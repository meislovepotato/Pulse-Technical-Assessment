# Development Notes

# Backend

## Fix: Prisma `Presence` Table Not Found

### Issue

While testing the polling endpoint, requests to `/api/poll` were failing with a Prisma `P2021` error:

```text
The table `public.Presence` does not exist in the current database.
```

This caused the endpoint to return:

```text
GET /api/poll?id=<id> 500
```

### Root Cause

The Prisma schema contained the `Presence` model, but the corresponding table had not yet been created in the PostgreSQL database.

As a result, Prisma Client attempted to query a table that did not exist.

### Resolution

Applied the pending Prisma migration:

```bash
npx prisma migrate dev
```

Migration output confirmed that the database schema was synchronized and the following tables were created:

- `Presence`
- `Signal`

### Verification

After running the migration:

- `POST /api/join` returned `200 OK`
- `GET /api/poll` returned `200 OK`
- Prisma queries executed successfully
- No further `P2021` errors occurred

Example successful logs:

```text
POST /api/join 200
GET /api/poll?id=<id> 200
GET /api/poll?id=<id> 200
GET /api/poll?id=<id> 200
```

### Additional Notes

The polling endpoint consistently responds in approximately 500ms. This appears to be expected behavior from the application's polling/long-polling implementation and is not related to database performance or Prisma.

## Fix: Presence Rows Never Expired

### Issue

User dots remained visible on the map after users closed the app.

### Root Cause

The polling endpoint refreshed `lastSeen` for all presence records on every poll request. Because every row was continuously updated, no presence record could become stale and expire.

### Resolution

Updated the heartbeat logic to refresh only the requesting user's presence record (`where: { id }`) instead of all rows.

### Verification

1. Open two clients and join the map.
2. Close one client.
3. Wait longer than `STALE_MS` (15 seconds by default).
4. Confirm the closed client's dot disappears from the remaining client's map.

### Result

Inactive users now expire correctly and are removed from the map once their `lastSeen` timestamp exceeds the stale timeout.

# Fix: Race Condition in Presence Cleanup (Polling System Instability)

## Issue

The live map occasionally showed inconsistent behavior where users would:

- appear online briefly
- disappear unexpectedly
- show `peers=0` even when active users existed

This was especially noticeable on mobile devices due to polling delays and background throttling.

---

## Root Cause

The `/api/poll` endpoint was previously responsible for multiple concerns:

- updating `lastSeen` (heartbeat)
- deleting stale presence rows
- deleting expired signals
- returning peer state

This created a race condition where multiple clients could simultaneously delete or modify global presence state during polling.

As a result:

- active users could be incorrectly removed during delayed polls
- different clients had inconsistent views of presence state
- mobile throttling amplified the issue

---

## Resolution

The system was refactored into a clear separation of concerns:

### `/api/poll`

- Only updates `lastSeen` for the requesting user (heartbeat)
- Only reads data (peers + signals)
- ❌ No deletions
- ❌ No cleanup logic

---

### `/api/cleanup`

- Sole authority for stale data removal
- Deletes:
  - inactive presence rows (`lastSeen < STALE_MS`)
  - expired signals (`createdAt < SIGNAL_TTL_MS`)
- Intended to be triggered by cron or scheduled job

---

### `/api/join`

- Remains responsible for creating/updating presence only
- Applies privacy offset and updates location + `lastSeen`

---

## Debugging Added

To trace the issue, lightweight server logs were added:

### Poll logs

[poll] id=<userId> peers=<count> ids=<peerIds>

Example:

[poll] id=e55... peers=1 ids=cf68...
[poll] id=e55... peers=0 ids=

### Join logs

[join] id=<userId> lat=<lat> lng=<lng>

---

## Example Debug Flow (Bug Reproduction)

### Scenario 1: Normal join

Phone -> online
PC -> online
Result: both see each other

---

### Scenario 2: Failure case (before fix)

Phone -> online
Phone -> offline
PC -> sees phone disappear
Phone -> online again
PC -> does NOT see phone return
(peers stays 0 or stale)

---

### Scenario 3: Observed unstable polling

[poll] peers=1 (phone visible)
[poll] peers=0 (phone suddenly disappears)
[poll] peers=1 (reappears briefly)
[poll] peers=0 (stays missing)

---

## Verification

1. Open two clients and join the map
2. Confirm both users appear online
3. Close one client
4. Wait longer than `STALE_MS`
5. Confirm user disappears consistently without flicker
6. Reconnect client and confirm presence restores correctly

---

## Result

Presence state is now stable and deterministic:

- Clients no longer mutate global state during polling
- Stale cleanup is server-controlled
- Mobile disconnects no longer cause incorrect deletions
- Peer visibility remains consistent across all clients

---

## Additional Notes

This refactor changes the system from a **client-driven cleanup model** to a **server-authoritative presence model**, eliminating race conditions caused by concurrent polling operations.

# Additional Fixes: Signaling Reliability & Duplicate Request Prevention

## Fix: Simultaneous Request Deadlock (Duplicate Request Handling)

### Issue

When two users clicked each other at the same time:

- Both sides emitted `"request"` signals simultaneously
- Both entered `"requesting"` state
- Both systems waited for the other to resolve first
- Result: stuck or inconsistent connection state

### Root Cause

No deterministic resolution strategy existed for concurrent requests between two peers.

### Fix

Introduced a **deterministic tie-break rule** using `sessionId` comparison:

```ts
const selfWins = sessionId > sig.fromId;
```

When both users initiate a request at the same time:

- Only one side is allowed to proceed as initiator
- The other side resolves the connection consistently
- Prevents duplicate negotiation flows

### Result

- Eliminated dual-request deadlocks
- Prevented mirrored “requesting ↔ requesting” loops
- Ensured only one WebRTC negotiation path is active per pair

---

## Fix: Duplicate / Stale Signal Handling in Request Flow

### Issue

Under delayed or repeated polling conditions:

- The same request signal could be processed multiple times
- Users could re-trigger connection logic from stale inbox data
- This caused inconsistent UI states (multiple transitions or stuck requesting)

### Fix

Added **signal deduplication layer in the client**:

```ts
const processedSignalIds = useRef(new Set<string>());
```

Before processing any signal:

- Check if signal ID was already handled
- Ignore duplicates safely
- Ensure each signal is processed exactly once per session

### Result

- No repeated request handling
- No duplicate state transitions
- Stable single-pass signal processing

---

## Fix: Request Collision Resolution (Request vs Request)

### Issue

If both peers were in `"requesting"` state and received each other’s request:

- Both would independently try to resolve the connection
- Could lead to both sides sending `"accept"` simultaneously
- Resulted in race condition during connection setup

### Fix

Centralized resolution logic inside `"request"` handler:

- If both sides are requesting each other:
  - apply deterministic winner rule
  - convert one side into initiator
  - prevent dual accept execution

### Result

- One consistent initiator per session
- No conflicting accept/accept race
- Stable connection handshake ordering

---

## Summary

This change improves **signal reliability only**, specifically:

- Prevents duplicate request processing
- Removes simultaneous request deadlocks
- Ensures deterministic resolution when both users initiate at once
- Adds client-side signal deduplication safety

## Fix: Peer Disconnect During Connection Flow (Stuck "Connecting" State)

### Issue

A race condition occurs when a peer disconnects during the connection handshake.

#### Example flow:

```
User1 -> request -> User2
```

User2 sees:

```
[Accept] [Decline]
```

If User1 closes the tab or loses connection:

- User1 stops polling
- User1 is removed from presence after cleanup
- User2 still sees the incoming prompt

If User2 then clicks **Accept**, the system proceeds normally:

- `startPeer(peerId, false)`
- `sendSignal("accept")`
- state becomes:

```
{ kind: "connecting" }
```

At this point:

- User1 no longer exists
- No WebRTC answer is ever received
- No ICE candidates arrive
- `onChannelOpen()` is never triggered

Result: User2 becomes permanently stuck in **Connecting...**

---

### Root Cause

The frontend does not validate whether the target peer still exists in the latest presence list before proceeding with a connection attempt.

Although polling updates `peers`, the connection logic never checks:

> "Is the peer I'm trying to connect to still online?"

---

### Solution

During each polling cycle, after updating the peer list:

```
setPeers(data.peers);
```

the client must verify that the currently active peer still exists in the server-provided presence list.

If the peer is no longer present:

- Immediately abort the connection flow
- Clear pending connection state
- Return the UI to a safe state

Conceptually:

- If `incoming` → reset to idle (safe cancel prompt)
- If `requesting / connecting / connected` → teardown session

Optionally, instead of hard resetting, a `peer-offline` state can be introduced to show a clearer UX message before resetting.

## Fix: Chat messages not appearing (WebRTC DataChannel)

### Root cause

Chat messages were not being received because the sender and receiver used different message types.

The sender was sending messages with type `"msg"`, while the receiver was only handling messages with type `"chat"`. As a result, incoming messages were ignored.

### Fix

Standardized the chat message type so both sender and receiver use `"chat"`.

### Why it was silent

Incoming DataChannel messages are parsed inside a try/catch block that ignores errors, so any unexpected message format failed without showing an error, making the issue appear as if messages were not sent at all.

## FIX: WebRTC Chat Issue: One-Way Messages

### Issue

After a successful connection:

User1 → request connection → User2
User2 → accepts
User1 ↔ User2 connected

The chat behaved incorrectly:

User2 → User1 messages ✅ worked
User1 → User2 messages ❌ did not arrive

The WebRTC connection appeared established, but the data channel was not fully synchronized.

---

### Root Cause

The issue was caused by the WebRTC negotiation flow in `webrtc.ts`.

Two problems were involved:

1. **ICE candidates were processed before the remote description was set**

The previous order was:

receive offer/answer
↓
add ICE candidates
↓
set remote description

ICE candidates depend on the remote SDP being available. Processing them too early caused incomplete negotiation and could leave the data channel in a partially working state.

2. **The data channel reference could be replaced during negotiation**

The receiving peer could overwrite an existing data channel handler, causing one side to hold an invalid or inactive channel reference.

---

### Solution

Updated the WebRTC flow:

receive offer/answer
↓
set remote description
↓
apply queued ICE candidates
↓
open data channel
↓
enable chat communication

Changes made:

- Moved `setRemoteDescription()` before ICE candidate flushing.
- Prevented duplicate data channel assignment.
- Added data channel lifecycle handling (`open`, `close`, `error`).
- Added validation before sending messages.

After the fix:

User1 → User2 messages
User2 → User1 messages
Both peers now have a synchronized RTCDataChannel after connection.

## Fix: Stale WebRTC Connection State After Offline/Rejoin

### Problem

A race condition could leave users stuck in a busy state after a failed WebRTC connection.

Example flow:

1. Phone sends a `request` signal.
   - Signal is stored in the `signal` table.

2. PC accepts.
   - PC sends an `accept` signal.
   - Server marks both users as `busy`.

3. Phone goes offline before WebRTC completes.

4. PC keeps waiting for the connection.

5. Phone disappears from polling because `lastSeen` expires.

6. PC detects the missing peer:

```ts
const peerStillHere = data.peers.some((p) => p.id === c.peerId);

if (!peerStillHere) {
  teardown("The stranger went offline.");
}
```

The PC destroys its local WebRTC state.

7. Phone reconnects later.

The phone does not know the previous connection failed because:

- the old `accept` signal was already consumed by polling or expired
- WebRTC negotiation never completed
- server-side `busy` state remained true
- the stale presence was not cleared immediately

When the PC sends another request, the phone receives it but rejects it because it still appears busy.

---

### Root Cause

The server trusted the `busy` flag longer than the actual connection lifetime.

`busy` represented "a connection was accepted", but there was no guarantee that:

- both peers were still online
- WebRTC was established
- the connection was still active

A disconnected client could leave stale state behind.

---

### Fix

The server now owns connection cleanup more strictly:

- Sender validation happens before changing busy state.
- Stale users cannot send signals or change connection state.
- Request targets must be online (`lastSeen` check) before accepting requests.
- `leave` removes the presence row completely instead of only marking it stale.
- `cleanup` removes expired users and clears related signals.
- Polling only updates heartbeat and reads data; it does not perform cleanup.
- Signal delivery deletes only valid consumed messages.

Additional protection:

- Auto-decline only happens when the requester is still online.
- A stale client cannot resurrect an old connection state.
- Busy state is cleared when users leave or expire.

---

### Result

Failed WebRTC attempts no longer permanently block users.

If a peer disappears:

- local WebRTC state is destroyed
- server presence expires
- stale signals are removed
- busy state is released
- users can reconnect normally.


# Frontend

## Phase 1 — UI Polish (Tier 1) USING CLAUDE

UI-only changes, no logic touched. Focused on the first impression, the core
loop (map → chat), and visual consistency.

### 1. Design system + keyframes (`app/globals.css`)

Replaced the minimal theme block with a full token system:
- Color tokens (`--bg-base`, `--bg-glass`, `--accent-from/to`, `--danger`, `--warning`, borders, radii).
- Shared easing curves (`--ease-out`, `--ease-in-out`).
- Keyframes reused across components: `ambient-drift-a/b`, `heartbeat`, `rise`,
  `progress-slide`, `pulse-ring`, `me-pulse`, `me-ring`, `toast-in/out/drain`,
  `modal-backdrop-in`, `modal-card-in`, `hud-in`.
- A `prefers-reduced-motion` block that collapses every animation.

### 2. Cinematic EntryGate (`app/components/EntryGate.tsx`)

- Two slow-drifting blurred radial blobs (CSS-only) + a masked grid layer for depth.
- Custom SVG pulse-glyph wordmark with a heartbeat animation.
- Staggered fade-rise on every text/button line.
- Gradient-glow primary button (emerald → cyan) with a shimmer sweep on hover
  and an active-press scale.
- Locating state: spinner inside the button + animated progress bar underneath.
- Slide-in error card with a leading `!` glyph.

### 3. Toast system (`app/components/Toast.tsx`, new)

Replaced the flat `bg-zinc-800/90` pill with a glass-morphism toast:
- Three variants — `info` (emerald), `warn` (amber), `error` (red) — color-coded dot + drain bar.
- Slide-in from top + fade-out 220ms before unmount (synced with the 3.5s dismiss).
- Bottom drain bar scales 1 → 0 over 3.5s to visualize the auto-dismiss.

### 4. WorldMap upgrade (`app/components/WorldMap.tsx`)

- Dots: layered animation — staggered expanding ring + inner core highlight; busy peers desaturated and static.
- "You are here" pin: custom CSS dot (glowing core + expanding ring) instead of the generic 📍.
- Glass HUD (bottom-left): live dot + online count + locale-derived region (e.g. `US`).
- Leave icon button (bottom-right): calls `leave()` and routes back to the EntryGate.
- Subtle radial vignette over the map so dots and HUD pop on bright regions.

### 5. `app/page.tsx` wiring

- `notice` state is now `{ message, variant }`; every `showNotice` / `teardown` call site classified (`error` for camera/network failures, `warn` for peer-offline/declined/timeout).
- `teardown(message, variant?)` defaults to `"warn"`, preserving existing call sites.
- Inline notice `<div>` replaced with `<Toast … />`.
- New `handleLeave` callback passed to `WorldMap`: calls `leave()` → `teardown()` → resets local state → `setPhase("gate")`.

### Verification

- `npx tsc --noEmit` — clean.
- `npx eslint app/` — clean (fixed one `react-hooks/set-state-in-effect` by deriving the region from a `useState` initializer instead of an effect).
- Mapbox attribution and existing dark-v11 style preserved; map controls unchanged.

## Phase 2 — UI Polish (Tier 2)

UI-only follow-up: refine the modal, the chat, the video call, and the
transient status pills. Added a small shared button system so the surfaces
feel of-a-piece.

### 1. Shared button system (`app/globals.css`)

- `.pulse-btn` base (pill, transition, focus/disabled states, active scale).
- `.pulse-btn-ghost` — for cancel/end; turns danger-tinted on hover.
- `.pulse-btn-gradient` — emerald→cyan gradient with shimmer sweep + glow;
  reused on the entry screen and the prompt's Accept.
- `.pulse-btn-round`, `.pulse-btn-end` — for the video control bar.

### 2. ConnectionPrompt (`app/components/ConnectionPrompt.tsx`)

- Radial-gradient backdrop that highlights the modal area instead of a flat
  black/60 wash.
- Modal-card entrance animation (`pulse-modal-backdrop` + `pulse-modal-card`).
- A pulse-ring glyph above the title that echoes the map dots.
- Decline → ghost button (tints red on hover); Accept → gradient button.

### 3. StatusPill (`app/components/StatusPill.tsx`, new)

Replaces the two `bg-zinc-800/90` flat pills:
- Glass-morphism pill with slide-in entrance.
- Two variants: `arc` (spinning ring) for "Requesting connection" and `dot`
  (pulsing dot) for "Waiting for stranger to accept video…".
- Optional inline `Cancel` action button.
- Used at top-center (requesting) and bottom-center (video waiting).

### 4. ChatPanel (`app/components/ChatPanel.tsx`)

- New `peerId` prop drives a color-hashed avatar in the header (same hash as
  the map dot, so the chat visually belongs to the dot you tapped).
- Status dot in the header turns emerald + blinks when connected, amber while
  connecting.
- Messages: gradient emerald→cyan for "mine" with a soft glow, neutral
  glass-style for "them", tails via asymmetric border-radius, fade+slide
  entry animation, scroll-to-bottom on new message.
- Empty state: speech-bubble icon inside a glass chip + a one-liner about
  P2P privacy.
- Composer: glass input with a soft focus ring; send button is a paper-plane
  SVG in a gradient circle that gently pulses when the draft is non-empty.
- Header actions: Video and End both use the new button system; "End" is
  the ghost variant (red on hover) instead of a solid red block.

### 5. VideoPanel (`app/components/VideoPanel.tsx`)

- Cinematic vignette overlay on the remote video.
- Top-left "Stranger" name pill with a red live-dot.
- Waiting state: animated concentric rings (3 staggered) instead of plain
  text.
- Picture-in-picture: rounded card with a soft border and a subtle scale on
  hover.
- Bottom-center frosted control bar with a gradient-pink "End" button
  (red→pink) — visually distinct from the chat's neutral End.

### Decision: video mic/cam toggles

The earlier Tier-2 spec mentioned mic/cam toggle buttons in the video control
bar. I intentionally did **not** add them — toggling local media tracks
would be a logic change (muting `MediaStream` tracks, signaling peer, etc.),
which is out of scope for UI-only. The control bar is shipped with just the
End button for now; adding toggles later only requires wiring the existing
local stream.

### Verification

- `npx tsc --noEmit` — clean.
- `npx eslint app/` — clean.
- `npx next build` — compiled successfully (8.9s, Turbopack).

## Phase 2 — UI Polish (Tier 3)

UI-only follow-up: map controls, empty-state treatment, typography.

### 1. Map recenter + first-load fit-bounds (`app/components/WorldMap.tsx`)

- New `pulse-recenter` button (crosshair icon) stacked above the leave button
  in the bottom-right corner. Hover tints to emerald, active scales down;
  the icon spins while a `flyTo` is in flight.
- `handleRecenter` calls `map.flyTo({ center: [me.lng, me.lat], zoom: 4, duration: 1500 })`.
- New effect performs a one-time `fitBounds` (padding 80, 1.4s, max zoom 5.5)
  over `me` + all current peers when the map first becomes ready with at
  least one peer. Uses a `hasFitInitialRef` so it never re-runs.
- `disabled` when `me` is null so the button is never a no-op.

### 2. Empty-state panel (`app/page.tsx`)

- New `pulse-empty` glass card centered on the map, shown when
  `peers.length === 0` and the user is `phase === "live"`.
- 1.5s show delay (so polling flicker doesn't flash it), 400ms fade-out
  when peers appear (`pulse-empty-leaving`).
- Animated concentric pulse + dot, "Looking for people nearby…" headline,
  one-line subcopy.
- Implemented with two pieces of state (`emptyVisible`, `emptyLeaving`) all
  updated from `setTimeout` callbacks inside a single effect — no synchronous
  setState in effects, passes `react-hooks/set-state-in-effect`.

### 3. Typography refinements

- New utility classes in `globals.css`:
  - `.pulse-display` — `font-feature-settings: "ss01", "cv11", "ss03";` and
    tighter letter-spacing for large display text.
  - `.pulse-numeric` — `font-variant-numeric: tabular-nums` for the online
    count and any number that changes in real time.
  - `.pulse-mono` — Geist Mono with a robust fallback stack for technical
    text (region code, etc.).
  - `.pulse-eyebrow` — small-caps style for labels.
- Applied in `WorldMap` HUD (count + region), `EntryGate` wordmark
  (`pulse-display`).
- Follow-up (same Tier 3 branch) — extended the refinements to the
  surfaces that actually carry weight in the UI:
  - `ConnectionPrompt` h2 gets `pulse-display`.
  - `pulse-chat-name` rule tightened (`letter-spacing: -0.012em`) with
    `font-feature-settings`.
  - `pulse-empty-title` rule tightened (`letter-spacing: -0.018em`) with
    `font-feature-settings`.
  - `pulse-video-name` flipped from positive tracking (`0.02em`) to
    display-negative (`-0.01em`) with font features — was the only
    typography outlier.
  - `pulse-toast` rule gets a subtle `-0.005em` tracking + font features
    so the message text feels of-a-piece with the rest.

### Verification

- `npx tsc --noEmit` — clean.
- `npx eslint app/` — clean.
- `npx next build` — compiled successfully (8.0s, Turbopack).

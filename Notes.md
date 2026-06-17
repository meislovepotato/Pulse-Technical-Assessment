# Development Notes

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
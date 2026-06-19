"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import EntryGate from "./components/EntryGate";
import WorldMap from "./components/WorldMap";
import ConnectionPrompt from "./components/ConnectionPrompt";
import ChatPanel, { type ChatMessage } from "./components/ChatPanel";
import VideoPanel from "./components/VideoPanel";
import StatusPill from "./components/StatusPill";
import Toast, { type ToastVariant } from "./components/Toast";
import { join, leave, poll, sendSignal } from "@/lib/api";
import { PeerSession, type DescType, type PeerControl } from "@/lib/webrtc";
import { POLL_INTERVAL_MS } from "@/lib/presence";
import { type PeerDot, type SignalMsg } from "@/lib/types";

type Conn =
  | { kind: "idle" }
  | { kind: "requesting"; peerId: string }
  | { kind: "incoming"; peerId: string }
  | { kind: "connecting"; peerId: string }
  | { kind: "connected"; peerId: string }
  | { kind: "peer-offline"; peerId: string };

type VideoState = "none" | "requesting" | "incoming" | "active";

const REQUEST_TIMEOUT_MS = 30_000;

export default function Home() {
  const [phase, setPhase] = useState<"gate" | "live">("gate");
  const [sessionId] = useState(() => crypto.randomUUID());
  const [peers, setPeers] = useState<PeerDot[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [myLocation, setMyLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(null);

  const [conn, _setConn] = useState<Conn>({ kind: "idle" });
  const connRef = useRef<Conn>(conn);
  const setConn = (c: Conn) => {
    connRef.current = c;
    _setConn(c);
  };

  const [video, _setVideo] = useState<VideoState>("none");
  const videoRef = useRef<VideoState>(video);
  const setVideo = (v: VideoState) => {
    videoRef.current = v;
    _setVideo(v);
  };

  const pendingSignals = useRef<SignalMsg[]>([]);
  const peerRef = useRef<PeerSession | null>(null);
  const msgId = useRef(0);
  const requestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const [notice, setNotice] = useState<{ message: string; variant: ToastVariant } | null>(null);
  const [emptyVisible, setEmptyVisible] = useState(false);
  const [emptyLeaving, setEmptyLeaving] = useState(false);

  const showNotice = useCallback(
    (text: string, variant: ToastVariant = "info") => {
      setNotice({ message: text, variant });

      if (noticeTimer.current !== null) {
        clearTimeout(noticeTimer.current);
      }

      noticeTimer.current = window.setTimeout(() => {
        setNotice(null);
      }, 3500);
    },
    [],
  );

  function addMessage(mine: boolean, text: string) {
    setMessages((prev) => [...prev, { id: msgId.current++, mine, text }]);
  }

  const teardown = useCallback(
    (message?: string, variant: ToastVariant = "warn") => {
      if (requestTimer.current) {
        clearTimeout(requestTimer.current);
        requestTimer.current = null;
      }
      peerRef.current?.close();
      peerRef.current = null;
      setLocalStream(null);
      setRemoteStream(null);
      setVideo("none");
      setMessages([]);
      setConn({ kind: "idle" });
      if (message) showNotice(message, variant);
    },
    [showNotice],
  );

  function startPeer(peerId: string, initiator: boolean) {
    const ps = new PeerSession(initiator, {
      onSignal: (type: DescType, payload: string) => {
        void sendSignal(sessionId, peerId, type, payload);
      },
      onChat: (text) => addMessage(false, text),
      onControl: (ctrl) => handleControl(ctrl),
      onRemoteStream: (stream) => setRemoteStream(stream),
      onConnectionState: (state) => {
        if (state === "failed") {
          teardown("Connection failed (network).", "error");
        }
      },
      onChannelOpen: () => {
        if (requestTimer.current) {
          clearTimeout(requestTimer.current);
          requestTimer.current = null;
        }
        setConn({ kind: "connected", peerId });
      },
    });
    peerRef.current = ps;

    const queued = pendingSignals.current;
    pendingSignals.current = [];

    for (const sig of queued) {
      void ps.handleSignal(sig.type as DescType, sig.payload ?? "");
    }
  }

  function handleControl(ctrl: PeerControl) {
    const ps = peerRef.current;
    switch (ctrl) {
      case "video-request":
        if (videoRef.current === "none") setVideo("incoming");
        break;
      case "video-accept":
        if (videoRef.current === "requesting" && ps) {
          ps.startVideo()
            .then((stream) => {
              setLocalStream(stream);
              setVideo("active");
            })
            .catch(() => {
              setVideo("none");
              ps.sendControl("video-end");
              showNotice("Camera unavailable.", "error");
            });
        }
        break;
      case "video-decline":
        if (videoRef.current === "requesting") {
          setVideo("none");
          showNotice("Video declined.", "warn");
        }
        break;
      case "video-end":
        ps?.stopVideo();
        setLocalStream(null);
        setRemoteStream(null);
        setVideo("none");
        break;
    }
  }

  function requestConnection(peerId: string) {
    if (connRef.current.kind !== "idle") return;
    setConn({ kind: "requesting", peerId });
    void sendSignal(sessionId, peerId, "request");
    requestTimer.current = setTimeout(() => {
      if (
        connRef.current.kind === "requesting" &&
        connRef.current.peerId === peerId
      ) {
        void sendSignal(sessionId, peerId, "end");
        teardown("No answer.");
        requestTimer.current = null;
      }
    }, REQUEST_TIMEOUT_MS);
  }

  

  function cancelRequest() {
    if (connRef.current.kind === "requesting") {
      void sendSignal(sessionId, connRef.current.peerId, "end");
    }
    teardown();
  }

  function acceptIncoming() {
    if (connRef.current.kind !== "incoming") return;
    const peerId = connRef.current.peerId;
    startPeer(peerId, false);
    void sendSignal(sessionId, peerId, "accept");
    setConn({ kind: "connecting", peerId });
    
  }

  function declineIncoming() {
    if (connRef.current.kind !== "incoming") return;
    void sendSignal(sessionId, connRef.current.peerId, "decline");
    setConn({ kind: "idle" });
  }

  function endConnection() {
    const c = connRef.current;
    if (c.kind === "connecting" || c.kind === "connected") {
      void sendSignal(sessionId, c.peerId, "end");
    }
    teardown();
  }

  function startVideoRequest() {
    if (videoRef.current !== "none" || !peerRef.current) return;
    setVideo("requesting");
    peerRef.current.sendControl("video-request");
  }

  function acceptVideo() {
    const ps = peerRef.current;
    if (!ps) return;
    ps.startVideo()
      .then((stream) => {
        setLocalStream(stream);
        ps.sendControl("video-accept");
        setVideo("active");
      })
      .catch(() => {
        ps.sendControl("video-decline");
        setVideo("none");
        showNotice("Camera unavailable.", "error");
      });
  }

  function declineVideo() {
    peerRef.current?.sendControl("video-decline");
    setVideo("none");
  }

  function endVideo() {
    const ps = peerRef.current;
    ps?.stopVideo();
    ps?.sendControl("video-end");
    setLocalStream(null);
    setRemoteStream(null);
    setVideo("none");
  }

  function processSignal(sig: SignalMsg) {
    switch (sig.type) {
      case "request": {
        const c = connRef.current;

        // deterministic tie-breaker
        const selfWins = sessionId > sig.fromId; // or use lexicographic rule

        if (c.kind === "requesting" && c.peerId === sig.fromId) {
          if (selfWins) {
            // we win → treat as accept instead of decline
            startPeer(sig.fromId, true);
            void sendSignal(sessionId, sig.fromId, "accept");
            setConn({ kind: "connecting", peerId: sig.fromId });
            
          } else {
            // we lose → accept theirs
            void sendSignal(sessionId, sig.fromId, "accept");
            startPeer(sig.fromId, false);
            setConn({ kind: "connecting", peerId: sig.fromId });
            
          }
          break;
        }

        if (c.kind === "idle") {
          setConn({ kind: "incoming", peerId: sig.fromId });
        } else {
          void sendSignal(sessionId, sig.fromId, "decline");
        }
        break;
      }
      case "accept": {
        const c = connRef.current;
        if (c.kind === "requesting" && c.peerId === sig.fromId) {
          if (requestTimer.current) {
            clearTimeout(requestTimer.current);
            requestTimer.current = null;
          }
          startPeer(sig.fromId, true);
          setConn({ kind: "connecting", peerId: sig.fromId });
          
        }
        break;
      }
      case "decline": {
        const c = connRef.current;
        if (c.kind === "requesting" && c.peerId === sig.fromId) {
          if (requestTimer.current) {
            clearTimeout(requestTimer.current);
            requestTimer.current = null;
          }
          teardown("Request declined.");
        }
        break;
      }
      case "offer":
      case "answer":
      case "ice": {
        const c = connRef.current;
        const peerId =
          c.kind === "connecting" || c.kind === "connected" ? c.peerId : null;
        if (peerId !== sig.fromId) {
          break;
        }

        if (!peerRef.current) {
          pendingSignals.current.push(sig);
          break;
        }

        void peerRef.current.handleSignal(
          sig.type as DescType,
          sig.payload ?? "",
        );

        break;
      }
      case "end": {
        const c = connRef.current;
        if (
          (c.kind === "incoming" ||
            c.kind === "connecting" ||
            c.kind === "connected") &&
          c.peerId === sig.fromId
        ) {
          if (c.kind === "incoming") setConn({ kind: "idle" });
          else teardown("Stranger disconnected.");
        }
        break;
      }
    }
  }

  const processSignalRef = useRef(processSignal);
  useEffect(() => {
    processSignalRef.current = processSignal;
  });

  // Avoid processing the same signal multiple times in the frontend in case
  // the server returns duplicates (e.g. before cleanup runs). We keep a
  // small in-memory set of processed signal ids for the lifetime of this
  // session.
  const processedSignalIds = useRef(new Set<string>());

  useEffect(() => {
    if (phase !== "live" || !sessionId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const data = await poll(sessionId);
        if (!active) return;
        setPeers(data.peers);

        // If our current peer disappeared from the server list, abort safely.
        const c = connRef.current;
        if (
          c.kind === "requesting" ||
          c.kind === "incoming" ||
          c.kind === "connecting" ||
          c.kind === "connected"
        ) {
          const peerStillHere = data.peers.some((p) => p.id === c.peerId);
          if (!peerStillHere) {
            if (c.kind === "incoming") {
              setConn({ kind: "idle" });
              showNotice("The stranger went offline.", "warn");
            } else {
              if (requestTimer.current) {
                clearTimeout(requestTimer.current);
                requestTimer.current = null;
              }
              teardown("The stranger went offline.", "warn");
            }
            // skip processing signals this tick
            if (active) timer = setTimeout(tick, POLL_INTERVAL_MS);
            return;
          }
        }

        for (const s of data.signals) {
          if (processedSignalIds.current.has(s.id)) continue;
          processedSignalIds.current.add(s.id);
          processSignalRef.current(s);
        }
      } catch {
        const c = connRef.current;

        if (
          c.kind === "requesting" ||
          c.kind === "incoming" ||
          c.kind === "connecting"
        ) {
          teardown("Connection lost.", "error");
        }
      }
      if (active) timer = setTimeout(tick, POLL_INTERVAL_MS);
    };
    tick();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [phase, sessionId, teardown, showNotice]);

  useEffect(() => {
    if (!sessionId || phase !== "live") return;
    const onLeave = () => leave(sessionId);
    window.addEventListener("pagehide", onLeave);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("pagehide", onLeave);
      window.removeEventListener("beforeunload", onLeave);
    };
  }, [sessionId, phase]);

  // Empty-state panel: shown when no peers are online (and we're connected),
  // with a short delay so polling flicker doesn't trigger it, and a leaving
  // animation when peers finally appear.
  useEffect(() => {
    if (phase !== "live") return;
    const timers: number[] = [];

    if (peers.length > 0) {
      // Begin the leaving animation, then unmount after the leave duration.
      timers.push(window.setTimeout(() => {
        setEmptyLeaving(true);
        timers.push(window.setTimeout(() => {
          setEmptyVisible(false);
          setEmptyLeaving(false);
        }, 400));
      }, 0));
    } else {
      // Show after a short delay so transient zero-peer ticks don't flash it.
      timers.push(window.setTimeout(() => {
        setEmptyVisible(true);
        setEmptyLeaving(false);
      }, 1500));
    }

    return () => {
      timers.forEach((t) => clearTimeout(t));
    };
  }, [peers.length, phase]);

  async function handleReady(lat: number, lng: number) {
    setMyLocation({ lat, lng });
    await join(sessionId, lat, lng);
    setPhase("live");
  }

  function handleLeave() {
    if (sessionId) leave(sessionId);
    teardown();
    setPeers([]);
    setMyLocation(null);
    setPhase("gate");
  }

  if (phase === "gate") {
    return <EntryGate onReady={handleReady} />;
  }

  const inChat = conn.kind === "connecting" || conn.kind === "connected";

  return (
    <main className="fixed inset-0 overflow-hidden">
      <WorldMap
        peers={peers}
        me={myLocation}
        onPeerClick={requestConnection}
        canConnect={conn.kind === "idle"}
        onLeave={handleLeave}
        sessionId={sessionId}
      />

      {notice && <Toast message={notice.message} variant={notice.variant} />}

      {emptyVisible && (
        <div
          className={`pulse-empty ${emptyLeaving ? "pulse-empty-leaving" : ""}`}
          role="status"
          aria-live="polite"
        >
          <span className="pulse-empty-pulse" aria-hidden="true">
            <span className="pulse-empty-pulse-dot" />
          </span>
          <div>
            <p className="pulse-empty-title">Looking for people nearby…</p>
            <p className="pulse-empty-sub">
              You&rsquo;re live. New dots appear here the moment someone joins.
            </p>
          </div>
        </div>
      )}

      {conn.kind === "requesting" && (
        <StatusPill
          text="Requesting connection…"
          position="top"
          variant="arc"
          actionLabel="Cancel"
          onAction={cancelRequest}
        />
      )}

      {conn.kind === "incoming" && (
        <ConnectionPrompt
          title="A stranger wants to connect"
          acceptLabel="Accept"
          declineLabel="Decline"
          onAccept={acceptIncoming}
          onDecline={declineIncoming}
        />
      )}

      {inChat && (
        <ChatPanel
          messages={messages}
          connected={conn.kind === "connected"}
          videoBusy={video !== "none"}
          peerId={conn.peerId}
          onSend={(text) => {
            peerRef.current?.sendChat(text);
            addMessage(true, text);
          }}
          onStartVideo={startVideoRequest}
          onEnd={endConnection}
        />
      )}

      {video === "requesting" && (
        <StatusPill
          text="Waiting for stranger to accept video…"
          position="bottom"
          variant="dot"
        />
      )}

      {video === "incoming" && (
        <ConnectionPrompt
          title="Start video call?"
          subtitle="The stranger wants to turn on video."
          acceptLabel="Accept"
          declineLabel="Decline"
          onAccept={acceptVideo}
          onDecline={declineVideo}
        />
      )}

      {video === "active" && (
        <VideoPanel
          localStream={localStream}
          remoteStream={remoteStream}
          onEnd={endVideo}
        />
      )}
    </main>
  );
}

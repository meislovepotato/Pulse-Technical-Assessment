"use client";

import { useEffect, useRef, useState } from "react";

export interface ChatMessage {
  id: number;
  mine: boolean;
  text: string;
}

// Same color-hash as WorldMap.tsx — keeps the chat avatar visually bound
// to the dot on the map that the user is talking to.
function avatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return `hsl(${Math.abs(hash) % 360}, 70%, 60%)`;
}

function PaperPlaneIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4 -9 -9 -4 20 -7z" />
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="6" width="14" height="12" rx="2" />
      <path d="M17 10l4 -2v8l-4 -2z" />
    </svg>
  );
}

function EndIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 13a9 9 0 0 1 18 0" />
      <path
        d="M16 16.5l3.5 -3.5h2v-3a2 2 0 0 0 -2 -2h-3v2l-3.5 3.5"
        transform="translate(0 -1)"
      />
    </svg>
  );
}

function BubbleIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12a8 8 0 0 1 -11.5 7.2L3 21l1.8 -6.5A8 8 0 1 1 21 12z" />
    </svg>
  );
}

export default function ChatPanel({
  messages,
  connected,
  videoBusy,
  peerId,
  onSend,
  onStartVideo,
  onEnd,
}: {
  messages: ChatMessage[];
  connected: boolean;
  videoBusy: boolean;
  peerId: string;
  onSend: (text: string) => void;
  onStartVideo: () => void;
  onEnd: () => void;
}) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const color = avatarColor(peerId);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !connected) return;
    onSend(text);
    setDraft("");
  }

  const sendEnabled = connected && draft.trim().length > 0;

  return (
    <aside className="pulse-chat">
      {/* Header */}
      <header className="pulse-chat-header">
        <div className="pulse-chat-peer">
          <span
            className="pulse-chat-avatar"
            style={{ background: color, color }}
            aria-hidden="true"
          />
          <div className="pulse-chat-meta">
            <span className="pulse-chat-name">Stranger</span>
            <span
              className="pulse-chat-status"
              data-state={connected ? "connected" : "connecting"}
            >
              <span className="pulse-chat-status-dot" aria-hidden="true" />
              {connected ? "Connected" : "Connecting…"}
            </span>
          </div>
        </div>
        <div className="pulse-chat-actions">
          <button
            onClick={onStartVideo}
            disabled={!connected || videoBusy}
            className="pulse-btn"
            aria-label="Start video call"
            title="Start video"
          >
            <VideoIcon />
            <span className="hidden sm:inline">Video</span>
          </button>
          <button
            onClick={onEnd}
            className="pulse-btn pulse-btn-ghost"
            aria-label="End chat"
            title="End chat"
          >
            <EndIcon />
            <span className="hidden sm:inline">End</span>
          </button>
        </div>
      </header>

      {/* Messages */}
      <div className="pulse-chat-messages">
        {messages.length === 0 ? (
          <div className="pulse-chat-empty">
            <span className="pulse-chat-empty-icon" aria-hidden="true">
              <BubbleIcon />
            </span>
            <span>Say hello.</span>
            <span className="text-xs text-zinc-500">
              Messages are peer-to-peer and never stored.
            </span>
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`pulse-msg ${m.mine ? "pulse-msg-mine" : "pulse-msg-them"}`}
            >
              <span className="pulse-msg-bubble">{m.text}</span>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      {/* Composer */}
      <form onSubmit={submit} className="pulse-chat-composer">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={connected ? "Type a message…" : "Connecting…"}
          disabled={!connected}
          className="pulse-chat-input"
          aria-label="Message"
        />
        <button
          type="submit"
          disabled={!sendEnabled}
          className={`pulse-chat-send ${sendEnabled ? "pulse-chat-send-pulse" : ""}`}
          aria-label="Send"
          title="Send"
        >
          <PaperPlaneIcon />
        </button>
      </form>
    </aside>
  );
}

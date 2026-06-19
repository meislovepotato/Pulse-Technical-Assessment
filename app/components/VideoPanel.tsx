"use client";

import { useEffect, useRef } from "react";

export default function VideoPanel({
  localStream,
  remoteStream,
  onEnd,
}: {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  onEnd: () => void;
}) {
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (localRef.current && localRef.current.srcObject !== localStream) {
      localRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteRef.current && remoteRef.current.srcObject !== remoteStream) {
      remoteRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  return (
    <div className="pulse-video">
      <div className="pulse-video-stage">
        {/* Remote (full screen) */}
        <video
          ref={remoteRef}
          autoPlay
          playsInline
          className="pulse-video-remote"
        />

        {/* Vignette for cinematic feel */}
        <div className="pulse-video-vignette" aria-hidden="true" />

        {/* Name pill (top-left) */}
        <div className="pulse-video-name" aria-label="Stranger">
          <span className="pulse-video-name-dot" aria-hidden="true" />
          Stranger
        </div>

        {/* Waiting state */}
        {!remoteStream && (
          <div className="pulse-video-waiting" aria-live="polite">
            <div className="pulse-video-waiting-ring" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <span>Waiting for stranger&rsquo;s video…</span>
          </div>
        )}

        {/* Local (picture-in-picture) */}
        <div className="pulse-video-pip">
          <video ref={localRef} autoPlay playsInline muted />
        </div>

        {/* Floating control bar */}
        <div className="pulse-video-controls">
          <button
            onClick={onEnd}
            className="pulse-btn pulse-btn-end"
            aria-label="End video call"
            title="End video"
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 13a9 9 0 0 1 18 0" />
              <path d="M21 13v-3a2 2 0 0 0 -2 -2h-3" />
              <path d="M3 13v-3a2 2 0 0 1 2 -2h3" />
              <path d="M9 17l-1.5 -1.5" />
              <path d="M15 17l1.5 -1.5" />
            </svg>
            <span>End</span>
          </button>
        </div>
      </div>
    </div>
  );
}

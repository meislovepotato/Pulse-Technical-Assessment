"use client";

import { useState } from "react";

/* A simple inline pulse-line glyph, drawn as an SVG so it scales with the
 * wordmark. Mirrors the heart-beat of the product. */
function PulseGlyph({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M3 12h4l2 -6l4 12l2 -6h6" />
    </svg>
  );
}

export default function EntryGate({
  onReady,
}: {
  onReady: (lat: number, lng: number) => void;
}) {
  const [status, setStatus] = useState<"idle" | "locating" | "error">("idle");
  const [error, setError] = useState<string>("");

  function enter() {
    if (!("geolocation" in navigator)) {
      setStatus("error");
      setError("Your browser doesn't support location access.");
      return;
    }
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => onReady(pos.coords.latitude, pos.coords.longitude),
      (err) => {
        setStatus("error");
        setError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission is required to place you on the map."
            : "Couldn't get your location. Please try again.",
        );
      },
      // High accuracy + maximumAge:0 forces a fresh fix (Wi-Fi/GPS scan)
      // instead of reusing the browser's cached IP-based location.
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }

  const locating = status === "locating";

  return (
    <main className="relative flex min-h-full flex-1 flex-col items-center justify-center overflow-hidden bg-zinc-950 p-6 text-zinc-100">
      {/* Ambient background layers (z-0) */}
      <div className="pulse-grid" aria-hidden="true" />
      <div className="pulse-ambient" aria-hidden="true" />

      {/* Vignette to seat the foreground */}
      <div
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 0%, rgba(0,0,0,0.55) 90%)",
        }}
        aria-hidden="true"
      />

      {/* Foreground content */}
      <div className="relative z-10 flex flex-col items-center gap-8 text-center">
        <div className="pulse-rise pulse-rise-1">
          <span className="pulse-wordmark">
            <PulseGlyph className="pulse-wordmark-icon" />
            Pulse
          </span>
        </div>

        <p className="pulse-rise pulse-rise-2 max-w-md text-base leading-relaxed text-zinc-400">
          A living globe of anonymous strangers.
          <br className="hidden sm:block" />
          <span className="text-zinc-300"> Drop onto the map and connect.</span>
        </p>

        <div className="pulse-rise pulse-rise-3 flex flex-col items-center">
          <button
            onClick={enter}
            disabled={locating}
            className="pulse-btn-primary"
          >
            {locating ? (
              <>
                <svg
                  className="h-4 w-4 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="9"
                    stroke="currentColor"
                    strokeOpacity="0.25"
                    strokeWidth="2.5"
                  />
                  <path
                    d="M21 12a9 9 0 0 1 -9 9"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                </svg>
                Locating…
              </>
            ) : (
              <>
                Enter Pulse
                <svg
                  className="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M5 12h14M13 6l6 6 -6 6" />
                </svg>
              </>
            )}
          </button>
          {locating && <span className="pulse-progress" aria-hidden="true" />}
        </div>

        {status === "error" && (
          <div className="pulse-rise pulse-rise-4 max-w-sm">
            <p className="pulse-error">{error}</p>
          </div>
        )}

        <p className="pulse-rise pulse-rise-5 max-w-sm text-xs leading-relaxed text-zinc-500">
          No sign-up. Your dot is placed 1–3 km from your real location.
          <br />
          Nothing is stored — closing the tab ends everything.
        </p>
      </div>
    </main>
  );
}

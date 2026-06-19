"use client";

import { useEffect, useRef, useState } from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Map as MapboxMap, Marker } from "mapbox-gl";
import type { PeerDot } from "@/lib/types";
import { leave } from "@/lib/api";

const TOKEN =
  process.env.NEXT_PUBLIC_MAPBOX_TOKEN ??
  "pk.eyJ1IjoicHVsc2UtbWFwIiwiYSI6ImNrMDBkZW1vMDAwMDAwMDAifQ.AAAAAAAAAAAAAAAAAAAAAA";

function dotColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return `hsl(${Math.abs(hash) % 360}, 70%, 60%)`;
}

function CrosshairIcon() {
  return (
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
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
    </svg>
  );
}

export default function WorldMap({
  peers,
  me,
  onPeerClick,
  canConnect,
  onLeave,
  sessionId,
}: {
  peers: PeerDot[];
  me: { lat: number; lng: number } | null;
  onPeerClick: (id: string) => void;
  canConnect: boolean;
  onLeave: () => void;
  sessionId: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const markersRef = useRef<Map<string, Marker>>(new Map());
  const meMarkerRef = useRef<Marker | null>(null);
  const [ready, setReady] = useState(false);
  // True while a recenter flyTo is in flight (drives the spin animation).
  const [flying, setFlying] = useState(false);
  // Whether the first-load fit-bounds has been performed — only once.
  const hasFitInitialRef = useRef(false);
  // Derive region once on mount from the browser locale — no reactivity needed.
  const [region] = useState<string | null>(() => {
    if (typeof navigator === "undefined") return null;
    const regionPart = (navigator.language || "").split("-")[1];
    if (regionPart && regionPart.length === 2) return regionPart.toUpperCase();
    return null;
  });

  // Marker click handlers are bound once, so read the live click handler +
  // connectability through refs (synced in an effect, never during render).
  const onPeerClickRef = useRef(onPeerClick);
  const canConnectRef = useRef(canConnect);
  useEffect(() => {
    onPeerClickRef.current = onPeerClick;
    canConnectRef.current = canConnect;
  });

  // Initialise the map once.
  useEffect(() => {
    if (!TOKEN || !containerRef.current) return;
    let cancelled = false;
    const markers = markersRef.current;

    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled || !containerRef.current) return;
      mapboxgl.accessToken = TOKEN;
      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/dark-v11",
        // Open centered on the user if we know where they are, else world view.
        center: me ? [me.lng, me.lat] : [0, 20],
        zoom: me ? 4 : 1.4,
        attributionControl: true,
        pitchWithRotate: false,
        dragRotate: false,
      });
      map.on("load", () => {
        if (!cancelled) setReady(true);
      });
      mapRef.current = map;
    })();

    return () => {
      cancelled = true;
      markers.forEach((m) => m.remove());
      markers.clear();
      meMarkerRef.current?.remove();
      meMarkerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      setReady(false);
    };
    // `me` is only read for the initial center; we don't want to re-init on change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Show / move the user's own "you are here" pin.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !me) return;
    let cancelled = false;

    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled) return;
      if (!meMarkerRef.current) {
        const el = document.createElement("div");
        el.className = "pulse-me";
        el.title = "You are here";
        el.innerHTML = `
          <span class="pulse-me-ring"></span>
          <span class="pulse-me-core"></span>
          <span class="pulse-me-label">You</span>
        `;
        // anchor "bottom" → the pin's tip sits on the exact coordinate.
        meMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: "bottom" })
          .setLngLat([me.lng, me.lat])
          .addTo(map);
      } else {
        meMarkerRef.current.setLngLat([me.lng, me.lat]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [me, ready]);

  // Reconcile markers whenever the peer list changes (or the map becomes ready).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let cancelled = false;

    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled) return;
      const markers = markersRef.current;
      const seen = new Set<string>();

      for (const peer of peers) {
        seen.add(peer.id);
        let marker = markers.get(peer.id);
        if (!marker) {
          const el = document.createElement("button");
          el.type = "button";
          el.className = "pulse-dot";
          el.title = "Tap to connect";
          el.style.background = dotColor(peer.id);
          el.style.color = dotColor(peer.id);
          el.setAttribute("aria-label", "Connect to a stranger");
          el.addEventListener("click", (e) => {
            e.stopPropagation();
            if (canConnectRef.current) onPeerClickRef.current(peer.id);
          });
          marker = new mapboxgl.Marker({ element: el })
            .setLngLat([peer.lng, peer.lat])
            .addTo(map);
          markers.set(peer.id, marker);
        } else {
          marker.setLngLat([peer.lng, peer.lat]);
        }

        // Busy peers get a desaturated, static look so the live ones stand out.
        const el = marker.getElement();
        if (peer.busy) {
          el.classList.add("pulse-dot-busy");
          el.style.opacity = "0.35";
        } else {
          el.classList.remove("pulse-dot-busy");
          el.style.opacity = "1";
        }
      }

      // Drop markers for peers that went offline / got filtered out.
      for (const [id, marker] of markers) {
        if (!seen.has(id)) {
          marker.remove();
          markers.delete(id);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [peers, ready]);

  function handleLeave() {
    if (sessionId) leave(sessionId);
    onLeave();
  }

  // Recenter the map onto the user's own location with a smooth flyTo.
  function handleRecenter() {
    const map = mapRef.current;
    if (!map || !me) return;
    setFlying(true);
    map.flyTo({
      center: [me.lng, me.lat],
      zoom: 4,
      pitch: 0,
      bearing: 0,
      duration: 1500,
      essential: true,
    });
    // Clear the spin a tick after the fly should be done — Mapbox doesn't
    // expose a "flyEnd" callback on the basic API without subscribing to
    // `moveend`, and 1500ms matches the requested duration exactly.
    window.setTimeout(() => setFlying(false), 1500);
  }

  // First-load fit-bounds: once the map is ready, peers exist, and we know
  // where the user is, gently fit the camera to include them all.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !me) return;
    if (hasFitInitialRef.current) return;
    if (peers.length === 0) return;

    let cancelled = false;
    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled) return;
      const bounds = new mapboxgl.LngLatBounds(
        [me.lng, me.lat],
        [me.lng, me.lat],
      );
      for (const p of peers) bounds.extend([p.lng, p.lat]);

      // Skip the animation if the user already moved the map themselves.
      if (hasFitInitialRef.current) return;
      hasFitInitialRef.current = true;
      map.fitBounds(bounds, {
        padding: 80,
        duration: 1400,
        maxZoom: 5.5,
        essential: true,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, peers, me]);

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full bg-zinc-900" />

      {/* Subtle map vignette so HUD elements and dots pop on bright regions */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.45) 100%)",
        }}
        aria-hidden="true"
      />

      {!TOKEN && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
          <p className="max-w-md rounded-lg bg-zinc-800 p-4 text-sm text-zinc-200">
            Set{" "}
            <code className="text-emerald-400">NEXT_PUBLIC_MAPBOX_TOKEN</code> in{" "}
            <code>.env</code> to load the map.
          </p>
        </div>
      )}

      {/* Online HUD */}
      <div className="pulse-hud" aria-label="Live presence status">
        <span className="pulse-hud-dot" aria-hidden="true" />
        <span className="pulse-hud-count pulse-numeric">{peers.length}</span>
        <span className="text-zinc-400">online</span>
        {region && (
          <>
            <span className="pulse-hud-divider" aria-hidden="true" />
            <span className="pulse-hud-region pulse-mono">{region}</span>
          </>
        )}
      </div>

      {/* Recenter button (above the leave button) */}
      <button
        type="button"
        onClick={handleRecenter}
        disabled={!me}
        className={`pulse-recenter ${flying ? "pulse-recenter-flying" : ""}`}
        title="Recenter on me"
        aria-label="Recenter on me"
      >
        <CrosshairIcon />
      </button>

      {/* Leave / disconnect button */}
      <button
        type="button"
        onClick={handleLeave}
        className="pulse-hud-leave"
        title="Leave Pulse"
        aria-label="Leave Pulse"
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
          <path d="M16 17l5 -5 -5 -5" />
          <path d="M21 12H9" />
          <path d="M9 21H5a2 2 0 0 1 -2 -2V5a2 2 0 0 1 2 -2h4" />
        </svg>
      </button>
    </div>
  );
}

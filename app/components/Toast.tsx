"use client";

import { useEffect, useState } from "react";

export type ToastVariant = "info" | "warn" | "error";

/**
 * A refined glass-morphism toast that auto-dismisses after `duration` ms.
 *
 * Variants:
 *  - info  : emerald (default — success / status)
 *  - warn  : amber    (peer went offline, etc.)
 *  - error : red      (request declined, failure)
 */
export default function Toast({
  message,
  variant = "info",
  duration = 3500,
}: {
  message: string;
  variant?: ToastVariant;
  duration?: number;
}) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    // Start the leaving animation a tick before unmount so the
    // page.tsx timeout (3.5s) lines up with the drain bar (also 3.5s).
    const t = setTimeout(() => setLeaving(true), duration - 220);
    return () => clearTimeout(t);
  }, [duration]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={`pulse-toast pulse-toast-${variant} ${
        leaving ? "pulse-toast-leaving" : ""
      }`}
    >
      <div className="pulse-toast-row">
        <span className="pulse-toast-icon" aria-hidden="true" />
        <span>{message}</span>
      </div>
      <span className="pulse-toast-bar" aria-hidden="true" />
    </div>
  );
}

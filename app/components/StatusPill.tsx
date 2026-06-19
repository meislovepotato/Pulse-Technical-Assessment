"use client";

/**
 * Animated status pill for transient connection states.
 *
 * Two visual modes:
 *  - `arc`   — a spinning ring (good for "Requesting connection" / "Waiting for video")
 *  - `dot`   — a pulsing dot (good for "The stranger is offline"-style held states)
 *
 * Optionally renders a text-button on the right (used for "Cancel").
 */
export default function StatusPill({
  text,
  position = "top",
  variant = "arc",
  actionLabel,
  onAction,
}: {
  text: string;
  position?: "top" | "bottom";
  variant?: "arc" | "dot";
  actionLabel?: string;
  onAction?: () => void;
}) {
  const positionClass =
    position === "top"
      ? "absolute left-1/2 top-20 -translate-x-1/2 z-30"
      : "absolute bottom-24 left-1/2 -translate-x-1/2 z-30";

  return (
    <div className={positionClass}>
      <div className="pulse-status" role="status" aria-live="polite">
        {variant === "arc" ? (
          <span className="pulse-status-arc" aria-hidden="true" />
        ) : (
          <span className="pulse-status-dot" aria-hidden="true" />
        )}
        <span>{text}</span>
        {actionLabel && onAction && (
          <button
            type="button"
            onClick={onAction}
            className="pulse-status-cancel"
          >
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}

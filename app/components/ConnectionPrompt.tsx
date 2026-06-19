"use client";

// Reusable centered prompt for "someone wants to connect" and
// "someone wants to start video".
export default function ConnectionPrompt({
  title,
  subtitle,
  acceptLabel,
  declineLabel,
  onAccept,
  onDecline,
}: {
  title: string;
  subtitle?: string;
  acceptLabel: string;
  declineLabel: string;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <div className="pulse-modal-backdrop pulse-modal-backdrop-radial absolute inset-0 z-20 flex items-center justify-center p-6">
      <div className="pulse-modal-card pulse-glass-strong w-full max-w-sm rounded-2xl p-7 text-center">
        <div className="pulse-prompt-ring" aria-hidden="true">
          <span className="pulse-prompt-ring-dot" />
        </div>

        <h2 className="text-lg font-semibold tracking-tight text-zinc-50">
          {title}
        </h2>
        {subtitle && (
          <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">
            {subtitle}
          </p>
        )}

        <div className="mt-6 flex gap-3">
          <button
            onClick={onDecline}
            className="pulse-btn pulse-btn-ghost flex-1"
          >
            {declineLabel}
          </button>
          <button
            onClick={onAccept}
            className="pulse-btn pulse-btn-gradient flex-1"
          >
            {acceptLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

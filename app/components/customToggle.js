"use client";

export default function CustomToggle({
  checked = false,
  className = "",
  disabled = false,
  label,
  onChange,
}) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300/60 disabled:cursor-not-allowed disabled:opacity-50 ${
        checked
          ? "border-white/25"
          : "border-white/15 bg-white/10! hover:bg-white/15!"
      } ${className}`}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      role="switch"
      style={
        checked
          ? {
              backgroundColor:
                "color-mix(in srgb, var(--accent, #a855f7) 50%, transparent)",
            }
          : undefined
      }
      type="button"
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute left-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

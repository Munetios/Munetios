"use client";

export default function CustomCheckbox({
  checked = false,
  className = "",
  disabled = false,
  label,
  onChange,
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={checked}
      className={`inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300/60 disabled:cursor-not-allowed disabled:opacity-45 ${
        checked
          ? "border-purple-300/70 bg-purple-600/70! text-white"
          : "border-white/20 bg-white/8! text-transparent hover:bg-white/14!"
      } ${className}`}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      type="button"
    >
      <icon className="text-base">check</icon>
    </button>
  );
}

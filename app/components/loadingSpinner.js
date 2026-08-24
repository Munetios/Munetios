export default function LoadingSpinner({
  className = "",
  label = "Loading",
  strokeWidth = 4,
}) {
  return (
    <output aria-label={label} className={`spinner-container ${className}`}>
      <svg aria-hidden="true" className="google-spinner" viewBox="0 0 50 50">
        <circle
          className="spinner-circle"
          cx="25"
          cy="25"
          fill="none"
          r="20"
          strokeWidth={strokeWidth}
        />
      </svg>
    </output>
  );
}

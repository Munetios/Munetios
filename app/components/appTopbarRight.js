export default function AppTopbarRight({ children, className = "" }) {
  return (
    <div
      className={`liquid-glass flex h-14 shrink-0 items-center gap-2 px-3 ${className}`}
    >
      {children}
    </div>
  );
}

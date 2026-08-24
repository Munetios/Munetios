export default function AppTopbarRight({ children, className = "" }) {
  return (
    <div
      className={`liquid-glass flex h-12 shrink-0 items-center gap-1.5 px-2 ${className}`}
    >
      {children}
    </div>
  );
}

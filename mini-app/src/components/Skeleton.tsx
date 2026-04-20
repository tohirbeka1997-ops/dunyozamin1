export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-black/[0.06] ${className}`}
      aria-hidden
    />
  );
}

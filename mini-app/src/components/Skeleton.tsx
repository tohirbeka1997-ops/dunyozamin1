export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-[color-mix(in_srgb,var(--dz-text)_8%,transparent)] ${className}`}
      aria-hidden
    />
  );
}

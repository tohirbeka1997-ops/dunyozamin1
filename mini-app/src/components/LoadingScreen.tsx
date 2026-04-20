export function LoadingScreen() {
  return (
    <div className="flex min-h-[50dvh] flex-col items-center justify-center gap-4 px-6">
      <div
        className="h-12 w-12 animate-spin rounded-full border-2 border-[var(--dz-accent)] border-t-transparent"
        aria-hidden
      />
      <div className="space-y-2 text-center">
        <p className="text-sm font-medium text-[var(--dz-muted)]">Yuklanmoqda</p>
        <p className="text-xs text-[var(--dz-soft)]">DunyoZamin</p>
      </div>
    </div>
  );
}

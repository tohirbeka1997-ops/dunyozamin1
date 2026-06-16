export function LoadingScreen() {
  return (
    <div className="flex min-h-[50dvh] flex-col items-center justify-center gap-4 px-6">
      <div className="relative">
        <div
          className="h-14 w-14 animate-spin rounded-full border-[3px] border-[var(--brand-primary-100)] border-t-[var(--brand-primary)]"
          aria-hidden
        />
        <div className="absolute inset-0 flex items-center justify-center text-xl">🌿</div>
      </div>
      <div className="space-y-1 text-center">
        <p className="text-[13px] font-bold text-[var(--brand-primary)]">DunyoZamin</p>
        <p className="text-[11px] text-[var(--dz-soft)]">Yuklanmoqda…</p>
      </div>
    </div>
  );
}

export function LoadingScreen() {
  return (
    <div className="flex min-h-[50dvh] flex-col items-center justify-center gap-4 px-6">
      <div className="relative">
        <div
          className="h-14 w-14 animate-spin rounded-full border-[3px] border-[var(--mint)] border-t-[var(--brand)]"
          aria-hidden
        />
        <div className="absolute inset-0 flex items-center justify-center text-[var(--brand-deep)]">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
            <path d="M3 21V9l9-6 9 6v12" />
            <path d="M9 21v-6h6v6" />
          </svg>
        </div>
      </div>
      <div className="space-y-1 text-center">
        <p className="text-[13px] font-bold text-[var(--ink)]">DunyoZamin</p>
        <p className="text-[11px] text-[var(--muted)]">Yuklanmoqda…</p>
      </div>
    </div>
  );
}

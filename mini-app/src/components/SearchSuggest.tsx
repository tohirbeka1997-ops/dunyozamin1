import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiUrl, readJsonSafe } from '../lib/api';
import { resolveProductImageUrl } from '../lib/productImageUrl';
import { useDebounce } from '../hooks/useDebounce';
import { loadRecentSearches, saveRecentSearch } from '../lib/recentSearches';
import { haptic, isQrSupported, tgScanQr } from '../lib/telegram';

type Suggestion = {
  id: string;
  name: string;
  price_uzs: number;
  image_url: string | null;
};

/**
 * Live search box with product suggestions.
 *
 * - Hits `/v1/products?q=…&limit=6` after a 300ms debounce.
 * - Shows recent searches when input is empty/focused.
 * - Tapping a suggestion navigates straight to the product page.
 * - Submitting falls back to the catalog page with the query string.
 */
export function SearchSuggest({
  placeholder = 'Mahsulot, kategoriya, brand…',
  className = '',
}: {
  placeholder?: string;
  className?: string;
}) {
  const nav = useNavigate();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>(() => loadRecentSearches());
  const debouncedQ = useDebounce(value.trim(), 280);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (debouncedQ.length < 2) {
      setItems([]);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    void (async () => {
      try {
        const r = await fetch(
          apiUrl(`/v1/products?q=${encodeURIComponent(debouncedQ)}&limit=6`),
          { signal: ctrl.signal },
        );
        if (!r.ok) throw new Error('http');
        const j = await readJsonSafe<{ data?: Suggestion[] }>(r);
        setItems(j.data || []);
      } catch (e) {
        if ((e as { name?: string }).name !== 'AbortError') {
          setItems([]);
        }
      } finally {
        setLoading(false);
      }
    })();
    return () => ctrl.abort();
  }, [debouncedQ]);

  // Close the dropdown on outside taps. The TG WebApp doesn't always
  // fire focus/blur the way browsers do, so we listen for any pointer
  // event outside the wrapper.
  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  function commit(query: string) {
    const q = query.trim();
    if (q.length < 2) return;
    setRecent(saveRecentSearch(q));
    setOpen(false);
    setValue(q);
    haptic.selection();
    nav(`/catalog?q=${encodeURIComponent(q)}`);
  }

  const showRecent = open && value.trim().length === 0 && recent.length > 0;
  const showSuggestions = open && debouncedQ.length >= 2;

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          commit(value);
        }}
        className="relative"
      >
        <span
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--brand-deep)]"
          aria-hidden
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-3.5-3.5" />
          </svg>
        </span>
        <input
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="dz-glass w-full rounded-2xl py-3 pl-11 pr-11 text-[13.5px] font-medium text-[var(--ink)] placeholder:font-normal placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/25"
        />
        {value ? (
          <button
            type="button"
            onClick={() => {
              setValue('');
              setOpen(true);
              haptic.selection();
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--steel)] text-[11px] font-bold text-[var(--soft-ink)] active:scale-90"
            aria-label="Tozalash"
          >
            ✕
          </button>
        ) : isQrSupported() ? (
          <button
            type="button"
            onClick={async () => {
              haptic.selection();
              const text = await tgScanQr('Mahsulot QR kodini skanerlang');
              if (!text) return;
              const trimmed = text.trim();
              // 1) Direct URL — open as-is
              try {
                const u = new URL(trimmed);
                // dz://product/<id> or our own /product/:id deep-link
                if (u.pathname.startsWith('/product/')) {
                  nav(u.pathname);
                  return;
                }
                // Otherwise treat as a search query
                setValue(trimmed);
                commit(trimmed);
                return;
              } catch {
                // Not a URL — treat as plain id or search term
              }
              // Heuristic: short alphanumeric → product id, else search
              if (/^[a-z0-9-]{4,40}$/i.test(trimmed)) {
                nav(`/product/${encodeURIComponent(trimmed)}`);
              } else {
                setValue(trimmed);
                commit(trimmed);
              }
            }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--mint)] text-[var(--brand-deep)] active:scale-90"
            aria-label="QR skaner"
            title="QR skaner"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
              <path d="M7 12h10" />
            </svg>
          </button>
        ) : null}
      </form>

      {showRecent || showSuggestions ? (
        <div className="absolute left-0 right-0 top-full z-30 mt-2 max-h-[60vh] overflow-y-auto rounded-2xl border border-[var(--brand-cream-200)] bg-white shadow-[var(--dz-card-shadow)]">
          {showRecent ? (
            <div className="p-2">
              <p className="px-2 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--brand-primary)]/55">
                ⏱ Yaqindagi qidiruvlar
              </p>
              {recent.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => commit(q)}
                  className="flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left text-[12.5px] text-[var(--brand-primary)] transition active:bg-[var(--brand-cream-100)] hover:bg-[var(--brand-cream-50)]"
                >
                  <span className="truncate">{q}</span>
                  <span className="text-[11px] text-[var(--brand-primary)]/40">↗</span>
                </button>
              ))}
            </div>
          ) : null}

          {showSuggestions ? (
            <div className="p-2">
              <p className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--brand-primary)]/55">
                {loading ? 'Topilmoqda…' : items.length ? '🛍 Mahsulotlar' : 'Hech narsa topilmadi'}
              </p>
              {items.map((it) => (
                <Link
                  key={it.id}
                  to={`/product/${encodeURIComponent(it.id)}`}
                  onClick={() => {
                    setRecent(saveRecentSearch(value.trim()));
                    setOpen(false);
                    haptic.selection();
                  }}
                  className="flex items-center gap-3 rounded-xl px-2 py-2 transition active:bg-[var(--brand-cream-100)] hover:bg-[var(--brand-cream-50)]"
                >
                  <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-xl bg-[var(--brand-cream-100)]">
                    {it.image_url ? (
                      <img
                        src={resolveProductImageUrl(it.image_url) || ''}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-[14px] text-[var(--brand-primary)]/40">
                        🛒
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-bold text-[var(--brand-primary)]">{it.name}</p>
                    <p className="text-[11px] font-bold tabular-nums text-[var(--brand-teal)]">
                      {it.price_uzs.toLocaleString('uz-UZ')} soʻm
                    </p>
                  </div>
                  <span className="text-[var(--brand-primary)]/40">›</span>
                </Link>
              ))}
              {!loading && items.length > 0 ? (
                <button
                  type="button"
                  onClick={() => commit(value)}
                  className="mt-1 flex w-full items-center justify-center gap-1 rounded-xl bg-[var(--brand-teal-50)] py-1.5 text-[11.5px] font-bold text-[var(--brand-teal)]"
                >
                  Hammasini koʻrish →
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

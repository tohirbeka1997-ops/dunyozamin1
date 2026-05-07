import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiFetch, loadTokens } from '../lib/api';
import { cartTotal, loadCart, saveCart } from '../lib/cart';
import { getTg } from '../lib/telegram';

function newIdempotencyKey(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // ignore — fall through
  }
  return `chk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function CheckoutPage({ onCartChange }: { onCartChange: () => void }) {
  const nav = useNavigate();
  const lines = loadCart();
  const [addr, setAddr] = useState('');
  const [phone, setPhone] = useState('');
  const [extraPhone, setExtraPhone] = useState('');
  const [note, setNote] = useState('');
  const [pm, setPm] = useState<'cash' | 'payme' | 'click'>('cash');
  const [deliveryMethod, setDeliveryMethod] = useState<'courier' | 'pickup'>('courier');
  const [busy, setBusy] = useState(false);
  const [locBusy, setLocBusy] = useState(false);
  const [loc, setLoc] = useState<{ latitude: number; longitude: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  // Synchronous lock — `setBusy` is async and won't stop a second click
  // that fires in the same React batch as the first.
  const submitLockRef = useRef(false);
  // Stable per-attempt key that survives "Confirm" double-tap and 5xx
  // retries within ~5 minutes (server replays the cached response).
  const idempotencyKeyRef = useRef<string>(newIdempotencyKey());

  useEffect(() => {
    if (!loadTokens()) return;
    let alive = true;
    void (async () => {
      try {
        const r = await apiFetch('/v1/me');
        if (!r.ok) return;
        const me = (await r.json()) as { phone?: string | null; address?: string | null };
        if (!alive) return;
        const savedPhone = String(me.phone || '').trim();
        const savedAddress = String(me.address || '').trim();
        if (savedPhone) setPhone((cur) => cur || savedPhone);
        if (savedAddress) setAddr((cur) => cur || savedAddress);
      } catch {
        // Checkout still works if profile prefill is unavailable.
      } finally {
        if (alive) setProfileLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!lines.length) {
    return (
      <div className="rounded-2xl border border-dashed bg-[var(--dz-surface)] px-6 py-10 text-center shadow-[var(--dz-card-shadow-soft)]">
        <p className="text-3xl" aria-hidden>
          📭
        </p>
        <p className="mt-3 text-sm font-medium text-[var(--dz-muted)]">Savat bo&apos;sh</p>
        <Link
          to="/catalog"
          className="mt-4 inline-flex rounded-xl bg-[var(--dz-accent)] px-5 py-2.5 text-sm font-semibold text-[var(--dz-accent-text)]"
        >
          Katalogga
        </Link>
      </div>
    );
  }

  if (!loadTokens()) {
    return (
      <div className="rounded-2xl border border-amber-200/80 bg-amber-50 px-4 py-4 text-sm text-amber-950 shadow-sm">
        <p className="font-semibold">Telegram kerak</p>
        <p className="mt-2 text-amber-900/90">
          Bu sahifani Telegram ichidagi <strong>Mini App</strong> orqali oching — avtomatik kirish
          ishlaydi.
        </p>
      </div>
    );
  }

  async function submit() {
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    setErr(null);
    if (deliveryMethod === 'courier' && addr.trim().length < 3) {
      setErr('Yetkazib berish manzilini kiriting.');
      submitLockRef.current = false;
      return;
    }
    const phoneCompact = phone.trim().replace(/[\s()-]/g, '');
    if (!phoneCompact) {
      setErr('Telefon raqamingizni kiriting.');
      submitLockRef.current = false;
      return;
    }
    if (!/^\+?\d{9,15}$/.test(phoneCompact)) {
      setErr("Telefon raqam noto'g'ri. Masalan: +998901234567");
      submitLockRef.current = false;
      return;
    }
    const extraPhoneCompact = extraPhone.trim().replace(/[\s()-]/g, '');
    if (extraPhoneCompact && !/^\+?\d{9,15}$/.test(extraPhoneCompact)) {
      setErr("Qo'shimcha telefon raqam noto'g'ri. Masalan: +998901234567");
      submitLockRef.current = false;
      return;
    }
    setBusy(true);
    try {
      for (const l of lines) {
        const pr = await apiFetch(`/v1/products/${encodeURIComponent(l.product_id)}`);
        if (!pr.ok) {
          setErr(`Mahsulot topilmadi: ${l.name}`);
          setBusy(false);
          return;
        }
        const pj = (await pr.json()) as { track_stock?: boolean; stock_quantity?: number | null };
        if (pj.track_stock) {
          const max = Math.max(0, Number(pj.stock_quantity ?? 0));
          if (l.quantity > max) {
            setErr(`${l.name}: omborda ${max} dona bor. Iltimos savatni yangilang.`);
            setBusy(false);
            return;
          }
        }
      }
      const items = lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity }));
      const finalNote = [
        note.trim(),
        extraPhoneCompact ? `Qo'shimcha telefon: ${extraPhoneCompact}` : '',
      ]
        .filter(Boolean)
        .join('\n');
      const r = await apiFetch('/v1/orders', {
        method: 'POST',
        headers: {
          'Idempotency-Key': idempotencyKeyRef.current,
        },
        body: JSON.stringify({
          items,
          payment_method: pm,
          delivery_method: deliveryMethod,
          delivery_address: deliveryMethod === 'pickup' ? (addr.trim() || "O'zi olib ketish") : addr.trim(),
          phone: phoneCompact || undefined,
          location: deliveryMethod === 'courier' ? loc || undefined : undefined,
          note: finalNote || undefined,
        }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        error?: string;
        order_number?: string;
        payment_url?: string | null;
      };
      if (!r.ok) {
        setErr(j.error || `HTTP ${r.status}`);
        return;
      }
      saveCart([]);
      onCartChange();
      void apiFetch('/v1/me', {
        method: 'PUT',
        body: JSON.stringify({
          phone: phoneCompact,
          address: deliveryMethod === 'courier' ? addr.trim() : undefined,
        }),
      }).catch(() => {});

      const payUrl = j.payment_url && String(j.payment_url).trim();
      if (payUrl && (pm === 'payme' || pm === 'click')) {
        const tg = getTg();
        try {
          if (tg && typeof tg.openLink === 'function') {
            tg.openLink(payUrl);
          } else {
            window.open(payUrl, '_blank', 'noopener,noreferrer');
          }
        } catch {
          window.open(payUrl, '_blank', 'noopener,noreferrer');
        }
        nav(`/orders?pending=${encodeURIComponent(j.order_number || '')}`);
        return;
      }

      nav(`/orders?done=${encodeURIComponent(j.order_number || '')}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Xato');
      // Allow retry (server idempotency will dedupe by key on success).
      submitLockRef.current = false;
    } finally {
      setBusy(false);
    }
  }

  async function detectLocation() {
    setErr(null);
    if (!navigator.geolocation) {
      setErr('Qurilmada geolokatsiya qo‘llab-quvvatlanmaydi.');
      return;
    }
    setLocBusy(true);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 60000,
        }),
      );
      const next = {
        latitude: Number(pos.coords.latitude.toFixed(6)),
        longitude: Number(pos.coords.longitude.toFixed(6)),
      };
      setLoc(next);
      if (!addr.trim()) {
        setAddr(`Lokatsiya: ${next.latitude}, ${next.longitude}`);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Lokatsiyani olib bo‘lmadi');
    } finally {
      setLocBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <Link
        to="/cart"
        className="inline-flex items-center gap-1 text-sm font-medium text-[var(--tg-theme-link-color,#2481cc)]"
      >
        ← Savatga qaytish
      </Link>
      <div>
        <h1 className="text-xl font-bold tracking-tight">Buyurtma</h1>
        <p className="mt-1 text-sm text-[var(--dz-muted)]">Yetkazish va to&apos;lov usuli</p>
      </div>

      <div className="rounded-2xl border bg-gradient-to-br from-[var(--dz-accent)]/15 to-transparent p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--dz-soft)]">To&apos;lov uchun</p>
        <p className="mt-1 text-2xl font-bold tabular-nums">
          {cartTotal(lines).toLocaleString('uz-UZ')} <span className="text-base font-semibold">so&apos;m</span>
        </p>
      </div>

      <div className="space-y-4 rounded-2xl border bg-[var(--dz-surface)] p-4 shadow-[var(--dz-card-shadow-soft)]">
        <div className="block text-sm">
          <span className="mb-2 block font-medium text-[var(--dz-muted)]">Yetkazish usuli</span>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setDeliveryMethod('courier')}
              className={`rounded-xl border px-3 py-3 text-sm font-semibold transition ${
                deliveryMethod === 'courier'
                  ? 'border-[var(--dz-accent)] bg-[var(--dz-accent)] text-[var(--dz-accent-text)]'
                  : 'bg-[var(--dz-bg)] text-[var(--dz-text)]'
              }`}
            >
              Kuryer
            </button>
            <button
              type="button"
              onClick={() => setDeliveryMethod('pickup')}
              className={`rounded-xl border px-3 py-3 text-sm font-semibold transition ${
                deliveryMethod === 'pickup'
                  ? 'border-[var(--dz-accent)] bg-[var(--dz-accent)] text-[var(--dz-accent-text)]'
                  : 'bg-[var(--dz-bg)] text-[var(--dz-text)]'
              }`}
            >
              O&apos;zi olib ketish
            </button>
          </div>
        </div>

        <label className="block text-sm">
          <span className="mb-1.5 block font-medium text-[var(--dz-muted)]">Telefon raqamingiz *</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            autoComplete="tel"
            className="w-full rounded-xl border bg-[var(--dz-bg)] px-3 py-3 text-sm text-[var(--dz-text)] placeholder:text-[var(--dz-soft)]"
            placeholder="+998 90 123 45 67"
          />
          <span className="mt-1 block text-xs text-[var(--dz-soft)]">
            {profileLoaded ? "Ro'yxatdan o'tgan raqamingiz avtomatik qo'yiladi." : "Raqam yuklanmoqda..."}
          </span>
        </label>

        <label className="block text-sm">
          <span className="mb-1.5 block font-medium text-[var(--dz-muted)]">Qo&apos;shimcha telefon (ixtiyoriy)</span>
          <input
            value={extraPhone}
            onChange={(e) => setExtraPhone(e.target.value)}
            inputMode="tel"
            autoComplete="tel"
            className="w-full rounded-xl border bg-[var(--dz-bg)] px-3 py-3 text-sm text-[var(--dz-text)] placeholder:text-[var(--dz-soft)]"
            placeholder="+998 90 123 45 67"
          />
          <span className="mt-1 block text-xs text-[var(--dz-soft)]">
            Kuryer bog&apos;lana olishi uchun boshqa raqam kerak bo&apos;lsa kiriting.
          </span>
        </label>

        <label className="block text-sm">
          <span className="mb-1.5 block font-medium text-[var(--dz-muted)]">
            {deliveryMethod === 'courier' ? 'Yetkazib berish manzili *' : 'Olib ketish izohi (ixtiyoriy)'}
          </span>
          <textarea
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            rows={3}
            className="w-full rounded-xl border bg-[var(--dz-bg)] px-3 py-3 text-sm leading-relaxed text-[var(--dz-text)] placeholder:text-[var(--dz-soft)]"
            placeholder={deliveryMethod === 'courier' ? "Viloyat, tuman, ko'cha, uy..." : "Masalan: bugun 18:00 da olib ketaman"}
          />
        </label>

        {deliveryMethod === 'courier' ? (
        <div className="rounded-xl border bg-[var(--dz-bg)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-[var(--dz-muted)]">Joylashuv (ixtiyoriy)</p>
            <button
              type="button"
              onClick={() => void detectLocation()}
              disabled={locBusy}
              className="rounded-lg border bg-[var(--dz-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--dz-text)] shadow-sm transition hover:bg-white disabled:opacity-60"
            >
              {locBusy ? 'Aniqlanmoqda…' : 'Joylashuvni olish'}
            </button>
          </div>
          {loc ? (
            <p className="mt-2 text-xs text-[var(--dz-soft)]">
              {loc.latitude}, {loc.longitude}
            </p>
          ) : (
            <p className="mt-2 text-xs text-[var(--dz-soft)]">
              Kuryer uchun aniq koordinata yuborish mumkin.
            </p>
          )}
        </div>
        ) : null}

        <label className="block text-sm">
          <span className="mb-1.5 block font-medium text-[var(--dz-muted)]">Izoh (ixtiyoriy)</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full rounded-xl border bg-[var(--dz-bg)] px-3 py-3 text-sm text-[var(--dz-text)]"
            placeholder="Eshik kodi, orientir..."
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1.5 block font-medium text-[var(--dz-muted)]">To&apos;lov usuli</span>
          <select
            value={pm}
            onChange={(e) => setPm(e.target.value as typeof pm)}
            className="mt-1 w-full rounded-xl border bg-[var(--dz-surface)] px-3 py-3 text-sm font-medium text-[var(--dz-text)] shadow-[var(--dz-card-shadow-soft)]"
          >
            <option value="cash">Naqd (yetkazganda / do&apos;konda)</option>
            <option value="payme">Payme</option>
            <option value="click">Click</option>
          </select>
        </label>
      </div>

      {err ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{err}</div>
      ) : null}

      <button
        type="button"
        disabled={busy}
        onClick={() => void submit()}
        className="w-full rounded-xl bg-[var(--dz-accent)] py-3.5 text-base font-semibold text-[var(--dz-accent-text)] shadow-md transition disabled:opacity-55"
      >
        {busy ? 'Jo‘natilmoqda…' : 'Buyurtmani tasdiqlash'}
      </button>
    </div>
  );
}

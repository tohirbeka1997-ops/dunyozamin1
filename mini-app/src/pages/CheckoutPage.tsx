import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiFetch, loadTokens } from '../lib/api';
import { cartTotal, loadCart, saveCart } from '../lib/cart';
import { getTg } from '../lib/telegram';

export function CheckoutPage({ onCartChange }: { onCartChange: () => void }) {
  const nav = useNavigate();
  const lines = loadCart();
  const [addr, setAddr] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [pm, setPm] = useState<'cash' | 'payme' | 'click'>('cash');
  const [busy, setBusy] = useState(false);
  const [locBusy, setLocBusy] = useState(false);
  const [loc, setLoc] = useState<{ latitude: number; longitude: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

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
    setErr(null);
    if (addr.trim().length < 3) {
      setErr('Yetkazib berish manzilini kiriting.');
      return;
    }
    const phoneCompact = phone.trim().replace(/[\s()-]/g, '');
    if (!phoneCompact) {
      setErr('Telefon raqamingizni kiriting.');
      return;
    }
    if (!/^\+?\d{9,15}$/.test(phoneCompact)) {
      setErr("Telefon raqam noto'g'ri. Masalan: +998901234567");
      return;
    }
    setBusy(true);
    try {
      const items = lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity }));
      const r = await apiFetch('/v1/orders', {
        method: 'POST',
        body: JSON.stringify({
          items,
          payment_method: pm,
          delivery_address: addr.trim(),
          phone: phoneCompact || undefined,
          location: loc || undefined,
          note: note.trim() || undefined,
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
      <div>
        <h1 className="text-xl font-bold tracking-tight">Buyurtma</h1>
        <p className="mt-1 text-sm text-[var(--dz-muted)]">Manzil va to&apos;lov usuli</p>
      </div>

      <div className="rounded-2xl border bg-gradient-to-br from-[var(--dz-accent)]/15 to-transparent p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--dz-soft)]">To&apos;lov uchun</p>
        <p className="mt-1 text-2xl font-bold tabular-nums">
          {cartTotal(lines).toLocaleString('uz-UZ')} <span className="text-base font-semibold">so&apos;m</span>
        </p>
      </div>

      <div className="space-y-4 rounded-2xl border bg-[var(--dz-surface)] p-4 shadow-[var(--dz-card-shadow-soft)]">
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
        </label>

        <label className="block text-sm">
          <span className="mb-1.5 block font-medium text-[var(--dz-muted)]">Yetkazib berish manzili *</span>
          <textarea
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            rows={3}
            className="w-full rounded-xl border bg-[var(--dz-bg)] px-3 py-3 text-sm leading-relaxed text-[var(--dz-text)] placeholder:text-[var(--dz-soft)]"
            placeholder="Viloyat, tuman, ko'cha, uy..."
          />
        </label>

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

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiFetch, loadTokens } from '../lib/api';
import { cartTotal, loadCart, saveCart } from '../lib/cart';
import { getTg } from '../lib/telegram';

export function CheckoutPage({ onCartChange }: { onCartChange: () => void }) {
  const nav = useNavigate();
  const lines = loadCart();
  const [addr, setAddr] = useState('');
  const [note, setNote] = useState('');
  const [pm, setPm] = useState<'cash' | 'payme' | 'click'>('cash');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!lines.length) {
    return (
      <div className="rounded-2xl border border-dashed border-black/15 bg-white px-6 py-10 text-center shadow-sm">
        <p className="text-3xl" aria-hidden>
          📭
        </p>
        <p className="mt-3 text-sm font-medium text-black/70">Savat bo&apos;sh</p>
        <Link
          to="/catalog"
          className="mt-4 inline-flex rounded-xl bg-[var(--tg-theme-button-color,#2481cc)] px-5 py-2.5 text-sm font-semibold text-[var(--tg-theme-button-text-color,#fff)]"
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
    setBusy(true);
    try {
      const items = lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity }));
      const r = await apiFetch('/v1/orders', {
        method: 'POST',
        body: JSON.stringify({
          items,
          payment_method: pm,
          delivery_address: addr.trim(),
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

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Buyurtma</h1>
        <p className="mt-1 text-sm text-black/55">Manzil va to&apos;lov usuli</p>
      </div>

      <div className="rounded-2xl border border-black/[0.06] bg-gradient-to-br from-[var(--tg-theme-button-color,#2481cc)]/10 to-transparent p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-black/45">To&apos;lov uchun</p>
        <p className="mt-1 text-2xl font-bold tabular-nums">
          {cartTotal(lines).toLocaleString('uz-UZ')} <span className="text-base font-semibold">so&apos;m</span>
        </p>
      </div>

      <div className="space-y-4 rounded-2xl border border-black/[0.06] bg-white p-4 shadow-sm">
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium text-black/75">Yetkazib berish manzili *</span>
          <textarea
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            rows={3}
            className="w-full rounded-xl border border-black/10 bg-black/[0.02] px-3 py-3 text-sm leading-relaxed placeholder:text-black/35"
            placeholder="Viloyat, tuman, ko'cha, uy..."
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1.5 block font-medium text-black/75">Izoh (ixtiyoriy)</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full rounded-xl border border-black/10 bg-black/[0.02] px-3 py-3 text-sm"
            placeholder="Eshik kodi, orientir..."
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1.5 block font-medium text-black/75">To&apos;lov usuli</span>
          <select
            value={pm}
            onChange={(e) => setPm(e.target.value as typeof pm)}
            className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-3 text-sm font-medium shadow-sm"
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
        className="w-full rounded-xl bg-[var(--tg-theme-button-color,#2481cc)] py-3.5 text-base font-semibold text-[var(--tg-theme-button-text-color,#fff)] shadow-md transition disabled:opacity-55"
      >
        {busy ? 'Jo‘natilmoqda…' : 'Buyurtmani tasdiqlash'}
      </button>
    </div>
  );
}

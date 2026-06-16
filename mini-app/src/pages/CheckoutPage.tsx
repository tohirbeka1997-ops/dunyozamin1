import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiFetch, loadTokens } from '../lib/api';
import { cartTotal, loadCart, saveCart } from '../lib/cart';
import { getTg, haptic, isTgEnv } from '../lib/telegram';
import { useTgBackButton, useTgMainButton } from '../hooks/useTgButtons';
import { fetchLoyalty, previewPromo, type PromoPreview } from '../lib/loyalty';
import { generateSlots } from '../lib/deliverySlots';
import { loadAddresses, removeAddress, saveAddress, type SavedAddress } from '../lib/addresses';

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

  // Loyalty: pulled once on mount (best-effort, missing endpoint = no UI).
  const [pointsAvailable, setPointsAvailable] = useState(0);
  const [pointsToUse, setPointsToUse] = useState(0);

  // Promo code state. We only call the server when the user explicitly
  // hits "Tekshirish" so a typing user doesn't spam the API.
  const [promoCodeInput, setPromoCodeInput] = useState('');
  const [promoApplied, setPromoApplied] = useState<PromoPreview | null>(null);
  const [promoBusy, setPromoBusy] = useState(false);
  const [promoErr, setPromoErr] = useState<string | null>(null);

  // Address book + delivery slot + courier tip
  const [savedAddrs, setSavedAddrs] = useState<SavedAddress[]>(() => loadAddresses());
  const [showAddrForm, setShowAddrForm] = useState(false);
  const [newAddrLabel, setNewAddrLabel] = useState('');
  const [slots] = useState(() => generateSlots());
  const [slotKey, setSlotKey] = useState<string>('');
  const [tip, setTip] = useState<number>(0);
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
    void fetchLoyalty().then((res) => {
      if (alive && res) setPointsAvailable(res.points_balance);
    });
    const sync = () => setSavedAddrs(loadAddresses());
    window.addEventListener('addresses:change', sync);
    return () => {
      alive = false;
      window.removeEventListener('addresses:change', sync);
    };
  }, []);

  const subtotal = cartTotal(lines);
  const tokensReady = !!loadTokens();
  const inTg = isTgEnv();
  const TIP_OPTIONS = [0, 5_000, 10_000, 20_000];

  // Discount math. 1 point = 100 soʻm and the user can never spend more
  // than half the subtotal in points (keeps cash flow healthy and avoids
  // free-with-points orders that the staff has to dispatch for "0 soʻm").
  const POINT_VALUE = 100;
  const maxPointsByCart = Math.floor(subtotal / 2 / POINT_VALUE);
  const maxPointsRedeemable = Math.max(0, Math.min(pointsAvailable, maxPointsByCart));
  const safePointsToUse = Math.max(0, Math.min(pointsToUse, maxPointsRedeemable));
  const pointsDiscount = safePointsToUse * POINT_VALUE;
  const promoDiscount = promoApplied ? promoApplied.discount : 0;
  const courierTip = deliveryMethod === 'courier' ? Math.max(0, tip || 0) : 0;
  const total = Math.max(0, subtotal - pointsDiscount - promoDiscount) + courierTip;

  // Telegram-native buttons. Wired unconditionally to satisfy the rules
  // of hooks; the actual MainButton behaviour is gated on having items.
  useTgBackButton();
  useTgMainButton({
    text: lines.length ? `✓ Tasdiqlash · ${total.toLocaleString('uz-UZ')} soʻm` : '',
    visible: lines.length > 0 && tokensReady,
    active: !busy,
    loading: busy,
    onClick: () => {
      void submit();
    },
  });

  async function applyPromo() {
    const code = promoCodeInput.trim().toUpperCase();
    if (!code) return;
    setPromoErr(null);
    setPromoBusy(true);
    haptic.selection();
    try {
      const res = await previewPromo(code, subtotal);
      if (res.ok) {
        setPromoApplied(res);
        haptic.notify('success');
      } else {
        setPromoApplied(null);
        const map: Record<string, string> = {
          not_found: 'Promokod topilmadi',
          expired: 'Promokod muddati tugagan',
          invalid_code: 'Promokod notoʻgʻri',
          network: 'Tarmoq xatosi',
          min_subtotal_not_met: `Minimal summa: ${'min_subtotal' in res ? res.min_subtotal.toLocaleString('uz-UZ') : ''} soʻm`,
        };
        setPromoErr(map[res.reason] || 'Promokod ishlamadi');
        haptic.notify('error');
      }
    } finally {
      setPromoBusy(false);
    }
  }

  if (!lines.length) {
    return (
      <div className="rounded-3xl border border-dashed border-[color-mix(in_srgb,var(--brand-primary)_22%,transparent)] bg-[var(--brand-primary-50)] px-6 py-12 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl dz-brand-bg text-3xl text-white">
          📭
        </div>
        <p className="mt-4 text-[15px] font-bold text-[var(--brand-primary)]">Savat boʻsh</p>
        <Link to="/catalog" className="dz-btn-accent mt-5 inline-flex">
          Katalogga
        </Link>
      </div>
    );
  }

  if (!tokensReady) {
    return (
      <div className="rounded-2xl border border-[color-mix(in_srgb,var(--brand-accent)_45%,transparent)] bg-[var(--brand-accent-100)] px-4 py-4 text-sm text-[var(--brand-primary)] shadow-[var(--dz-card-shadow-soft)]">
        <p className="font-bold">⚠ Telegram kerak</p>
        <p className="mt-2">
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
      const slotMeta = slots.find((s) => s.key === slotKey);
      const itemNotes = lines
        .filter((l) => l.note && l.note.trim())
        .map((l) => `• ${l.name}: ${l.note}`);
      const finalNote = [
        note.trim(),
        slotMeta ? `Yetkazib berish: ${slotMeta.label}` : '',
        courierTip > 0 ? `Kuryerga chaqim: ${courierTip.toLocaleString('uz-UZ')} soʻm` : '',
        itemNotes.length ? `Mahsulotlarga izoh:\n${itemNotes.join('\n')}` : '',
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
          promo_code: promoApplied?.code || undefined,
          points_to_redeem: safePointsToUse > 0 ? safePointsToUse : undefined,
        }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        error?: string;
        order_number?: string;
        payment_url?: string | null;
      };
      if (!r.ok) {
        setErr(j.error || `HTTP ${r.status}`);
        haptic.notify('error');
        return;
      }
      saveCart([]);
      onCartChange();
      haptic.notify('success');
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
      haptic.notify('error');
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

  const inputCls =
    'w-full rounded-xl border border-[color-mix(in_srgb,var(--brand-primary)_12%,transparent)] bg-white px-3 py-3 text-sm text-[var(--dz-text)] placeholder:text-[var(--dz-soft)] focus:border-[var(--brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/15';

  return (
    <div className="space-y-4 dz-animate-in">
      <Link
        to="/cart"
        className="inline-flex items-center gap-1 text-[13px] font-bold text-[var(--brand-primary)] underline-offset-2 hover:underline"
      >
        ← Savatga qaytish
      </Link>
      <div>
        <h1 className="text-xl font-extrabold tracking-tight text-[var(--brand-primary)]">📝 Buyurtma rasmiylashtirish</h1>
        <p className="mt-1 text-[12px] font-medium text-[var(--dz-soft)]">Yetkazish va toʻlov usulini tanlang</p>
      </div>

      <div className="relative overflow-hidden rounded-3xl dz-brand-bg p-5 text-white shadow-[var(--dz-card-shadow)]">
        <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-[var(--brand-accent)]/30 blur-3xl" />
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--brand-accent)]/95">Toʻlov uchun</p>
        <p className="mt-1.5 text-[28px] font-black tabular-nums leading-none">
          {total.toLocaleString('uz-UZ')}
          <span className="ml-1.5 text-[14px] font-bold text-white/85">soʻm</span>
        </p>
        <p className="mt-1 text-[12px] text-white/85">{lines.length} pozitsiya · oxirgi tasdiqlash</p>
        {pointsDiscount > 0 || promoDiscount > 0 ? (
          <div className="relative mt-3 space-y-1 rounded-xl bg-white/10 px-3 py-2 text-[11.5px]">
            <div className="flex justify-between">
              <span className="text-white/75">Mahsulotlar</span>
              <span className="font-semibold tabular-nums">{subtotal.toLocaleString('uz-UZ')} soʻm</span>
            </div>
            {pointsDiscount > 0 ? (
              <div className="flex justify-between text-[var(--brand-accent)]">
                <span>− Bonus ball ({safePointsToUse})</span>
                <span className="font-semibold tabular-nums">−{pointsDiscount.toLocaleString('uz-UZ')} soʻm</span>
              </div>
            ) : null}
            {promoDiscount > 0 ? (
              <div className="flex justify-between text-[var(--brand-accent)]">
                <span>− Promokod ({promoApplied?.code})</span>
                <span className="font-semibold tabular-nums">−{promoDiscount.toLocaleString('uz-UZ')} soʻm</span>
              </div>
            ) : null}
            {courierTip > 0 ? (
              <div className="flex justify-between text-white/85">
                <span>+ Kuryerga chaqim</span>
                <span className="font-semibold tabular-nums">+{courierTip.toLocaleString('uz-UZ')} soʻm</span>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* LOYALTY + PROMO section — bonus points appear only when the user
          has any, the promo input is always available */}
      <section className="dz-card relative overflow-hidden p-4">
          <span className="dz-leak dz-leak-accent dz-leak-md" style={{ top: '-50%', right: '-25%', opacity: 0.25 }} />
          <span className="dz-leak dz-leak-teal dz-leak-sm" style={{ bottom: '-50%', left: '-15%', opacity: 0.2 }} />

          {pointsAvailable > 0 ? (
            <div className="relative">
              <div className="flex items-center justify-between gap-3">
                <p className="flex items-center gap-1.5 text-[12px] font-bold text-[var(--brand-primary)]">
                  <span aria-hidden>✦</span> Bonus ball ishlatish
                </p>
                <p className="text-[10.5px] font-semibold text-[var(--brand-primary)]/65">
                  Mavjud: <b>{pointsAvailable.toLocaleString('uz-UZ')}</b> ball
                </p>
              </div>

              {maxPointsRedeemable > 0 ? (
                <>
                  <div className="mt-3 flex items-center gap-2">
                    <input
                      type="range"
                      min={0}
                      max={maxPointsRedeemable}
                      step={1}
                      value={safePointsToUse}
                      onChange={(e) => setPointsToUse(Number.parseInt(e.target.value, 10) || 0)}
                      className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-[var(--brand-cream-200)] accent-[var(--brand-teal)]"
                    />
                    <span className="min-w-[3.5rem] rounded-lg bg-[var(--brand-teal-50)] px-2 py-1 text-center text-[12px] font-black tabular-nums text-[var(--brand-teal)]">
                      {safePointsToUse}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-[10.5px] text-[var(--brand-primary)]/60">
                    <span>1 ball = {POINT_VALUE} soʻm</span>
                    <button
                      type="button"
                      onClick={() => {
                        setPointsToUse(safePointsToUse === maxPointsRedeemable ? 0 : maxPointsRedeemable);
                        haptic.selection();
                      }}
                      className="font-bold text-[var(--brand-teal)] hover:underline"
                    >
                      {safePointsToUse === maxPointsRedeemable ? 'Tozalash' : `Maks: ${maxPointsRedeemable}`}
                    </button>
                  </div>
                </>
              ) : (
                <p className="mt-2 text-[11px] text-[var(--brand-primary)]/55">
                  Buyurtma summasi kichkina — ko'proq mahsulot qo'shing.
                </p>
              )}
              <div className="my-3 h-px bg-[var(--brand-cream-200)]" />
            </div>
          ) : null}

          {/* Promo code input */}
          <div className="relative">
            <p className="flex items-center gap-1.5 text-[12px] font-bold text-[var(--brand-primary)]">
              <span aria-hidden>🎟</span> Promokod
            </p>
            {promoApplied ? (
              <div className="mt-2 flex items-center justify-between gap-2 rounded-xl bg-[var(--brand-accent-100)] px-3 py-2">
                <div className="min-w-0">
                  <p className="font-mono text-[12.5px] font-black text-[var(--brand-primary)]">
                    {promoApplied.code}
                  </p>
                  <p className="text-[10.5px] text-[var(--brand-primary)]/70">
                    −{promoApplied.discount.toLocaleString('uz-UZ')} soʻm chegirma
                    {promoApplied.percent ? ` (${promoApplied.percent}%)` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPromoApplied(null);
                    setPromoCodeInput('');
                    setPromoErr(null);
                    haptic.selection();
                  }}
                  className="rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-bold text-[var(--brand-primary)]"
                >
                  ✕
                </button>
              </div>
            ) : (
              <div className="mt-2 flex gap-2">
                <input
                  type="text"
                  inputMode="text"
                  autoCapitalize="characters"
                  spellCheck={false}
                  value={promoCodeInput}
                  onChange={(e) => {
                    setPromoCodeInput(e.target.value.toUpperCase().slice(0, 32));
                    if (promoErr) setPromoErr(null);
                  }}
                  placeholder="PROMO20"
                  className="flex-1 rounded-xl border border-[var(--brand-cream-200)] bg-white px-3 py-2 text-[13px] font-mono font-bold uppercase tracking-wider text-[var(--brand-primary)] placeholder:font-sans placeholder:font-normal placeholder:tracking-normal placeholder:text-[var(--brand-primary)]/40 focus:border-[var(--brand-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-teal)]/30"
                />
                <button
                  type="button"
                  disabled={promoBusy || !promoCodeInput.trim()}
                  onClick={() => void applyPromo()}
                  className="rounded-xl bg-[var(--brand-primary)] px-3.5 py-2 text-[12px] font-bold text-white transition active:scale-95 disabled:opacity-40"
                >
                  {promoBusy ? '…' : 'Tekshirish'}
                </button>
              </div>
            )}
            {promoErr ? (
              <p className="mt-1.5 text-[11px] font-semibold text-red-600">⚠ {promoErr}</p>
            ) : null}
          </div>
        </section>

      <div className="space-y-4 rounded-3xl border border-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)] bg-[var(--dz-surface)] p-4 shadow-[var(--dz-card-shadow-soft)]">
        <div className="block text-sm">
          <span className="mb-2 block text-[12px] font-bold uppercase tracking-wide text-[var(--dz-soft)]">
            Yetkazish usuli
          </span>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setDeliveryMethod('courier')}
              className={`flex flex-col items-start gap-1 rounded-2xl border-2 px-3 py-3 text-left text-sm font-bold transition active:scale-[0.98] ${
                deliveryMethod === 'courier'
                  ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white shadow-[0_8px_18px_-8px_rgba(16,137,77,0.45)]'
                  : 'border-transparent bg-[var(--brand-primary-50)] text-[var(--brand-primary)]'
              }`}
            >
              <span className="text-lg" aria-hidden>🚚</span>
              <span>Kuryer</span>
            </button>
            <button
              type="button"
              onClick={() => setDeliveryMethod('pickup')}
              className={`flex flex-col items-start gap-1 rounded-2xl border-2 px-3 py-3 text-left text-sm font-bold transition active:scale-[0.98] ${
                deliveryMethod === 'pickup'
                  ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white shadow-[0_8px_18px_-8px_rgba(16,137,77,0.45)]'
                  : 'border-transparent bg-[var(--brand-primary-50)] text-[var(--brand-primary)]'
              }`}
            >
              <span className="text-lg" aria-hidden>🏪</span>
              <span>Oʻzi olib ketish</span>
            </button>
          </div>
        </div>

        <label className="block text-sm">
          <span className="mb-1.5 block text-[12px] font-bold uppercase tracking-wide text-[var(--dz-soft)]">
            📞 Telefon raqamingiz *
          </span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            autoComplete="tel"
            className={inputCls}
            placeholder="+998 90 123 45 67"
          />
          <span className="mt-1 block text-[11px] text-[var(--dz-soft)]">
            {profileLoaded ? "Roʻyxatdan oʻtgan raqamingiz avtomatik qoʻyiladi." : "Raqam yuklanmoqda..."}
          </span>
        </label>

        <label className="block text-sm">
          <span className="mb-1.5 block text-[12px] font-bold uppercase tracking-wide text-[var(--dz-soft)]">
            Qoʻshimcha telefon (ixtiyoriy)
          </span>
          <input
            value={extraPhone}
            onChange={(e) => setExtraPhone(e.target.value)}
            inputMode="tel"
            autoComplete="tel"
            className={inputCls}
            placeholder="+998 90 123 45 67"
          />
        </label>

        <div className="block text-sm">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[12px] font-bold uppercase tracking-wide text-[var(--dz-soft)]">
              {deliveryMethod === 'courier' ? '📍 Yetkazib berish manzili *' : '📝 Olib ketish izohi (ixtiyoriy)'}
            </span>
            {deliveryMethod === 'courier' && addr.trim().length >= 3 && !savedAddrs.some((a) => a.address === addr.trim()) ? (
              <button
                type="button"
                onClick={() => {
                  setShowAddrForm((v) => !v);
                  setNewAddrLabel('');
                }}
                className="text-[10.5px] font-bold text-[var(--brand-teal)] hover:underline"
              >
                {showAddrForm ? 'Bekor' : '＋ Saqlash'}
              </button>
            ) : null}
          </div>

          {/* Saved address chips */}
          {deliveryMethod === 'courier' && savedAddrs.length > 0 ? (
            <div className="dz-scroll-x mb-2 -mx-1 flex gap-1.5 px-1 pb-1">
              {savedAddrs.map((a) => {
                const active = a.address === addr.trim();
                return (
                  <button
                    type="button"
                    key={a.id}
                    onClick={() => {
                      setAddr(a.address);
                      if (a.location) setLoc(a.location);
                      haptic.selection();
                    }}
                    className={`group inline-flex flex-shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-bold transition active:scale-95 ${
                      active
                        ? 'bg-[var(--brand-primary)] text-white'
                        : 'bg-[var(--brand-cream-100)] text-[var(--brand-primary)]'
                    }`}
                  >
                    <span aria-hidden>{a.icon || '📍'}</span>
                    <span>{a.label}</span>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setSavedAddrs(removeAddress(a.id));
                        if (active) setAddr('');
                        haptic.impact('medium');
                      }}
                      className={`ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] ${
                        active ? 'bg-white/20' : 'bg-white text-[var(--brand-primary)]/55'
                      }`}
                      aria-label="Oʻchirish"
                    >
                      ✕
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {showAddrForm ? (
            <div className="mb-2 flex gap-2">
              <input
                type="text"
                placeholder="Nomi: Uy / Ish / Ota uyi"
                value={newAddrLabel}
                onChange={(e) => setNewAddrLabel(e.target.value)}
                className="flex-1 rounded-xl border border-[var(--brand-cream-200)] bg-white px-3 py-2 text-[12px] focus:border-[var(--brand-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-teal)]/25"
              />
              <button
                type="button"
                onClick={() => {
                  if (newAddrLabel.trim().length < 1 || addr.trim().length < 3) return;
                  setSavedAddrs(saveAddress({ label: newAddrLabel, address: addr.trim(), location: loc }));
                  setShowAddrForm(false);
                  setNewAddrLabel('');
                  haptic.notify('success');
                }}
                className="rounded-xl bg-[var(--brand-primary)] px-3 py-2 text-[11.5px] font-bold text-white"
              >
                ✓ Saqlash
              </button>
            </div>
          ) : null}

          <textarea
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            rows={3}
            className={`${inputCls} leading-relaxed`}
            placeholder={
              deliveryMethod === 'courier'
                ? "Viloyat, tuman, ko'cha, uy..."
                : 'Masalan: bugun 18:00 da olib ketaman'
            }
          />
        </div>

        {/* Delivery time slots — only shown for courier */}
        {deliveryMethod === 'courier' && slots.length > 0 ? (
          <div className="block text-sm">
            <span className="mb-2 block text-[12px] font-bold uppercase tracking-wide text-[var(--dz-soft)]">
              ⏰ Yetkazish vaqti
            </span>
            <div className="dz-scroll-x -mx-1 flex gap-1.5 px-1">
              <button
                type="button"
                onClick={() => {
                  setSlotKey('');
                  haptic.selection();
                }}
                className={`flex-shrink-0 rounded-xl px-3 py-2 text-[11.5px] font-bold transition active:scale-95 ${
                  slotKey === ''
                    ? 'bg-[var(--brand-primary)] text-white'
                    : 'bg-[var(--brand-cream-100)] text-[var(--brand-primary)]'
                }`}
              >
                Tezroq
              </button>
              {slots.map((s) => (
                <button
                  type="button"
                  key={s.key}
                  onClick={() => {
                    setSlotKey(s.key);
                    haptic.selection();
                  }}
                  className={`flex flex-shrink-0 flex-col items-start gap-0.5 rounded-xl px-3 py-1.5 text-left transition active:scale-95 ${
                    slotKey === s.key
                      ? 'bg-[var(--brand-teal)] text-white shadow-[var(--dz-glow-teal)]'
                      : 'bg-[var(--brand-cream-100)] text-[var(--brand-primary)]'
                  }`}
                >
                  <span className="text-[10px] font-bold uppercase opacity-75">{s.day}</span>
                  <span className="text-[12px] font-extrabold tabular-nums">{s.range}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* Courier tip — only shown for courier */}
        {deliveryMethod === 'courier' ? (
          <div className="block text-sm">
            <span className="mb-2 block text-[12px] font-bold uppercase tracking-wide text-[var(--dz-soft)]">
              💚 Kuryerga chaqim (ixtiyoriy)
            </span>
            <div className="grid grid-cols-4 gap-1.5">
              {TIP_OPTIONS.map((amount) => (
                <button
                  type="button"
                  key={amount}
                  onClick={() => {
                    setTip(amount);
                    haptic.selection();
                  }}
                  className={`rounded-xl py-2 text-[11.5px] font-bold transition active:scale-95 ${
                    tip === amount
                      ? 'bg-[var(--brand-accent)] text-[var(--brand-primary)] shadow-[var(--dz-glow-accent)]'
                      : 'bg-[var(--brand-cream-100)] text-[var(--brand-primary)]'
                  }`}
                >
                  {amount === 0 ? 'Yoʻq' : `${amount / 1000}K`}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {deliveryMethod === 'courier' ? (
          <div className="rounded-2xl border border-[color-mix(in_srgb,var(--brand-accent)_45%,transparent)] bg-[var(--brand-accent-50)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-1 text-[13px] font-bold text-[var(--brand-primary)]">
                <span aria-hidden>📡</span> Joylashuv (ixtiyoriy)
              </p>
              <button
                type="button"
                onClick={() => void detectLocation()}
                disabled={locBusy}
                className="rounded-xl bg-[var(--brand-primary)] px-3 py-1.5 text-[11.5px] font-bold text-white shadow-[0_6px_14px_-6px_rgba(16,137,77,0.4)] transition active:scale-95 disabled:opacity-60"
              >
                {locBusy ? 'Aniqlanmoqda…' : '📡 Joylashuvni olish'}
              </button>
            </div>
            {loc ? (
              <p className="mt-2 text-[11.5px] font-semibold text-[var(--brand-primary)]">
                ✓ {loc.latitude}, {loc.longitude}
              </p>
            ) : (
              <p className="mt-2 text-[11.5px] text-[var(--brand-primary)]/70">
                Kuryer uchun aniq koordinata yuborish mumkin.
              </p>
            )}
          </div>
        ) : null}

        <label className="block text-sm">
          <span className="mb-1.5 block text-[12px] font-bold uppercase tracking-wide text-[var(--dz-soft)]">
            💬 Izoh (ixtiyoriy)
          </span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className={inputCls}
            placeholder="Eshik kodi, orientir..."
          />
        </label>

        <div className="block text-sm">
          <span className="mb-2 block text-[12px] font-bold uppercase tracking-wide text-[var(--dz-soft)]">
            💳 Toʻlov usuli
          </span>
          <div className="grid grid-cols-3 gap-2">
            {[
              { v: 'cash' as const, label: 'Naqd', emoji: '💵' },
              { v: 'payme' as const, label: 'Payme', emoji: '💙' },
              { v: 'click' as const, label: 'Click', emoji: '🟦' },
            ].map((opt) => (
              <button
                key={opt.v}
                type="button"
                onClick={() => setPm(opt.v)}
                className={`flex flex-col items-center gap-0.5 rounded-2xl border-2 px-2 py-2.5 text-[12px] font-bold transition active:scale-95 ${
                  pm === opt.v
                    ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white shadow-[0_8px_18px_-8px_rgba(16,137,77,0.45)]'
                    : 'border-transparent bg-[var(--brand-primary-50)] text-[var(--brand-primary)]'
                }`}
              >
                <span className="text-base" aria-hidden>{opt.emoji}</span>
                <span>{opt.label}</span>
              </button>
            ))}
          </div>
          {pm === 'cash' ? (
            <p className="mt-2 text-[11px] text-[var(--dz-soft)]">Yetkazganda yoki doʻkonda toʻlanadi.</p>
          ) : null}
        </div>
      </div>

      {err ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900">
          ⚠ {err}
        </div>
      ) : null}

      {/* Inside Telegram, the native MainButton at the bottom handles
          submission (with live total + progress spinner). Outside TG,
          show the in-page primary CTA. */}
      {!inTg ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className="dz-btn-accent w-full text-[15px] disabled:opacity-55"
        >
          {busy ? 'Joʻnatilmoqda…' : '✓ Buyurtmani tasdiqlash'}
        </button>
      ) : (
        <p className="text-center text-[11.5px] text-[var(--brand-primary)]/55">
          Tasdiqlash uchun pastdagi <b>«Tasdiqlash»</b> tugmasini bosing
        </p>
      )}
    </div>
  );
}

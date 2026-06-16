import { useState } from 'react';
import { Link } from 'react-router-dom';
import { haptic, shareToTelegram } from '../lib/telegram';

const FAQ: { q: string; a: string }[] = [
  {
    q: 'Buyurtmani qancha vaqtda yetkazib beradi?',
    a: 'Toshkent boʻyicha 60–120 daqiqa ichida, viloyatlarga 1–3 kun ichida yetib boradi. Yetkazish vaqtini xaridda tanlay olasiz.',
  },
  {
    q: 'Toʻlov qanday amalga oshiriladi?',
    a: 'Naqd (kuryerga), Payme yoki Click orqali toʻlay olasiz. Onlayn toʻlov xavfsiz va tasdiqlangan kanallar orqali qabul qilinadi.',
  },
  {
    q: 'Bonus ballarni qanday yigʻaman?',
    a: 'Har bir buyurtmadan jami summaning 1% miqdorida ball olasiz. 1 ball = 100 soʻm. Ballarni yangi xaridda chegirma sifatida ishlatasiz (maksimal 50% gacha).',
  },
  {
    q: 'Buyurtmani qaytarish mumkinmi?',
    a: 'Ha, mahsulot qabul qilinganidan keyin 24 soat ichida yaroqli holatda qaytarsangiz, biz pulingizni qaytaramiz yoki almashtiramiz.',
  },
  {
    q: 'Buyurtmani bekor qilish mumkinmi?',
    a: '«Yangi» holatdagi buyurtmalarni siz oʻzingiz «Buyurtmalar» sahifasidan bekor qila olasiz. Toʻlangan buyurtmalar uchun operatorga bogʻlaning.',
  },
  {
    q: 'Promokod qanday ishlaydi?',
    a: 'Promokodingiz boʻlsa, xarid sahifasida «Promokod» bandiga kiriting va «Tekshirish» tugmasini bosing. Yaroqli boʻlsa avtomatik chegirma qoʻllaniladi.',
  },
  {
    q: 'Mahsulot omborda yoʻq, qachon qaytadi?',
    a: 'Mahsulot sahifasida «🔔 Eslatib turing» tugmasini bosing — mavjud boʻlishi bilan Telegram orqali xabar yuboramiz.',
  },
  {
    q: 'Yetkazib berish narxi qancha?',
    a: 'Toshkent ichida 25 000 soʻm. 300 000 soʻmdan yuqori xaridlar uchun bepul. Viloyatlar uchun masofaga qarab hisoblanadi.',
  },
];

const SUPPORT_PHONE = '+998901234567';
const SUPPORT_TG = 'https://t.me/dunyozaminbot';

export function HelpPage() {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  return (
    <div className="space-y-4 dz-animate-in">
      {/* Header */}
      <div className="dz-card-flat dz-cream-bg relative overflow-hidden p-4 -mx-1">
        <span className="dz-leak dz-leak-teal dz-leak-md" style={{ top: '-40%', right: '-20%', opacity: 0.22 }} />
        <span className="dz-leak dz-leak-accent dz-leak-sm" style={{ bottom: '-30%', left: '-15%', opacity: 0.25 }} />
        <div className="relative">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.2em] text-[var(--brand-teal)]">
            ✦ Yordam markazi
          </p>
          <h1 className="mt-1.5 text-[20px] font-extrabold text-[var(--brand-primary)]">Sizga qanday yordam beraylik?</h1>
          <p className="mt-1 text-[12px] leading-relaxed text-[var(--brand-primary)]/65">
            Tez-tez beriladigan savollar, jonli operator va aloqa kanallari shu yerda.
          </p>
        </div>
      </div>

      {/* Quick contact actions */}
      <section className="grid grid-cols-3 gap-2.5">
        <a
          href={SUPPORT_TG}
          target="_blank"
          rel="noreferrer"
          onClick={() => haptic.selection()}
          className="dz-card-flat relative flex flex-col items-start justify-between gap-3 px-3 py-3 text-left text-[11.5px] font-semibold text-[var(--brand-primary)] transition active:scale-[0.97]"
        >
          <span className="dz-leak dz-leak-teal dz-leak-sm" style={{ top: '-30%', right: '-30%', opacity: 0.25 }} />
          <span className="relative flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--brand-teal-50)] text-[15px] text-[var(--brand-teal)]" aria-hidden>
            💬
          </span>
          <span className="relative leading-tight">Telegram<br />operator</span>
        </a>
        <a
          href={`tel:${SUPPORT_PHONE.replace(/[^+\d]/g, '')}`}
          onClick={() => haptic.selection()}
          className="dz-card-flat relative flex flex-col items-start justify-between gap-3 px-3 py-3 text-left text-[11.5px] font-semibold text-[var(--brand-primary)] transition active:scale-[0.97]"
        >
          <span className="dz-leak dz-leak-accent dz-leak-sm" style={{ top: '-30%', right: '-30%', opacity: 0.3 }} />
          <span className="relative flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--brand-accent)]/45 text-[15px] text-[var(--brand-primary)]" aria-hidden>
            📞
          </span>
          <span className="relative leading-tight">Qoʻngʻiroq<br />qilish</span>
        </a>
        <button
          type="button"
          onClick={() => {
            haptic.selection();
            void shareToTelegram(window.location.origin, 'DunyoZamin do\'kon — har narsa bir joyda 🌿');
          }}
          className="dz-card-flat relative flex flex-col items-start justify-between gap-3 px-3 py-3 text-left text-[11.5px] font-semibold text-[var(--brand-primary)] transition active:scale-[0.97]"
        >
          <span className="dz-leak dz-leak-cream dz-leak-sm" style={{ top: '-30%', right: '-30%', opacity: 0.45 }} />
          <span className="relative flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--brand-cream-200)] text-[15px] text-[var(--brand-primary)]" aria-hidden>
            ↗
          </span>
          <span className="relative leading-tight">Doʻst<br />bilan ulashish</span>
        </button>
      </section>

      {/* FAQ accordion */}
      <section className="space-y-2">
        <p className="px-1 text-[10.5px] font-bold uppercase tracking-[0.2em] text-[var(--brand-primary)]/55">
          ❓ Ko‘p beriladigan savollar
        </p>
        {FAQ.map((item, i) => {
          const open = openIdx === i;
          return (
            <div key={i} className="dz-card relative overflow-hidden">
              {open ? (
                <span
                  className="dz-leak dz-leak-teal dz-leak-md"
                  style={{ top: '-50%', right: '-25%', opacity: 0.16 }}
                />
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setOpenIdx(open ? null : i);
                  haptic.selection();
                }}
                className="relative flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left"
              >
                <span className="text-[12.5px] font-bold text-[var(--brand-primary)]">{item.q}</span>
                <span
                  className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[var(--brand-cream-100)] text-[10px] text-[var(--brand-primary)] transition ${
                    open ? 'rotate-180 bg-[var(--brand-teal)] text-white' : ''
                  }`}
                  aria-hidden
                >
                  ▼
                </span>
              </button>
              {open ? (
                <div className="relative px-3.5 pb-3.5 pt-0 text-[12px] leading-relaxed text-[var(--brand-primary)]/80">
                  {item.a}
                </div>
              ) : null}
            </div>
          );
        })}
      </section>

      {/* Bottom hint */}
      <div className="dz-card-flat dz-cream-bg relative overflow-hidden px-4 py-4 text-center">
        <span className="dz-leak dz-leak-accent dz-leak-md" style={{ top: '-50%', right: '-25%', opacity: 0.18 }} />
        <p className="relative text-[12px] font-semibold text-[var(--brand-primary)]">
          Javobingizni topa olmadingizmi?
        </p>
        <p className="relative mt-0.5 text-[11px] text-[var(--brand-primary)]/65">
          Telegram orqali yozing — biz 5 daqiqa ichida javob beramiz.
        </p>
        <a
          href={SUPPORT_TG}
          target="_blank"
          rel="noreferrer"
          className="dz-btn-primary relative mt-3 inline-flex items-center gap-1 text-[12px]"
        >
          💬 Operator bilan bogʻlanish
        </a>
      </div>

      {/* Footer link back */}
      <div className="text-center">
        <Link to="/" className="text-[11.5px] font-bold text-[var(--brand-teal)]">
          ← Asosiy sahifaga qaytish
        </Link>
      </div>
    </div>
  );
}

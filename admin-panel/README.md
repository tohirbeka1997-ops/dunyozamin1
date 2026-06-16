# Dunyozamin — Admin panel

Mini-app (Telegram Web App) do'konini boshqarish uchun web admin panel.
`public-api` backendiga `/v1/admin/*` route'lari orqali ulanadi.

## Imkoniyatlar

- **Boshqaruv paneli** — bugungi savdo, tushum, buyurtmalar, web-buyurtma navbatlari
- **Buyurtmalar** — web buyurtmalar ro'yxati, qidiruv, holatni o'zgartirish, kuryerga biriktirish
- **Mahsulotlar** — katalog, narx/qoldiq ko'rish, mini-appda ko'rinish (visible/hidden) boshqaruvi
- **Aksiyalar** — chegirma/promo aksiyalar (yoqish/o'chirish/o'chirib tashlash), bosh sahifa bannerlari
- **Mijozlar** — mijozlar ro'yxati, balans, loyalty, xaridlar tarixi

## Auth

Alohida admin login (`/v1/admin/auth/login`). Faqat **admin** va **manager** rolidagi
POS foydalanuvchilari kira oladi. Token (access+refresh) `localStorage`da saqlanadi,
muddati tugaganda avtomatik yangilanadi.

## Ishga tushirish (dev)

```bash
cd admin-panel
npm install
npm run dev          # http://localhost:5181
```

Dev rejimida `/v1` so'rovlari `http://127.0.0.1:3334` (public-api)ga proxy qilinadi —
`vite.config.ts` ichida sozlangan.

## Build va deploy

```bash
npm run build        # dist/ papkasi
```

`dist/` ni nginx orqali tarqating. Backend bilan bir domenda (same-origin) bo'lsa
`VITE_ADMIN_API_URL` ni bo'sh qoldiring; alohida domen bo'lsa to'liq URL kiriting
(`.env.production` da). CORS uchun `PUBLIC_API_CORS_ORIGINS` ga admin domenini qo'shing.

## Tekshirish

```bash
npm run typecheck    # tsc --noEmit — 0 xato
```

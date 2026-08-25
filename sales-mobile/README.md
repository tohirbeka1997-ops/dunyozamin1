# DunyoZamin — Sotuvchi mobil ilova

Enterprise mobil ilova: savdo, smena, onlayn buyurtmalar, mijozlar, oflayn navbat.

> **Holat:** 1.1.0 — staff funksiyalar tayyor (sideload APK); Play Store packaging EAS orqali.

## Ishga tushirish (dev)

**1. Public API (staff routes):**

```bash
# Loyiha ildizida .env da STAFF_JWT_SECRET (yoki JWT_SECRET) va POS_DATA_DIR
npm run public-api:dev
```

**2. Mobil ilova:**

```bash
cd sales-mobile && npm install && npx expo start
```

`sales-mobile/.env` (`.env.example` dan):

```
EXPO_PUBLIC_STAFF_API_URL=http://localhost:3334
EXPO_PUBLIC_DEFAULT_TENANT=default
```

- Android emulator: `http://10.0.2.2:3334`
- Haqiqiy telefon (LAN): `http://192.168.x.x:3334` yoki production HTTPS

## Native APK (lokal, Expo hisobisiz)

Production API: `https://staff.dunyozamin.com`

```bash
cd sales-mobile
npm run build:android:local
# Natija: dist-native/dz-sotuvchi-1.1.0.apk (~50 MB)
```

Telefon: APK ni o‘rnatish (noma’lum manbalarga ruxsat). Keystore: `credentials/release.keystore` (gitga kirmaydi).

## Native build (EAS / Play Store)

### Bir marta sozlash

1. Expo hisobi: `npm run eas:login` + `npm run eas:init` (projectId)
2. Play Console + (ixtiyoriy) Firebase `google-services.json`
3. `npm run build:android:production` → `npm run submit:android`

> Eslatma: Play Store / Apple / Firebase hisoblari sizniki — ularni agent o‘rniga kira olmaydi. Lokal signed APK yuqorida tayyor.

## Stack

- Expo SDK 52 + Expo Router + EAS Build
- TypeScript, SecureStore, AsyncStorage, biometrika, kamera skaner
- Staff REST `/v1/staff/*` (public-api)

Arxitektura: [docs/SALES-MOBILE-ARCHITECTURE.md](../docs/SALES-MOBILE-ARCHITECTURE.md)

# DunyoZamin — Sotuvchi mobil ilova



Enterprise mobil ilova: onlayn buyurtmalar navbatlari, holat boshqaruvi, kuryerga yuborish.



> **Holat:** MVP core (0.1) — login, navbatlar, buyurtmalar ro‘yxati, tafsilot + holat yangilash.



## Ishga tushirish



**1. Public API (staff routes):**



```bash

# Loyiha ildizida .env da STAFF_JWT_SECRET (yoki JWT_SECRET) va POS_DATA_DIR

npm run public-api:dev   # yoki: npm run start --prefix public-api

```



**2. Mobil ilova:**



```bash

npm run sales-mobile:dev

# yoki:

cd sales-mobile && npm install && npx expo start

```



`sales-mobile/.env` nusxasi (`.env.example` dan):



```

EXPO_PUBLIC_STAFF_API_URL=http://localhost:3334

EXPO_PUBLIC_DEFAULT_TENANT=default

```



Android emulator uchun API URL: `http://10.0.2.2:3334`



## Ekranlar



| Ekran | Yo‘l |

|-------|------|

| Login | `/(auth)/login` |

| Navbatlar dashboard | `/(tabs)/` |

| Buyurtmalar ro‘yxati | `/(tabs)/orders` |

| Buyurtma tafsiloti | `/orders/[id]` |

| Profil / til / chiqish | `/(tabs)/profile` |



## Stack



- Expo SDK 52 + Expo Router

- TypeScript, expo-secure-store

- Staff REST `/v1/staff/*` (public-api)



Arxitektura: [docs/SALES-MOBILE-ARCHITECTURE.md](../docs/SALES-MOBILE-ARCHITECTURE.md)



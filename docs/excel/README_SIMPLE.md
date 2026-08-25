# Kunlik kassa va oldi-berdi (soddalashtirilgan)

Do'kon egasi uchun **minimal** pul hisobi — qisqa **KOD** yozish tizimi bilan.

## Fayllar

| Fayl | Vazifasi |
|------|----------|
| [Kunlik_Kassa_Oldi_Berdi_ui.xlsx](./Kunlik_Kassa_Oldi_Berdi_ui.xlsx) | Tayyor workbook (namuna + formulalar, UI) |
| `generate_simple_cash_workbook.py` | Qayta yaratish skripti |

```bash
python docs/excel/generate_simple_cash_workbook.py
```

Agar Excel ochiq bo'lsa, skript `Kunlik_Kassa_Oldi_Berdi_ui.xlsx` / `_fixed.xlsx` nomiga yozadi.

## Varag'lar (7 ta)

| Varag | Nima qilasiz | Nima avtomatik |
|-------|--------------|----------------|
| **Parametrlar** | Do'kon nomi, boshlang'ich kassa, oy/yil; kodlar | — |
| **Xarajatlar** | Kod + summa | Sana, tur nomi |
| **Tovarga pul** | Yetkazuvchi kodi + summa | Sana, ism |
| **Kunlik kassa** | Kirdi, boshqa chiqim | Xarajat/tovar, qoldiq |
| **Oldi-berdi** | Kod + berdim/olding | Sana, ism, balans |
| **Hisob balans** | — | Jami, kassa, qarzlar |
| **Oylik xulosa** | Parametrlarda oy/yil | Oy bo'yicha jami va foyda |

## Ranglar

- **To'q teal sarlavha** — varaq nomi
- **Sariq** — qo'lda yoziladi (Kod ustuni biroz to'qroq)
- **Yashil** — formula (o'zgartirmang)
- **Belgi = Namuna** — namuna qatorlar (o'chirishingiz mumkin)

## Namuna hisob (avgust 2026)

| Band | Summa |
|------|------:|
| Boshlang'ich kassa | 500 000 |
| Jami kirdi | 3 680 000 |
| Xarajat (SV+AB+IJ) | 580 000 |
| Tovarga pul | 650 000 |
| Boshqa chiqim | 65 000 |
| **Jami chiqim** | **1 295 000** |
| **Oy oxiri kassa** | **2 885 000** (= 500k + 3 680k − 1 295k) |
| Bizga qarz (SH+SI) | 250 000 |
| Bizdan qarz (JA) | 150 000 |

### «750 000 qayerdan?»

Bu **oy oxiri kassa qoldiq emas**. Eski namuna / chalkashlik:

1. Ba'zi eski kunlik qatorda 3-avgust **chiqim** va **kunlik farq** ikkalasi ham 750 000 bo'lgan, yoki
2. **500 000** (boshlang'ich) + **250 000** (odamlardan qarz) = **750 000** — bu kassa emas, kassa+qarz aralashmasi.

To'g'ri oy oxiri kassa: **2 885 000**.

## Kodlash

**Odamlar:** SH, JA, SI · **Xarajat:** SV, AB, IJ, MS, TR, BOSHQA · **Yetkazuvchi:** JA, SH, BAZAR, OPT

Yangi kod: **Parametrlar** dagi tegishli jadvalga qator qo'shing.

## Excel versiyasi

Excel **2016 / 2019 / 365** — `INDEX/MATCH`, `SUMIFS` (XLOOKUP kerak emas).

## Eski katta kitob

Murakkab POS: [Dokon_Oldi_Berdi_Hisobotlar.xlsx](./Dokon_Oldi_Berdi_Hisobotlar.xlsx) va `README.md`.

# Do'kon Oldi-Berdi Excel hisobotlari

## Fayl

- **[Dokon_Oldi_Berdi_Hisobotlar.xlsx](./Dokon_Oldi_Berdi_Hisobotlar.xlsx)** — tayyor workbook (namuna ma'lumot + formulalar)
- `generate_pos_excel_workbook.py` — qayta generatsiya skripti:

```bash
python docs/excel/generate_pos_excel_workbook.py
```

## Qisqa ishlatish

1. `Parametrlar` — do'kon nomi, davr (From/To), AsOf sana, default FX.
2. Sariq kataklarga xom ma'lumot yozing (`01`…`09` varaqlar).
3. Yashil kataklar — formulalar (`Dashboard`, `Ombor_Qoldiq`, `Sotuv_Hisobot`, `Kassa`, `Aging_AR_AP`).

Excel **365 / 2021+** tavsiya etiladi (`XLOOKUP`, `SUMIFS`).

Batafsil yo'riqnoma workbook ichidagi **`00_README`** varag'ida.

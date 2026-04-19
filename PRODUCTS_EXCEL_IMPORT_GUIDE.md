# Mahsulotlarni Excel orqali import qilish (Qo‘llanma va struktura)

Bu hujjat mahsulotlarni Excel’dan import qilish uchun **standart ustunlar (shablon)** va **to‘ldirish qoidalari**ni beradi.

> Eslatma: hozirgi UI’da to‘g‘ridan-to‘g‘ri “Import” tugmasi bo‘lmasligi mumkin. Shunga qaramay, shu strukturada fayl tayyorlab qo‘ysangiz, import funksiyasini qo‘shishda aynan shu format ishlatiladi.

## 80% kerak bo‘ladigan minimal ustunlar (tavsiya)
Quyidagi ustunlar bilan import qilish eng qulay va xavfsiz:

- **sku** *(majburiy, unik)*: mahsulot kodi (masalan `MILK-1L-001`)
- **name** *(majburiy)*: mahsulot nomi
- **sale_price** *(majburiy)*: sotuv narxi (son)
- **purchase_price** *(ixtiyoriy, lekin tavsiya)*: kirim narxi (son)
- **unit** *(tavsiya)*: `pcs`, `kg`, `l`, `m`, `sqm`, `box`, `roll`, `bag`, `set`
- **barcode** *(ixtiyoriy, unik bo‘lsa yaxshi)*: shtrix-kod (matn sifatida)
- **category** *(ixtiyoriy)*: kategoriya nomi (masalan `Sut mahsulotlari`)
- **min_stock_level** *(ixtiyoriy)*: minimal qoldiq (son)
- **current_stock** *(ixtiyoriy)*: boshlang‘ich qoldiq (son)
- **is_active** *(ixtiyoriy)*: `1` (faol) / `0` (nofaol)
- **track_stock** *(ixtiyoriy)*: `1` (ombor nazorati) / `0` (nazorat yo‘q)

## Ustunlar va qoidalar (to‘liq ro‘yxat)

### Majburiy
- **sku**: text, *unik*, bo‘sh bo‘lmasin
- **name**: text, bo‘sh bo‘lmasin
- **sale_price**: number, `0` dan katta bo‘lsa yaxshi

### Ixtiyoriy
- **barcode**: text, agar bo‘lsa *unik* bo‘lishi kerak (takror bo‘lsa import xato beradi)
- **description**: text
- **category**: text (kategoriya nomi)
- **category_id**: text (agar kategoriya ID’lari oldindan ma’lum bo‘lsa)
- **unit**: text (default: `pcs`)
- **purchase_price**: number (default: `0`)
- **current_stock**: number (default: `0`)
- **min_stock_level**: number (default: `0`)
- **max_stock_level**: number (ixtiyoriy)
- **track_stock**: `1/0` (default: `1`)
- **is_active**: `1/0` (default: `1`)
- **image_url**: text (ixtiyoriy)

## Excel’da muhim sozlashlar (xatolik bo‘lmasligi uchun)
- **Barcode ustuni**ni Excel’da *Text (Matn)* qiling. Aks holda uzun shtrix-kodlar `1.234E+12` ko‘rinishga o‘tib buziladi.
- Narxlarni **raqam** (number) formatida kiriting.
- Agar kasr ishlatmasangiz, narxlarni butun son ko‘rinishida yozing (UZS).

## Misol (1 qator)

| sku | name | barcode | category | unit | purchase_price | sale_price | current_stock | min_stock_level | is_active | track_stock |
|---|---|---|---|---|---:|---:|---:|---:|---:|---:|
| MILK-1L-001 | Sut 1L | 4780123456789 | Sut mahsulotlari | pcs | 9000 | 12000 | 20 | 5 | 1 | 1 |

## Tayyor shablon fayl
Repo ichida tayyor CSV shablon bor:
- `templates/products_import_template.csv`

Uni Excel’da ochib to‘ldiring va xohlasangiz `xlsx` qilib saqlang.

## Importni ilovada qilish (UI)
1) `Mahsulotlar` sahifasiga kiring  
2) Yuqoridagi **“Excel/CSV Import”** tugmasini bosing  
3) `.xlsx` yoki `.csv` faylni tanlang (Preview chiqadi)  
4) Rejimni tanlang:
   - **SKU bo‘yicha yaratish/yangilash**: sku mos kelsa yangilanadi, bo‘lmasa yangi yaratiladi
   - **Faqat yaratish**: mavjud SKU bo‘lsa ham yangi yaratishga urinadi (agar sku unik bo‘lsa, xato beradi)
5) **“Importni boshlash”** ni bosing



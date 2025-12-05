# POS Tizimi Talablar Hujjati

## 1. Tizim nomi
POS Tizimi (Point of Sale Management System)

## 2. Tizim tavsifi
Professional savdo nuqtalari uchun to'liq funksional POS tizimi. Tizim real vaqt rejimida savdo jarayonlarini boshqarish,ombor nazorati, moliyaviy hisobotlar va xodimlar faoliyatini kuzatish imkoniyatlarini taqdim etadi.

## 3. Asosiy funksional modullar

### 3.1 Dashboard (Analitika)
- Real vaqt rejimida savdo ko'rsatkichlari
- Kunlik/haftalik/oylik statistika
- Tezkor ko'rsatkichlar paneli
\n### 3.2 POS Terminal (Kassa oynasi)
- Barcode scanner orqali mahsulot qo'shish
- Qidiruv va kategoriyalar bo'yicha tanlash
- Chegirma (foiz va summa)\n- Kuponlar va promo-kodlar qo'llash
- Ko'p to'lov usullari:\n  - Naqd pul\n  - Bank kartasi
  - Terminal\n  - QR to'lov
  - Aralash to'lov (masalan: 50% karta + 50% naqd)
- Tovar narxini real-time o'zgartirish (faqat manager)
- Qaytarish summasi avtomatik hisoblash
- Chek raqami avtomatik generatsiya (Format: POS-2025-000123)
- Quick Actions paneli:\n  - To'lov qabul qilish
  - Buyurtmani saqlab qo'yish (Hold order)
  - Chek qaytarish
  - Xaridor tanlash
- Offline rejimda ishlash imkoniyati

### 3.3 Mahsulotlar katalogi (Products Module)
\n#### 3.3.1 Products List Page
**Jadval/Grid ko'rinishi quyidagi ustunlar bilan:**
- Mahsulot rasmi
- Mahsulot nomi
- SKU / Barcode
- Kategoriya
- O'lchov birligi (dona, kg, litr, paket va boshqalar)
- Xarid narxi
- Sotuv narxi
- Joriy qoldiq
- Status (Faol / Nofaol)
- Amallar (Ko'rish, Tahrirlash, O'chirish)

**Funksiyalar:**
- Qidiruv: nom, SKU, barcode bo'yicha
- Filtrlar:\n  - Kategoriya filtri
  - Status filtri
  - Kam qoldiq filtri
- Sahifalash (Pagination)
- Excel orqali ommaviy import
- Excel orqali ommaviy export
-'Mahsulot qo'shish' tugmasi

**Qoldiq holati ranglari:**
- Yashil → Qoldiq yetarli
- Sariq → Kam qoldiq
- Qizil → Qoldiqda yo'q
\n#### 3.3.2 Add / Edit Product Form
**Umumiy ma'lumotlar:**
- Mahsulot nomi (majburiy)
- SKU (avtomatik generatsiya + tahrirlash mumkin)
  - Format: SKU-000123
- Barcode (ixtiyoriy, scanner bilan mos)
- Kategoriya (dropdown)
- O'lchov birligi (dona, kg, litr, paket va boshqalar)
- Status (Faol / Nofaol)
\n**Narxlar:**
- Xarid narxi
- Sotuv narxi
- Foyda foizi kalkulyatori
- Narxlar o'zgarganda foizni avtomatik hisoblash
- Soliq stavkasi (ixtiyoriy)

**Ombor sozlamalari:**
- Boshlang'ich qoldiq (faqat yaratishda ruxsat etiladi)
- Minimal qoldiq ogohlantirish darajasi
- Qoldiqni kuzatish ON/OFF
  -Agar OFF bo'lsa → mahsulot sotiladi, lekin ombor kamaytirilmaydi
\n**Rasmlar:**
- Mahsulot rasmi yuklash (1-3 ta rasm tavsiya etiladi)
\n#### 3.3.3 Product Detail Page
**Yuqori qism:**
- Rasm
- Mahsulot nomi
- SKU / Barcode
- Kategoriya
- Joriy qoldiq
- Status belgisi
- Sotuv narxi
- Xarid narxi
- Foyda foizi\n\n**Faoliyat varaqlari (Tabs):**
\n**1)Ombor harakatlari (Inventory Movements)**
- Barcha qoldiq tarixi:\n  - Xarid buyurtmalari (kiruvchi qoldiq)
  - Sotuvlar (chiquvchi qoldiq)
  - Qaytarishlar\n  - Inventarizatsiya tuzatishlari
  - Ko'chirishlar
- Ustunlar:
  - Sana
  - Turi
  - Miqdor (+ yoki –)
  - Foydalanuvchi
  - Bog'liq hujjat raqami

**2) Sotuv tarixi (Sales History)**
- Buyurtma ID
- Mijoz (ixtiyoriy)
- Sotilgan miqdor
- Jami summa
- Foyda\n\n**3) Xarid tarixi (Purchase History)**
- Yetkazib beruvchi
- Xarid qilingan miqdor
- Narx
- Hujjat raqami
\n#### 3.3.4 Ombor integratsiyasi (Majburiy)
- Sotuv amalga oshganda → qoldiq kamayadi
- Qaytarish amalga oshganda → qoldiq ortadi
- Xarid buyurtmasi qabul qilinganda → qoldiq ortadi\n- Inventarizatsiya tuzatishi amalga oshganda → loglar yangilanadi

#### 3.3.5 Barcode tizimi integratsiyasi\n- Barcode avtomatik generatsiya YOKI qo'lda kiritish
- Barcode scanner POS Terminalda mahsulotni darhol qidirishi va qo'shishi kerak
- Chop qilinadigan barcode yorliqlari yaratish (ixtiyoriy)

#### 3.3.6 Kategoriya integratsiyasi\n- Kategoriya dropdown tanlash
- Kategoriya bo'yicha filtrlash
- Kategoriya rangli teglar (ixtiyoriy)

#### 3.3.7 Ma'lumotlarni tekshirish (Data Validation)
- Mahsulot nomi majburiy
- Sotuv narxi xarid narxidan past bo'lsa ogohlantirish
- SKU noyob bo'lishi kerak
- Barcode noyob bo'lishi kerak
- Boshlang'ich qoldiq manfiy bo'lishi mumkin emas
- Narxlar raqamli qiymatlar bo'lishi kerak
- O'chirishda →agar mahsulotning sotuv tarixi bo'lsa ogohlantirish
\n#### 3.3.8 Qo'shimcha funksiyalar (Ixtiyoriy lekin tavsiya etiladi)
- Sevimli mahsulotlar (POS tezkor kirishiga yulduzcha belgisi)
- Ko'p do'konombor sinxronizatsiyasi
- Variantlar (o'lcham/rang)
- Birlashtirilgan mahsulotlar\n- Amal qilish muddatini kuzatish (dorixona/oziq-ovqat uchun)
- FIFO/LIFO xarajat hisoblash (ERP darajasidagi ombor uchun)

### 3.4 Kategoriyalar\n- Mahsulotlarni guruhlash
- Ierarxik tuzilma
\n### 3.5 Cheklar (Orders/Receipts)
- Chek ma'lumotlari: raqam, sana, kassir, mijoz, summa, to'lov turi, status
- Chek detallari: mahsulotlar ro'yxati, jami hisob, soliq, to'lovlar tarixi
- PDF formatda chek yaratish
- Chop qilish funksiyasi

### 3.6 Qaytarishlar (Sales Returns)
- Chek raqami bo'yicha qidiruv
- Qaytariladigan mahsulotlarni tanlash
- Miqdor kiritish
- Ombor qoldig'ini avtomatik yangilash
- Mijoz balansini yangilash
- Return Slip PDF yaratish
- Qaytarish raqami formati: RET-YYYY-#####

### 3.7 To'lovlar (Payments)
- Bir nechta to'lov usuli
- Qisman to'lov imkoniyati
- Terminal integratsiyasi
- Oldindan to'lov (qarzdor mijozlaruchun)
- To'lov ma'lumotlari: raqam, sana, summa, turi, izoh

### 3.8 Ombor (Inventory Management)
- Real-time qoldiq hisoblash: Qoldiq = Prihod – Rashod + Qaytarish – Qaytarish yetkazib beruvchiga
- Ombor harakatlari: prihod, rashod, inventarizatsiya, ko'chirish
- Serial number tracking
- Ogohlantirishlar:\n  - Minimal qoldiq\n  - Tugash arafasi
  - Ko'p sotilayotgan tovarlar

### 3.9 Tovar qabul qilish (Purchase Receiving)
- Yetkazib beruvchini tanlash
- Qabul etilgan mahsulotlar jadvali
- Narxlarni kechiktirilgan holda o'zgartirish
- Tovarni omborga avtomatik qo'shish\n- Hisob-faktura raqami
- Prihod raqami formati: PRC-YYYY-#####

### 3.10 Inventarizatsiya\n- Omborni tanlash
- Haqiqiy miqdorni kiritish
- Tizim miqdori bilan taqqoslash
- Farqni avtomatik hisoblash va tasdiqlash
- Ombor harakatiga yozish
- Inventarizatsiya raqami formati: INV-YYYY-#####
\n### 3.11 Mijozlar (Customers)
- Bonus tizimi
- Qarzdorlik kuzatuvi
- Keshbek\n- Mijoz tarixini ko'rsatish
- Oxirgi xaridlar ro'yxati
\n### 3.12 Xodimlar va rollar
- Rollar: Admin, Manager, Kassir\n- Ruxsatlar tizimi:\n  - Narxni o'zgartirish
  - Qaytarish qilish
  - Chek o'chirish
  - Omborga kirish
- Role-based access control (RBAC)
\n### 3.13 Hisobotlar (Reports)
**Savdo hisobotlari:**
- Kunlik savdo
- Kassir bo'yicha savdo
- Eng ko'p sotilgan mahsulotlar
- Eng kam sotilgan mahsulotlar\n- To'lov usullari bo'yicha taqsimot

**Ombor hisobotlari:**
- Qoldiq\n- Harakatlar
- Kam qoldiqdagi mahsulotlar
\n**Moliya hisobotlari:**
- Kirim/Chiqim
- Foyda/zarar (Profit & Loss)
\n**Mijoz hisobotlari:**\n- Top mijozlar
- Qarzdorlik hisobotlari

**Kassa hisobotlari:**\n- Z-otchet (kunlik yakun)
- X-otchet (oraliq hisobot)
- Kassa ochilishi/yopilishi
- Shift-based accounting

### 3.14 Sozlamalar (Settings)
- Tizim sozlamalari
- Kassa sozlamalari
- Printer sozlamalari
- Device binding (faqat bitta kassaga ulangan)
\n## 4. Professional funksiyalar
- Hold order (chekni vaqtincha saqlash)
- Split payment (bir nechta to'lov turi)
- Quick add product (tezkor qo'shish)\n- Z-otchet va X-otchet
- Kassa ochilishi/yopilishi
- Shift-based accounting
- Device binding

## 5. Texnik talablar
\n### 5.1 UI/UX talablar
- Minimalist va silliq dizayn
- Tez ishlash (caching va optimization)
- Tablet va kassa monitorlariga moslashgan
- Touch screenuchun katta tugmalar
- Offline mode va data sync
- Qorong'i va yorug' rejim
- Desktop va POS displeylaruchun optimallashtirilgan
- Yig'iladigan yon panellar
- Admin darajasidagi funksiyalar kassirlardan yashirilgan
-10,000+ mahsulot bilan ham tez render qilish

### 5.2 Xavfsizlik
- JWT yoki Session authentication
- Role-based access control (RBAC)
- Offline ma'lumot shifrlanishi
- Kassa bo'yicha loglar: kim nima qilgan\n\n### 5.3 Integratsiyalar
- Fiskal printer
- Barcode scanner\n- QR Pay (Click/Payme)
- Inventory API
- Bank terminali
\n## 6. Tizim nomerlash siyosati
- Chek: POS-YYYY-#####
- Qaytarish: RET-YYYY-#####\n- Prihod: PRC-YYYY-#####
- Inventarizatsiya: INV-YYYY-#####
- SKU: SKU-000123\n\n## 7. Modullar integratsiyasi
Mahsulotlar moduli quyidagi modullar bilan to'liq integratsiyalangan bo'lishi kerak:
- POS Terminal
- Ombor (Inventory)
- Xarid buyurtmalari (Purchase Orders)
- Sotuvlar (Sales)
- Hisobotlar (Reports)
- Mijozlar (Customers,agar kerak bo'lsa)
- Sotuv qaytarishlari (Sales Returns)
\nBarcha operatsiyalar to'liq sinxronlashtirilgan va audit qilinadigan bo'lishi kerak.

## 8. Dizayn uslubi
- Zamonaviy va professional ko'rinish, biznes muhitiga mos\n- Asosiy ranglar: ko'k (#2563EB) va kulrang (#64748B) tonlari, oq fon (#FFFFFF)
- Karta uslubidagi layout, har bir modul alohida kartada
- Yumshoq soyalar (shadow-sm) va 8px border-radius
- Ikkonlar: Lucide yoki Heroicons kutubxonasidan zamonaviy chiziqli ikkonlar
- Jadvallar: zebra-striped uslubda, hover effekti bilan
- Tugmalar: to'ldirilgan (primary) va konturli (secondary) variantlar, touch screen uchun minimal44px balandlik
- Responsive grid layout: desktopuchun 3-4 ustun, tablet uchun 2ustun
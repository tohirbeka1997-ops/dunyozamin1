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
  - Aralash to'lov (masalan:50% karta + 50% naqd)
- Tovar narxini real-time o'zgartirish (faqat manager)
- Qaytarish summasi avtomatik hisoblash
- Chek raqami avtomatik generatsiya (Format: POS-YYYYMMDD-#####)
- Quick Actions paneli:\n  - To'lov qabul qilish
  - Buyurtmani saqlab qo'yish (Hold order)
  - Chek qaytarish
  - Xaridor tanlash
- Offline rejimda ishlash imkoniyati
- Kategoriya tugmalari orqali mahsulotlarni filtrlash
- Rangli kategoriya belgilari va ikkonlar
- Eng ko'p sotiladigan kategoriyalar yuqorida ko'rsatiladi
- Mijozni tanlash yoki tezkor yaratish (ism + telefon)
- Kredit savdo imkoniyati (mijoz ruxsati bo'lsa)

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
- 'Mahsulot qo'shish' tugmasi
\n**Qoldiq holati ranglari:**
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
- Qoldiqni kuzatish ON/OFF\n  -Agar OFF bo'lsa → mahsulot sotiladi, lekin ombor kamaytirilmaydi
\n**Rasmlar:**
- Mahsulot rasmi yuklash (1-3 ta rasm tavsiya etiladi)
\n#### 3.3.3 Product Detail Page
**Yuqori qism:**
- Rasm\n- Mahsulot nomi
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
\n**2) Sotuv tarixi (Sales History)**
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
- Barcode scanner POS Terminalda mahsulotnidarhol qidirishi va qo'shishi kerak
- Chop qilinadigan barcode yorliqlari yaratish (ixtiyoriy)

#### 3.3.6 Kategoriya integratsiyasi
- Kategoriya dropdown tanlash
- Kategoriya bo'yicha filtrlash\n- Kategoriya rangli teglar (ixtiyoriy)
\n#### 3.3.7 Ma'lumotlarni tekshirish (Data Validation)
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
- Birlashtirilgan mahsulotlar
- Amal qilish muddatini kuzatish (dorixona/oziq-ovqat uchun)
- FIFO/LIFO xarajat hisoblash (ERP darajasidagi ombor uchun)

### 3.4 Kategoriyalar (Categories Module)
\n#### 3.4.1 Categories List Page
**Sahifa sarlavhasi:** Categories

**Jadval ustunlari:**
- Name – Kategoriya nomi
- Description – Ixtiyoriy qisqa tavsif
- Products Count – Mahsulotlar soni (tavsiya etiladi)
- Created Date – Yaratilgan sana
- Actions – Ko'rish / Tahrirlash / O'chirish

**Funksiyalar:**
- Nom bo'yicha qidiruv
- Saralash (A–Z, Z–A, eng yangi, eng eski)
- Sahifalash (Pagination)
- '+ Add Category' tugmasi
- O'chirishda → agar kategoriyada mahsulotlar bo'lsa, ogohlantirish ko'rsatish
- Rangli teg belgilari (ixtiyoriy)
\n#### 3.4.2 Add Category Form
**Forma maydonlari:**
- Category Name (majburiy)
- Description (ixtiyoriy)\n- Color Tag (ixtiyoriy; POS Terminal UI guruhlashuchun)
- Icon (ixtiyoriy; emoji yoki SVG)
- Parent Category (ixtiyoriy → ichki kategoriyalaruchun)
\n**Tekshirish:**
- Nom majburiy
- Noyob bo'lishi kerak
- Agar parent category tanlangan bo'lsa → doiraviy parent/child munosabatlarini oldini olish

**Tugmalar:**
- Save\n- Cancel
\n#### 3.4.3 Edit Category Page
Yaratish formasiga to'liq o'xshash, lekin oldindan to'ldirilgan.\n
**Qo'shimcha funksiyalar:**
- Biriktirilgan mahsulotlar sonini ko'rsatish
- O'chirishga urinishda:\n  - Agar mahsulotlar yo'q bo'lsa → o'chirishga ruxsat berish
  - Agar mahsulotlar mavjud bo'lsa → modal ko'rsatish:\n    - 'This category contains X products. Move them to another category before deleting.'
\n#### 3.4.4 Category Detail Page (tavsiya etiladi)
**Ko'rsatish:**
- Name
- Description
- Created at
- Color tag
- Icon
- Parent category
- Products count
\n**Tabs:**
\n**1) Products in this Category**
- Jadval:\n  - Mahsulot nomi
  - SKU / Barcode
  - Narx
  - Qoldiq
  - Status\n  - 'Open product' amal (mahsulot detailiga o'tish)

**2) Activity Log**
- Created\n- Updated
- Deleted
- Products added/removed
- (Audit trail uchun)

#### 3.4.5 Mahsulotlar moduli bilan integratsiya
Kategoriyalar Mahsulotlar bilan to'liq integratsiyalangan bo'lishi kerak:\n- Mahsulot yaratish/tahrirlashda kategoriya dropdown
- Mahsulotlar ro'yxatida kategoriya bo'yicha filtrlash
- Agar kategoriyada mahsulotlar bo'lsa, kategoriyani o'chirish mumkin emas
- Mahsulotlar ro'yxatida kategoriya rangi teglar ko'rsatiladi
- POS Terminal kategoriya asosida navigatsiyani qo'llab-quvvatlashi kerak
- Misol:'Drinks', 'Snacks', 'Fruits', 'Pharmacy' kabi tugmalar

#### 3.4.6 POS Terminal bilan integratsiya
POS Terminal ko'rsatishi kerak:
- Kategoriya tugmalari
- Kategoriya bo'yicha filtrlangan mahsulotlar
- Tez tanib olish uchun ranglar/ikkonlar
- Aqlli tartiblash: eng ko'p sotiladigan kategoriyalar yuqorida ko'rsatiladi
\n#### 3.4.7 UI / UX talablar
- Toza jadval ko'rinishi
- Minimalistik zamonaviy kartalar
- Boshqa modullar bilan izchil bo'shliq
- Mobil qulay on panel o'zaro ta'siri
- Vizual guruhlash uchun rangli teglardan foydalanish
- Ikkonlar ixtiyoriy (lekin POS planshetlar uchun juda tavsiya etiladi)
\n#### 3.4.8 Xavfsizlik va ruxsatlar
Rol asosida kirish:\n- Admin va Manager: Kategoriyalarni yaratish, tahrirlash, o'chirish
- Kassir: Faqat kategoriyalarni ko'rish (tahrirlash yo'q)
\n#### 3.4.9 Texnik talablar
**Kategoriya jadval tuzilishi:**
- id\n- name
- description\n- color\n- icon
- parent_id (nullable)
- created_at
- updated_at
\n**Munosabatlar:**
- Mahsulotlar bilan One-to-many\n- O'z-o'ziga havola qiluvchi parent-child kategoriyalar
- Inventory va POS Terminal bilan avtomatik sinxronizatsiya
\n### 3.5 Ombor boshqaruvi (Inventory Management Module)

#### 3.5.1 Inventory List Page
**Sahifa sarlavhasi:** Inventory

**Jadval ustunlari:**
- product_name – Mahsulot nomi\n- SKU / Barcode – Mahsulot identifikatori
- category – Kategoriya
- stock_quantity – Joriy qoldiq miqdori
- unit – O'lchov birligi\n- cost_price – Xarid narxi
- inventory_value – Ombor qiymati (stock × cost_price)
- status – In Stock / Low Stock / Out of Stock
- actions – View detail / Adjust stock\n
**Funksiyalar:**
- Qidiruv: mahsulot nomi yoki SKU bo'yicha
- Filtrlar:
  - Kategoriya\n  - Qoldiq holati (All / Low Stock / Out of Stock)
- Saralash:\n  - Nom
  - Qoldiq miqdori
  - Ombor qiymati
- Sahifalash (Pagination)
- Excel / PDF formatida eksport
\n**Qoldiq holati ranglari:**
- Yashil → In stock (qoldiq yetarli)\n- Sariq → Low stock (kam qoldiq)
- Qizil → Out of stock (qoldiqda yo'q)

#### 3.5.2 Inventory Detail Page
Mahsulotga xosombor ma'lumotlarini ochish.\n
**Sarlavha ma'lumotlari:**
- Mahsulot rasmi
- Mahsulot nomi
- SKU / Barcode
- Kategoriya
- Joriy qoldiq
- Minimal qoldiq ogohlantirish darajasi
- Xarid narxi va sotuv narxi
-Ombor qiymati
\n**Tabs:**

**Tab 1 — Stock Movements (Harakatlar tarixi)**
Ombor o'zgarishlarining to'liq audit trail.

**Ustunlar:**
- Sana va vaqt
- Harakat turi:\n  - Purchase Received (+) – Xarid qabul qilindi
  - Sale (-) – Sotuv\n  - Sales Return (+) – Savdo qaytarish
  - Purchase Return (-) – Xarid qaytarish
  - Inventory Adjustment (+/-) – Inventarizatsiya tuzatishi
  - Stock Transfer (+/-) – Qoldiq ko'chirish
- Miqdor (+ yoki - bilan)
- Foydalanuvchi
- Bog'liq hujjat (Order #, Return #, Purchase Order #, Adjustment #)

**Harakat qatori rangi mantiqiy:**
- Musbat (+) → Yashil
- Manfiy (–) → Qizil
\n**Tab 2 — Purchase History (Xarid tarixi)**
**Ustunlar:**
- Xarid buyurtmasi raqami
- Yetkazib beruvchi
- Sana
- Qabul qilingan miqdor
- Narx
- Jami xarajat

**Tab 3 — Sales History (Sotuv tarixi)**
**Ustunlar:**
- Buyurtma raqami
- Mijoz
- Sana
- Sotilgan miqdor
- Daromad
- Foyda (sotuv narxi – xarid narxi × miqdor)

#### 3.5.3 Stock Adjustment Module (Qoldiq tuzatish moduli)
**Tugma:** Adjust Stock

**Forma maydonlari:**
- Tuzatish turi:
  - Increase (oshirish)
  - Decrease (kamaytirish)
- Miqdor\n- Sabab:\n  - Damaged (shikastlangan)
  - Lost (yo'qolgan)
  - Correction (tuzatish)
  - Inventory count difference (inventarizatsiya farqi)
- Izohlar (ixtiyoriy)
\n**Tekshirish:**
- Noldan pastga kamaytirish mumkin emas
- Tuzatish logga yozilishi kerak
\n**Tasdiqlashdan keyin:**
- Harakat Movement History ga qo'shiladi
- Mahsulot qoldig'i yangilanadi
- Hisobotlar real-time yangilanadi

#### 3.5.4 Real-Time Inventory Update Logic (Real vaqt rejimida ombor yangilanish mantiqiy)
Qat'iy ombor mantiqiy amalga oshirish:
\n**Sotuv amalga oshganda:**
```
stock -= sold_quantity\nmovement: type = 'Sale', quantity = -X
```

**Savdo qaytarish amalga oshganda:**
```
stock += returned_quantity
movement: type = 'Sales Return', quantity = +X
```

**Xarid buyurtmasi qabul qilinganda:**
```
stock += received_quantity
movement: type = 'Purchase Received', quantity = +X
```

**Xarid yetkazib beruvchiga qaytarilganda:**
```\nstock -= returned_quantity
movement: type = 'Purchase Return', quantity = -X
```
\n**Qoldiq tuzatilganda:**
```
stock += adjustment_quantity (musbat yoki manfiy)
movement: type = 'Adjustment'\n```

Barcha harakatlar audit trail uchun doimiy saqlanishi kerak.

#### 3.5.5 Low Stock Alerts (Kam qoldiq ogohlantirishlari)
**Avtomatik aniqlash:**
```
if stock_quantity <= minimal_stock:\n    show'Low Stock' badge
```

**Global ogohlantirish paneli qo'shish:**
- Kam qoldiqdagi mahsulotlar ro'yxatini ko'rsatish
-Ushbu ro'yxatni eksport qilish imkoniyati
- POS terminal ham kam qoldiqdagi mahsulotlarni ajratib ko'rsatishi kerak (ixtiyoriy)

#### 3.5.6 Integration (Integratsiya - MAJBURIY)
\n**Mahsulotlar bilan integratsiya:**
Mahsulotlar jadvali quyidagilarni o'z ichiga olishi kerak:
- minimal_stock
- track_inventory flag
- cost_price
\nInventory moduli mahsulot ma'lumotlari bilan doimo sinxronlashadi.

**Buyurtmalar bilan integratsiya:**
- Buyurtma yaratilganda → qoldiq kamayadi
- Buyurtma bekor qilinganda → qoldiq tiklanadi
- Qisman qaytarishlar faqat qaytarilgan mahsulotlar uchun qoldiqni tuzatadi

**Sales Returns bilan integratsiya:**\n- Qaytarishlar qoldiqni oshiradi
\n**Purchase Orders bilan integratsiya:**\n- PO qabul qilish qoldiqni oshiradi\n- PO qaytarish qoldiqni kamaytiradi
\n**Hisobotlar bilan integratsiya:**
Inventory quyidagi hisobotlarga ma'lumot beradi:
- Inventory Valuation Report (Ombor baholash hisoboti)
- Stock Movement Report (Qoldiq harakati hisoboti)
- Profit & Loss report (Foyda va zarar hisoboti - xarajat asosida hisoblash)
- Low-stock report (Kam qoldiq hisoboti)

#### 3.5.7 Audit Trail Requirements (Audit trail talablari)
Har birombor amali quyidagilarni saqlashi kerak:
- Foydalanuvchi
- Vaqt belgisi
- Oldingi miqdor
- Keyingi miqdor
- Farq\n- Bog'liq hujjat\n
Bu to'liq kuzatuvni ta'minlaydi.

#### 3.5.8 UI/UX Requirements\n- Toza zamonaviy jadval
- Status belgilari\n- Tezkor filtrlar
- Responsive layout
- 10,000+ mahsulotlar uchun ham tez yuklash
- Inventory → product → movements orasida silliq navigatsiya
\n#### 3.5.9 Permissions (Ruxsatlar)
**Admin / Manager:**
- To'liq kirish
- Qoldiqni tuzatish
- Tuzatishni o'chirish (agar ruxsat etilgan bo'lsa)

**Kassir:**
- Faqat ko'rish
- Tuzatish huquqi yo'q
\n#### 3.5.10 Texnik talablar
**Inventory jadval tuzilishi:**\n- id
- product_id
- stock_quantity
- minimal_stock
- cost_price
- inventory_value (hisoblangan)\n- last_updated
- created_at
- updated_at

**Inventory Movements jadval tuzilishi:**\n- id
- product_id
- movement_type (Sale, Purchase Received, Sales Return, Purchase Return, Adjustment, Transfer)
- quantity (musbat yoki manfiy)
- before_quantity\n- after_quantity
- user_id
- related_document_type
- related_document_id
- notes
- created_at
\n**Munosabatlar:**
- Mahsulotlar bilan One-to-one
- Movements bilan One-to-many\n- Orders, Returns, Purchase Orders bilan avtomatik sinxronizatsiya
\n### 3.6 Cheklar / Buyurtmalar (Orders Module)

#### 3.6.1 Orders List Page\n**Sahifa sarlavhasi:** Orders

**Jadval ustunlari:**
- order_number – Buyurtma / Chek raqami (masalan: POS-20251205-00042)
- date_time – Sana va vaqt
- cashier – Kassir / xodim
- customer_name – Mijoz (ixtiyoriy,'Walk-in' bo'lishi mumkin)
- total_amount – Buyurtma jami\n- payment_status – To'langan / Qisman to'langan / To'lanmagan
- payment_methods – Ikkonlar yoki matn (Naqd, Karta, QR, Aralash)
- status – Yakunlangan / Bekor qilingan / Qaytarilgan
- actions – Ko'rish, Chop qilish, Qaytarish (Sales Return)\n\n**Filtrlar:**
- Sana oralig'i (bugun, shu hafta, maxsus)
- Kassir\n- To'lov holati
- Status (Yakunlangan, Bekor qilingan, Qaytarilgan)
- To'lov usuli\n- Buyurtma raqami yoki mijoz nomi bo'yicha qidiruv

**Funksiyalar:**
- Sahifalash (Pagination)
- Excel va PDF formatida eksport
- Tanlangan davr uchun yuqori qismda jami ko'rsatkichlar:\n  - total_sales_amount – Jami savdo summasi
  - total_orders_count – Jami buyurtmalar soni
  - average_order_value – O'rtacha buyurtma qiymati
\n#### 3.6.2 Order Detail Page
Foydalanuvchi buyurtma qatorini bosganda, Order Detail sahifasi yokiyon panel ochiladi.

**Sarlavha bloki:**
- Buyurtma raqami
- Sana va vaqt
- POS terminal nomi (agar ko'p terminallar bo'lsa)
- Kassir
- Mijoz (mijoz profiliga havola bilan)
- Status belgisi
- To'lov holati belgisi
\n**Mahsulotlar jadvali:**
**Ustunlar:**
- Mahsulot nomi
- SKU / Barcode
- Miqdor
- Birlik narxi
- Chegirma (har bir qator uchun,agar mavjud bo'lsa)
- Qator jami
\n**Xulosa bloki:**
- Oraliq jami (Subtotal)\n- Chegirmalar (buyurtma darajasida)
- Soliq (agar ishlatilsa)
- Umumiy jami (Grand total)
- To'langan summa
- Qolgan balans (agar mavjud bo'lsa)

**To'lovlar bloki (Payments moduli bilan integratsiyalangan):**
Ushbu buyurtma uchun to'lovlar ro'yxati:
- Sana va vaqt
- Summa
- Usul (Naqd, Karta, QR, Aralash)
- Ma'lumotnoma (terminal tranzaksiyasi, chek raqami)
\n**Bog'liq qaytarishlar (Sales Returns):**
Ushbu buyurtmaga bog'liq qaytarishlar ro'yxati:
- Qaytarish raqami
- Sana\n- Qaytarilgan summa
- Status
\n**Amallar:**
- Chekni chop qilish (PDF yoki printer)
- Savdo qaytarishini yaratish (ushbu buyurtmadan oldindan to'ldirilgan Sales Return formasini ochish)
- Qayta chop qilish / chekni email/WhatsApp orqali yuborish (ixtiyoriy)
- Buyurtmani bekor qilish (faqat managerlar uchun; kim va qachon logga yozilishi kerak)

#### 3.6.3 Buyurtma yaratish va manba
Buyurtmalar bu yerda qo'lda yaratilmaydi – ular POS Terminaldan keladi:\n- POS terminalda har bir yakunlangan savdo avtomatik ravishda Order yozuvini yaratadi
- Agar buyurtma 'held' yoki 'parked' sifatida saqlangan bo'lsa, status = Pending
- To'lov yakunlanganda, status = Completed
- Agar buyurtma POSdan bekor qilinsa, status = Voided vaombor tiklanadi

#### 3.6.4 Integratsiyalar (majburiy)
\n**Ombor integratsiyasi:**
- Buyurtma Completed bo'lganda → mahsulotlarga ko'ra qoldiq kamayadi
- Buyurtma Sales Return orqali Refunded bo'lganda → qoldiq ortadi
\n**To'lovlar integratsiyasi:**
- Har bir to'lov buyurtmaga tegishli\n- To'lov holati hisoblanadi:\n  - Paid: jami to'lovlar >= buyurtma jami
  - Partially paid: jami to'lovlar >0 va < buyurtma jami
  - Unpaid: jami to'lovlar = 0

**Mijozlar integratsiyasi:**\n- Agar mijoz POSda belgilangan bo'lsa, u Orders ro'yxati va detallarda ko'rsatilishi kerak
- Mijoz balanslari (qarz, sodiqlik) buyurtma yaratilganda/to'langanda/qaytarilganda yangilanishi kerak
- Kredit savdo amalga oshganda mijoz balansi ortadi
- To'lov qabul qilinganda mijoz balansi kamayadi

**Sales Returns integratsiyasi:**\n- Order Detail sahifasidan foydalanuvchi Sales Return yozuvini yaratishi mumkin
- Order sahifasida bog'liq qaytarishlar ro'yxati ko'rsatilishi kerak\n- Buyurtma holati qaytarishga qarab yangilanadi:\n  - Barcha mahsulotlar qaytarilsa → 'Refunded'\n  - Qisman qaytarilsa → 'Partially Refunded'
  - Qaytarish bo'lmasa → 'Completed' holatida qoladi

#### 3.6.5 Tekshirish va xavfsizlik
Faqat Manager yoki Admin roligaega foydalanuvchilar:\n- Buyurtmalarni bekor qilishi mumkin
- Buyurtmalarni o'chirishi mumkin (agar umuman ruxsat etilgan bo'lsa)
\nBuyurtmalarga o'zgartirishlar (bekor qilish, qaytarish) logga yozilishi kerak:\n- kim, qachon, nima o'zgartirilgan
\n#### 3.6.6 UI/UX talablar
- Toza, tez jadval ko'rinishi
- Yuqori qismda yopishqoq filtrlar paneli
- Status va payment_status rangli belglar bilan:\n  - Completed – yashil
  - Pending – ko'k
  - Voided – kulrang
  - Refunded – to'q sariq
  - Partially Refunded – och sariq
- Mobil/Planshet uchun qulay (lekin desktop uchun optimallashtirilgan)

### 3.7 Qaytarishlar (Sales Returns Module)

#### 3.7.1 Sales Returns List Page
**Sahifa sarlavhasi:** Sales Returns
\n**Jadval ustunlari:**
- return_number – Qaytarish raqami (RET-YYYYMMDD-#####)
- order_number – Asl sotuv buyurtmasi raqami
- customer_name – Mijoz nomi
- date_time – Sana va vaqt\n- returned_amount – Qaytarilgan summa
- status – Pending, Completed, Cancelled
- cashier – Kassir
- actions – Ko'rish, Chop qilish, Bekor qilish

**Funksiyalar:**
- Qaytarish raqami yoki buyurtma raqami bo'yicha qidiruv
- Filtrlar:\n  - Sana oralig'i
  - Mijoz\n  - Kassir
  - Status
- Sahifalash (Pagination)
- Excel va PDF formatida eksport
- '+ New Sales Return' tugmasi

#### 3.7.2 Create Sales Return Page
Ushbu sahifa mavjud buyurtmadan mahsulotlarni qaytarish imkonini beradi.

**Qadam1 — Buyurtmani tanlash**
Foydalanuvchi quyidagilarni amalga oshirishi mumkin:
- Buyurtma raqami bo'yicha qidiruv
- Chek barcode skanerlash (ixtiyoriy)
- Oxirgi buyurtmalardan tanlash
\nTanlangandan keyin ko'rsatish:
- Buyurtma raqami
- Mijoz\n- Kassir
- Sana
- Jami summa
\n**Qadam 2 — Qaytariladigan mahsulotlar jadvali**
Barcha buyurtma mahsulotlarini jadvalga avtomatik yuklash:
\n**Ustunlar:**
- Mahsulot nomi
- SKU\n- Sotilgan miqdor
- Qaytarish miqdori (tahrirlash mumkin)
- Birlik narxi
- Qator jami (avtomatik hisoblash)

**Tekshirish:**
- Qaytarish miqdori sotilgan miqdordan oshmasligi kerak
- Agar qaytarish miqdori = 0 → mahsulotni o'tkazib yuborish
\n**Avtomatik hisoblashlar:**
- line_total = unit_price × return_quantity
\n**Qadam 3 — Xulosa bloki**
Ko'rsatish:
- Qaytarilgan mahsulotlar oraliq jami
- Soliqlar (agar ishlatilsa)
- Jami qaytarish summasi
- Mijozning yangi balansi (agar mijoz mavjud bo'lsa)

**Qadam 4 — Qo'shimcha maydonlar**
- Qaytarish sababi (tanlash: shikastlangan, noto'g'ri mahsulot, mijoz noroziligi va boshqalar)
- Izohlar (ixtiyoriy)
\n**Qadam 5 — Amallar**
- Qaytarishni yuborish →ombor ortadi, buyurtma yangilanadi
- Bekor qilish\n- Ixtiyoriy: Qaytarish chekini chop qilish\n\n#### 3.7.3 Sales Return Detail Page
Detail ko'rinishi quyidagilarni ko'rsatishi kerak:
\n**Umumiy ko'rinish:**
- Qaytarish raqami
- Bog'liq buyurtma raqami
- Mijoz
- Kassir\n- Sana va vaqt
- Status belgisi
- Qaytarish sababi
- Izohlar

**Mahsulotlar jadvali:**
- Mahsulot\n- SKU
- Qaytarilgan miqdor
- Narx
- Qator jami
\n**Moliyaviy xulosa:**
- Jami qaytarilgan summa
- Buyurtmaning oldingi jami
- Buyurtmaning yangi jami
- Mijozning yangilangan balansi

**Amallar:**
- Qaytarish chekini chop qilish\n- PDF eksport qilish
- Qaytarishni bekor qilish (faqat ombor tiklanmagan bo'lsa)
\n#### 3.7.4 Ombor integratsiyasi (Majburiy)
To'g'ri qoldiq mantiqini amalga oshirish:
\n**Qaytarish yaratilganda:**
- inventory_stock += returned_quantity
\n**Harakatni loglash:**
Har bir qaytarish ombor yozuvini yaratadi:
- type: 'Sales Return'
- product_id\n- quantity (+)
- related_return_number
- date\n- performed_by (foydalanuvchi)
\n#### 3.7.5 Buyurtmalar integratsiyasi\n**Buyurtma detali bog'liq qaytarishlar ro'yxatini ko'rsatishi kerak**\n
**Buyurtma jami qaytarishdan keyin yangilanishi kerak:**
- updated_order_total = original_total - returned_amount
\n**Buyurtma holati:**
- Barcha mahsulotlar qaytarilsa → 'Refunded'
- Qisman qaytarilsa → 'Partially Refunded'
- Qaytarish bo'lmasa → 'Completed' holatida qoladi

#### 3.7.6 To'lovlar integratsiyasi
Agar qaytarish summasi qaytarilishi kerak bo'lsa:
\n**Tizim taklif qilinadigan qaytarish summasini ko'rsatishi kerak**

Kassir qaytarish usulini tanlaydi:
- Naqd\n- Karta
- Mijoz hisobiga balans
\n**Qaytarish quyidagilarni yaratishi kerak:**
- payment_type: Refund\n- amount: returned_amount
- method: tanlangan usul
\n#### 3.7.7 Mijozlar integratsiyasi
Agar mijoz bog'langan bo'lsa:\n
**Mijoz balansi qaytarilgan summa miqdorida ortadi (agar balans qaytarish turi bo'lsa)**

**Mijoz profili ko'rsatadi:**
- Bog'liq qaytarishlar\n- Qaytarilgan mahsulotlar
- Qaytarish tarixi

#### 3.7.8 Hisobotlar integratsiyasi
Sales Returns quyidagi hisobotlarda ko'rinishi kerak:

**Savdo hisobotlari:**
- Jami qaytarilgan summa
- Sof savdo\n- Qaytarish foizi

**Ombor hisobotlari:**
- Qaytarilgan mahsulotlar
- Qaytarishlardan tuzatishlar
\n**Xodimlar hisobotlari:**
- Kassir tomonidan qayta ishlangan qaytarishlar
\n#### 3.7.9 UI/UX talablar
- Toza jadval ko'rinishi
- Tezkor POS ish jarayoni uchun katta kirishlar
- Aniq ogohlantirishlar va tekshirish xabarlari
- Status rangli kodlari:\n  - Pending → Ko'k
  - Completed → Yashil
  - Cancelled → Qizil

#### 3.7.10 Raqamlash siyosati (Majburiy)
**Qaytarish raqamlash:**
- Format: RET-YYYYMMDD-#####
- Misol: RET-20251205-00023

**Buyurtmaga asoslangan havola kuzatuvni ta'minlaydi**

#### 3.7.11 O'chirish va bekor qilish cheklovlari
- Faqat Manager va Admin qaytarishlarni bekor qilishi yoki o'chirishi mumkin\n- Agar ombor allaqachon yangilangan bo'lsa, qaytarishni bekor qilish mumkin emas
- Barcha o'zgarishlar audit logiga yoziladi

#### 3.7.12 Audit trail
Har bir qaytarish uchun quyidagilar logga yoziladi:
- Kim yaratdi
- Qachon yaratildi
- Qaysi buyurtmadan\n- Qaysi mahsulotlar qaytarildi
- Qancha summa qaytarildi
- Qaysi usul bilan qaytarildi
- Kim bekor qildi (agar bekor qilingan bo'lsa)

### 3.8 To'lovlar (Payments)\n- Bir nechta to'lov usuli
- Qisman to'lov imkoniyati
- Terminal integratsiyasi
- Oldindan to'lov (qarzdor mijozlar uchun)
- To'lov ma'lumotlari: raqam, sana, summa, turi, izoh
- Qaytarish to'lovlari (Refund payments)
- Mijoz balansi bilan integratsiya
\n### 3.9 Xarid buyurtmalari (Purchase Orders Module)
\n#### 3.9.1 Purchase Orders List Page
**Sahifa sarlavhasi:** Purchase Orders

**Jadval ustunlari:**\n- po_number – Xarid buyurtmasi raqami (masalan: PO-20251206-00023)
- supplier_name – Yetkazib beruvchi (matn yoki bog'langan obyekt)
- order_date – Yaratilgan sana
- expected_date – Kutilayotgan yetkazib berish sanasi
- total_amount – Buyurtma jami
- status – Draft / Approved / Partially Received / Received / Cancelled
- created_by – Foydalanuvchi
- actions – Ko'rish / Tahrirlash / Qabul qilish / Bekor qilish

**Funksiyalar:**
- PO raqami yoki yetkazib beruvchi nomi bo'yicha qidiruv
- Filtrlar:
  - Status
  - Sana oralig'i
  - Yetkazib beruvchi
- Sana, status, jami summa bo'yicha saralash
- Sahifalash (Pagination)
- Excel / PDF formatida eksport
- '+ New Purchase Order' tugmasi

#### 3.9.2 Create / Edit Purchase Order Page
**Forma bo'limlari:**
\n**A) Sarlavha**
- po_number – avtomatik generatsiya (faqat o'qish)\n- supplier_name – dropdown yoki matn kiritish
- order_date – standart = bugun
- expected_date – ixtiyoriy
- reference – yetkazib beruvchi hisob-fakturasi / ma'lumotnoma raqami (ixtiyoriy)
- notes – matn maydoni\n- status – Draft (standart)\n\n**B) Mahsulotlar jadvali**
**Ustunlar:**
- Mahsulot (nom yoki SKU bo'yicha qidiruv)
- SKU\n- Birlik\n- Miqdor (ordered_qty)
- Xarid narxi (cost)\n- Qator jami (qty × price, avtomatik)\n\n**Funksiyalar:**
- Qatorlarni qo'shish / o'chirish
- Mahsulotdan cost_price ni avtomatik to'ldirish, lekin tahrirlash mumkin
\n**Tekshirish:**
- Miqdor > 0\n- Narx ≥ 0
\n**C) Xulosa**
- Oraliq jami (Subtotal)\n- Chegirma (ixtiyoriy)
- Soliq (ixtiyoriy)
- Jami summa (Total amount)
\n**Tugmalar:**
- Save as Draft
- Approve
- Cancel
\n**Status o'zgarishlari:**
- Draft → Approved → (Partially) Received → Closed
- Draft / Approved → Cancelled
\n#### 3.9.3 Purchase Order Detail Page
**Ko'rsatish:**
\n**Sarlavha:**
- PO raqami
- Yetkazib beruvchi\n- Status belgisi
- Buyurtma sanasi va kutilayotgan sana
- Kim yaratdi, kim tasdiqladi
- Izohlar\n
**Mahsulotlar jadvali:**
- Mahsulot
- Buyurtma qilingan miqdor
- Qabul qilingan miqdor
- Qolgan miqdor
- Birlik narxi
- Qator jami

**Xulosa:**
- Jami buyurtma qilingan summa
- Jami qabul qilingan summa
- Qolgan summa
\n**Vaqt chizig'i / Faoliyat logi (ixtiyoriy):**
- Yaratildi, tasdiqlandi, har bir qabul qilish voqeasi, status o'zgarishlari
\n**Amallar:**
- Tovarlarni qabul qilish (qisman yoki to'liq)
- Tahrirlash (faqat Draft / Approved)\n- Bekor qilish (agar hech narsa qabul qilinmagan bo'lsa)
- PO ni chop qilish / PDF eksport qilish

#### 3.9.4 Receive Goods Flow (Juda muhim)
**Tugma:** Receive goods

**Forma maydonlari:**
- Qabul qilingan sana
- Har bir qatoruchun:\n  - Buyurtma qilingan miqdor
  - Allaqachon qabul qilingan miqdor
  - Yangi qabul qilingan miqdor (kiritish)
- Izohlar

**Tekshirish:**
- Yangi qabul qilingan miqdor + allaqachon qabul qilingan ≤ buyurtma qilingan miqdor
\n**Yuborishdan keyin:**
- Ombor harakatlarini yaratish:\n  - type: Purchase Received
  - quantity: +received_qty
- Inventory modulida mahsulot qoldig'ini yangilash\n- PO statusini yangilash:\n  -Agar barcha qatorlar to'liq qabul qilingan bo'lsa → Received
  - Agar kamida bitta qator qisman qabul qilingan bo'lsa → Partially Received
\n**Ixtiyoriy:**
- Oxirgi xaridga asoslanib mahsulot cost_price ni avtomatik yangilash
\n#### 3.9.5 Integratsiyalar
\n**Inventory moduli bilan:**
- Har bir qabul qilish voqeasi qoldiqnioshiradi va harakat yozuvini qo'shadi
- Ixtiyoriy: Xarid qaytarish oqimi (kelajakda)
\n**Mahsulotlar moduli bilan:**
- Mahsulotlar jadvalidagi mahsulot tanlagich
- Narx va birlik mahsulotlar jadvalidan o'qiladi

**Yetkazib beruvchilar bilan (agar tizimda mavjud bo'lsa):**
- supplier_name Suppliers moduliga bog'lanishi mumkin
\n**Hisobotlar bilan:**
Purchase Orders ma'lumotlari quyidagi hisobotlarda ishlatiladi:
- Mahsulot bo'yicha xarid tarixi
- Yetkazib beruvchi samaradorligi hisobotlari
- Ombor baholash va xarajat tahlili

#### 3.9.6 Ruxsatlar va xavfsizlik
**Admin / Manager:**
- PO larni yaratish, tahrirlash, tasdiqlash, qabul qilish, bekor qilish
\n**Kassir / Xodim:**
- Faqat ko'rish, ixtiyoriy ravishda draft yaratish

**Barcha status o'zgarishlari va qabul qilish operatsiyalari logga yozilishi kerak:**
- foydalanuvchi, vaqt, eski status, yangi status

#### 3.9.7 UI / UX talablar
- Toza, karta asosidagi layout
- Asosiy PO ma'lumotlari bilan yopishqoq sarlavha
- Inline tahrirlash bilan mahsulotlar jadvali
- Rangli status belgilari:\n  - Draft – kulrang
  - Approved – ko'k
  - Partially Received – to'q sariq
  - Received – yashil
  - Cancelled – qizil
- Desktop (POS backoffice) uchun optimallashtirilgan, planshet uchun qulay

#### 3.9.8 Raqamlash siyosati\n**PO raqamini avtomatik generatsiya:**
- Format: PO-YYYYMMDD-#####
- Misol: PO-20251206-00015

**Buyurtmaga asoslangan havola kuzatuvni ta'minlaydi**

#### 3.9.9 Texnik talablar
**Purchase Orders jadval tuzilishi:**
- id\n- po_number
- supplier_name
- order_date
- expected_date\n- reference
- notes
- status
- total_amount
- created_by
- approved_by
- created_at
- updated_at
\n**Purchase Order Items jadval tuzilishi:**\n- id
- po_id
- product_id\n- ordered_qty
- received_qty
- unit_cost
- line_total
\n**Munosabatlar:**
- Mahsulotlar bilan Many-to-many (PO Items orqali)
- Inventory Movements bilan One-to-many\n- Yetkazib beruvchilar bilan Many-to-one (agar mavjud bo'lsa)

### 3.10 Inventarizatsiya\n- Omborni tanlash
- Haqiqiy miqdorni kiritish
- Tizim miqdori bilan taqqoslash
- Farqni avtomatik hisoblash va tasdiqlash
- Ombor harakatiga yozish
- Inventarizatsiya raqami formati: INV-YYYY-#####

### 3.11 Mijozlar (Customers Module)

#### 3.11.1 Customers List Page
**Sahifa sarlavhasi:** Customers
\n**Jadval ustunlari:**
- name – To'liq ism yoki kompaniya nomi
- phone – Asosiy telefon
- type – Jismoniy shaxs / Kompaniya\n- total_sales – Jami xaridlar summasi
- balance – Joriy balans (musbat = mijoz qarzi, manfiy = do'kon qarzi/qaytarish)
- last_order_date – Oxirgi xarid sanasi
- status – Faol / Nofaol
- actions – Ko'rish / Tahrirlash / O'chirish

**Funksiyalar:**
- Ism / telefon bo'yicha qidiruv
- Filtrlar:
  -Turi (Jismoniy shaxs / Kompaniya)
  - Status (Faol / Nofaol)
  - Balans (Qarzdor / Qarzsiz)
- Saralash:\n  - Jami savdo\n  - Oxirgi buyurtma sanasi
  -Ism A–Z / Z–A
- Excel / PDF formatida eksport
- '+ Add Customer' tugmasi
\n#### 3.11.2 Add / Edit Customer Form
**Asosiy ma'lumotlar:**
- name (majburiy)
- type – Jismoniy shaxs / Kompaniya
- phone (majburiy, formatlash + tekshirish bilan)
- email (ixtiyoriy)
- address (ixtiyoriy)
\n**Kompaniya bo'limi (faqat type = Kompaniya bo'lganda ko'rinadi):**
- company_name (agar asosiy ismdan farq qilsa)
- tax_number / VAT / INN (ixtiyoriy lekin o'rnatilgan bo'lsa noyob)
\n**Moliyaviy sozlamalar:**
- credit_limit (ixtiyoriy)
- allow_debt (ha/yo'q)
- initial_balance (standart 0; faqat yaratishda)
\n**Boshqa:**
- notes – erkin matn
- status – Faol / Nofaol
\n**Tekshirish:**
- Ism va telefon majburiy
- Telefon noyob (dublikatlar yo'q)
- Soliq raqami noyob\n- Boshlang'ich balans raqamli
- Kredit limiti raqamli

**Tugmalar:** Save, Cancel\n
#### 3.11.3 Customer Detail Page
**Layout:**umumiy ma'lumotlar bilan sarlavha + tablar.\n
**Sarlavha bloki:**
- Ism +turi belgisi
- Telefon, email\n- Manzil
- Status
- Kredit limiti
- Joriy balans (rang bilan):\n  - Qizil → mijoz do'konga qarzdor (musbat balans)
  - Yashil → do'kon qarzdor/qaytarish / oldindan to'lov (manfiy)\n  - Kulrang → nol balans

**Asosiy ko'rsatkichlar (kartalar):**
- Jami savdo summasi
- Buyurtmalar soni
- O'rtacha buyurtma qiymati
- Jami qaytarishlar summasi
- Oxirgi buyurtma sanasi\n\n**Tab1— Buyurtmalar (Orders)**
Jadval:\n- Buyurtma raqami
- Sana
- Jami summa
- To'langan summa
- Status
- Amallar → buyurtma detailiga o'tish

**Tab 2 — To'lovlar (Payments)**
Jadval:
- Sana
- Summa\n- Yo'nalish (Mijozdan to'lov / Mijozga qaytarish)
- Usul (Naqd / Karta / O'tkazma / Boshqa)
- Bog'liq buyurtma (agar mavjud bo'lsa)
\nBalans buyurtmalar + to'lovlar asosida avtomatik hisoblanishi kerak.

**Tab 3 — Qaytarishlar (Returns)**
Jadval:
- Qaytarish raqami
- Sana
- Qaytarilgan summa
- Bog'liq buyurtma
- Status
\n**Tab 4 — Eslatmalar / Faoliyat logi (Notes / Activity Log)**
- Qo'lda eslatmalar
- Tizim voqealari:\n  - Mijoz yaratildi/yangilandi
  - Kredit limiti o'zgarishi
  - Balans tuzatishlari
\n#### 3.11.4 POS Terminal integratsiyasi
POS Terminaldan kassir:\n- Mavjud mijozni tanlashi mumkin
- Tezkor mijoz yaratishi mumkin (faqat ism + telefon)
\nSotuvdan keyin:
- Buyurtma mijozga bog'lanadi
- Balans yangilanadi agar:\n  - Kredit savdo\n  - Ortiqcha to'lov / oldindan to'lov
\n#### 3.11.5 Balans va qarz mantiqiy (Majburiy)
**Balans formulasi:**
Balans = (Mijoz uchun jami buyurtmalar – Mijozdan jami to'lovlar + Do'kon qaytarishlari)

**Balans talqini:**
- Agar balans > 0 → mijoz qarzi
- Agar balans < 0 → do'kon qarzdor (oldindan to'lov yoki qaytarish)
\n**Ogohlantirish ko'rsatish qachon:**
- Yangi savdo balansi credit_limit danoshirib yuborsa
- Mijoz allow_debt = false va kassir kredit savdo qilmoqchi bo'lsa

#### 3.11.6 Hisobotlar integratsiyasi
Mijozlar moduli hisobotlarga ma'lumot berishi kerak:
- Savdo bo'yicha top mijozlar
- Eng ko'p qarzdor mijozlar
- Davr bo'yicha mijoz faolligi

#### 3.11.7 Ruxsatlar va xavfsizlik
**Admin/Manager:** to'liq kirish (qo'shish, tahrirlash, o'chirish, balansni tuzatish)
**Kassir:** ko'rish + yaratish + asosiy maydonlarni tahrirlash, o'chirish yo'q, to'g'ridan-to'g'ri balansni tahrirlash yo'q

**Mijozni o'chirish faqat ruxsat etiladiagar:**
- Bog'liq buyurtmalar, to'lovlar yoki qaytarishlar yo'q bo'lsa
- Aks holda → jismoniy o'chirish o'rniga Nofaol deb belgilash

#### 3.11.8 UI/UX talablar
- Toza, zamonaviy jadval ko'rinishi
- Yopishqoq qidiruv va filtrlar paneli
- Status va balans uchun rangli belglar
- Responsive layout (desktop optimallashtirilgan, planshet uchun qulay)
- Mijoz → buyurtmalar → to'lovlar va orqaga tez navigatsiya

#### 3.11.9 Texnik talablar
**Mijozlar jadval tuzilishi:**
- id
- name
- type (individual/company)
- phone
- email
- address
- company_name
- tax_number
- credit_limit\n- allow_debt
- initial_balance
- current_balance (hisoblangan)
- notes
- status
- created_at
- updated_at

**Munosabatlar:**
- Buyurtmalar bilan One-to-many\n- To'lovlar bilan One-to-many
- Qaytarishlar bilan One-to-many
- Balans avtomatik hisoblash
\n### 3.12 Xodimlar va rollar\n- Rollar: Admin, Manager, Kassir\n- Ruxsatlar tizimi:\n  - Narxni o'zgartirish
  - Qaytarish qilish
  - Chek o'chirish
  - Omborga kirish
  - Qaytarishlarni bekor qilish
  - Mijozlarni boshqarish
- Role-based access control (RBAC)\n\n### 3.13 Hisobotlar (Reports)
**Savdo hisobotlari:**\n- Kunlik savdo
- Kassir bo'yicha savdo
- Eng ko'p sotilgan mahsulotlar
- Eng kam sotilgan mahsulotlar
- To'lov usullari bo'yicha taqsimot
- Jami qaytarilgan summa
- Sof savdo (savdo - qaytarishlar)
- Qaytarish foizi

**Ombor hisobotlari:**
- Qoldiq\n- Harakatlar
- Kam qoldiqdagi mahsulotlar
- Qaytarishlardan tuzatishlar
- Inventory Valuation Report (Ombor baholash hisoboti)
- Stock Movement Report (Qoldiq harakati hisoboti)

**Moliya hisobotlari:**
- Kirim/Chiqim
- Foyda/zarar (Profit & Loss)
- Qaytarishlar ta'siri
\n**Mijoz hisobotlari:**
- Top mijozlar (savdo bo'yicha)
- Qarzdorlik hisobotlari
- Qaytarishlar bo'yicha mijozlar
- Mijoz faolligi davr bo'yicha
\n**Xodimlar hisobotlari:**\n- Kassir bo'yicha savdo
- Kassir tomonidan qayta ishlangan qaytarishlar
\n**Kassa hisobotlari:**\n- Z-otchet (kunlik yakun)
- X-otchet (oraliq hisobot)
- Kassa ochilishi/yopilishi
- Shift-based accounting

### 3.14 Sozlamalar (Settings)
- Tizim sozlamalari\n- Kassa sozlamalari
- Printer sozlamalari
- Device binding (faqat bitta kassaga ulangan)
- Qaytarish siyosati sozlamalari
- Mijoz sozlamalari (kredit limiti, qarzdorlik siyosati)

##4. Professional funksiyalar
- Hold order (chekni vaqtincha saqlash)
- Split payment (bir nechta to'lov turi)\n- Quick add product (tezkor qo'shish)\n- Z-otchet va X-otchet
- Kassa ochilishi/yopilishi
- Shift-based accounting
- Device binding
- To'liq Sales Returns tizimi
- To'liq Customers tizimi (balans, qarz, kredit limiti)
- To'liq Inventory Management tizimi (real-time tracking, movements, adjustments, alerts)
- To'liq Purchase Orders tizimi (yaratish, tasdiqlash, qabul qilish,ombor integratsiyasi)
-Ombor bilan avtomatik sinxronizatsiya
- Audit trail va loglar
\n## 5. Texnik talablar
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
- Kassa bo'yicha loglar: kim nima qilgan\n- Qaytarishlar uchun audit trail
- O'chirish va bekor qilish cheklovlari
- Mijoz ma'lumotlari xavfsizligi
\n### 5.3 Integratsiyalar
- Fiskal printer
- Barcode scanner
- QR Pay (Click/Payme)
- Inventory API
- Bank terminali
- Sales Returns bilan to'liq integratsiya
- Customers bilan to'liq integratsiya
- Inventory Management bilan to'liq integratsiya
- Purchase Orders bilan to'liq integratsiya
\n## 6. Tizim nomerlash siyosati
- Chek / Buyurtma: POS-YYYYMMDD-#####
  - Misol: POS-20251205-00042
- Qaytarish: RET-YYYYMMDD-#####
  - Misol: RET-20251205-00023
- Xarid buyurtmasi: PO-YYYYMMDD-#####
  - Misol: PO-20251206-00015
- Inventarizatsiya: INV-YYYY-#####
- SKU: SKU-000123
\n## 7. Modullar integratsiyasi
Mahsulotlar, Kategoriyalar, Inventory Management, Buyurtmalar, Sales Returns, Purchase Orders va Customers modullari quyidagi modullar bilan to'liq integratsiyalangan bo'lishi kerak:
- POS Terminal
- Ombor (Inventory)\n- Xarid buyurtmalari (Purchase Orders)
- Sotuvlar (Sales)\n- Hisobotlar (Reports)
- To'lovlar (Payments)
\nBarcha operatsiyalar to'liq sinxronlashtirilgan va audit qilinadigan bo'lishi kerak.
\n## 8. Dizayn uslubi
- Zamonaviy va professional ko'rinish, biznes muhitiga mos\n- Asosiy ranglar: ko'k (#2563EB) va kulrang (#64748B) tonlari, oq fon (#FFFFFF)\n- Karta uslubidagi layout, har bir modul alohida kartada
- Yumshoq soyalar (shadow-sm) va 8px border-radius
- Ikkonlar: Lucide yoki Heroicons kutubxonasidan zamonaviy chiziqli ikkonlar
- Jadvallar: zebra-striped uslubda, hover effekti bilan
- Tugmalar: to'ldirilgan (primary) va konturli (secondary) variantlar, touch screen uchun minimal44px balandlik
- Responsive grid layout: desktopuchun 3-4 ustun, tablet uchun 2ustun\n- Kategoriya rangli teglar va ikkonlar POS Terminal va mahsulotlar ro'yxatida ko'rsatiladi
- Status rangli kodlari:\n  - Completed / Paid / In Stock / Received → Yashil
  - Pending / Low Stock / Approved → Sariq yoki Ko'k
  - Cancelled / Voided / Out of Stock → Qizil
  - Refunded → To'q sariq
  - Partially Refunded / Partially Paid / Partially Received → Och sariq
  - Draft → Kulrang
- Mijoz balansi rangli kodlari:
  - Qizil → mijoz qarzdor (musbat balans)
  - Yashil → do'kon qarzdor/oldindan to'lov (manfiy balans)
  - Kulrang → nol balans
- Inventory movements rangli kodlari:
  - Musbat (+) → Yashil
  - Manfiy (–) → Qizil
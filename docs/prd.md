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
- Qoldiqni kuzatish ON/OFF
  - Agar OFF bo'lsa → mahsulot sotiladi, lekin ombor kamaytirilmaydi
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
- Ko'p do'kon ombor sinxronizatsiyasi
- Variantlar (o'lcham/rang)
- Birlashtirilgan mahsulotlar
- Amal qilish muddatini kuzatish (dorixona/oziq-ovqat uchun)
- FIFO/LIFO xarajat hisoblash (ERP darajasidagi ombor uchun)

### 3.4 Kategoriyalar (Categories Module)

#### 3.4.1 Categories List Page\n**Sahifa sarlavhasi:** Categories

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
- Description (ixtiyoriy)
- Color Tag (ixtiyoriy; POS Terminal UI guruhlashuchun)
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
  - Status
  - 'Open product' amal (mahsulot detailiga o'tish)

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
\n### 3.5 Cheklar / Buyurtmalar (Orders Module)

#### 3.5.1 Orders List Page\n**Sahifa sarlavhasi:** Orders

**Jadval ustunlari:**
- order_number – Buyurtma / Chek raqami (masalan: POS-20251205-00042)
- date_time – Sana va vaqt
- cashier – Kassir / xodim
- customer_name – Mijoz (ixtiyoriy,'Walk-in' bo'lishi mumkin)
- total_amount – Buyurtma jami\n- payment_status – To'langan / Qisman to'langan / To'lanmagan
- payment_methods – Ikkonlar yoki matn (Naqd, Karta, QR, Aralash)
- status – Yakunlangan / Bekor qilingan / Qaytarilgan
- actions – Ko'rish, Chop qilish, Qaytarish (Sales Return)\n
**Filtrlar:**
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
\n#### 3.5.2 Order Detail Page
Foydalanuvchi buyurtma qatorini bosganda, Order Detail sahifasi yoki yon panel ochiladi.

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

**Xulosa bloki:**
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

#### 3.5.3 Buyurtma yaratish va manba
Buyurtmalar bu yerda qo'lda yaratilmaydi – ular POS Terminaldan keladi:\n- POS terminalda har bir yakunlangan savdo avtomatik ravishda Order yozuvini yaratadi
- Agar buyurtma 'held' yoki 'parked' sifatida saqlangan bo'lsa, status = Pending
- To'lov yakunlanganda, status = Completed
- Agar buyurtma POSdan bekor qilinsa, status = Voided vaombor tiklanadi

#### 3.5.4 Integratsiyalar (majburiy)
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

**Sales Returns integratsiyasi:**
- Order Detail sahifasidan foydalanuvchi Sales Return yozuvini yaratishi mumkin
- Order sahifasida bog'liq qaytarishlar ro'yxati ko'rsatilishi kerak\n- Buyurtma holati qaytarishga qarab yangilanadi:\n  - Barcha mahsulotlar qaytarilsa → 'Refunded'\n  - Qisman qaytarilsa → 'Partially Refunded'
  - Qaytarish bo'lmasa → 'Completed' holatida qoladi

#### 3.5.5 Tekshirish va xavfsizlik
Faqat Manager yoki Admin roligaega foydalanuvchilar:\n- Buyurtmalarni bekor qilishi mumkin
- Buyurtmalarni o'chirishi mumkin (agar umuman ruxsat etilgan bo'lsa)
\nBuyurtmalarga o'zgartirishlar (bekor qilish, qaytarish) logga yozilishi kerak:
- kim, qachon, nima o'zgartirilgan
\n#### 3.5.6 UI/UX talablar
- Toza, tez jadval ko'rinishi
- Yuqori qismda yopishqoq filtrlar paneli
- Status va payment_status rangli belglar bilan:\n  - Completed – yashil
  - Pending – ko'k
  - Voided – kulrang
  - Refunded – to'q sariq
  - Partially Refunded – och sariq
- Mobil/Planshet uchun qulay (lekin desktop uchun optimallashtirilgan)
\n### 3.6 Qaytarishlar (Sales Returns Module)

#### 3.6.1 Sales Returns List Page
**Sahifa sarlavhasi:** Sales Returns
\n**Jadval ustunlari:**
- return_number – Qaytarish raqami (RET-YYYYMMDD-#####)
- order_number – Asl sotuv buyurtmasi raqami
- customer_name – Mijoz nomi
- date_time – Sana va vaqt
- returned_amount – Qaytarilgan summa
- status – Pending, Completed, Cancelled
- cashier – Kassir
- actions – Ko'rish, Chop qilish, Bekor qilish

**Funksiyalar:**\n- Qaytarish raqami yoki buyurtma raqami bo'yicha qidiruv
- Filtrlar:
  - Sana oralig'i
  - Mijoz\n  - Kassir
  - Status
- Sahifalash (Pagination)
- Excel va PDF formatida eksport
- '+ New Sales Return' tugmasi
\n#### 3.6.2 Create Sales Return Page
Ushbu sahifa mavjud buyurtmadan mahsulotlarni qaytarish imkonini beradi.

**Qadam 1 — Buyurtmani tanlash**
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
- Bekor qilish\n- Ixtiyoriy: Qaytarish chekini chop qilish\n\n#### 3.6.3 Sales Return Detail Page
Detail ko'rinishi quyidagilarni ko'rsatishi kerak:
\n**Umumiy ko'rinish:**
- Qaytarish raqami
- Bog'liq buyurtma raqami
- Mijoz\n- Kassir
- Sana va vaqt
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
\n#### 3.6.4 Ombor integratsiyasi (Majburiy)
To'g'ri qoldiq mantiqini amalga oshirish:
\n**Qaytarish yaratilganda:**
- inventory_stock += returned_quantity
\n**Harakatni loglash:**
Har bir qaytarish ombor yozuvini yaratadi:
- type: 'Sales Return'
- product_id\n- quantity (+)
- related_return_number
- date\n- performed_by (foydalanuvchi)
\n#### 3.6.5 Buyurtmalar integratsiyasi\n**Buyurtma detali bog'liq qaytarishlar ro'yxatini ko'rsatishi kerak**\n
**Buyurtma jami qaytarishdan keyin yangilanishi kerak:**
- updated_order_total = original_total - returned_amount
\n**Buyurtma holati:**
- Barcha mahsulotlar qaytarilsa → 'Refunded'
- Qisman qaytarilsa → 'Partially Refunded'
- Qaytarish bo'lmasa → 'Completed' holatida qoladi

#### 3.6.6 To'lovlar integratsiyasi
Agar qaytarish summasi qaytarilishi kerak bo'lsa:
\n**Tizim taklif qilinadigan qaytarish summasini ko'rsatishi kerak**

Kassir qaytarish usulini tanlaydi:
- Naqd\n- Karta
- Mijoz hisobiga balans
\n**Qaytarish quyidagilarni yaratishi kerak:**
- payment_type: Refund\n- amount: returned_amount
- method: tanlangan usul
\n#### 3.6.7 Mijozlar integratsiyasi\nAgar mijoz bog'langan bo'lsa:\n
**Mijoz balansi qaytarilgan summa miqdorida ortadi (agar balans qaytarish turi bo'lsa)**

**Mijoz profili ko'rsatadi:**
- Bog'liq qaytarishlar\n- Qaytarilgan mahsulotlar
- Qaytarish tarixi

#### 3.6.8 Hisobotlar integratsiyasi
Sales Returns quyidagi hisobotlarda ko'rinishi kerak:

**Savdo hisobotlari:**\n- Jami qaytarilgan summa
- Sof savdo\n- Qaytarish foizi

**Ombor hisobotlari:**
- Qaytarilgan mahsulotlar
- Qaytarishlardan tuzatishlar
\n**Xodimlar hisobotlari:**
- Kassir tomonidan qayta ishlangan qaytarishlar
\n#### 3.6.9 UI/UX talablar
- Toza jadval ko'rinishi
- Tezkor POS ish jarayoni uchun katta kirishlar
- Aniq ogohlantirishlar va tekshirish xabarlari
- Status rangli kodlari:\n  - Pending → Ko'k
  - Completed → Yashil
  - Cancelled → Qizil

#### 3.6.10 Raqamlash siyosati (Majburiy)
**Qaytarish raqamlash:**
- Format: RET-YYYYMMDD-#####
- Misol: RET-20251205-00023

**Buyurtmaga asoslangan havola kuzatuvni ta'minlaydi**

#### 3.6.11 O'chirish va bekor qilish cheklovlari
- Faqat Manager va Admin qaytarishlarni bekor qilishi yoki o'chirishi mumkin
- Agar ombor allaqachon yangilangan bo'lsa, qaytarishni bekor qilish mumkin emas
- Barcha o'zgarishlar audit logiga yoziladi

#### 3.6.12 Audit trail
Har bir qaytarish uchun quyidagilar logga yoziladi:
- Kim yaratdi
- Qachon yaratildi
- Qaysi buyurtmadan\n- Qaysi mahsulotlar qaytarildi
- Qancha summa qaytarildi
- Qaysi usul bilan qaytarildi
- Kim bekor qildi (agar bekor qilingan bo'lsa)

### 3.7 To'lovlar (Payments)\n- Bir nechta to'lov usuli
- Qisman to'lov imkoniyati
- Terminal integratsiyasi
- Oldindan to'lov (qarzdor mijozlar uchun)
- To'lov ma'lumotlari: raqam, sana, summa, turi, izoh
- Qaytarish to'lovlari (Refund payments)
- Mijoz balansi bilan integratsiya
\n### 3.8 Ombor (Inventory Management)
- Real-time qoldiq hisoblash: Qoldiq = Prihod – Rashod + Qaytarish – Qaytarish yetkazib beruvchiga
- Ombor harakatlari: prihod, rashod, inventarizatsiya, ko'chirish, savdo qaytarishlari
- Serial number tracking
- Ogohlantirishlar:\n  - Minimal qoldiq\n  - Tugash arafasi
  - Ko'p sotilayotgan tovarlar

### 3.9 Tovar qabul qilish (Purchase Receiving)
- Yetkazib beruvchini tanlash
- Qabul etilgan mahsulotlar jadvali
- Narxlarni kechiktirilgan holda o'zgartirish
- Tovarni omborga avtomatik qo'shish
- Hisob-faktura raqami
- Prihod raqami formati: PRC-YYYY-#####

### 3.10 Inventarizatsiya\n- Omborni tanlash
- Haqiqiy miqdorni kiritish
- Tizim miqdori bilan taqqoslash
- Farqni avtomatik hisoblash va tasdiqlash
- Ombor harakatiga yozish
- Inventarizatsiya raqami formati: INV-YYYY-#####

### 3.11 Mijozlar (Customers Module)
\n#### 3.11.1 Customers List Page
**Sahifa sarlavhasi:** Customers\n
**Jadval ustunlari:**
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
  - Turi (Jismoniy shaxs / Kompaniya)
  - Status (Faol / Nofaol)
  - Balans (Qarzdor / Qarzsiz)
- Saralash:\n  - Jami savdo\n  - Oxirgi buyurtma sanasi
  - Ism A–Z / Z–A
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
-Ism va telefon majburiy
- Telefon noyob (dublikatlar yo'q)
- Soliq raqami noyob
- Boshlang'ich balans raqamli
- Kredit limiti raqamli
\n**Tugmalar:** Save, Cancel\n
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
- Oxirgi buyurtma sanasi
\n**Tab1 — Buyurtmalar (Orders)**
Jadval:\n- Buyurtma raqami
- Sana
- Jami summa
- To'langan summa
- Status
- Amallar → buyurtma detailiga o'tish

**Tab 2 — To'lovlar (Payments)**\nJadval:
- Sana
- Summa\n- Yo'nalish (Mijozdan to'lov / Mijozga qaytarish)
- Usul (Naqd / Karta / O'tkazma / Boshqa)
- Bog'liq buyurtma (agar mavjud bo'lsa)
\nBalans buyurtmalar + to'lovlar asosida avtomatik hisoblanishi kerak.

**Tab 3 — Qaytarishlar (Returns)**
Jadval:
- Qaytarish raqami
- Sana\n- Qaytarilgan summa
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
Balans = (Mijoz uchun jami buyurtmalar – Mijozdan jami to'lovlar + Do'kon qaytarishlari)\n
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

#### 3.11.7 Ruxsatlar va xavfsizlik\n**Admin/Manager:** to'liq kirish (qo'shish, tahrirlash, o'chirish, balansni tuzatish)
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
- id\n- name
- type (individual/company)
- phone
- email
- address
- company_name
- tax_number
- credit_limit
- allow_debt
- initial_balance
- current_balance (hisoblangan)
- notes
- status
- created_at
- updated_at
\n**Munosabatlar:**
- Buyurtmalar bilan One-to-many\n- To'lovlar bilan One-to-many
- Qaytarishlar bilan One-to-many
- Balans avtomatik hisoblash

### 3.12 Xodimlar va rollar\n- Rollar: Admin, Manager, Kassir\n- Ruxsatlar tizimi:\n  - Narxni o'zgartirish
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
\n**Moliya hisobotlari:**
- Kirim/Chiqim
- Foyda/zarar (Profit & Loss)
- Qaytarishlar ta'siri
\n**Mijoz hisobotlari:**
- Top mijozlar (savdo bo'yicha)
- Qarzdorlik hisobotlari
- Qaytarishlar bo'yicha mijozlar
- Mijoz faolligi davr bo'yicha
\n**Xodimlar hisobotlari:**
- Kassir bo'yicha savdo
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
- Ombor bilan avtomatik sinxronizatsiya
- Audit trail va loglar

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
\n## 6. Tizim nomerlash siyosati
- Chek / Buyurtma: POS-YYYYMMDD-#####
  - Misol: POS-20251205-00042
- Qaytarish: RET-YYYYMMDD-#####
  - Misol: RET-20251205-00023
- Prihod: PRC-YYYY-#####
- Inventarizatsiya: INV-YYYY-#####
- SKU: SKU-000123
\n## 7. Modullar integratsiyasi
Mahsulotlar, Kategoriyalar, Buyurtmalar, Sales Returns va Customers modullari quyidagi modullar bilan to'liq integratsiyalangan bo'lishi kerak:
- POS Terminal
- Ombor (Inventory)
- Xarid buyurtmalari (Purchase Orders)
- Sotuvlar (Sales)
- Hisobotlar (Reports)
- To'lovlar (Payments)
\nBarcha operatsiyalar to'liq sinxronlashtirilgan va audit qilinadigan bo'lishi kerak.

## 8. Dizayn uslubi
- Zamonaviy va professional ko'rinish, biznes muhitiga mos\n- Asosiy ranglar: ko'k (#2563EB) va kulrang (#64748B) tonlari, oq fon (#FFFFFF)\n- Karta uslubidagi layout, har bir modul alohida kartada
- Yumshoq soyalar (shadow-sm) va 8px border-radius
- Ikkonlar: Lucide yoki Heroicons kutubxonasidan zamonaviy chiziqli ikkonlar
- Jadvallar: zebra-striped uslubda, hover effekti bilan
- Tugmalar: to'ldirilgan (primary) va konturli (secondary) variantlar, touch screen uchun minimal44px balandlik
- Responsive grid layout: desktopuchun 3-4 ustun, tablet uchun 2ustun\n- Kategoriya rangli teglar va ikkonlar POS Terminal va mahsulotlar ro'yxatida ko'rsatiladi
- Status rangli kodlari:\n  - Completed / Paid → Yashil
  - Pending → Ko'k
  - Cancelled / Voided → Qizil
  - Refunded → To'q sariq
  - Partially Refunded / Partially Paid → Och sariq
- Mijoz balansi rangli kodlari:\n  - Qizil → mijoz qarzdor (musbat balans)
  - Yashil → do'kon qarzdor/oldindan to'lov (manfiy balans)
  - Kulrang → nol balans
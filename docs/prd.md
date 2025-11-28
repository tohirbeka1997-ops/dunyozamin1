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
- Quick Actions paneli:
  - To'lov qabul qilish
  - Buyurtmani saqlab qo'yish (Hold order)
  - Chek qaytarish
  - Xaridor tanlash
- Offline rejimda ishlash imkoniyati

### 3.3 Mahsulotlar katalogi
- Mahsulot ma'lumotlari: nom, SKU/Barcode, kategoriya, o'lchov birligi\n- Xarid va sotuv narxlari
- Minimal qoldiq chegarasi
- Mahsulot rasmi\n- SKU avtomatik generatsiya\n- Barcode scanner orqali tez qo'shish
- Excel orqali Import/Export
- Minimal qoldiqdan past bo'lganda qizil ogohlantirish

### 3.4 Kategoriyalar
- Mahsulotlarni guruhlash
- Ierarxik tuzilma
\n### 3.5 Cheklar (Orders/Receipts)
- Chek ma'lumotlari: raqam, sana, kassir, mijoz, summa, to'lov turi, status
- Chek detallari: mahsulotlar ro'yxati, jami hisob, soliq, to'lovlar tarixi
- PDF formatda chek yaratish
- Chop qilish funksiyasi\n
### 3.6 Qaytarishlar (Sales Returns)
- Chek raqami bo'yicha qidiruv
- Qaytariladigan mahsulotlarni tanlash
- Miqdor kiritish
- Ombor qoldig'ini avtomatik yangilash
- Mijoz balansini yangilash
- Return Slip PDF yaratish
- Qaytarish raqami formati: RET-YYYY-#####\n
### 3.7 To'lovlar (Payments)
- Bir nechta to'lov usuli
- Qisman to'lov imkoniyati
- Terminal integratsiyasi
- Oldindan to'lov (qarzdor mijozlar uchun)
- To'lov ma'lumotlari: raqam, sana, summa,turi, izoh
\n### 3.8 Ombor (Inventory Management)\n- Real-time qoldiq hisoblash: Qoldiq = Prihod – Rashod + Qaytarish – Qaytarish yetkazib beruvchiga\n- Ombor harakatlari: prihod, rashod, inventarizatsiya, ko'chirish
- Serial number tracking\n- Ogohlantirishlar:\n  - Minimal qoldiq
  - Tugash arafasi
  - Ko'p sotilayotgan tovarlar
\n### 3.9 Tovar qabul qilish (Purchase Receiving)
- Yetkazib beruvchini tanlash
- Qabul etilgan mahsulotlar jadvali
- Narxlarni kechiktirilgan holda o'zgartirish\n- Tovarni omborga avtomatik qo'shish
- Hisob-faktura raqami
- Prihod raqami formati: PRC-YYYY-#####

### 3.10 Inventarizatsiya
- Omborni tanlash
- Haqiqiy miqdorni kiritish
- Tizim miqdori bilan taqqoslash
- Farqni avtomatik hisoblash va tasdiqlash
- Ombor harakatiga yozish
- Inventarizatsiya raqami formati: INV-YYYY-#####

### 3.11 Mijozlar (Customers)
- Bonus tizimi
- Qarzdorlik kuzatuvi
- Keshbek
- Mijoz tarixini ko'rsatish
- Oxirgi xaridlar ro'yxati

### 3.12 Xodimlar va rollar
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
- Eng kam sotilgan mahsulotlar
- To'lov usullari bo'yicha taqsimot
\n**Ombor hisobotlari:**
- Qoldiq\n- Harakatlar\n- Kam qoldiqdagi mahsulotlar
\n**Moliya hisobotlari:**\n- Kirim/Chiqim
- Foyda/zarar (Profit & Loss)
\n**Mijoz hisobotlari:**
- Top mijozlar
- Qarzdorlik hisobotlari

**Kassa hisobotlari:**
- Z-otchet (kunlik yakun)
- X-otchet (oraliq hisobot)
- Kassa ochilishi/yopilishi
- Shift-based accounting
\n### 3.14 Sozlamalar (Settings)
- Tizim sozlamalari
- Kassa sozlamalari
- Printer sozlamalari
- Device binding (faqat bitta kassaga ulangan)

## 4. Professional funksiyalar
- Hold order (chekni vaqtincha saqlash)
- Split payment (bir nechta to'lov turi)
- Quick add product (tezkor qo'shish)
- Z-otchet va X-otchet\n- Kassa ochilishi/yopilishi
- Shift-based accounting
- Device binding

## 5. Texnik talablar
\n### 5.1 UI/UX talablar
- Minimalist va silliq dizayn
- Tez ishlash (caching va optimization)
- Tablet va kassa monitorlariga moslashgan
- Touch screen uchun katta tugmalar\n- Offline mode va data sync
- Qorong'i va yorug' rejim

### 5.2 Xavfsizlik
- JWT yoki Session authentication
- Role-based access control (RBAC)
- Offline ma'lumot shifrlanishi
- Kassa bo'yicha loglar: kim nima qilgan

### 5.3 Integratsiyalar
- Fiskal printer
- Barcode scanner
- QR Pay (Click/Payme)
- Inventory API
- Bank terminali

## 6. Tizim nomerlash siyosati
- Chek: POS-YYYY-#####
- Qaytarish: RET-YYYY-#####
- Prihod: PRC-YYYY-#####
- Inventarizatsiya: INV-YYYY-#####\n
## 7. Dizayn uslubi
- Zamonaviy va professional ko'rinish, biznes muhitiga mos
- Asosiy ranglar: ko'k (#2563EB) va kulrang (#64748B) tonlari, oq fon (#FFFFFF)\n- Karta uslubidagi layout, har bir modul alohida kartada
- Yumshoq soyalar (shadow-sm) va 8px border-radius
- Ikkonlar: Lucide yoki Heroicons kutubxonasidan zamonaviy chiziqli ikkonlar
- Jadvallar: zebra-striped uslubda, hover effekti bilan
- Tugmalar: to'ldirilgan (primary) va konturli (secondary) variantlar, touch screen uchun minimal44px balandlik
- Responsive grid layout: desktopuchun 3-4 ustun, tablet uchun 2ustun
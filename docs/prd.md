# POS Tizimi Talablar Hujjati (Yangilangan versiya - Hold Order funksiyasi qo'shildi)

## 1. Tizim nomi
POS Tizimi (Point of Sale Management System)

## 2. Tizim tavsifi
Professional savdo nuqtalari uchun to'liq funksional POS tizimi. Tizim real vaqt rejimida savdo jarayonlarini boshqarish,ombor nazorati, moliyaviy hisobotlar va xodimlar faoliyatini kuzatish imkoniyatlarini taqdim etadi. Tizim markazlashtirilgan ma'lumotlar bazasi asosida ishlaydi va barcha modullar o'rtasida real-time sinxronizatsiyani ta'minlaydi.
\n## 3. Global tizim sinxronizatsiya qoidalari
\n### 3.1 Markazlashtirilgan ma'lumotlar bazasi
Tizim quyidagi barcha ma'lumotlarni yagona markazlashtirilgan ma'lumotlar bazasida saqlaydi:
- Mahsulotlar (Products)
- Ombor (Inventory)
- Sotuvlar / Buyurtmalar (Sales / Orders)
- Qaytarishlar (Returns)
- Mijozlar (Customers)
- Yetkazib beruvchilar (Suppliers)
- Xarid buyurtmalari (Purchase Orders)
- Xodimlar (Employees)
- Sozlamalar (Settings)
- Audit loglari (Audit Logs)
- Kutilayotgan buyurtmalar (Held Orders)
\nBarcha modullar bir xil yagona ma'lumotlar manbasidan o'qiydi va yangilaydi.

### 3.2 Modullararo integratsiya qoidalari

#### 3.2.1 Mahsulotlar ↔ Ombor
- Mahsulot yaratilganda avtomatik ravishda ombor yozuvi yaratiladi
- Mahsulot qoldig'ini yangilash kam qoldiq ogohlantirishlariga va dashboardga ta'sir qiladi
- Agar mahsulot buyurtmalarda ishlatilgan bo'lsa, uni o'chirish oldini olinadi
\n#### 3.2.2 Buyurtmalar (Sotuvlar) ↔Ombor
**Buyurtma yakunlanganda:**
- Sotilgan miqdorga asoslanib qoldiqni kamaytirish
- Qoldiq o'zgarishini Inventory Movement Log ga yozish
- Dashboard statistikasini yangilash
- Mijoz xarid tarixini yangilash
- Xodim samaradorlik statistikasini yangilash
- To'lov yozuvini yaratish (xulosa)

**Buyurtma bekor qilinganda:**
- Qoldiqni tiklash
- Buyurtmani faoliyat logida bekor qilingandeb belgilash
\n#### 3.2.3 Savdo qaytarishlari ↔ Ombor
**Qaytarish qayta ishlanganda:**
- Mahsulotlarni qoldiqqa qaytarish\n- Harakat logiga yozuv qo'shish (Return)\n- Mijozning jami xarajatini kamaytirish
- Xodim samaradorlik ko'rsatkichlarini kamaytirish
- Dashboard ko'rsatkichlarini yangilash
\n#### 3.2.4 Xarid buyurtmalari ↔ Ombor
**Xarid buyurtmasi qabul qilinganda:**
- Qoldiqni oshirish
- Harakat logiga yozuv qo'shish (Purchase Receipt)
- Ombor baholashini yangilash
- Dashboard va hisobotlarni yangilash\n
**Xarid buyurtmasi bekor qilinganda:**\n- Qoldiqqa hech narsa qo'shilmasligi kerak
- Bekor qilishni loglash
\n#### 3.2.5 Mijozlar ↔ Buyurtmalar ↔ Qaytarishlar
Har bir mijoz quyidagilarga ega bo'lishi kerak:
- Jami xaridlar soni
- Jami sarflangan summa
- Qolgan balans (agar kredit savdo ruxsat etilgan bo'lsa)
- Buyurtmalar ro'yxati
- Qaytarishlar ro'yxati
- Hisobotlar va dashboardda ishlatiladigan ma'lumotlar

Agar buyurtmalar mavjud bo'lsa, mijozni o'chirish oldini olinadi (faqat soft delete).

#### 3.2.6 Xodimlar ↔ POS Terminal ↔ Buyurtmalar
Har bir buyurtma quyidagilarni saqlashi kerak:
- Kassir ID
- Terminal sessiyasi
- Vaqt belgisi
\nXodimlar moduli avtomatik ravishda quyidagilarni oladi:
- Savdolar soni
- Savdo summasi
- Qayta ishlangan qaytarishlar
- Xatolar (bekor qilingan buyurtmalar)
- Kirish sessiyalari
\nPOS Terminal quyidagilarni loglashi kerak:
- Shift boshlanishi/tugashi
- Sessiya vaqti
- Xodimga bog'langan kassa tortmasi amallari
\n#### 3.2.7 Sozlamalar ↔ Butun tizim
Sozlamalar modullar faoliyatiga bevosita ta'sir qilishi kerak:
\n**POS Terminal:**
- To'lov usullari
- Aralash to'lov qoidalari
- Avtomatik chiqish
- Chek chop qilish sozlamalari
- Manfiy qoldiq qoidalari
- Standart soliq stavkasi
- Hold Order funksiyasini yoqish/o'chirish

**Ombor:**
- Minimal qoldiq chegarasi
- Qoldiq tuzatish cheklovlari
\n**Buyurtmalar:**
- Raqam formati
- Soliq kiritish/chiqarish sozlamasi
\n**UI:**
- Til\n- Valyuta
- Raqam formatlash
\nBarcha o'zgarishlar tizim bo'ylab darhol yangilanishi kerak.

### 3.3 Dashboard sinxronizatsiyasi
Dashboard doimo REAL-TIME ko'rsatkichlarni ko'rsatishi kerak:
- Bugungi savdolar
- Bugungi buyurtmalar
- Kam qoldiqdagi mahsulotlar
- Faol mijozlar
- Eng ko'p sotiladigan mahsulotlar
- Xodim samaradorligi ogohlantirishlari
- Kutilayotgan xarid buyurtmalari
- Kutilayotgan buyurtmalar soni (Held Orders)

Barcha hisoblar quyidagi amallardan keyin avtomatik qayta hisoblanishi kerak:
- Yangi buyurtma\n- Qaytarish
- Ombor tuzatishi
- Xarid qabul qilish
- Yangi mahsulot qo'shilishi
- Sozlamalar yangilanishi

### 3.4 Hisobotlar moduli sinxronizatsiyasi
Hisobotlar quyidagi manbalardan real-time ma'lumotlarni olishi kerak:
- Buyurtmalar (savdolar)
- Ombor harakatlari
- Mijozlar
- Xarid buyurtmalari
- Xodimlar
- To'lovlar tizimi
- Sozlamalar (soliq hisoblash, valyuta, tiluchun)

Har bir hisobot bog'liq modullar o'zgarganda to'g'ri yangilanishi kerak.
\n### 3.5 Modullar bo'ylab ma'lumotlarni tekshirish qoidalari

**Buyurtmalar:**
- Sozlamalar ruxsat bermasa, qoldiqda yo'q mahsulotlarni sotish mumkin emas
- To'lovsiz buyurtmani yakunlash mumkin emas
\n**Ombor:**\n- Qo'lda tuzatishlar sabab talab qiladi
- Agar cheklangan bo'lsa, noldan pastga tuzatish mumkin emas

**Mijozlar:**
- Telefon va email noyob bo'lishi kerak
\n**Xodimlar:**
- Oxirgi Admin hisobini o'chirish mumkin emas
\n**Xarid buyurtmalari:**\n- Qabul qilish buyurtma qilingan miqdordanoshib ketishi mumkin emas

### 3.6 Tizim bo'ylab audit loglash
Har bir muhim amal loglarni yozishi kerak:
- Mahsulotlarni yaratish/tahrirlash/o'chirish
- Buyurtmalarni yaratish, bekor qilish
- Qaytarishlarni qayta ishlash
-Ombor tuzatishlari
- Mijozlarni yangilash
- Xodim amallari
- Tizim sozlamalarini o'zgartirish
- Kutilayotgan buyurtmalarni saqlash/tiklash/bekor qilish

**Log formati:**
- user_id
- action\n- module
- document_id
- details
- timestamp
- ip_address
\n### 3.7 Samaradorlik va optimizatsiya qoidalari
- SKU, buyurtma raqamlari, mijoz nomlari uchun indekslashdan foydalanish
- Tez yuklash uchun dashboard ma'lumotlarini keshlash
- Kerak bo'lsa, og'ir hisobotlarni fonda qayta hisoblash
\n### 3.8 Ruxsatlar va kirish nazorati
\n**Admin:**
- Barcha modullar va sozlamalarga to'liq kirish
\n**Manager:**
- Quyidagilarga kirish yo'q:\n  - Tizim sozlamalari
  - Xodimlarni boshqarish
  - Raqamlash va xavfsizlik sozlamalari
\n**Kassir:**
- Faqat quyidagilarni amalga oshirishi mumkin:
  - POS Terminalni ochish
  - Buyurtmalarni yaratish
  - Qaytarishlarni yaratish
  - Mahsulotlar va mijozlarni ko'rish
  - Buyurtmalarni kutish ro'yxatiga saqlash va tiklash
- Asosiy yozuvlarni tahrirlash yoki o'chirish mumkin emas

### 3.9 UI/UX sinxronizatsiya qoidalari
- Barcha modullar bo'ylab izchil layout
- Standart tugma pozitsiyalari (Save, Cancel, Edit)
- Tizim bo'ylab yagona status belgilari:\n  - Yashil = Yakunlangan
  - Sariq = Kutilmoqda
  - Qizil = Bekor qilingan / Kam qoldiq
- Barcha buzuvchi amallar uchun tasdiqlash dialoglari

## 4. Asosiy funksional modullar

### 4.1 Dashboard (Analitika)
- Real vaqt rejimida savdo ko'rsatkichlari
- Kunlik/haftalik/oylik statistika
- Tezkor ko'rsatkichlar paneli
- Barcha modullardan avtomatik yangilanadigan metrikalar
- Kutilayotgan buyurtmalar soni ko'rsatkichi

### 4.2 POS Terminal (Kassa oynasi)
\n#### 4.2.1 Asosiy funksiyalar
- Barcode scanner orqali mahsulot qo'shish
- Qidiruv va kategoriyalar bo'yicha tanlash
- Ko'p to'lov usullari:\n  - Naqd pul\n  - Bank kartasi
  - Terminal\n  - QR to'lov
  - Aralash to'lov (masalan:50% karta + 50% naqd)
- Tovar narxini real-time o'zgartirish (faqat manager)
- Qaytarish summasi avtomatik hisoblash
- Chek raqami avtomatik generatsiya (Format: POS-YYYYMMDD-#####)
- Quick Actions paneli:\n  - To'lov qabul qilish
  - Buyurtmani saqlab qo'yish (Hold order)
  - Kutilayotgan buyurtmalarni ko'rish (Waiting Orders)
  - Chek qaytarish
  - Xaridor tanlash
- Offline rejimda ishlash imkoniyati
- Kategoriya tugmalari orqali mahsulotlarni filtrlash
- Rangli kategoriya belgilari va ikkonlar
- Eng ko'p sotiladigan kategoriyalar yuqorida ko'rsatiladi
- Mijozni tanlash yoki tezkor yaratish (ism + telefon)
- Kredit savdo imkoniyati (mijoz ruxsati bo'lsa)
- Xodim login/logout tizimi
- Shift start/end tracking
- Kassir-specific cheklovlar
- Sozlamalar modulidan to'lov usullari va qoidalarni real-time o'qish
- Har bir tranzaksiya avtomatik ravishda ombor, mijoz va xodim modullarini yangilaydi

#### 4.2.2 Hold Order (Buyurtmani kutish ro'yxatiga saqlash) funksiyasi

**Biznes stsenariy:**
- Mijoz kassaga keladi, ba'zi mahsulotlar skanerlangan va savatga qo'shilgan
- Mijoz qo'shimcha mahsulotlar olish yoki biror narsani tekshirish uchun kassirdan kutishni so'raydi
- Kassir joriy savatni'kutilayotgan buyurtma' sifatida saqlashi va boshqa mijozlar bilan ishlashni davom ettirishi kerak
- Keyinchalik, mijoz qaytib kelganda, kassir kutilayotgan buyurtmani tiklaydi va to'lovni yakunlaydi

**Funksional talablar:**
\n**1. POS Terminal yangi amallar:**
- 'Process Payment' tugmasi yoniga **'Hold Order'** (Buyurtmani saqlash) tugmasini qo'shish
- Yuqori o'ng qismda yoki POS Terminal sarlavhasida **'Waiting Orders'** (Kutilayotgan buyurtmalar) menyu/tugmasini qo'shish
\n**2. Hold Order xatti-harakati:**
- Kassir **'Hold Order'** tugmasini bosganda:\n  - Agar savat bo'sh bo'lsa → ogohlantirish ko'rsatish va hech narsa qilmaslik
  - Aks holda:\n    - Kichik dialog/modal oynasini ochish:\n      - Maydonlar:\n        - Ixtiyoriy 'Mijoz nomi / yorliq' (masalan: 'Yashil futbolkali odam', 'Tohirbek', 'Stol3')
        - Ixtiyoriy izoh\n    - Joriy savat holatini to'lovsiz **kutilayotgan buyurtma** sifatida saqlash
    - Terminaldagi joriy savatni tozalash (kassir keyingi mijozga xizmat ko'rsatishiuchun)
- Kutilayotgan buyurtma haliombor yoki hisobotlarga ta'sir qilmasligi kerak (qoldiq kamaytirilmaydi, savdo jami hisoblanmaydi)

**3. Ma'lumotlar modeli:**
- `pending_orders` yoki `held_orders` jadvalini yaratish yoki ishlatish:\n  - id (primary key)
  - items (JSON array: product_id, name, unit_price, quantity, line_discount va boshqalar)
  - customer_name (nullable)
  - note (nullable)
  - created_at\n  - status ('HELD' | 'RESTORED' | 'CANCELLED')\n- Bu bosqichda asosiy `orders` jadvaliga qo'shmaslik. Haqiqiy buyurtma faqat to'lovdan keyin yaratiladi\n
**4. Kutilayotgan buyurtmalar ro'yxati:**
- 'Waiting Orders' tugmasi modal yokiyon panelni ochadi:\n  - Har bir kutilayotgan buyurtma uchun ko'rsatish:\n    - Qisqa yorliq: customer_name yoki generatsiya qilingan nom ('Buyurtma #3')
    - Vaqt (qancha vaqt oldin saqlangan)\n    - Jami summa ko'rinishi (line_subtotals yig'indisi)
  - Har bir element uchun amallar:
    - **Restore** (Ushbu buyurtmani joriy savatga yuklash)
    - **Cancel** (Agar kerak bo'lmasa, kutilayotgan buyurtmani o'chirish)
- Bir vaqtning o'zida bir nechta kutilayotgan buyurtmalarni qo'llab-quvvatlash

**5. Restore (Tiklash) xatti-harakati:**
- Kassir kutilayotgan buyurtmada **Restore** tugmasini bosganda:
  - Agar joriy savat bo'sh bo'lmasa, tasdiqlash so'rash:\n    - 'Joriy savatda mahsulotlar bor. Ularni kutilayotgan buyurtma bilan almashtirish kerakmi?'
    - Variantlar:
      - Joriy savatni almashtirish
      - Bekor qilish
  - Tasdiqlashdan keyin:
    - Kutilayotgan buyurtma mahsulotlarini savdo savatiga yuklash (miqdorlar va qator chegirmalari bilan)
    - Ixtiyoriy mijoz nomini 'Customer' maydoniga yuklash (agar bog'langan bo'lsa)
    - `pending_orders` daushbu kutilayotgan buyurtmani o'chirish yoki RESTOREDdeb belgilash
  - Tiklanganidan keyin, kassir 'Process Payment' orqali to'lovni odatdagidek qayta ishlashi mumkin

**6. Cancel (Bekor qilish) xatti-harakati:**
- Kutilayotgan buyurtmani bekor qilishda:\n  - Tasdiqlash ko'rsatish: 'Ushbu kutilayotgan buyurtmani o'chirish kerakmi? Buni qaytarib bo'lmaydi.'
  - Tasdiqlashda, `pending_orders` da o'chirish yoki CANCELLED deb belgilash
  - Buombor yoki hisobotlarga ta'sir qilmasligi kerak
\n**7. UI/UX tafsilotlari:**
-'Hold Order' tugmasi uslubi:
  - Secondary tugma, masalan: outlined, 'Process Payment' chap tomonida
- 'Waiting Orders' tugmasi:\n  - Ikkona (masalan: soat yoki pause) + kutilayotgan buyurtmalar soni bilan badge
- Aniq toast xabarlar:\n  - Saqlash muvaffaqiyatli: 'Buyurtma kutish ro'yxatiga ko'chirildi.'
  - Tiklash muvaffaqiyatli: 'Kutilayotgan buyurtma savatga tiklandi.'
  - Bekor qilish: 'Kutilayotgan buyurtma o'chirildi.'

**8. Tekshirish:**
-Agar savat bo'sh bo'lsa, `Hold` ga ruxsat bermaslik\n- Tiklashda mahsulot mavjudligini qayta tekshirish:\n  - Agar ba'zi mahsulotlar katalogdan o'chirilgan yoki qoldiq keskin o'zgargan bo'lsa, yumshoq boshqarish:\n    - Agar mahsulot yo'qolgan bo'lsa → xabar ko'rsatish vaushbu elementni o'tkazib yuborish
    - Agar miqdor > joriy maksimal qoldiq (agar qoldiqni majburlasangiz) → mavjudga qisqartirish va ogohlantirish ko'rsatish
\n**9. TypeScript va holat:**
- `HeldOrder` / `PendingOrder` uchun turlarni qo'shish
- Quyidagilar uchun hooks yoki state management ni amalga oshirish:
  - `heldOrders` ro'yxati
  - `saveHeldOrder`, `restoreHeldOrder`, `cancelHeldOrder`
- Funksiyalar type-safe bo'lishini va async xatolarni (Supabase yoki API xatolari) boshqarishini ta'minlash

**Yetkazish:**
- To'liq ishlaydigan 'Hold / Waiting Order' tizimi:\n  - Kassir joriy savatni kutish ro'yxatiga saqlashi mumkin
  - Barcha kutilayotgan buyurtmalarni ro'yxatda ko'rish\n  - Istalgan kutilayotgan buyurtmani savatga tiklash va to'lovni yakunlash\n  - Kerak bo'lmaganda kutilayotgan buyurtmalarni bekor qilish
- To'lov yakunlanib, haqiqiy `order` yaratilgunga qadar Inventory yoki Reports ga ta'sir yo'q
\n#### 4.2.3 Savat (Shopping Cart) - Per-Product Discount bilan

**Savat tuzilishi:**
\nHar bir savat elementi (cart item) quyidagi ma'lumotlarni o'z ichiga oladi:
- Mahsulot nomi
- SKU / Barcode
- Birlik narxi (unit_price)
- Miqdor (quantity)
- Qator chegirmasi (lineDiscountAmount)
- Qator oraliq jami (line_subtotal = unit_price × quantity)
- Qator jami (line_total = line_subtotal - lineDiscountAmount)
\n**Per-Product Discount UI:**

1. **Har bir savat qatoriuchun chegirma nazorati:**
   - Har bir mahsulot qatorida kichik chegirma maydoni ko'rsatiladi
   - Standart qiymat: 0(chegirma yo'q)
   - Format: summa ko'rinishida (masalan: 5000 UZS)
   - Chegirma belgisi yoki 'Chegirma' yorlig'i bilan

2. **Chegirma kiritish:**
   - Foydalanuvchi chegirma maydonini bosganda inline input yoki popover ochiladi
   - Foydalanuvchi chegirma qiymatini kiritishi mumkin
   - Birinchi versiya uchun: faqat summa (amount) formatida
   - Kelajakda: foiz (%) va summa o'rtasida toggle qo'shish mumkin

**Hisoblash qoidalari:**
\n```\nlet unit_price = mahsulot narxi\nlet qty = miqdor
let line_subtotal = unit_price × qty\nlet line_discount = mahsulot uchun chegirma (summa, >= 0)
let line_total = line_subtotal - line_discount
```

**Cheklovlar:**
- line_discount manfiy bo'lishi mumkin emas
- line_discount line_subtotal danoshib ketishi mumkin emas
- Agar foydalanuvchi line_subtotal dan katta qiymat kiritsa:\n  - Qiymat line_subtotal ga teng qilib o'rnatiladi
  - Kichik ogohlantirish yoki toast ko'rsatiladi
- Barcha raqamlar number tipida ishlanishi kerak (stringemas)

**Miqdor o'zgarganda:**
- Mavjud line_discount saqlanadi
- Lekin yangi line_subtotal < mavjud line_discount bo'lsa:\n  - line_discount avtomatik ravishda yangi line_subtotal ga teng qilib o'rnatiladi
\n**Order Summary integratsiyasi:**
\n1. **Oraliq jami (Subtotal):**
   - Barcha line_subtotal qiymatlarining yig'indisi (chegirmalardan oldin)
   - Formula: sum(unit_price × quantity) barcha qatorlar uchun
\n2. **Jami chegirma (Total Discount):**
   - Global buyurtma chegirmasi + barcha qator chegirmalarining yig'indisi
   - Formula: global_order_discount + sum(lineDiscountAmount)\n
3. **Jami summa (Total Amount):**
   - Oraliq jami - jami chegirma
   - Formula: Subtotal - Total Discount

4. **To'lov modali:**
   - Yakuniy Total Amount dan foydalanadi
\n**Real-time yangilanish:**
- Qator chegirmasini yangilash darhol quyidagilarni qayta hisoblaydi:
  - Ushbu qatorning line_total qiymatini\n  - Order Summarydagi Subtotal, Discount va Total qiymatlarini
- Barcha hisoblashlar avtomatik va real-time amalga oshiriladi

**Soliq bilan integratsiya:**
- Hozircha qator chegirmalari soliqdan oldin qo'llaniladi
- Soliq mantiqiy keyinchalik yangilanishi mumkin
\n**TypeScript tuzilishi:**
\n```typescript
interface CartItem {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  unitPrice: number;
  quantity: number;
  lineDiscountAmount: number; // standart 0\n  lineSubtotal: number; // unitPrice × quantity
  lineTotal: number; // lineSubtotal - lineDiscountAmount
}\n```

**Xatolarni boshqarish:**\n- Savat bo'sh bo'lganda yoki chegirma maydonlari tozalanganda runtime xatolari bo'lmasligi kerak
- Agar foydalanuvchi chegirma maydonini tozalasa va bo'sh qoldirsa,0 sifatida qabul qilinadi
- Barcha kiritishlar validatsiya qilinadi
- Noto'g'ri qiymatlar uchun aniq xato xabarlari ko'rsatiladi
\n**Yetkazish talablari:**
- POS Terminal savati har bir mahsulot uchun tahrirlash mumkin bo'lgan chegirmaga ega
- Order Summary va to'lov oqimi qator chegirmalari va global chegirma bilan to'liq sinxronlashtirilgan
- Barcha hisoblashlar aniq va real-time\n- UI intuitiv va touch screen uchun qulay

### 4.3 Mahsulotlar katalogi (Products Module)

#### 4.3.1 Products List Page
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
- Qidiruv: nom, SKU, barcode bo'yicha\n- Filtrlar:\n  - Kategoriya filtri
  - Status filtri
  - Kam qoldiq filtri
- Sahifalash (Pagination)
- Excel orqali ommaviy import
- Excel orqali ommaviy export
-'Mahsulot qo'shish' tugmasi
\n**Qoldiq holati ranglari:**
- Yashil → Qoldiq yetarli
- Sariq → Kam qoldiq
- Qizil → Qoldiqda yo'q
\n**Integratsiya qoidalari:**
- Mahsulot yaratilganda avtomatik ombor yozuvi yaratiladi
- Mahsulot o'chirilganda buyurtmalarda ishlatilganligini tekshirish
- Qoldiq o'zgarishlari real-time dashboard va hisobotlarga aks etadi

#### 4.3.2 Add / Edit Product Form
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
\n**Ombor sozlamalari:**
- Boshlang'ich qoldiq (faqat yaratishda ruxsat etiladi)
- Minimal qoldiq ogohlantirish darajasi
- Qoldiqni kuzatish ON/OFF\n  - Agar OFF bo'lsa → mahsulot sotiladi, lekin ombor kamaytirilmaydi
\n**Rasmlar:**
- Mahsulot rasmi yuklash (1-3 ta rasm tavsiya etiladi)
\n#### 4.3.3 Product Detail Page
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
  - Bog'liq hujjat raqomi

**2) Sotuv tarixi (Sales History)**
- Buyurtma ID
- Mijoz (ixtiyoriy)
- Sotilgan miqdor
- Jami summa
- Foyda\n\n**3) Xarid tarixi (Purchase History)**
- Yetkazib beruvchi
- Xarid qilingan miqdor
- Narx
- Hujjat raqomi
\n#### 4.3.4 Ombor integratsiyasi (Majburiy)
- Sotuv amalga oshganda → qoldiq kamayadi
- Qaytarish amalga oshganda → qoldiq ortadi
- Xarid buyurtmasi qabul qilinganda → qoldiq ortadi\n- Inventarizatsiya tuzatishi amalga oshganda → loglar yangilanadi
- Barcha o'zgarishlar real-time dashboard va hisobotlarga sinxronlanadi

#### 4.3.5 Barcode tizimi integratsiyasi\n- Barcode avtomatik generatsiya YOKI qo'lda kiritish\n- Barcode scanner POS Terminalda mahsulotnidarhol qidirishi va qo'shishi kerak
- Chop qilinadigan barcode yorliqlari yaratish (ixtiyoriy)
\n#### 4.3.6 Kategoriya integratsiyasi
- Kategoriya dropdown tanlash
- Kategoriya bo'yicha filtrlash\n- Kategoriya rangli teglar (ixtiyoriy)

#### 4.3.7 Ma'lumotlarni tekshirish (Data Validation)
- Mahsulot nomi majburiy
- Sotuv narxi xarid narxidan past bo'lsa ogohlantirish
- SKU noyob bo'lishi kerak
- Barcode noyob bo'lishi kerak
- Boshlang'ich qoldiq manfiy bo'lishi mumkin emas
- Narxlar raqamli qiymatlar bo'lishi kerak
- O'chirishda →agar mahsulotning sotuv tarixi bo'lsa ogohlantirish
\n#### 4.3.8 Qo'shimcha funksiyalar (Ixtiyoriy lekin tavsiya etiladi)
- Sevimli mahsulotlar (POS tezkor kirishiga yulduzcha belgisi)
- Ko'pdo'konombor sinxronizatsiyasi
- Variantlar (o'lcham/rang)
- Birlashtirilgan mahsulotlar
- Amal qilish muddatini kuzatish (dorixona/oziq-ovqat uchun)
- FIFO/LIFO xarajat hisoblash (ERP darajasidagi ombor uchun)

### 4.4 Kategoriyalar (Categories Module)
\n#### 4.4.1 Categories List Page
**Sahifa sarlavhasi:** Categories\n
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
- Rangli teg belgilari (ixtiyoriy)\n
#### 4.4.2 Add Category Form
**Forma maydonlari:**
- Category Name (majburiy)
- Description (ixtiyoriy)\n- Color Tag (ixtiyoriy; POS Terminal UI guruhlashuchun)
- Icon (ixtiyoriy; emoji yoki SVG)
- Parent Category (ixtiyoriy → ichki kategoriyalaruchun)
\n**Tekshirish:**
- Nom majburiy
- Noyob bo'lishi kerak
-Agar parent category tanlangan bo'lsa → doiraviy parent/child munosabatlarini oldini olish
\n**Tugmalar:**
- Save\n- Cancel
\n#### 4.4.3 Edit Category Page
Yaratish formasiga to'liq o'xshash, lekin oldindan to'ldirilgan.\n
**Qo'shimcha funksiyalar:**
- Biriktirilgan mahsulotlar sonini ko'rsatish
- O'chirishga urinishda:\n  - Agar mahsulotlar yo'q bo'lsa → o'chirishga ruxsat berish
  - Agar mahsulotlar mavjud bo'lsa → modal ko'rsatish:\n    - 'This category contains X products. Move them to another category before deleting.'
\n#### 4.4.4 Category Detail Page (tavsiya etiladi)
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

#### 4.4.5 Mahsulotlar moduli bilan integratsiya
Kategoriyalar Mahsulotlar bilan to'liq integratsiyalangan bo'lishi kerak:\n- Mahsulot yaratish/tahrirlashda kategoriya dropdown\n- Mahsulotlar ro'yxatida kategoriya bo'yicha filtrlash
- Agar kategoriyada mahsulotlar bo'lsa, kategoriyani o'chirish mumkin emas
- Mahsulotlar ro'yxatida kategoriya rangi teglar ko'rsatiladi
- POS Terminal kategoriya asosida navigatsiyani qo'llab-quvvatlashi kerak
- Misol:'Drinks', 'Snacks', 'Fruits', 'Pharmacy' kabi tugmalar

#### 4.4.6 POS Terminal bilan integratsiya
POS Terminal ko'rsatishi kerak:
- Kategoriya tugmalari
- Kategoriya bo'yicha filtrlangan mahsulotlar
- Tez tanib olish uchun ranglar/ikkonlar
- Aqlli tartiblash: eng ko'p sotiladigan kategoriyalar yuqorida ko'rsatiladi
\n#### 4.4.7 UI / UX talablar
- Toza jadval ko'rinishi
- Minimalistik zamonaviy kartalar
- Boshqa modullar bilan izchil bo'shliq
- Mobil qulay on panel o'zaro ta'siri
- Vizual guruhlash uchun rangli teglardan foydalanish
- Ikkonlar ixtiyoriy (lekin POS planshetlar uchun juda tavsiya etiladi)
\n#### 4.4.8 Xavfsizlik va ruxsatlar
Rol asosida kirish:\n- Admin va Manager: Kategoriyalarni yaratish, tahrirlash, o'chirish
- Kassir: Faqat kategoriyalarni ko'rish (tahrirlash yo'q)
\n#### 4.4.9 Texnik talablar
**Kategoriya jadval tuzilishi:**
- id\n- name
- description\n- color\n- icon
- parent_id (nullable)
- created_at
- updated_at
\n**Munosabatlar:**
- Mahsulotlar bilan One-to-many\n- O'z-o'ziga havola qiluvchi parent-child kategoriyalar
- Inventory va POS Terminal bilan avtomatik sinxronizatsiya
\n### 4.5 Ombor boshqaruvi (Inventory Management Module)

#### 4.5.1 Inventory List Page
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

**Real-time sinxronizatsiya:**
- Barcha qoldiq o'zgarishlari darhol dashboard va hisobotlarga aks etadi
- Kam qoldiq ogohlantirishlari avtomatik yangilanadi
\n#### 4.5.2Inventory Detail Page
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
- Xarid buyurtmasi raqomi
- Yetkazib beruvchi
- Sana
- Qabul qilingan miqdor
- Narx
- Jami xarajat
\n**Tab 3 — Sales History (Sotuv tarixi)**
**Ustunlar:**
- Buyurtma raqomi
- Mijoz
- Sana
- Sotilgan miqdor
- Daromad
- Foyda (sotuv narxi – xarid narxi × miqdor)

#### 4.5.3 Stock Adjustment Module (Qoldiq tuzatish moduli)
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
- Dashboard ko'rsatkichlari avtomatik yangilanadi

#### 4.5.4 Real-Time Inventory Update Logic (Real vaqt rejimida ombor yangilanish mantiqiy)
Qat'iy ombor mantiqiy amalga oshirish:
\n**Sotuv amalga oshganda:**
```
stock -= sold_quantity\nmovement: type = 'Sale', quantity = -X
update dashboard metrics
update reports
```

**Savdo qaytarish amalga oshganda:**
```
stock += returned_quantity
movement: type = 'Sales Return', quantity = +X
update dashboard metrics
update customer stats
update employee stats
```

**Xarid buyurtmasi qabul qilinganda:**\n```
stock += received_quantity
movement: type = 'Purchase Received', quantity = +X
update inventory valuation
update dashboard\n```

**Xarid yetkazib beruvchiga qaytarilganda:**
```\nstock -= returned_quantity
movement: type = 'Purchase Return', quantity = -X
```

**Qoldiq tuzatilganda:**
```
stock += adjustment_quantity (musbat yoki manfiy)
movement: type = 'Adjustment'\nlog user, reason, timestamp
```
\nBarcha harakatlar audit trail uchun doimiy saqlanishi kerak.

#### 4.5.5 Low Stock Alerts (Kam qoldiq ogohlantirishlari)
**Avtomatik aniqlash:**
```
if stock_quantity <= minimal_stock:\n    show'Low Stock' badge
    add to dashboard alerts
    notify relevant users
```

**Global ogohlantirish paneli qo'shish:**
- Kam qoldiqdagi mahsulotlar ro'yxatini ko'rsatish
-Ushbu ro'yxatni eksport qilish imkoniyati
- POS terminal ham kam qoldiqdagi mahsulotlarni ajratib ko'rsatishi kerak (ixtiyoriy)

#### 4.5.6 Integration (Integratsiya - MAJBURIY)
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
- Barcha o'zgarishlar real-time dashboard gaaks etadi

**Sales Returns bilan integratsiya:**\n- Qaytarishlar qoldiqni oshiradi
- Dashboard va hisobotlar avtomatik yangilanadi
\n**Purchase Orders bilan integratsiya:**\n- PO qabul qilish qoldiqni oshiradi\n- PO qaytarish qoldiqni kamaytiradi
\n**Hisobotlar bilan integratsiya:**
Inventory quyidagi hisobotlarga ma'lumot beradi:
- Inventory Valuation Report (Ombor baholash hisoboti)
- Stock Movement Report (Qoldiq harakati hisoboti)
- Profit & Loss report (Foyda va zarar hisoboti - xarajat asosida hisoblash)
- Low-stock report (Kam qoldiq hisoboti)

#### 4.5.7 Audit Trail Requirements (Audit trail talablari)
Har birombor amali quyidagilarni saqlashi kerak:
- Foydalanuvchi\n- Vaqt belgisi
- Oldingi miqdor
- Keyingi miqdor
- Farq\n- Bog'liq hujjat\n
Bu to'liq kuzatuvni ta'minlaydi.

#### 4.5.8 UI/UX Requirements\n- Toza zamonaviy jadval\n- Status belgilari\n- Tezkor filtrlar
- Responsive layout
- 10,000+ mahsulotlar uchun ham tez yuklash
- Inventory → product → movements orasida silliq navigatsiya
\n#### 4.5.9 Permissions (Ruxsatlar)
**Admin / Manager:**
- To'liq kirish
- Qoldiqni tuzatish
- Tuzatishni o'chirish (agar ruxsat etilgan bo'lsa)

**Kassir:**
- Faqat ko'rish
- Tuzatish huquqi yo'q
\n#### 4.5.10 Texnik talablar
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
- quantity (musbat yoki manfiy)\n- before_quantity\n- after_quantity
- user_id
- related_document_type
- related_document_id
- notes
- created_at
\n**Munosabatlar:**
- Mahsulotlar bilan One-to-one
- Movements bilan One-to-many\n- Orders, Returns, Purchase Orders bilan avtomatik sinxronizatsiya
\n### 4.6 Cheklar / Buyurtmalar (Orders Module)

#### 4.6.1 Orders List Page\n**Sahifa sarlavhasi:** Orders

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
- To'lov usuli\n- Buyurtma raqomi yoki mijoz nomi bo'yicha qidiruv

**Funksiyalar:**
- Sahifalash (Pagination)
- Excel va PDF formatida eksport
- Tanlangan davr uchun yuqori qismda jami ko'rsatkichlar:\n  - total_sales_amount – Jami savdo summasi
  - total_orders_count – Jami buyurtmalar soni
  - average_order_value – O'rtacha buyurtma qiymati
\n#### 4.6.2 Order Detail Page
Foydalanuvchi buyurtma qatorini bosganda, Order Detail sahifasi yoki yon panel ochiladi.

**Sarlavha bloki:**
- Buyurtma raqomi
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
- Qator chegirmasi (lineDiscountAmount)
- Qator jami\n\n**Xulosa bloki:**
- Oraliq jami (Subtotal)\n- Qator chegirmalari jami (Total Line Discounts)
- Buyurtma chegirmasi (Order Discount)
- Jami chegirmalar (Total Discounts = Line Discounts + Order Discount)
- Soliq (agar ishlatilsa)
-Umumiy jami (Grand total)
- To'langan summa
- Qolgan balans (agar mavjud bo'lsa)

**To'lovlar bloki (Payments moduli bilan integratsiyalangan):**
Ushbu buyurtma uchun to'lovlar ro'yxati:
- Sana va vaqt
- Summa
- Usul (Naqd, Karta, QR, Aralash)
- Ma'lumotnoma (terminal tranzaksiyasi, chek raqomi)
\n**Bog'liq qaytarishlar (Sales Returns):**
Ushbu buyurtmaga bog'liq qaytarishlar ro'yxati:
- Qaytarish raqomi
- Sana\n- Qaytarilgan summa
- Status
\n**Amallar:**
- Chekni chop qilish (PDF yoki printer)
- Savdo qaytarishini yaratish (ushbu buyurtmadan oldindan to'ldirilgan Sales Return formasini ochish)
- Qayta chop qilish / chekni email/WhatsApp orqali yuborish (ixtiyoriy)
- Buyurtmani bekor qilish (faqat managerlar uchun; kim va qachon logga yozilishi kerak)

#### 4.6.3 Buyurtma yaratish va manba
Buyurtmalar bu yerda qo'lda yaratilmaydi – ular POS Terminaldan keladi:\n- POS terminalda har bir yakunlangan savdo avtomatik ravishda Order yozuvini yaratadi
- Agar buyurtma 'held' yoki 'parked' sifatida saqlangan bo'lsa, status = Pending
- To'lov yakunlanganda, status = Completed
- Agar buyurtma POS dan bekor qilinsa, status = Voided vaombor tiklanadi

#### 4.6.4 Integratsiyalar (majburiy)
\n**Ombor integratsiyasi:**
- Buyurtma Completed bo'lganda → mahsulotlarga ko'ra qoldiq kamayadi
- Buyurtma Sales Return orqali Refunded bo'lganda → qoldiq ortadi
- Barcha o'zgarishlar real-time dashboard va hisobotlarga sinxronlanadi

**To'lovlar integratsiyasi:**
- Har bir to'lov buyurtmaga tegishli\n- To'lov holati hisoblanadi:\n  - Paid: jami to'lovlar >= buyurtma jami
  - Partially paid: jami to'lovlar >0 va < buyurtma jami
  - Unpaid: jami to'lovlar = 0
\n**Mijozlar integratsiyasi:**\n- Agar mijoz POS da belgilangan bo'lsa, u Orders ro'yxati va detallarda ko'rsatilishi kerak
- Mijoz balanslari (qarz, sodiqlik) buyurtma yaratilganda/to'langanda/qaytarilganda yangilanishi kerak
- Kredit savdo amalga oshganda mijoz balansi ortadi
- To'lov qabul qilinganda mijoz balansi kamayadi
- Mijoz statistikasi real-time yangilanadi

**Sales Returns integratsiyasi:**\n- Order Detail sahifasidan foydalanuvchi Sales Return yozuvini yaratishi mumkin
- Order sahifasida bog'liq qaytarishlar ro'yxati ko'rsatilishi kerak\n- Buyurtma holati qaytarishga qarab yangilanadi:\n  - Barcha mahsulotlar qaytarilsa → 'Refunded'\n  - Qisman qaytarilsa → 'Partially Refunded'
  - Qaytarish bo'lmasa → 'Completed' holatida qoladi

**Xodimlar integratsiyasi:**
- Har bir buyurtma kassir ID ni saqlaydi
- Xodim samaradorlik statistikasi avtomatik yangilanadi
- Bekor qilingan buyurtmalar xodim xato darajasiga ta'sir qiladi
\n**Dashboard integratsiyasi:**
- Har bir yangi buyurtma dashboard ko'rsatkichlarini darhol yangilaydi
- Bugungi savdolar, buyurtmalar soni, o'rtacha qiymat real-time hisoblanadi
\n#### 4.6.5 Tekshirish va xavfsizlik
Faqat Manager yoki Admin roligaega foydalanuvchilar:\n- Buyurtmalarni bekor qilishi mumkin
- Buyurtmalarni o'chirishi mumkin (agar umuman ruxsat etilgan bo'lsa)
\nBuyurtmalarga o'zgartirishlar (bekor qilish, qaytarish) logga yozilishi kerak:\n- kim, qachon, nima o'zgartirilgan
\n#### 4.6.6 UI/UX talablar
- Toza, tez jadval ko'rinishi
- Yuqori qismda yopishqoq filtrlar paneli
- Status va payment_status rangli belglar bilan:\n  - Completed – yashil
  - Pending – ko'k
  - Voided – kulrang
  - Refunded – to'q sariq
  - Partially Refunded – och sariq
- Mobil/Planshet uchun qulay (lekin desktop uchun optimallashtirilgan)

### 4.7 Qaytarishlar (Sales Returns Module)

#### 4.7.1 Sales Returns List Page
**Sahifa sarlavhasi:** Sales Returns
\n**Jadval ustunlari:**
- return_number – Qaytarish raqami (RET-YYYYMMDD-#####)
- order_number – Asl sotuv buyurtmasi raqomi
- customer_name – Mijoz nomi
- date_time – Sana va vaqt
- returned_amount – Qaytarilgan summa
- status – Pending, Completed, Cancelled
- cashier – Kassir\n- actions – Ko'rish, Chop qilish, Bekor qilish

**Funksiyalar:**
- Qaytarish raqomi yoki buyurtma raqomi bo'yicha qidiruv
- Filtrlar:\n  - Sana oralig'i
  - Mijoz\n  - Kassir
  - Status
- Sahifalash (Pagination)
- Excel va PDF formatida eksport
- '+ New Sales Return' tugmasi

#### 4.7.2 Create Sales Return Page
Ushbu sahifa mavjud buyurtmadan mahsulotlarni qaytarish imkonini beradi.

**Qadam 1 — Buyurtmani tanlash**
Foydalanuvchi quyidagilarni amalga oshirishi mumkin:
- Buyurtma raqomi bo'yicha qidiruv
- Chek barcode skanerlash (ixtiyoriy)
- Oxirgi buyurtmalardan tanlash
\nTanlangandan keyin ko'rsatish:
- Buyurtma raqomi
- Mijoz\n- Kassir
- Sana
- Jami summa
\n**Qadam 2 — Qaytariladigan mahsulotlar jadvali**
Barcha buyurtma mahsulotlarini jadvalga avtomatik yuklash:
\n**Ustunlar:**\n- Mahsulot nomi
- SKU\n- Sotilgan miqdor
- Qaytarish miqdori (tahrirlash mumkin)
- Birlik narxi
- Qator jami (avtomatik hisoblash)

**Tekshirish:**
- Qaytarish miqdori sotilgan miqdordanoshmasligi kerak
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
- Bekor qilish\n- Ixtiyoriy: Qaytarish chekini chop qilish\n\n#### 4.7.3 Sales Return Detail Page
Detail ko'rinishi quyidagilarni ko'rsatishi kerak:
\n**Umumiy ko'rinish:**
- Qaytarish raqomi
- Bog'liq buyurtma raqomi
- Mijoz
- Kassir
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
- Qaytarish chekini chop qilish
- PDF eksport qilish
- Qaytarishni bekor qilish (faqat ombor tiklanmagan bo'lsa)
\n#### 4.7.4 Ombor integratsiyasi (Majburiy)
To'g'ri qoldiq mantiqini amalga oshirish:
\n**Qaytarish yaratilganda:**
- inventory_stock += returned_quantity
- Dashboard va hisobotlar avtomatik yangilanadi
\n**Harakatni loglash:**
Har bir qaytarish ombor yozuvini yaratadi:
- type: 'Sales Return'
- product_id\n- quantity (+)
- related_return_number
- date\n- performed_by (foydalanuvchi)
\n#### 4.7.5 Buyurtmalar integratsiyasi\n**Buyurtma detali bog'liq qaytarishlar ro'yxatini ko'rsatishi kerak**\n
**Buyurtma jami qaytarishdan keyin yangilanishi kerak:**
- updated_order_total = original_total - returned_amount
\n**Buyurtma holati:**
- Barcha mahsulotlar qaytarilsa → 'Refunded'
- Qisman qaytarilsa → 'Partially Refunded'
- Qaytarish bo'lmasa → 'Completed' holatida qoladi

#### 4.7.6 To'lovlar integratsiyasi
Agar qaytarish summasi qaytarilishi kerak bo'lsa:
\n**Tizim taklif qilinadigan qaytarish summasini ko'rsatishi kerak**

Kassir qaytarish usulini tanlaydi:
- Naqd\n- Karta
- Mijoz hisobiga balans
\n**Qaytarish quyidagilarni yaratishi kerak:**
- payment_type: Refund
- amount: returned_amount
- method: tanlangan usul
\n#### 4.7.7 Mijozlar integratsiyasi
Agar mijoz bog'langan bo'lsa:\n
**Mijoz balansi qaytarilgan summa miqdorida ortadi (agar balans qaytarishturi bo'lsa)**

**Mijoz profili ko'rsatadi:**
- Bog'liq qaytarishlar\n- Qaytarilgan mahsulotlar
- Qaytarish tarixi

**Mijoz statistikasi avtomatik yangilanadi:**\n- Jami xaridlar summasi kamayadi
- Qaytarishlar soni ortadi
\n#### 4.7.8 Hisobotlar integratsiyasi
Sales Returns quyidagi hisobotlarda ko'rinishi kerak:

**Savdo hisobotlari:**
- Jami qaytarilgan summa
- Sof savdo\n- Qaytarish foizi

**Ombor hisobotlari:**
- Qaytarilgan mahsulotlar
- Qaytarishlardan tuzatishlar
\n**Xodimlar hisobotlari:**
- Kassir tomonidan qayta ishlangan qaytarishlar
\n#### 4.7.9 UI/UX talablar
- Toza jadval ko'rinishi
- Tezkor POS ish jarayoni uchun katta kirishlar
- Aniq ogohlantirishlar va tekshirish xabarlari
- Status rangli kodlari:\n  - Pending → Ko'k
  - Completed → Yashil
  - Cancelled → Qizil

#### 4.7.10 Raqamlash siyosati (Majburiy)
**Qaytarish raqamlash:**
- Format: RET-YYYYMMDD-#####
- Misol: RET-20251205-00023

**Buyurtmaga asoslangan havola kuzatuvni ta'minlaydi**

#### 4.7.11 O'chirish va bekor qilish cheklovlari
- Faqat Manager va Admin qaytarishlarni bekor qilishi yoki o'chirishi mumkin
- Agar ombor allaqachon yangilangan bo'lsa, qaytarishni bekor qilish mumkin emas
- Barcha o'zgarishlar audit logiga yoziladi

#### 4.7.12 Audit trail
Har bir qaytarish uchun quyidagilar logga yoziladi:
- Kim yaratdi
- Qachon yaratildi
- Qaysi buyurtmadan\n- Qaysi mahsulotlar qaytarildi
- Qancha summa qaytarildi
- Qaysi usul bilan qaytarildi
- Kim bekor qildi (agar bekor qilingan bo'lsa)

### 4.8 To'lovlar (Payments)\n- Bir nechta to'lov usuli
- Qisman to'lov imkoniyati
- Terminal integratsiyasi
- Oldindan to'lov (qarzdor mijozlar uchun)
- To'lov ma'lumotlari: raqam, sana, summa, turi, izoh
- Qaytarish to'lovlari (Refund payments)
- Mijoz balansi bilan integratsiya
- Sozlamalar modulidan to'lov usullarini real-time o'qish
- Har bir to'lov buyurtma va mijozga bog'lanadi
- To'lovlar dashboard va hisobotlarga avtomatik sinxronlanadi

### 4.9 Xarid buyurtmalari (Purchase Orders Module)

#### 4.9.1 Purchase Orders List Page
**Sahifa sarlavhasi:** Purchase Orders
\n**Jadval ustunlari:**
- po_number – Xarid buyurtmasi raqomi (masalan: PO-20251206-00023)
- supplier_name – Yetkazib beruvchi (matn yoki bog'langan obyekt)
- order_date – Yaratilgan sana
- expected_date – Kutilayotgan yetkazib berish sanasi
- total_amount – Buyurtma jami
- status – Draft / Approved / Partially Received / Received / Cancelled
- created_by – Foydalanuvchi\n- actions – Ko'rish / Tahrirlash / Qabul qilish / Bekor qilish

**Funksiyalar:**
- PO raqomi yoki yetkazib beruvchi nomi bo'yicha qidiruv
- Filtrlar:
  - Status
  - Sana oralig'i
  - Yetkazib beruvchi
- Sana, status, jami summa bo'yicha saralash
- Sahifalash (Pagination)
- Excel / PDF formatida eksport
- '+ New Purchase Order' tugmasi

#### 4.9.2 Create / Edit Purchase Order Page
**Forma bo'limlari:**
\n**A) Sarlavha**
- po_number – avtomatik generatsiya (faqat o'qish)\n- supplier_name – dropdown yoki matn kiritish
- order_date – standart = bugun
- expected_date – ixtiyoriy
- reference – yetkazib beruvchi hisob-fakturasi / ma'lumotnoma raqomi (ixtiyoriy)
- notes – matn maydoni\n- status – Draft (standart)\n\n**B) Mahsulotlar jadvali**
**Ustunlar:**
- Mahsulot (nom yoki SKU bo'yicha qidiruv)
- SKU\n- Birlik\n- Miqdor (ordered_qty)
- Xarid narxi (cost)\n- Qator jami (qty × price, avtomatik)\n
**Funksiyalar:**
- Qatorlarni qo'shish / o'chirish
- Mahsulotdan cost_price ni avtomatik to'ldirish, lekin tahrirlash mumkin
\n**Tekshirish:**
- Miqdor > 0\n- Narx ≥ 0
\n**C) Xulosa**
- Oraliq jami (Subtotal)\n- Chegirma (ixtiyoriy)
- Soliq (ixtiyoriy)
- Jami summa (Total amount)
\n**Tugmalar:**
- Save as Draft\n- Approve
- Cancel
\n**Status o'zgarishlari:**
- Draft → Approved → (Partially) Received → Closed
- Draft / Approved → Cancelled
\n#### 4.9.3 Purchase Order Detail Page
**Ko'rsatish:**
\n**Sarlavha:**
- PO raqomi
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

#### 4.9.4 Receive Goods Flow (Juda muhim)
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
- Inventory modulida mahsulot qoldig'ini yangilash
- PO statusini yangilash:\n  -Agar barcha qatorlar to'liq qabul qilingan bo'lsa → Received
  - Agar kamida bitta qator qisman qabul qilingan bo'lsa → Partially Received
- Dashboard ko'rsatkichlarini yangilash
- Hisobotlarni yangilash

**Ixtiyoriy:**
- Oxirgi xaridga asoslanib mahsulot cost_price ni avtomatik yangilash
\n#### 4.9.5 Integratsiyalar
\n**Inventory moduli bilan:**
- Har bir qabul qilish voqeasi qoldiqnioshiradi va harakat yozuvini qo'shadi
- Ixtiyoriy: Xarid qaytarish oqimi (kelajakda)
- Barcha o'zgarishlar real-time dashboard va hisobotlarga sinxronlanadi

**Mahsulotlar moduli bilan:**
- Mahsulotlar jadvalidagi mahsulot tanlagich
- Narx va birlik mahsulotlar jadvalidan o'qiladi
\n**Yetkazib beruvchilar bilan (agar tizimda mavjud bo'lsa):**
- supplier_name Suppliers moduliga bog'lanishi mumkin
\n**Hisobotlar bilan:**
Purchase Orders ma'lumotlari quyidagi hisobotlarda ishlatiladi:
- Mahsulot bo'yicha xarid tarixi
- Yetkazib beruvchi samaradorligi hisobotlari
- Ombor baholash va xarajat tahlili
\n#### 4.9.6 Ruxsatlar va xavfsizlik
**Admin / Manager:**
- PO larni yaratish, tahrirlash, tasdiqlash, qabul qilish, bekor qilish
\n**Kassir / Xodim:**
- Faqat ko'rish, ixtiyoriy ravishda draft yaratish

**Barcha status o'zgarishlari va qabul qilish operatsiyalari logga yozilishi kerak:**
- foydalanuvchi, vaqt, eski status, yangi status

#### 4.9.7 UI / UX talablar
- Toza, karta asosidagi layout
- Asosiy PO ma'lumotlari bilan yopishqoq sarlavha
- Inline tahrirlash bilan mahsulotlar jadvali
- Rangli status belgilari:
  - Draft – kulrang
  - Approved – ko'k
  - Partially Received – to'q sariq
  - Received – yashil
  - Cancelled – qizil
- Desktop (POS backoffice) uchun optimallashtirilgan, planshet uchun qulay

#### 4.9.8 Raqamlash siyosati\n**PO raqamini avtomatik generatsiya:**
- Format: PO-YYYYMMDD-#####
- Misol: PO-20251206-00015

**Buyurtmaga asoslangan havola kuzatuvni ta'minlaydi**

#### 4.9.9 Texnik talablar
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

### 4.10 Inventarizatsiya\n- Omborni tanlash
- Haqiqiy miqdorni kiritish
- Tizim miqdori bilan taqqoslash
- Farqni avtomatik hisoblash va tasdiqlash
- Ombor harakatiga yozish
- Inventarizatsiya raqomi formati: INV-YYYY-#####
- Barcha o'zgarishlar real-time dashboard va hisobotlarga sinxronlanadi
- Audit trail to'liq saqlanadi

### 4.11 Mijozlar (Customers Module)

#### 4.11.1 Customers List Page
**Sahifa sarlavhasi:** Customers
\n**Jadval ustunlari:**
- name – To'liq ism yoki kompaniya nomi
- phone – Asosiy telefon\n- type – Jismoniy shaxs / Kompaniya\n- total_sales – Jami xaridlar summasi
- balance – Joriy balans (musbat = mijoz qarzi, manfiy = do'kon qarzi/qaytarish)
- last_order_date – Oxirgi xarid sanasi
- status – Faol / Nofaol
- actions – Ko'rish / Tahrirlash / O'chirish

**Funksiyalar:**
- Ism / telefon bo'yicha qidiruv
- Filtrlar:\n  -Turi (Jismoniy shaxs / Kompaniya)
  - Status (Faol / Nofaol)
  - Balans (Qarzdor / Qarzsiz)
- Saralash:\n  - Jami savdo\n  - Oxirgi buyurtma sanasi
  -Ism A–Z / Z–A
- Excel / PDF formatida eksport
- '+ Add Customer' tugmasi
\n#### 4.11.2 Add / Edit Customer Form
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
- Soliq raqami noyob
- Boshlang'ich balans raqamli
- Kredit limiti raqamli

**Tugmalar:** Save, Cancel\n
#### 4.11.3 Customer Detail Page
**Layout:**umumiy ma'lumotlar bilan sarlavha + tablar.\n
**Sarlavha bloki:**
- Ism +turi belgisi
- Telefon, email\n- Manzil
- Status
- Kredit limiti
- Joriy balans (rang bilan):\n  - Qizil → mijoz do'konga qarzdor (musbat balans)
  - Yashil → do'kon qarzdor/qaytarish / oldindan to'lov (manfiy)\n  - Kulrang → nol balans
\n**Asosiy ko'rsatkichlar (kartalar):**
- Jami savdo summasi
- Buyurtmalar soni
- O'rtacha buyurtma qiymati
- Jami qaytarishlar summasi
- Oxirgi buyurtma sanasi
\n**Tab1— Buyurtmalar (Orders)**
Jadval:\n- Buyurtma raqomi
- Sana
- Jami summa
- To'langan summa
- Status
- Amallar → buyurtma detailiga o'tish

**Tab 2 — To'lovlar (Payments)**
Jadval:
- Sana
- Summa
- Yo'nalish (Mijozdan to'lov / Mijozga qaytarish)
- Usul (Naqd / Karta / O'tkazma / Boshqa)
- Bog'liq buyurtma (agar mavjud bo'lsa)
\nBalans buyurtmalar + to'lovlar asosida avtomatik hisoblanishi kerak.

**Tab 3 — Qaytarishlar (Returns)**
Jadval:
- Qaytarish raqomi
- Sana
- Qaytarilgan summa
- Bog'liq buyurtma
- Status
\n**Tab 4 — Eslatmalar / Faoliyat logi (Notes / Activity Log)**
- Qo'lda eslatmalar
- Tizim voqealari:\n  - Mijoz yaratildi/yangilandi
  - Kredit limiti o'zgarishi
  - Balans tuzatishlari
\n#### 4.11.4 POS Terminal integratsiyasi
POS Terminaldan kassir:\n- Mavjud mijozni tanlashi mumkin
- Tezkor mijoz yaratishi mumkin (faqat ism + telefon)
\nSotuvdan keyin:
- Buyurtma mijozga bog'lanadi
- Balans yangilanadi agar:\n  - Kredit savdo\n  - Ortiqcha to'lov / oldindan to'lov
- Mijoz statistikasi real-time yangilanadi

#### 4.11.5 Balans va qarz mantiqiy (Majburiy)
**Balans formulasi:**
Balans = (Mijoz uchun jami buyurtmalar – Mijozdan jami to'lovlar + Do'kon qaytarishlari)\n
**Balans talqini:**
- Agar balans > 0 → mijoz qarzi
- Agar balans < 0 → do'kon qarzdor (oldindan to'lov yoki qaytarish)
\n**Ogohlantirish ko'rsatish qachon:**
- Yangi savdo balansi credit_limit danoshirib yuborsa
- Mijoz allow_debt = false va kassir kredit savdo qilmoqchi bo'lsa

#### 4.11.6 Hisobotlar integratsiyasi
Mijozlar moduli hisobotlarga ma'lumot berishi kerak:
- Savdo bo'yicha top mijozlar
- Eng ko'p qarzdor mijozlar
- Davr bo'yicha mijoz faolligi

#### 4.11.7 Ruxsatlar va xavfsizlik
**Admin/Manager:** to'liq kirish (qo'shish, tahrirlash, o'chirish, balansni tuzatish)
**Kassir:** ko'rish + yaratish + asosiy maydonlarni tahrirlash, o'chirish yo'q, to'g'ridan-to'g'ri balansni tahrirlash yo'q

**Mijozni o'chirish faqat ruxsat etiladiagar:**
- Bog'liq buyurtmalar, to'lovlar yoki qaytarishlar yo'q bo'lsa
- Aks holda → jismoniy o'chirish o'rniga Nofaol deb belgilash

#### 4.11.8 UI/UX talablar
- Toza, zamonaviy jadval ko'rinishi
- Yopishqoq qidiruv va filtrlar paneli
- Status va balans uchun rangli belglar
- Responsive layout (desktop optimallashtirilgan, planshet uchun qulay)
- Mijoz → buyurtmalar → to'lovlar va orqaga tez navigatsiya

#### 4.11.9 Texnik talablar
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
\n### 4.12 Xodimlar va rollar (Employees Module)

#### 4.12.1 Employees Main Page
**Sahifa sarlavhasi:** Employees

**Jadval ustunlari:**
- Name – To'liq ism\n- Role – Admin / Manager / Cashier\n- Phone – Telefon raqami
- Email – Elektron pochta
- Status – Active / Disabled
- Last login – Oxirgi kirish vaqti
- Actions – View, Edit, Deactivate

**Funksiyalar:**
- Ism, telefon yoki email bo'yicha qidiruv
- Filtrlar:
  - Role (Admin / Manager / Cashier)
  - Status (Active / Disabled)
- Sahifalash (Pagination)
- '+ Add Employee' tugmasi\n
#### 4.12.2 Add Employee Form
**Forma maydonlari:**
- Full name (majburiy)
- Role: Admin / Manager / Cashier (majburiy)
- Phone number (majburiy, +998 formatini tekshirish)
- Email (ixtiyoriy lekin tekshiriladi)
- Login username (majburiy, noyob)
- Password + Confirm Password\n- Status (Active / Disabled)
\n**Tekshirish:**
- Username noyob bo'lishi kerak
- Telefon mahalliy formatgamos kelishi kerak
- Parol uzunligi ≥ 6\n- Rolni Adminga o'zgartirish tasdiqlash modali bilan amalga oshiriladi

**Yuborishdan keyin:**
- Xodim foydalanuvchi yozuvini yaratish
- Ruxsatlarni avtomatik tayinlash
\n#### 4.12.3 Edit Employee Page
**Tahrirlash mumkin bo'lgan maydonlar:**
- Name\n- Role (Admin faqat manager/kassirlarni pasaytirishi/ko'tarishi mumkin)
- Phone
- Email
- Status toggle
\n**Tahrirlash mumkin emas:**
- Username\n- Created date
\n**Qo'shimcha amallar:**
- Reset password\n- Disable employee (soft delete)
- Force logout (faol sessiyani o'chirish)
\n#### 4.12.4 Employee Detail Page
**Bo'limlar:**
\n**A) Profile Overview**
- Name\n- Role badge
- Contact info
- Current status
- Last login
- Account created date
\n**B) Performance Dashboard**
- Total sales completed – Yakunlangan jami savdolar\n- Total revenue generated – Yaratilgan jami daromad
- Average order amount – O'rtacha buyurtma summasi
- Total returns processed – Qayta ishlangan jami qaytarishlar
- Net profit from sales – Savdodan sof foyda
- Productivity index – Samaradorlik indeksi (AI hisoblangan)

**Diagrammalar:**
- Daily sales chart – Kunlik savdo diagrammasi
- Transactions count chart – Tranzaksiyalar soni diagrammasi
- Hourly activity heatmap – Soatlik faoliyat issiqlik xaritasi
\n**C) Time Tracking**
Barcha login/logout ro'yxati:
- Login time – Kirish vaqti
- Logout time – Chiqish vaqti
- Session duration – Sessiya davomiyligi
- IP address – IP manzil

**D) Activity Log**
Audit trail:
- Created orders – Yaratilgan buyurtmalar
- Edited orders – Tahrirlangan buyurtmalar
- Cancellations – Bekor qilishlar
- Returns – Qaytarishlar\n- Inventory adjustments – Ombor tuzatishlari
- Price changes – Narx o'zgarishlari
- Held orders saved/restored – Kutilayotgan buyurtmalar saqlangan/tiklangan

Har bir yozuv quyidagilarni o'z ichiga olishi kerak:
- Timestamp – Vaqt belgisi
- Action – Amal\n- Affected document ID – Ta'sirlangan hujjat ID
- Description – Tavsif
\n#### 4.12.5 POS Terminal bilan integratsiya
POS Terminal xodimga asoslangan mantiqni qo'llab-quvvatlashi kerak:
\n**Login tizimi:**
- Username/password orqali kirish
- Sessiya kuzatuvi
- Xodim shift start/end\n- Avtomatik shift hisobotlari
- Cash drawer open/close yozuvlari xodimga bog'langan

**Kassir cheklovlari:**
- Mahsulotlarni tahrirlash mumkin emas
- Sozlamalarni tahrirlash mumkin emas\n- Buyurtmalarni o'chirish mumkin emas\n- Narxlarni o'zgartirish mumkin emas\n\n**Manager:**
- Chegirmalarni tasdiqlashi mumkin\n- Kam qoldiqdagi savdolarni bekor qilishi mumkin
- Qaytarishlarni tasdiqlashi mumkin
\n**Admin:**
- To'liq kirish\n\n#### 4.12.6 Permissions & Security Layer
**Rol asosida kirish:**
\n**Admin:**
- Tizimga to'liq kirish
- Xodimlarni yaratish/tahrirlash/o'chirish
- Barcha hisobotlarni ko'rish
- Tizim sozlamalarini o'zgartirish

**Manager:**
- Ko'pchilik resurslarga ko'rish/tahrirlash
- Xodimlarni o'chirish mumkin emas
- Tizim sozlamalarini o'zgartirish mumkin emas
- Muhim amallarni tasdiqlashi mumkin

**Kassir:**
- Cheklangan kirish
- Savdo, qaytarishlar yaratishi mumkin
- Moliyaviy hisobotlarni ko'rish mumkin emas
- Omborni tahrirlash mumkin emas\n
**Backend tekshiruvlari:**
- Himoyalangan xodim yozuvlari (oxirgi adminni o'chirish mumkin emas)
- Kuchli parol tekshiruvi
- 5marta muvaffaqiyatsiz kirish urinishidan keyin hisob blokirovkasi

#### 4.12.7 Employee Activity Analytics
Tizim quyidagilarni hisoblashi kerak:
- Employee performance score – Xodim samaradorlik balli
- Profit contribution – Foyda hissasi
- Transaction accuracy – Tranzaksiyaaniqligi
- Error rate – Xato darajasi (bekor qilingan/o'chirilgan buyurtmalar)
- Average checkout time – O'rtacha to'lov vaqti
- Peak working hours – Eng yuqori ish soatlari

**Vizualizatsiya:**
- Line charts – Chiziqli diagrammalar
- Bar charts – Ustunli diagrammalar
- Pie charts – Doira diagrammalar
\n#### 4.12.8 Export & Reporting
Eksport imkoniyati:
- Employees list (Excel/PDF) – Xodimlar ro'yxati
- Time logs – Vaqt loglari
- Cashier performance reports – Kassir samaradorlik hisobotlari
- Employee activity logs – Xodim faoliyat loglari
\n#### 4.12.9 Technical Requirements
**Database fields:**
- id
- full_name
- role
- phone
- email
- username
- password_hash
- status
- last_login
- created_at
- updated_at

**Audit Log Table:**
- employee_id
- action_type
- description
- document_id
- timestamp
- ip_address
\n**Time Tracking Table:**
- employee_id\n- login_time
- logout_time
- duration
- ip_address

#### 4.12.10 UI/UX talablar
- Toza professional layout
- Izchil rang sxemasi
- Responsive dizayn
- Mobil qulay versiya
- Sticky table header
- Loading states va skeletons
- Empty state placeholders
- Xodim → buyurtmalar → faoliyat va orqaga tez navigatsiya

#### 4.12.11 Ruxsatlar\n**Admin:**
- Barcha xodim operatsiyalariga to'liq kirish
- Rollarni o'zgartirish
- Xodimlarni o'chirish
\n**Manager:**
- Xodimlarni ko'rish
- Kassirlarni yaratish/tahrirlash
- O'chirish huquqi yo'q

**Kassir:**
- Faqat o'z profilini ko'rish
- Tahrirlash huquqi yo'q
\n### 4.13 Hisobotlar (Reports Module)

#### 4.13.1 Reports Main Page\n**Sahifa sarlavhasi:** Reports

**Sahifa bo'limlari (kartalar ko'rinishida ikkonlar bilan):**
- Sales Reports (Savdo hisobotlari)
- Inventory Reports (Ombor hisobotlari)
- Purchase Reports (Xarid hisobotlari)\n- Employee Reports (Xodimlar hisobotlari)
- Financial Reports (Moliya hisobotlari)
- Export Center (Eksport markazi)

#### 4.13.2 Sales Reports (Savdo hisobotlari)
\n**4.13.2.1 Daily Sales Report (Kunlik savdo hisoboti)**
\n**Jadval ustunlari:**
- Invoice number (Chek raqomi)
- Date/time (Sana/vaqt)
- Cashier (Kassir)
- Payment type (To'lov turi: Cash / Card / Mixed)
- Total sale (Jami savdo)
- Profit (Foyda)
- Status (Completed / Returned / Cancelled)

**Filtrlar:**
- Date range (Sana oralig'i)
- Cashier (Kassir)
- Payment type (To'lov turi)
- Status\n
**Jami ko'rsatkichlar:**
- Total sales (Jami savdo)
- Total profit (Jami foyda)\n- Total returns (Jami qaytarishlar)
- Average order value (O'rtacha buyurtma qiymati)
\n**Eksport:**
- Excel va PDF\n\n**Real-time sinxronizatsiya:**
- Barcha ko'rsatkichlar buyurtmalar va qaytarishlar modullaridan avtomatik yangilanadi
\n**4.13.2.2 Product Sales Report (Mahsulot savdo hisoboti)**

**Jadval ustunlari:**
- Product name (Mahsulot nomi)
- SKU\n- Category (Kategoriya)
- Quantity sold (Sotilgan miqdor)
- Revenue (Daromad)
- Profit (Foyda)\n\n**Funksiyalar:**
- Top10 best-selling products (Eng ko'p sotilgan 10 mahsulot)
- Slow-moving products (Kam sotilayotgan mahsulotlar)\n- Profit margin indicators (Foyda marjasi ko'rsatkichlari: yashil/qizil)\n
**Filtrlar:**
- Date range (Sana oralig'i)
- Category (Kategoriya)
- SKU
\n**4.13.2.3 Customer Sales Report (Mijoz savdo hisoboti)**

**Jadval ustunlari:**
- Customer (Mijoz)
- Total purchases (Jami xaridlar)
- Number of orders (Buyurtmalar soni)
- Average order value (O'rtacha buyurtma qiymati)
- Outstanding balance (Qarz balansi)

**Filtrlar:**
- Customer name (Mijoz nomi)
- Date (Sana)
\n#### 4.13.3 Inventory Reports (Ombor hisobotlari)

**4.13.3.1 Stock Levels Report (Qoldiq darajalari hisoboti)**

**Jadval ustunlari:**
- Product name (Mahsulot nomi)
- SKU
- Current stock (Joriy qoldiq)
- Minimum stock (Minimal qoldiq)
- Stock status (Qoldiq holati: Low / OK / Out of stock)
\n**Funksiyalar:**
- Avtomatik rangli ko'rsatkichlar
- Excel va PDF eksport
\n**4.13.3.2 Inventory Movement Report (Ombor harakati hisoboti)**
\n**Jadval ustunlari:**
- Date (Sana)
- Product (Mahsulot)
- Type (Turi: Sale, Purchase, Adjustment, Return)
- Quantity change (Miqdor o'zgarishi: +/-)
- Referencedocument (Ma'lumotnoma hujjat: Order ID / Purchase Order ID)
- Performed by user (Foydalanuvchi tomonidan amalga oshirildi)

**Filtrlar:**
- Date range (Sana oralig'i)
- Type (Turi)
- Product (Mahsulot)

**4.13.3.3 Valuation Report (Baholash hisoboti)**
\n**Jadval ustunlari:**
- Product (Mahsulot)
- SKU
- Cost price (Xarid narxi)
- Quantity (Miqdor)
- Total value (Jami qiymat: qty × price)
\n**Jami ko'rsatkichlar:**
- Total inventory value (Jami ombor qiymati)
- Total units in stock (Ombordagi jami birliklar)\n\n#### 4.13.4 Purchase Reports (Xarid hisobotlari)
\n**4.13.4.1 Purchase Order Summary (Xarid buyurtmasi xulosasi)**

**Jadval ustunlari:**\n- PO number (PO raqomi)
- Supplier (Yetkazib beruvchi)
- Total ordered amount (Jami buyurtma qilingan summa)
- Total received amount (Jami qabul qilingan summa)
- Status\n- Date (Sana)

**4.13.4.2 Supplier Performance Report (Yetkazib beruvchi samaradorligi hisoboti)**
\n**Jadval ustunlari:**
- Supplier (Yetkazib beruvchi)
- Total purchases (Jami xaridlar)
- On-time delivery rate (O'z vaqtida yetkazib berish darajasi)
- Number of purchase orders (Xarid buyurtmalari soni)
- Returns from supplier (Yetkazib beruvchidan qaytarishlar)
- Average cost savings (O'rtacha xarajat tejash)

#### 4.13.5 Employee Reports (Xodimlar hisobotlari)

**4.13.5.1Cashier Performance (Kassir samaradorligi)**

**Jadval ustunlari:**
- Employee (Xodim)
- Number of sales (Savdolar soni)
- Total sales amount (Jami savdo summasi)
- Total profit (Jami foyda)\n- Mistakes / voided orders (Xatolar / bekor qilingan buyurtmalar)
- Working hours (Ish soatlari - ixtiyoriy)\n
**4.13.5.2 Login Activity Log (Kirish faoliyati logi)**

**Jadval ustunlari:**
- Employee (Xodim)\n- Login time (Kirish vaqti)
- Logout time (Chiqish vaqti)
- Duration (Davomiyligi)
- IP address (IP manzil)
\n#### 4.13.6 Financial Reports (Moliya hisobotlari)

**4.13.6.1 Profit & Loss Report (Foyda va zarar hisoboti)**
\n**Bo'limlar:**
- Gross sales (Yalpi savdo)
- Discounts (Chegirmalar - qator va buyurtma chegirmalari)
- Net sales (Sof savdo)
- Cost of goods sold - COGS (Sotilgan tovarlar xarajati)
- Gross profit (Yalpi foyda)
- Returns (Qaytarishlar)\n- Final profit (Yakuniy foyda)
\n**Vaqt davrlari:**
- Daily (Kunlik)
- Weekly (Haftalik)
- Monthly (Oylik)
- Custom date (Maxsus sana)

**4.13.6.2 Payment Method Breakdown (To'lov usullari taqsimoti)**
\n**Diagramma:**
- Cash % (Naqd %)
- Card % (Karta %)
- Mixed payments % (Aralash to'lovlar %)
\n**Jadval:**
- Payment type (To'lov turi)\n- Number of transactions (Tranzaksiyalar soni)
- Total amount (Jami summa)
\n#### 4.13.7 Dashboard Analytics (Ixtiyoriy qo'shimcha)\n
**Vizual diagrammalar:**
- Sales chart by date (Sana bo'yicha savdo diagrammasi)
- Profit chart (Foyda diagrammasi)
- Top products (Top mahsulotlar)
- Stock alerts (Qoldiq ogohlantirishlari)
- Purchase trends (Xarid tendentsiyalari)

**Diagramma turlari:**
- Bar chart (Ustunli diagramma)
- Line chart (Chiziqli diagramma)
- Pie chart (Doira diagramma)\n\n**Ishlatish:**
- Recharts kutubxonasi
- Responsive UI
\n#### 4.13.8 Export Center (Eksport markazi)

**Har bir hisobot uchun eksport qo'llab-quvvatlash:**\n- Excel\n- PDF
- CSV\n\n#### 4.13.9Filtrlar va qidiruv (Global mantiq)

**Har bir hisobot quyidagilarni qo'llab-quvvatlashi kerak:**
- Global tezkor qidiruv
- Date range picker (Sana oralig'i tanlagich)
- Multi-select filters (Ko'p tanlovli filtrlar)
- Pagination (Sahifalash)
- Sorting (Saralash)
\n#### 4.13.10 Ruxsatlar\n
**Admin:**
- Barcha hisobotlarga kirish
\n**Manager:**
- Savdo,ombor, moliya hisobotlariga kirish

**Kassir:**
- Faqat shaxsiy samaradorlik hisobotiga kirish

**Audit logging:**
- Eksportlarni ko'rish
- Hisobotlarni yaratish
\n#### 4.13.11 UI talablar

- Toza professional layout
- Izchil rang sxemasi
- Responsive dizayn
- Mobil qulay versiya
- Sticky table header (Yopishqoq jadval sarlavhasi)
- Loading states va skeletons (Yuklash holatlari va skeletlar)
- Empty state placeholders (Bo'sh holat to'ldirgichlari)
\n#### 4.13.12 Real-time sinxronizatsiya
- Barcha hisobotlar bog'liq modullardan real-time ma'lumotlarni oladi
- Har qanday o'zgarish (buyurtma, qaytarish, ombor tuzatishi) hisobotlarni avtomatik yangilaydi
- Dashboard ko'rsatkichlari doimiy sinxronlashtiriladi

### 4.14 Sozlamalar (Settings Module)

#### 4.14.1 Settings Main Page Layout
**Sahifa sarlavhasi:** Settings

**Sahifa tuzilishi:**
Chap yoki yuqori qismda tablar/bo'limlar navigatsiyasi, o'ng qismda formalar.\n
**Bo'limlar (Tabs):**
1. Company Profile (Kompaniya profili)
2. POS Terminal Settings (POS Terminal sozlamalari)
3. Payments & Taxes (To'lovlar va soliqlar)
4. Receipts & Printing (Cheklar va chop qilish)
5. Inventory Settings (Ombor sozlamalari)
6. Numbering & IDs (Raqamlash va ID'lar)
7. User & Security (Foydalanuvchi va xavfsizlik)
8. Localization (Mahalliylashtirish)
9. Backup & Data Management (Zaxira va ma'lumotlar boshqaruvi - ixtiyoriy)
\n#### 4.14.2 Company Profile (Kompaniya profili)

**Maydonlar:**
- Company name (majburiy) – Kompaniya nomi
- Legal name (ixtiyoriy) – Yuridik nomi
- Logo upload – Logo yuklash
- Address (country, city, street) – Manzil (mamlakat, shahar, ko'cha)
- Phone number – Telefon raqami
- Email – Elektron pochta\n- Website (ixtiyoriy) – Veb-sayt
- Tax ID / INN / VAT number (ixtiyoriy) – Soliq ID / INN / QQS raqami
\n**Tekshirish:**
- Majburiy maydonlar bo'sh bo'lishi mumkin emas
- Email formatlash
- Telefon formati (masalan: +998 XX XXX XX XX)
\n**Ishlatilishi:**
Kompaniya ma'lumotlari quyidagilarda ishlatiladi:
- Cheklar\n- Hisob-fakturalar
- Hisobotlar
\n#### 4.14.3 POS Terminal Settings (POS Terminal sozlamalari)
\n**POS frontuchun global parametrlar:**
- Default POS mode: Retail / Restaurant (faqat enum, kelajakuchun)
- Enable'Hold Order' feature (yoqish/o'chirish) –'Buyurtmani saqlash' funksiyasini yoqish
- Enable 'Mixed Payment' (yoqish/o'chirish) – 'Aralash to'lov' funksiyasini yoqish
- Enable 'Per-Product Discount' (yoqish/o'chirish) – 'Mahsulot bo'yicha chegirma' funksiyasini yoqish
- Require customer selection for credit sales (yoqish/o'chirish) – Kredit savdo uchun mijoz tanlashni talab qilish
- Automatically log out cashier after X minutes of inactivity – Xdaqiqa faoliyatsizlikdan keyin kassirni avtomatik chiqarish
- Show low-stock warning in POS (yoqish/o'chirish) – POS da kam qoldiq ogohlantirishini ko'rsatish
- Quick access buttons limit (masalan: 8 / 12 / 16 products on main screen) – Tezkor kirish tugmalari cheklovi (asosiy ekranda mahsulotlar soni)

**Ushbu sozlamalar POS Terminal xatti-harakatiga real-time ta'sir qiladi.**

#### 4.14.4 Payments & Taxes (To'lovlar va soliqlar)

**Payment Methods (To'lov usullari)**
\n**Sozlanadigan ro'yxat:**
- Standart usullar: Cash, Card, QR, Bank transfer
- Imkoniyatlar:\n  - Usullarni yoqish/o'chirish
  - Yorliqlarni o'zgartirish (masalan: 'Card' o'rniga 'Terminal')
  - Maxsus usul qo'shish (masalan: 'Debt', 'Wallet')

**Taxes (Soliqlar)**

- Enable tax system (yoqish/o'chirish) – Soliq tizimini yoqish\n- Default tax rate (%) – Standart soliq stavkasi
- Tax inclusive / exclusive option – Soliq kiritilgan / chiqarilgan varianti
- Per-product tax override allowed (yoqish/o'chirish) – Mahsulot bo'yicha soliqni bekor qilishga ruxsat berish
\n**Tekshirish:**
- Foiz0 dan 100 gacha bo'lishi kerak
\n**Real-time sinxronizatsiya:**
- To'lov usullari o'zgarishlari darhol POS Terminal va buyurtmalar moduliga sinxronlanadi
- Soliq sozlamalari barcha narx hisoblashlariga avtomatik qo'llaniladi
\n#### 4.14.5 Receipts & Printing (Cheklar va chop qilish)

**Chek shablonlari uchun parametrlar:**
\n- Toggle: Auto print receipt after each sale (yoqish/o'chirish) – Har bir sotuvdan keyin chekni avtomatik chop qilish
- Receipt header text (ko'p qatorli; masalan: 'Thank you for shopping') – Chek sarlavha matni
- Receipt footer text (return policy, contact info) – Chek pastki matni (qaytarish siyosati, aloqa ma'lumotlari)
- Show company logo on receipt (yoqish/o'chirish) – Chekda kompaniya logosini ko'rsatish\n- Show cashier name (yoqish/o'chirish) – Kassir nomini ko'rsatish
- Show customer name (yoqish/o'chirish) – Mijoz nomini ko'rsatish\n- Show product SKU (yoqish/o'chirish) – Mahsulot SKU ni ko'rsatish
- Show line discounts on receipt (yoqish/o'chirish) – Chekda qator chegirmalarini ko'rsatish\n- Default receipt size: 58mm / 80mm – Standart chek o'lchami
- Test print button (placeholder) – Sinov chop qilish tugmasi

**Ushbu sozlamalar chop qilish mantiqida qayta ishlatilishi kerak.**

#### 4.14.6 Inventory Settings (Ombor sozlamalari)

**Globalombor xatti-harakati:**
\n- Enable inventory tracking (yoqish/o'chirish) – Ombor kuzatuvini yoqish
- Default minimal stock level for new products – Yangi mahsulotlar uchun standart minimal qoldiq darajasi
- Allow selling when stock is zero or negative: – Qoldiq nol yoki manfiy bo'lganda sotishga ruxsat berish:\n  - Option: Block sale, Allow with warning, Allow without warning – Variant: Sotuvni bloklash, Ogohlantirish bilan ruxsat berish, Ogohlantirishsiz ruxsat berish
- Automatic cost calculation mode (for profit reports): – Avtomatik xarajat hisoblash rejimi (foyda hisobotlari uchun):
  - Latest purchase price – Oxirgi xarid narxi
  - Average cost (future-ready) – O'rtacha xarajat (kelajak uchun tayyor)
- Automatic stock adjustment approval required (yes/no) – Avtomatik qoldiq tuzatishini tasdiqlash talab qilinadi (ha/yo'q)
\n**Real-time sinxronizatsiya:**
- Ombor sozlamalari o'zgarishlari darhol POS Terminal va Inventory moduliga qo'llaniladi
\n#### 4.14.7 Numbering & IDs (Raqamlash va ID'lar)

**Avtomatik yaratilgan raqamlar uchun sozlamalar:**

**Maydonlar:**
- Order number prefix (standart: POS-) – Buyurtma raqami prefiksi
- Order number format: POS-YYYYMMDD-##### – Buyurtma raqami formati
- Return number prefix (standart: RET-) – Qaytarish raqami prefiksi\n- Purchase order prefix (standart: PO-) – Xarid buyurtmasi prefiksi
- Movement/adjustment prefix (ixtiyoriy) – Harakat/tuzatish prefiksi

**AI quyidagilarni qo'llab-quvvatlashi kerak:**
- Har bir hujjat turi uchun keyingi ketma-ketlik raqamini ko'rish
- Ketma-ketliklarni qayta tiklash (tasdiqlash modali bilan)
\n**Barcha ID'lar noyob bo'lib qolishi kerak.**

#### 4.14.8 User & Security (Foydalanuvchi va xavfsizlik)
\n**Xavfsizlik parametrlari:**
\n- Minimum password length (standart 6) – Minimal parol uzunligi
- Require strong password (letters + numbers) (yoqish/o'chirish) – Kuchli parol talab qilish (harflar + raqamlar)\n- Max failed login attempts before lock (masalan: 5) – Blokirovkadan oldin maksimal muvaffaqiyatsiz kirish urinishlari
- Session timeout (minutes) – Sessiya tugash vaqti (daqiqalar)
- Allow multiple active sessions per user (yes/no) – Foydalanuvchi uchun bir nechta faol sessiyalarga ruxsat berish (ha/yo'q)
\n**Role management (qisqa tavsif, bu yerda to'liq CRUD yo'q):**
- Rollar ro'yxatini ko'rsatish (Admin, Manager, Cashier) qisqa tavsif bilan
- Rollar Employees modulida boshqarilishiga havola yoki ma'lumot berish
\n**Audit:**
- Switch'Enable activity logging' (yoqish/o'chirish) – 'Faoliyat logini yoqish' tugmasi —agar yoqilgan bo'lsa, asosiy amallarni loglash (buyurtmalar, qaytarishlar, ombor tuzatishlari).

#### 4.14.9 Localization (Mahalliylashtirish)

**Maydonlar:**
\n- Default language (masalan: Uzbek, Russian, English) – Standart til
- Additional interface languages (for future use) – Qo'shimcha interfeys tillari (kelajak uchun)
- Default currency (UZS, USD, va boshqalar) – Standart valyuta
- Currency symbol position: – Valyuta belgisi pozitsiyasi:
  - Before amount (₩10000) – Summa oldida
  - After amount (10000 ₩) – Summa keyin
- Thousand separator and decimal separator options – Ming ajratuvchi va o'nlik ajratuvchi parametrlari
\n**Ushbu sozlamalar barcha modullarda formatlashni boshqaradi.**

#### 4.14.10 Backup & Data Management (Zaxira va ma'lumotlar boshqaruvi - Ixtiyoriy lekin tavsiya etiladi)

**Sozlamalar:**
\n- Allow export of: – Eksport qilishga ruxsat berish:
  - Products – Mahsulotlar
  - Customers – Mijozlar
  - Orders – Buyurtmalar
  - Inventory movements – Ombor harakatlari
- 'Download full backup' button (placeholder) – 'To'liq zaxirani yuklash' tugmasi
- Info text about where backups are stored – Zaxiralar qayerda saqlanishi haqida ma'lumot matni
\n#### 4.14.11 Permissions & Access (Ruxsatlar va kirish)

**Faqat Admin roli Settings sahifasini ko'rishi va o'zgartirishi mumkin.**

**Manager va Kassir bu sahifaga kira olmaydi.**

**Har bir saqlash operatsiyasi quyidagilarni bajarishi kerak:**
- Maydonlarni tekshirish
- Muvaffaqiyat yoki xato toast ko'rsatish
- Audit logiga yozish:\n  - foydalanuvchi, vaqt, qaysi bo'lim o'zgartirilgan
\n#### 4.14.12 UI/UX Requirements (UI/UX talablar)

- Har bir bo'lim uchun toza karta asosidagi layout
- Bo'limlar orasida navigatsiya uchun chapyon panel yoki tablar
- Viewport pastki qismida mahkamlangan Save / Cancel tugmalari
- Saqlanmagan o'zgarishlar bilan sahifani tark etishda tasdiqlash dialogi
- Xavfli parametrlarni tushuntiruvchi aniq tooltiplar (masalan: 'Allow negative stock')
- To'liq responsive (desktop ustuvorligi, planshet uchun qulay)

#### 4.14.13 Final AI Requirements (Yakuniy AI talablar)

**AI to'liq funksional Settings modulini yaratishi kerak:**
\n- Konfiguratsiyani markaziy settings jadvalida / config store da saqlash
- Ushbu sozlamalarni quyidagi modullarda real-time qo'llash:
  - POS Terminal\n  - Orders
  - Sales Returns
  - Inventory
  - Purchase Orders
  - Reports
  - Employees
- Adminga tekshirish va audit loglash bilan konfiguratsiyani xavfsiz ko'rish va yangilash imkonini berish
- POS tizimining qolgan qismi bilan izchil UI dan foydalanish
- Barcha o'zgarishlar tizim bo'ylabdarhol sinxronlanadi

##5. Professional funksiyalar
- Hold order (chekni vaqtincha saqlash) - YANGI\n- Split payment (bir nechta to'lov turi)\n- Quick add product (tezkor qo'shish)\n- Z-otchet va X-otchet\n- Kassa ochilishi/yopilishi
- Shift-based accounting
- Device binding\n- To'liq Sales Returns tizimi
- To'liq Customers tizimi (balans, qarz, kredit limiti)
- To'liq Inventory Management tizimi (real-time tracking, movements, adjustments, alerts)
- To'liq Purchase Orders tizimi (yaratish, tasdiqlash, qabul qilish,ombor integratsiyasi)
-Ombor bilan avtomatik sinxronizatsiya
- Audit trail va loglar
- To'liq Reports Module (Sales, Inventory, Purchase, Employee, Financial analytics)
- To'liq Employees Module (yaratish, tahrirlash, rol asosida ruxsatlar, samaradorlik tahlili, vaqt kuzatuvi, audit loglari, POS integratsiyasi)
- To'liq Settings Module (Company Profile, POS Terminal, Payments & Taxes, Receipts, Inventory, Numbering, User & Security, Localization, Backup)\n- Real-time global sinxronizatsiya barcha modullar orasida
- Per-Product Discount (Mahsulot bo'yicha chegirma)\n\n## 6. Texnik talablar
\n### 6.1 UI/UX talablar
- Minimalist va silliq dizayn
- Tez ishlash (caching va optimization)
- Tablet va kassa monitorlariga moslashgan\n- Touch screenuchun katta tugmalar
- Offline mode va data sync
- Qorong'i va yorug' rejim
- Desktop va POS displeylaruchun optimallashtirilgan
- Yig'iladigan yon panellar
- Admin darajasidagi funksiyalar kassirlardan yashirilgan
-10,000+ mahsulot bilan ham tez render qilish
- Barcha modullar bo'ylab izchil UI/UX
- Standart status ranglari va belgilari
\n### 6.2 Xavfsizlik\n- JWT yoki Session authentication
- Role-based access control (RBAC)
- Offline ma'lumot shifrlanishi
- Kassa bo'yicha loglar: kim nima qilgan\n- Qaytarishlar uchun audit trail
- O'chirish va bekor qilish cheklovlari
- Mijoz ma'lumotlari xavfsizligi
- Xodim ma'lumotlari xavfsizligi
- Kuchli parol siyosati
- Session management
- IP tracking
- Oxirgi admin hisobini o'chirish oldini olish
- Barcha muhim amallar uchun audit loglash

### 6.3 Integratsiyalar
- Fiskal printer\n- Barcode scanner
- QR Pay (Click/Payme)
- Inventory API
- Bank terminali
- Sales Returns bilan to'liq integratsiya
- Customers bilan to'liq integratsiya
- Inventory Management bilan to'liq integratsiya
- Purchase Orders bilan to'liq integratsiya
- Reports Module bilan to'liq integratsiya
- Employees Module bilan to'liq integratsiya
- Settings Module bilan to'liq integratsiya
- Barcha modullar markazlashtirilgan ma'lumotlar bazasi orqali real-time sinxronlashadi

### 6.4 Ma'lumotlar bazasi arxitekturasi
- Markazlashtirilgan yagona ma'lumotlar bazasi
- Barcha modullar bir xil ma'lumotlar manbasidan o'qiydi va yozadi
- Real-time sinxronizatsiya barcha modullar orasida
- Indexing muhim maydonlar uchun (SKU, order numbers, customer names)
- Optimallashtirilgan so'rovlar va keshlash
- Audit trail barcha muhim amallar uchun\n- Held Orders jadvali (pending_orders / held_orders)
\n### 6.5 Samaradorlik va optimizatsiya
- Tez yuklash uchun dashboard ma'lumotlarini keshlash
- Og'ir hisobotlarni fonda hisoblash
- 10,000+ yozuvlar bilan ham tez ishlash
- Real-time yangilanishlar minimal kechikish bilan
- Optimallashtirilgan ma'lumotlar bazasi so'rovlari
\n## 7. Tizim nomerlash siyosati
- Chek / Buyurtma: POS-YYYYMMDD-#####
  - Misol: POS-20251205-00042
- Qaytarish: RET-YYYYMMDD-#####
  - Misol: RET-20251205-00023
- Xarid buyurtmasi: PO-YYYYMMDD-#####\n  - Misol: PO-20251206-00015
- Inventarizatsiya: INV-YYYY-#####
- SKU: SKU-000123\n\n## 8. Modullar integratsiyasi va sinxronizatsiya
Mahsulotlar, Kategoriyalar, Inventory Management, Buyurtmalar, Sales Returns, Purchase Orders, Customers, Employees, Reports va Settings modullari quyidagi modullar bilan to'liq integratsiyalangan va real-time sinxronlashtirilgan:\n- POS Terminal
-Ombor (Inventory)
- Xarid buyurtmalari (Purchase Orders)
- Sotuvlar (Sales)\n- Hisobotlar (Reports)
- To'lovlar (Payments)
- Xodimlar (Employees)
- Sozlamalar (Settings)
- Dashboard\n- Kutilayotgan buyurtmalar (Held Orders)

**Sinxronizatsiya qoidalari:**
- Barcha operatsiyalar to'liq sinxronlashtirilgan va audit qilinadigan
- Har qanday o'zgarish (buyurtma, qaytarish,ombor tuzatishi, sozlamalar yangilanishi)darhol barcha bog'liq modullargaaks etadi
- Dashboard ko'rsatkichlari real-time avtomatik yangilanadi
- Hisobotlar hardoim eng yangi ma'lumotlarni ko'rsatadi
- Mijoz va xodim statistikasi avtomatik hisoblanadi
-Ombor qoldiqlari har bir tranzaksiyadan keyin yangilanadi
- Sozlamalar o'zgarishlari darhol tizim xatti-harakatiga ta'sir qiladi
- Kutilayotgan buyurtmalarombor yoki hisobotlarga ta'sir qilmaydi (faqat to'lov yakunlangandan keyin)

## 9. Dizayn uslubi
- Zamonaviy va professional ko'rinish, biznes muhitiga mos\n- Asosiy ranglar: ko'k (#2563EB) va kulrang (#64748B) tonlari, oq fon (#FFFFFF)\n- Karta uslubidagi layout, har bir modul alohida kartada
- Yumshoq soyalar (shadow-sm) va 8px border-radius
- Ikkonlar: Lucide yoki Heroicons kutubxonasidan zamonaviy chiziqli ikkonlar
- Jadvallar: zebra-striped uslubda, hover effekti bilan
- Tugmalar: to'ldirilgan (primary) va konturli (secondary) variantlar, touch screen uchun minimal44px balandlik
- Responsive grid layout: desktopuchun 3-4 ustun, tablet uchun 2ustun\n- Kategoriya rangli teglar va ikkonlar POS Terminal va mahsulotlar ro'yxatida ko'rsatiladi
- Status rangli kodlari:\n  - Completed / Paid / In Stock / Received → Yashil
  - Pending / Low Stock / Approved / Held → Sariq yoki Ko'k
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
- Diagrammalar uchun Recharts kutubxonasi
- Reports sahifalarida professional data visualization
- Employee performance indicatorsuchun rangli ko'rsatkichlar
- Settings sahifasida chap yon panel yoki tablar navigatsiyasi, o'ng qismda formalar
- Barcha modullar bo'ylab izchil dizayn tili

## 10. Yakuniy yetkazish talablari
\nAI quyidagi xususiyatlarga ega POS tizimini yaratishi kerak:
\n✔ To'liq integratsiyalangan\n✔ Real-time sinxronlashtirilgan\n✔ Rol asosida kirish bilan xavfsiz
✔ Barcha biznes qoidalariga mos
✔ Professional darajadagi arxitektura
✔ Ishlab chiqarish uchun tayyor
✔ Markazlashtirilgan ma'lumotlar bazasi
✔ Barcha modullar orasida avtomatik sinxronizatsiya
✔ To'liq audit trail va loglash
✔ Optimallashtirilgan samaradorlik
✔ Izchil UI/UX barcha modullar bo'ylab
✔ Per-Product Discount funksiyasi bilan to'liq POS Terminal
✔ **Hold Order (Buyurtmani kutish ro'yxatiga saqlash) funksiyasi bilan to'liq POS Terminal** - YANGI

 # 2-kassa qo'shish — to'liq professional plan
 
 ## 1) Maqsad va prinsiplar
 
 **Maqsad:** bir vaqtning o'zida 2 ta (keyin 3–4 ta) kassaning konfliktlarsiz, tez va xavfsiz ishlashi.
 
 **Asosiy prinsiplar:**
 - Single source of truth: faqat bitta HOST DB
 - All writes on HOST: CLIENT faqat UI + RPC
 - Stateless CLIENT: DB va business logic yo'q
 - Deterministic stock control: conflict bo'lsa HOST hal qiladi
 
 ---
 
 ## 2) Arxitektura (final holat)
 
 ```
 [KASSA #1] ─┐
             ├── RPC (HTTP/IPC) ──> [HOST SERVER]
 [KASSA #2] ─┘                     ├─ SQLite (WAL)
                                   ├─ Business Logic
                                   └─ Lock / Transaction control
 ```
 
 **HOST:**
 - DB
 - batch/FIFO
 - stock, price, checkout logic
 - concurrency nazorati
 
 **CLIENT (har bir kassa):**
 - UI
 - scanner / keyboard
 - RPC chaqiruvlar
 - lokal state (temporary)
 
 ---
 
 ## 3) 2-kassani ulash (texnik setup)
 
 ### 3.1 CLIENT #2 sozlamasi
 
 CLIENT #2'dan:
 - Mode = CLIENT
 - HOST URL = http://192.168.1.13:PORT
 - CLIENT_SECRET = HOST_SECRET
 - Save → Restart
 - Test connection → OK
 
 **Muhim:** CLIENT'da SQLite yo'q, DB ochilmaydi.
 
 ### 3.2 Identifikatsiya (majburiy)
 
 Har bir kassani aniq ajratish uchun:
 - `register_id` → KASSA_1, KASSA_2
 - `cashier_id` → login qilgan kassir
 
 Bu audit, hisobot va konflikt tahlili uchun muhim.
 
 ---
 
 ## 4) Ishlash ssenariylari (real hayot)
 
 ### 4.1 Qidiruv va qo'shish
 - Kassa 1 va Kassa 2 bir vaqtda qidiradi
 - Search = read-only
 - Lock yo'q
 - WAL sabab parallel read muammo emas
 
 ### 4.2 Checkout (eng muhim joy)
 
 Checkout HOST'da **atomic transaction** bo'ladi:
 1) Transaction boshlanadi
 2) Stock qayta tekshiriladi
 3) Yetarli bo'lsa:
    - inventory_movements yoziladi
    - order yaratiladi
    - stock update
    - commit
 4) Javob CLIENT'ga qaytadi
 
 Agar:
 - Kassa 1 oxirgi mahsulotni sotib yuborgan bo'lsa
 - Kassa 2 checkout qilsa
 
 **HOST error qaytaradi:** `INSUFFICIENT_STOCK` (kutilgan xatti-harakat).
 
 ---
 
 ## 5) Konfliktlarni boshqarish
 
 ### 5.1 Stock konflikt
 
 Holat: 2 kassa bir xil mahsulotni sotmoqda (oxirgi dona).
 
 Yechim:
 - Client-side lock yo'q
 - HOST re-check + transaction
 - Yutqazgan kassa → error + UI message
 
 ### 5.2 UX darajasida (tavsiya)
 
 Aniq error matni:
 - "Mahsulot qoldig'i boshqa kassada sotildi"
 
 Avtomatik:
 - savatchadan olib tashlash
 - yoki quantity = available
 
 ---
 
 ## 6) Performance va barqarorlik
 
 ### 6.1 SQLite + WAL
 
 **Majburiy PRAGMA:**
 - WAL
 - busy_timeout
 - synchronous NORMAL
 - temp_store MEMORY
 - cache_size
 
 Bu setup bilan:
 - 2 kassa → muammosiz
 - 3–4 kassa → hali ham OK
 
 ### 6.2 RPC dizayn qoidasi
 
 Har doim:
 - 1 UI action = 1 RPC
 - Screen API (checkoutScreen, addToCartScreen)
 
 Man etiladi:
 - N+1 so'rov
 - client-side hisob-kitob
 
 ---
 
 ## 7) Audit va hisobot
 
 Har order'da saqlansin:
 - `order_id`
 - `register_id`
 - `cashier_id`
 - `created_at`
 
 Bu qaysi kassada, qaysi vaqtda, kim sotganini aniq ko'rsatadi.
 
 ---
 
 ## 8) Xatolik va fallback ssenariylari (keyingi bosqich)
 
 HOST vaqtincha o'chsa:
 - CLIENT checkout'ni pending sifatida saqlaydi
 - HOST qaytgach → sync
 
 Double-sell bo'lmasligi uchun:
 - offline limit
 - yoki offline mode = read-only
 
 (Hozircha majburiy emas.)
 
 ---
 
 ## 9) Test plan (release oldidan)
 
 ### 9.1 Parallel test
 - Kassa 1 va 2'da bir xil mahsulot
 - bir vaqtda checkout
 
 Kutilgan natija:
 - faqat bittasi muvaffaqiyatli
 
 ### 9.2 Load test (realistik)
 - 30–50 ta ketma-ket checkout
 - 2 kassa parallel
 
 KPI:
 - checkout < 500ms
 - error yo'q
 
 ---
 
 ## 10) Qachon keyingi bosqichga o'tamiz?
 
 PostgreSQL haqida o'ylash kerak, agar:
 - 5+ kassa
 - 50k+ mahsulot
 - filiallararo sinxronizatsiya
 - cloud kerak bo'lsa
 
 Hozircha SQLite + WAL to'liq yetarli.
 
 ---
 
 ## Yakuniy xulosa
 
 - 2-kassa qo'shish uchun arxitektura tayyor
 - Toza, scalable, "hack"siz
 - Production darajada, konfliktlar HOST tomonidan hal qilinadi

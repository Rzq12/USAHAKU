# usahaku versi sederhana: rencana implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mengubah usahaku menjadi aplikasi satu peran dengan layar tombol besar untuk mencatat penjualan, mencatat pengeluaran, dan melihat laporan.

**Architecture:** API dikecilkan lebih dulu dengan tes sebagai pengaman, lalu web menyusul. Tabel lama tetap ada, dan kode data lama dipertahankan hanya untuk pembatalan penjualan, Laba Rugi, Arus Kas, dan Ekspor. Layar baru memakai `useFetch`, `useSubmit`, dan komponen `ui.jsx` yang sudah ada.

**Tech Stack:** React 18, Vite, Tailwind CSS, Vitest, Node.js 20, Express, Zod, PostgreSQL 16, node:test.

**Spec:** `Docs/superpowers/specs/2026-11-04-usahaku-sederhana-design.md`

## Global Constraints

- Teks antarmuka berbahasa Indonesia. Kode, field API, dan komentar berbahasa Inggris.
- Uang adalah integer rupiah.
- Setiap query memfilter `business_id`.
- Penulisan ke beberapa tabel memakai satu transaksi basis data dan menyertakan entri audit.
- Stok hanya berubah lewat stock movement.
- Tidak ada dependensi baru. `recharts` dihapus setelah tidak dipakai.
- Tidak ada tabel atau kolom yang di-drop.
- Tulisan utama 18px, tidak ada tulisan di bawah 16px, dan tombol utama minimal 56px.
- Jangan commit atau push kecuali pemilik proyek memintanya. Langkah "Titik commit" hanya dijalankan kalau sudah diminta.
- Tes tidak boleh dihapus atau dilemahkan supaya lolos. Tes hanya dihapus kalau perilaku yang diujinya memang dihapus oleh spesifikasi.
- Tes API butuh `TEST_DATABASE_URL` yang namanya mengandung `test`. Jangan baca atau ubah `.env` yang berisi nilai asli. Kalau variabel ini tidak tersedia, hentikan pekerjaan dan minta pemilik proyek menyediakannya.
- Jangan menjalankan aplikasi atau migrasi terhadap basis data pengembangan pemilik proyek. Semua pemeriksaan memakai basis data tes.

## Review Focus

- **Tombol Simpan diketuk dua kali:** hanya satu penjualan atau pengeluaran yang tersimpan (Task 7, Task 8, dan pemeriksaan di Task 9).
- **Penjualan bon lama dibuka dari Riwayat Penjualan:** detailnya tampil tanpa tautan yang mati, dan pembatalan ikut membatalkan piutangnya (Task 2, Task 6, dan pemeriksaan di Task 9).
- **Laba hari ini saat ada penjualan batal, transaksi terhapus, atau transaksi dikecualikan:** semuanya tidak dihitung (Task 4).
- **Akun Staff lama dengan sesi yang masih terbuka:** ditolak 401, dan masuk dengan sandinya juga ditolak (Task 3).
- **Transaksi lama yang punya kontak diubah dari Riwayat Transaksi:** tetap bisa disimpan dan kontaknya tidak hilang (Task 2).

---

### Task 1: Hapus API Anggaran, Berulang, Pajak, Impor, dan Log Aktivitas

**Files:**
- Modify: `apps/api/src/routes/finance.js`, `apps/api/src/app.js`, `apps/api/src/jobs/scheduler.js`, `apps/api/src/routes/settings.js`, `apps/api/src/services/business.js`, `apps/api/src/db/business.js`, `apps/api/src/db/audit.js`
- Delete: `apps/api/src/services/{budgets,recurring,tax,imports}.js`, `apps/api/src/db/{budgets,recurring,imports}.js`
- Test: `apps/api/tests/finance.test.js`, `apps/api/tests/units.test.js`, `apps/api/tests/transactions.test.js`, `apps/api/tests/auth.test.js`

**Interfaces:**
- Produces: `PUT /business` hanya menerima `name`, `address`, `phone`, `period_start_day`.
- Produces: `GET /business` tetap membalas kolom pajak yang tersimpan.

- [ ] **Step 1: Tulis tes yang gagal di `finance.test.js`**

```js
test('removed finance routes answer 404', async () => {
  const { owner } = await newBusiness();
  for (const url of ['/budgets/summary', '/recurring', '/tax/estimate?year=2026', '/audit-logs']) {
    assert.equal((await owner.get(url)).status, 404, url);
  }
  assert.equal((await owner.post('/import/commit')).status, 404);
});

test('saving settings keeps stored NPWP and tax values', async () => {
  // Set npwp, tax_threshold, payment_info directly with SQL.
  // PUT /business with name, address, phone, period_start_day only.
  // assert: 200, and the SQL row still holds the same npwp, tax_rate_bp, tax_threshold, payment_info.
});
```

- [ ] **Step 2: Jalankan tes dan pastikan gagal**

Run: `npm test -w apps/api`
Expected: kedua tes baru FAIL. Route masih membalas selain 404, dan `PUT /business` menolak isian yang kurang.

- [ ] **Step 3: Hapus route, service, dan db di daftar Files**

Di `scheduler.js`, hapus `runDueRules` saja. Pembersihan sesi dan log tetap jalan. Hapus `listAuditLogs` dari `db/audit.js`. `writeAudit`, `changedFields`, dan `deleteExpiredAuditLogs` tetap ada.

- [ ] **Step 4: Sempitkan `PUT /business`**

`businessSchema` hanya berisi empat field di atas. `updateBusiness` hanya menulis kolom itu. `updateSettings` tidak lagi menghitung `tax_rate_bp`.

- [ ] **Step 5: Sesuaikan tes yang tersisa**

- Hapus dari `finance.test.js`: AC-016, AC-017, AC-021, AC-022, tes berulang, tes impor, dan `audit log filters`.
- Hapus dari `units.test.js`: tes BR-012, `monthly recurrence`, dan `import parsing`. Hapus `parseCsv` dari `lib/csv.js` kalau tidak ada lagi yang memakainya, dan pertahankan bagian `toCsv` pada tes CSV.
- Hapus `BR-011 settings` dari `auth.test.js`.
- Ubah AC-025 di `transactions.test.js` dan pemeriksaan audit di AC-024 supaya membaca tabel `audit_logs` langsung lewat `pool`. Isi pemeriksaannya tidak berubah.

- [ ] **Step 6: Jalankan tes dan pastikan lolos**

Run: `npm test -w apps/api`
Expected: semua PASS.

- [ ] **Step 7: Titik commit**

`feat(api): remove budgets, recurring, tax, import, and audit log features`

---

### Task 2: Hapus API Hutang-Piutang, Kontak, dan Faktur

**Files:**
- Modify: `apps/api/src/routes/commerce.js`, `apps/api/src/app.js`, `apps/api/src/services/sales.js`, `apps/api/src/services/reports.js`, `apps/api/src/db/reports.js`, `apps/api/src/db/debts.js`, `apps/api/src/db/invoices.js`, `apps/api/src/db/contacts.js`
- Delete: `apps/api/src/services/{contacts,debts,invoices}.js`
- Test: `apps/api/tests/support.js`, `apps/api/tests/sales.test.js`, `apps/api/tests/reports.test.js`, `apps/api/tests/finance.test.js`, `apps/api/tests/transactions.test.js`, `apps/api/tests/units.test.js`, `apps/api/tests/auth.test.js`

**Interfaces:**
- Produces di `tests/support.js`, semuanya menulis langsung lewat `pool`:
  - `insertLegacyContact(business, { name, type = 'both' }) -> contactId`
  - `insertLegacyCreditSale(business, { contactId, total, saleDate, dueDate }) -> { saleId, debtId }`
  - `insertLegacyPayable(business, { contactId, amount, categoryId, issueDate }) -> debtId`
  - `insertLegacyDebtPayment(business, { debtId, amount, accountId, paidOn, sourceType }) -> paymentId`, yang juga menulis baris `transactions` dengan `source_type` `receivable_payment` atau `payable_payment`.
- Produces: `POST /sales` hanya menerima `items`, `discount`, `account_id`, `sale_date`. `account_id` wajib.
- Produces: `GET /sales/:id` tetap membalas `contact_name` dan `debt_id` untuk penjualan lama.

- [ ] **Step 1: Tulis tes yang gagal di `sales.test.js`**

```js
test('a sale is always paid: credit and contact fields are refused', async () => {
  const business = await newBusiness();
  const product = await addProduct(business);
  const items = [{ product_id: product.id, qty: 1, unit_price: 10_000 }];
  const base = { items, account_id: business.kas.id };

  assert.equal((await business.owner.post('/sales', base)).status, 201);
  assert.equal((await business.owner.post('/sales', { ...base, payment_type: 'credit' })).status, 422);
  const contactId = await insertLegacyContact(business, { name: 'Bu Sari' });
  assert.equal((await business.owner.post('/sales', { ...base, contact_id: contactId })).status, 422);
  assert.equal((await business.owner.post('/sales', { items })).status, 422);
});

test('removed commerce routes answer 404', async () => {
  // GET /contacts, /debts, /invoices, and GET /reports/receivable-aging?from=...&to=... are 404.
});

test('editing an old transaction keeps its contact', async () => {
  // Insert a contact with SQL and a manual expense carrying contact_id.
  // PUT /transactions/:id with contact_id and a new note.
  // assert: 200, note changed, contact_id unchanged.
});
```

Sesuaikan kode status 422 dengan cara `parse` di repo kalau galat validasinya memakai kode lain. Pemeriksaannya tetap bahwa permintaan ditolak dan tidak ada penjualan tersimpan.

- [ ] **Step 2: Ubah tes data lama supaya memakai fixture**

Isi pemeriksaannya tidak boleh dilemahkan:

- `sales.test.js`: `BR-005: voiding a credit sale` tetap memeriksa piutang, pembayaran, dan status faktur ikut batal. Faktur dimasukkan lewat SQL. `AC-014` tetap memeriksa pembayaran tidak masuk laba.
- `reports.test.js`: `a payable bill for equipment` dan `receivable payments show apart`.
- `finance.test.js`: `BR-010` dan `AC-019`.

- [ ] **Step 3: Hapus tes perilaku yang dihapus**

- `sales.test.js`: `a credit sale creates a receivable`, AC-012, AC-013, `BR-007`, tes Staff piutang, AC-015, BR-006, dan tes faktur.
- `units.test.js`: `BR-007` dan `receivable aging buckets`.
- `finance.test.js` dan `reports.test.js`: bagian aging saja, dengan pemeriksaan lain dalam tes yang sama tetap dipertahankan.
- `auth.test.js`: sesuaikan tes tenancy supaya memakai resource yang masih ada.

- [ ] **Step 4: Jalankan tes dan pastikan tes baru gagal**

Run: `npm test -w apps/api`
Expected: tiga tes baru dari Step 1 FAIL.

- [ ] **Step 5: Ubah `saleSchema` dan `services/sales.js`**

Pakai `z.object({...}).strict()`, dengan `account_id: uuid`. Hapus `assertPaymentFields`, `requireCustomer`, dan cabang kredit di `createSale`. Simpan penjualan baru dengan `payment_type: 'paid'` dan `contact_id: null`. Hapus `contact_id` dan `payment_status` dari `saleListQuery`.

Pesan `account_id` kosong: `Pilih akun penerima.`

- [ ] **Step 6: Hapus route dan service**

Hapus `contactsRouter`, `debtsRouter`, `invoicesRouter`, dan mount-nya. Hapus laporan `receivable-aging`, `agingBucket`, dan `openReceivables`. `debtSummary` tetap ada sampai Task 4, karena `dashboard.js` masih memakainya.

Pertahankan: `voidSale`, `voidReceivable`, `findDebtBySale`, `listActivePayments`, `markPaymentVoid`, `setDebtPaid`, `setInvoiceStatusBySale`, `getContact`, `softDeleteBySource`, `EXPENSE_LINES`, dan query `db/dataExport.js`. Hapus fungsi lain di `db/debts.js`, `db/invoices.js`, dan `db/contacts.js` yang tidak punya pemakai.

`lib/pdf.js` tetap dipakai laporan. Hapus bagian yang khusus faktur kalau ada.

- [ ] **Step 7: Jalankan tes dan pastikan lolos**

Run: `npm test -w apps/api`
Expected: semua PASS.

- [ ] **Step 8: Titik commit**

`feat(api): remove receivables, payables, contacts, and invoices; sales are always paid`

---

### Task 3: Satu peran dan migrasi akun

**Files:**
- Create: `db/migrations/003_single_role.sql`
- Modify: `apps/api/src/middleware/auth.js`, `apps/api/src/routes/{commerce,finance,settings,transactions,categories,accounts,auth}.js`, `apps/api/src/services/{auth,sales,products,accounts,transactions}.js`, `apps/api/src/db/users.js`, `apps/api/src/app.js`
- Delete: `apps/api/src/services/users.js`
- Test: `apps/api/tests/auth.test.js`, `apps/api/tests/support.js`, `apps/api/tests/sales.test.js`, `apps/api/tests/transactions.test.js`, `apps/api/tests/finance.test.js`, `apps/api/tests/reports.test.js`

**Interfaces:**
- Produces: `/auth/me` dan respons masuk membalas `user: { id, name, email }`, tanpa `role` dan `must_change_password`.
- Produces: `POST /auth/register` tetap menulis `role = 'owner'`.

- [ ] **Step 1: Tulis tes yang gagal di `auth.test.js`**

```js
const migration = readFileSync(new URL('../../../db/migrations/003_single_role.sql', import.meta.url), 'utf8');

test('the single-role migration disables non-Owners and ends their sessions', async () => {
  // Insert a staff user and an accountant with SQL, with sessions, plus the registered Owner.
  await pool.query(migration);
  // assert: staff and accountant is_active = false, their sessions gone.
  // assert: Owner still active, Owner client GET /auth/me is 200.
  // assert: staff and accountant rows still exist with their role and created records intact.
});

test('a disabled old account cannot use an open session or log in', async () => {
  // Log in as a staff user inserted with a real argon2 hash, then run the migration.
  // assert: the open client gets 401 on GET /auth/me.
  // assert: POST /auth/login with the right password is refused.
});

test('the removed users route answers 404', async () => {
  const { owner } = await newBusiness();
  assert.equal((await owner.get('/users')).status, 404);
});
```

- [ ] **Step 2: Jalankan tes dan pastikan gagal**

Run: `npm test -w apps/api`
Expected: FAIL karena file migrasi belum ada.

- [ ] **Step 3: Tulis `003_single_role.sql`**

```sql
DELETE FROM sessions
WHERE user_id IN (SELECT id FROM users WHERE role <> 'owner');

UPDATE users
SET is_active = false, updated_at = now()
WHERE role <> 'owner';
```

Sesuaikan nama kolom sesi kalau berbeda di `001_init.sql`.

- [ ] **Step 4: Hapus peran dari API**

- Hapus `requireRole`, `OWNER`, `STAFF`, `ACCOUNTANT`, dan pemeriksaan `must_change_password` dari `middleware/auth.js`, lalu hapus semua pemakaiannya di route.
- Hapus `usersRouter` dan mount-nya.
- Hapus `STAFF_ROLE`, `staffDashboard`, `itemForRole`, `productForRole`, `forRole`, dan cabang Staff di service. Termasuk batas ubah 24 jam Staff di `services/transactions.js`.
- Respons transaksi selalu menyertakan `account_balance`.

- [ ] **Step 5: Sesuaikan tes**

- Hapus `addUser` dari `support.js`.
- Hapus tes yang hanya menguji peran: `AC-003`, `the last active Owner`, `a temporary password`, `roles:`, `AC-007`, `BR-011`, `Staff list only`, `AC-009`, `Staff see only`, `AC-018`.
- Di `audit:`, pertahankan pemeriksaan login, login gagal, dan rahasia, lalu hapus bagian `role_change`.
- Di `reports validate the range` dan `every report exports a PDF`, hapus hanya bagian Staff dan Akuntan.

- [ ] **Step 6: Jalankan tes dan pastikan lolos**

Run: `npm test -w apps/api`
Expected: semua PASS.

Run: `git grep -nE "requireRole|STAFF_ROLE|ForRole|actor\.role" apps/api/src`
Expected: tidak ada hasil.

- [ ] **Step 7: Titik commit**

`feat(api): reduce to one role and disable non-Owner accounts`

---

### Task 4: Laba hari ini

**Files:**
- Modify: `apps/api/src/services/dashboard.js`, `apps/api/src/routes/finance.js`, `apps/api/src/db/reports.js`
- Test: `apps/api/tests/finance.test.js`

**Interfaces:**
- Produces: `GET /dashboard -> { today: 'YYYY-MM-DD', today_profit: integer, is_empty: boolean }`.
- `is_empty` bernilai `true` kalau hari ini belum ada penjualan aktif dan transaksi yang terhitung.

- [ ] **Step 1: Tulis tes yang gagal di `finance.test.js`**

```js
test('today_profit: sales minus cost, plus other income, minus expenses', async () => {
  // Product sell 10_000, cost 6_000; paid sale qty 2 => revenue 20_000, cost 12_000.
  // Other income 5_000. Expense 3_000.
  // assert: today_profit === 10_000 and is_empty === false.
});

test('today_profit ignores voided sales, deleted and excluded entries, stock purchases, and other days', async () => {
  // Create one sale then void it. Create an expense then delete it. Create an excluded expense.
  // Restock with record_expense true. Create an expense dated yesterday.
  // assert: today_profit === 0.
});

test('today_profit can be negative and a new business is empty', async () => {
  // New business: today_profit === 0 and is_empty === true.
  // Expense 5_000 today: today_profit === -5_000 and is_empty === false.
});
```

Hapus `AC-004` dan `the Owner dashboard carries every card` karena kartu dan periode Beranda dihapus.

- [ ] **Step 2: Jalankan tes dan pastikan gagal**

Run: `npm test -w apps/api`
Expected: tiga tes baru FAIL.

- [ ] **Step 3: Tulis ulang `getDashboard(actor)`**

Pakai `salesTotals`, `otherIncome`, dan `expensesByCategory` dengan `from` dan `to` sama-sama `todayJakarta()`, lalu `sumPeriodFigures` untuk laba. Hapus parameter `period` di route. Hapus `debtSummary`, `dailySeries`, `topProducts`, `lowStockProducts`, dan `salesOnDate` kalau tidak ada pemakai lain.

- [ ] **Step 4: Jalankan tes dan pastikan lolos**

Run: `npm test -w apps/api`
Expected: semua PASS.

Run: `npm run lint`
Expected: lolos.

- [ ] **Step 5: Titik commit**

`feat(api): dashboard returns today's profit`

---

### Task 5: Ukuran tampilan dan layar utama

**Files:**
- Create: `apps/web/src/pages/Home.jsx`
- Delete: `apps/web/src/pages/Dashboard.jsx`, dan `apps/web/src/components/NavyBand.jsx` kalau halaman masuk tidak memakainya
- Modify: `apps/web/tailwind.config.js`, `apps/web/src/index.css`, `apps/web/src/App.jsx`, `apps/web/package.json`, `package-lock.json`

**Interfaces:**
- Consumes: `GET /dashboard` dari Task 4.
- Produces: setelah menyimpan, form memanggil `navigate('/', { replace: true, state: { saved: { message: string, warning?: string } } })`.

- [ ] **Step 1: Ubah token ukuran di `tailwind.config.js`**

`micro`, `caption`, dan `body-sm`: 16px. `body`: 18px. `h5`: 20px. Di `index.css`, `.btn` minimal 48px, `.btn-primary` minimal 56px, dan `.field-input` minimal 52px.

Hapus kelas ukuran tetap di bawah 16px. Run: `git grep -nE "text-\[(9|1[0-5])px\]" apps/web/src`. Expected: tidak ada hasil.

- [ ] **Step 2: Tulis `Home.jsx`**

- Judul `Laba hari ini` dengan angka `rupiah(today_profit)` besar. Saat minus, angkanya memakai warna `danger-deep` dan tetap ditulis lengkap.
- Tiga tautan tombol besar setinggi minimal 72px: **Catat Penjualan** `/penjualan/baru`, **Catat Pengeluaran** `/pengeluaran/baru`, **Laporan** `/laporan`.
- Tautan **Menu lain** ke `/lainnya`.
- `is_empty`: tampilkan `Belum ada catatan hari ini. Mulai dengan mencatat penjualan pertama.`
- Galat: tombol tetap tampil. Tempat angka laba menampilkan `error.message` dan tombol **Coba lagi** yang memanggil `reload`.
- `location.state.saved`: tampilkan kotak konfirmasi `role="status"` berisi pesan dan peringatan. Salin ke state lokal saat mount, lalu bersihkan `location.state` dengan `navigate('.', { replace: true, state: null })` supaya tidak muncul lagi setelah muat ulang.

- [ ] **Step 3: Pasang `Home` di route indeks dan hapus `recharts`**

Run: `git grep -n recharts apps/web/src`
Expected: tidak ada hasil. Lalu jalankan `npm uninstall recharts -w apps/web`.

- [ ] **Step 4: Jalankan pemeriksaan**

Run: `npm test -w apps/web && npm run lint && npm run build`
Expected: semua lolos.

- [ ] **Step 5: Titik commit**

`feat(web): big-button home screen and larger type`

---

### Task 6: Bersihkan web dari fitur dan peran

**Files:**
- Delete: `apps/web/src/pages/{Users,Contacts,Debts,DebtDetail,debtParts,Invoices,Budgets,Recurring,Tax,Import,Audit}.jsx`
- Modify: `apps/web/src/App.jsx`, `apps/web/src/lib/auth.jsx`, `apps/web/src/lib/format.js`, `apps/web/src/components/Layout.jsx`, `apps/web/src/components/TransactionDrawer.jsx`, `apps/web/src/pages/{More,Sales,saleParts,SaleDetail,Settings,Categories,Reports,Accounts,Products,Transactions,DataExport,Guide,Auth,ChangePassword}.jsx`

**Interfaces:**
- Produces di `Layout.jsx`: `NAV_ITEMS` berisi item `{ to, label, icon }` untuk Menu lain, dan `PRIMARY_NAV` untuk navbar desktop.
- Produces: `useAuth` tetap ada. `usePermissions`, `navLabel`, `ROLE_NAMES`, dan `RoleRoute` dihapus.

- [ ] **Step 1: Hapus halaman dan route**

Hapus halaman di daftar Files dan route-nya di `App.jsx`. Hapus `RoleRoute`, cabang `must_change_password`, dan prop `forced` di `ChangePassword.jsx`. Alamat lama jatuh ke `NotFound` yang sudah ada, yang juga diberi tautan **Kembali ke Beranda**.

- [ ] **Step 2: Hapus peran dari halaman yang tersisa**

Anggap setiap `isOwner`, `canRecord`, dan `canSeeFinancials` bernilai benar, serta `isStaff` dan `isAccountant` bernilai salah. Sederhanakan cabangnya, bukan menyisakan konstanta.

- [ ] **Step 3: Ubah `Layout.jsx`**

- Desktop `PRIMARY_NAV`: Beranda `/`, Penjualan `/penjualan/baru`, Pengeluaran `/pengeluaran/baru`, Laporan `/laporan`. Item terakhir adalah tautan **Menu lain** ke `/lainnya`, bukan popover.
- Blok meluncur dan penanda halaman aktif tetap memakai `useGlideBlock` yang sudah ada.
- Hapus tombol Tambah, `AddMenu`, tombol mengambang, `BottomNav`, `MOBILE_TABS`, dan `AddContext`. Menu akun di header diganti dengan nama usaha tanpa peran.
- Di ponsel, setiap halaman selain `/` menampilkan tautan **Kembali ke Beranda** di bawah header.
- Pindahkan `TransactionDrawer` dan tombolnya ke `Transactions.jsx` sebagai state halaman itu. Tombolnya: **Pemasukan lain**, **Transfer**.

- [ ] **Step 4: Ubah `More.jsx`**

Urutan: Riwayat Transaksi, Riwayat Penjualan, Produk, Akun Kas, Kategori, Ekspor Data, Pengaturan, Panduan, Ganti Kata Sandi, Keluar. Hapus baris peran.

- [ ] **Step 5: Sederhanakan halaman**

- **`SaleDetail.jsx`:** hapus `InvoiceDrawer`, tombol faktur, dan tautan tagihan. Penjualan lama tetap menampilkan nama pelanggan dan status bayarnya.
- **`Sales.jsx`:** ganti subjudul menjadi `Semua penjualan.`, dan hapus filter status bayar serta kontak.
- **`Settings.jsx`:** hapus bagian Pajak, NPWP, dan info pembayaran. Hapus isian `period_start_day` kalau `Reports.jsx` tidak memakainya, tetapi kirim nilai tersimpan saat menyimpan.
- **`Categories.jsx`:** hapus `RulesSection` dan `RuleTester`.
- **`Reports.jsx`:** hapus Umur Piutang dan ganti kalimat `Transfer dan pembayaran hutang piutang tidak dihitung sebagai laba.` menjadi `Transfer tidak dihitung sebagai laba.`
- **`Auth.jsx`:** ganti teks `Masuk untuk mencatat penjualan, memantau piutang, dan melihat laba sebenarnya.` menjadi `Masuk untuk mencatat penjualan dan pengeluaran, lalu melihat laba sebenarnya.`
- **`TransactionDrawer.jsx`:** tetap mengirim `contact_id` milik transaksi lama. Sembunyikan Tag di form tambah.
- **`Guide.jsx`:** tulis ulang sesuai alur baru dan buang fitur yang dihapus.

- [ ] **Step 6: Periksa sisa rujukan**

Run: `git grep -nE "usePermissions|navLabel|ROLE_NAMES|RoleRoute|/kontak|/tagihan|/faktur|/anggaran|/berulang|/pajak|/impor|/audit|/pengguna|/contacts|/debts|/invoices" apps/web/src`
Expected: tidak ada hasil.

- [ ] **Step 7: Jalankan pemeriksaan**

Run: `npm test -w apps/web && npm run lint && npm run build`
Expected: semua lolos.

- [ ] **Step 8: Titik commit**

`feat(web): remove retired features and roles from the interface`

---

### Task 7: Catat Penjualan sederhana

**Files:**
- Create: `apps/web/src/lib/simpleForm.js`, `apps/web/src/lib/simpleForm.test.js`
- Modify: `apps/web/src/pages/NewSale.jsx`

**Interfaces:**
- Consumes: `location.state.saved` dari Task 5.
- Produces di `lib/simpleForm.js`:
  - `defaultAccountId(accounts: {items: {id, is_archived}[]} | null) -> string`: id akun aktif pertama, atau `''`.
  - `expenseCategories(categories: {items}[] | null) -> {id, name}[]`: kategori `type === 'expense'` yang tidak diarsipkan dan tidak punya anak.

- [ ] **Step 1: Tulis tes yang gagal di `simpleForm.test.js`**

```js
test('defaultAccountId picks the first active account', () => {
  const items = [{ id: 'a', is_archived: true }, { id: 'b', is_archived: false }];
  expect(defaultAccountId({ items })).toBe('b');
  expect(defaultAccountId({ items: [] })).toBe('');
  expect(defaultAccountId(null)).toBe('');
});

test('expenseCategories keeps active expense categories without children', () => {
  const items = [
    { id: 'p', name: 'Induk', type: 'expense', parent_id: null, is_archived: false },
    { id: 'c', name: 'Anak', type: 'expense', parent_id: 'p', is_archived: false },
    { id: 'x', name: 'Arsip', type: 'expense', parent_id: null, is_archived: true },
    { id: 'i', name: 'Masuk', type: 'income', parent_id: null, is_archived: false },
  ];
  expect(expenseCategories({ items }).map((c) => c.id)).toEqual(['c']);
});
```

- [ ] **Step 2: Jalankan tes dan pastikan gagal**

Run: `npm test -w apps/web`
Expected: FAIL karena modul belum ada.

- [ ] **Step 3: Implementasikan `lib/simpleForm.js`, lalu jalankan tes**

Run: `npm test -w apps/web`
Expected: PASS.

- [ ] **Step 4: Sederhanakan `NewSale.jsx`**

- Hapus `NewCustomerDrawer`, `PAYMENT_OPTIONS`, `PillTabs`, pilihan pelanggan, dan jatuh tempo.
- Kartu barang minimal setinggi 88px. Placeholder pencarian: `Cari nama barang`.
- Label tetap: **Simpan** untuk tombol utama dan **Pilihan lain** untuk bagian tertutup. Pakai `<details>` berisi tanggal, diskon, dan akun.
- Kirim `{ items, discount, account_id, sale_date }`.
- Setelah tersimpan, navigasi sesuai Interfaces Task 5 dengan pesan `Penjualan tersimpan.`, dan `warning` diisi `stock_warnings.join(' ')` kalau ada.
- Tombol **Batal** kembali ke `/`.
- Kalau `defaultAccountId` kosong dan akun selesai dimuat: tampilkan `Belum ada akun kas. Buat dulu di Menu lain, Akun Kas.` dengan tautan ke `/akun`, dan nonaktifkan **Simpan**.
- **Simpan** nonaktif selama `pending` atau belum ada barang.

- [ ] **Step 5: Jalankan pemeriksaan**

Run: `npm test -w apps/web && npm run lint && npm run build`
Expected: semua lolos.

- [ ] **Step 6: Titik commit**

`feat(web): simple sale form`

---

### Task 8: Catat Pengeluaran

**Files:**
- Create: `apps/web/src/pages/NewExpense.jsx`
- Modify: `apps/web/src/App.jsx`

**Interfaces:**
- Consumes: `defaultAccountId` dan `expenseCategories` dari Task 7, `location.state.saved` dari Task 5, serta `compressReceipt` dari `lib/image.js`.

- [ ] **Step 1: Tulis `NewExpense.jsx` dan route `/pengeluaran/baru`**

- Label: `Berapa uangnya?`, `Untuk apa?`, **Simpan**, **Batal**, **Pilihan lain**.
- `MoneyField large autoFocus` untuk nominal.
- Kategori sebagai tombol besar dengan `aria-pressed`. Galat kategori memakai `fieldErrors.category_id`.
- `<details>` **Pilihan lain** berisi tanggal, akun, catatan, dan foto struk. Tidak ada isian Tag.
- `POST /transactions` dengan `{ type: 'expense', amount, occurred_on, account_id, category_id, contact_id: null, transfer_account_id: null, note, tags: [] }`.
- Kalau foto gagal diunggah, transaksi tetap tersimpan. Navigasi ke `/` dengan `warning` berisi `Foto gagal diunggah. Pengeluaran tetap tersimpan.`
- Setelah tersimpan, navigasi ke `/` dengan pesan `Pengeluaran tersimpan.`
- Kalau gagal menyimpan, isian tidak hilang.
- Keadaan tanpa akun sama dengan Task 7.
- Kalau tidak ada kategori: tampilkan `Belum ada kategori pengeluaran. Buat dulu di Menu lain, Kategori.` dengan tautan ke `/kategori`.
- **Simpan** nonaktif selama `pending`, atau saat nominal atau kategori belum diisi.

- [ ] **Step 2: Jalankan pemeriksaan**

Run: `npm test -w apps/web && npm run lint && npm run build`
Expected: semua lolos.

- [ ] **Step 3: Titik commit**

`feat(web): one-screen expense form`

---

### Task 9: Dokumen dan pemeriksaan akhir

**Files:**
- Modify: `PRODUCT.md`, `DESIGN.md`, `README.md`, `Docs/CLAUDE.md`, `Docs/PRD.md`, `Docs/FRD.md`, `Docs/SRS.md`

- [ ] **Step 1: Perbarui dokumen**

- **`PRODUCT.md`:** satu pengguna, yaitu pemilik usaha yang lebih tua dan kurang paham teknologi. Hapus Staff, Akuntan, dan aturan yang menyebut Staff.
- **`DESIGN.md`:** ukuran tulisan dan tombol baru, layar tombol besar, navbar baru, serta tidak ada tab bawah.
- **`Docs/CLAUDE.md`:** hapus penyebutan tiga peran, BR-011, dan aturan tarif pajak. Perbarui deskripsi proyek dan peran scheduler.
- **`README.md`:** deskripsi fitur dan catatan bahwa `npm run migrate` menonaktifkan akun non-Pemilik.
- **PRD, FRD, SRS:** tambahkan satu catatan di awal: `Versi sederhana berbeda dari dokumen ini. Lihat Docs/superpowers/specs/2026-11-04-usahaku-sederhana-design.md.`

- [ ] **Step 2: Jalankan semua pemeriksaan**

Run: `npm test && npm run lint && npm run build`
Expected: semua lolos. Laporkan hasilnya apa adanya.

- [ ] **Step 3: Jalankan aplikasi terhadap basis data tes**

Pakai `TEST_DATABASE_URL` sebagai `DATABASE_URL` untuk API, dan buat akun uji lewat halaman daftar. Jangan memakai basis data pengembangan.

- [ ] **Step 4: Periksa di browser pada lebar 375px dan 1280px**

Dengan Playwright, pastikan:

- Daftar, buat produk, catat penjualan, catat pengeluaran, buka Laporan, buka Menu lain, lalu keluar.
- Layar utama menampilkan konfirmasi setelah menyimpan, dan konfirmasi hilang setelah dimuat ulang.
- Mengetuk **Simpan** dua kali dengan cepat hanya mengirim satu `POST /sales`, dan satu `POST /transactions` di form pengeluaran. Hitung lewat `page.on('request')`.
- Laba hari ini sesuai hitungan dari data uji.
- `/tagihan` menampilkan halaman tidak ditemukan dengan tautan ke Beranda.
- Penjualan bon lama yang dimasukkan lewat SQL bisa dibuka dari Riwayat Penjualan dan dibatalkan.
- `getComputedStyle` pada semua elemen teks: tidak ada `font-size` di bawah 16px.
- Tidak ada scroll horizontal di 375px. Navbar desktop tidak bertabrakan di 1024px.
- Seluruh alur bisa dijalankan dengan keyboard.
- Konsol tidak menampilkan galat.

- [ ] **Step 5: Titik commit**

`docs: describe the simplified single-role app`

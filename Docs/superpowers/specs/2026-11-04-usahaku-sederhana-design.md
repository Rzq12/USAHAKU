# usahaku versi sederhana: spesifikasi

Tanggal: 4 November 2026. Status: menunggu tinjauan pemilik proyek.

## 1. Tujuan

Pengguna usahaku adalah orang tua yang kurang paham teknologi. Aplikasi disederhanakan menjadi satu peran dan tiga tugas utama.

**Ukuran berhasil:** orang yang baru pertama memakai bisa mencatat penjualan atau pengeluaran tanpa dibantu dan tanpa mencari menu.

## 2. Keputusan pemilik proyek

| Topik | Keputusan |
|---|---|
| Peran | Hanya Pemilik. Staff dan Akuntan dihapus. |
| Layar utama | Laba hari ini dan tombol besar. |
| Dihapus | Anggaran, Transaksi Berulang, Impor, Log Aktivitas, Faktur, Perkiraan Pajak, Hutang dan Piutang, Kontak, Pengguna. |
| Tetap ada | Beranda, Penjualan, Pengeluaran, Riwayat Transaksi, Produk, Laporan, Akun Kas, Kategori, Ekspor, Pengaturan, Panduan. |

**Konsekuensi yang sudah diterima:**

- Siapa pun yang memakai akun Pemilik bisa melihat laba dan modal.
- Penjualan bon tidak bisa dicatat. Semua penjualan dianggap lunas saat disimpan.
- Hutang ke pemasok tidak dicatat lagi.

## 3. Prinsip data

Fitur dihapus, data lama tetap ada.

- Tidak ada tabel atau kolom yang di-drop.
- Angka laba periode lama tidak boleh berubah.
- Data kontak dan hutang-piutang lama tetap bisa diambil lewat Ekspor.

## 4. Alur pengguna

### 4.1 Layar utama (`/`)

- Menampilkan **Laba hari ini** dan 3 tombol besar: **Catat Penjualan**, **Catat Pengeluaran**, **Laporan**.
- Di bawahnya ada tautan **Menu lain**.
- Grafik dan kartu angka Beranda lama dihapus.
- Laba hari ini boleh minus dan ditampilkan apa adanya.
- Kalau data gagal dimuat, tombol tetap tampil dan bisa dipakai. Tempat angka laba menampilkan alasan dan tombol coba lagi.
- Kalau belum ada catatan hari ini, angka laba tampil `Rp0` dengan ajakan mencatat penjualan pertama.

### 4.2 Navigasi

- **Ponsel:** tab bawah dan tombol tambah mengambang dihapus. Setiap halaman selain layar utama punya tombol **Kembali ke Beranda**.
- **Desktop:** navbar berisi Beranda, Penjualan, Pengeluaran, Laporan, dan Menu lain, dengan blok meluncur yang sudah dibuat. Tombol Tambah di header dihapus.
- **Pengeluaran** di navbar membuka form Catat Pengeluaran.
- **Penjualan** di navbar membuka Catat Penjualan. Riwayat Penjualan ada di Menu lain.

### 4.3 Catat Penjualan (`/penjualan/baru`)

1. Ketuk barang pada kartu besar.
2. Atur jumlah dengan tombol **−** dan **+**. Total tampil besar.
3. Ketuk **Simpan**.
4. Muncul konfirmasi besar, lalu kembali ke layar utama.

- Tanggal otomatis hari ini dan uang masuk ke akun kas pertama yang aktif.
- **Pilihan lain** yang tertutup berisi tanggal, diskon, dan akun.
- Baris "Barang atau jasa lain" tetap ada untuk barang yang belum terdaftar.
- Pilihan cara bayar, pelanggan, dan jatuh tempo dihapus.
- Peringatan stok kurang tetap tampil.
- Kalau gagal menyimpan, isian tidak hilang dan pesan menjelaskan langkah berikutnya.
- Kalau belum ada akun aktif, form memberi tahu cara membuat akun dan tombol Simpan dinonaktifkan.

### 4.4 Catat Pengeluaran (`/pengeluaran/baru`)

1. Isi **Berapa uangnya?**
2. Ketuk kategori pada tombol besar di bawah **Untuk apa?**
3. Ketuk **Simpan**.
4. Muncul konfirmasi besar, lalu kembali ke layar utama.

- Tanggal otomatis hari ini dan akun otomatis akun kas pertama yang aktif.
- **Pilihan lain** yang tertutup berisi tanggal, akun, catatan, dan foto struk.
- Isian Tag dan saran kategori dari catatan dihapus dari form.
- Form ini hanya untuk pengeluaran. Pemasukan lain dan Transfer dicatat dari Riwayat Transaksi.
- Kalau gagal menyimpan, isian tidak hilang dan pesan menjelaskan langkah berikutnya.

### 4.5 Menu lain (`/lainnya`)

Satu daftar di ponsel dan desktop: Riwayat Transaksi, Riwayat Penjualan, Produk, Akun Kas, Kategori, Ekspor Data, Pengaturan, Panduan, Ganti Kata Sandi, Keluar.

### 4.6 Halaman lain

- **Detail penjualan:** tombol faktur dan tautan tagihan dihapus. Tombol batalkan tetap ada dengan konfirmasi.
- **Pengaturan:** bagian Pajak dan isian khusus faktur dihapus.
- **Kategori:** tampilan aturan kategori otomatis disembunyikan.
- **Laporan:** Umur Piutang dihapus. Laba Rugi, Arus Kas, Penjualan per Produk, dan Pengeluaran per Kategori tetap ada.
- **Masuk dan daftar:** kalimat yang menyebut piutang diganti.
- **Teks:** bahasa sehari-hari dipakai di form yang tersisa.

### 4.7 Tampilan

- Tulisan utama 18px dan tidak ada tulisan di bawah 16px.
- Tombol utama minimal 56px tingginya.
- Sebelum menghapus atau membatalkan sesuatu selalu ada pertanyaan konfirmasi.

## 5. Perubahan teknis

### 5.1 Peran

- Hapus `requireRole`, konstanta peran, dan pemeriksaan peran di semua route dan service.
- Hapus penyaringan data khusus Staff, termasuk `staffDashboard` dan `itemForRole`.
- Hapus `usePermissions`, `RoleRoute`, `ROLE_NAMES`, dan pengisian menu per peran di web.
- Hapus paksaan ganti kata sandi sementara di API dan web. Halaman Ganti Kata Sandi biasa tetap ada.
- Pendaftaran tetap membuat pengguna dengan `role = 'owner'`.

### 5.2 Migrasi `003`

- Set `is_active = false` untuk semua pengguna dengan `role <> 'owner'`.
- Hapus sesi pengguna tersebut.
- Kolom `role`, kolom `must_change_password`, dan semua tabel tetap ada.
- Akun bisa diaktifkan lagi dengan mengubah `is_active` menjadi `true`. Akun yang diaktifkan lagi mendapat akses penuh, karena pemeriksaan peran sudah tidak ada.

### 5.3 API yang dihapus

`/users`, `/contacts`, `/debts`, `/invoices`, `/budgets`, `/recurring`, `/tax`, `/import`, `/audit-logs`, serta route, service, dan fungsi basis data yang hanya dipakai oleh mereka.

### 5.4 API yang dipertahankan khusus untuk data lama

- `voidSale` tetap membatalkan piutang, pembayaran, dan status faktur dari penjualan lama.
- Fungsi `db/debts.js` dan `db/invoices.js` yang dibutuhkan pembatalan tersebut tetap ada.
- Query `EXPENSE_LINES` tetap membaca hutang lama, dan `salesTotals` tetap menghitung penjualan bon lama.
- Baris "Pelunasan piutang" lama tetap muncul di Arus Kas.
- Ekspor tetap menyertakan kontak dan hutang-piutang lama.
- `writeAudit` tetap merekam aktivitas. API aturan kategori tetap ada.

### 5.5 API yang berubah

- `POST /sales` hanya menerima penjualan lunas. Isian `payment_type: 'credit'` atau `contact_id` ditolak dengan galat validasi.
- `GET /dashboard` diganti menjadi `{ today, today_profit, is_empty }`.
- `today_profit` memakai rumus Laba Rugi yang sudah ada, dengan periode hari ini saja: pendapatan penjualan − modal barang terjual + pemasukan lain − pengeluaran. Pembelian stok tidak mengurangi angka ini.
- Laporan `receivable-aging` dihapus, begitu juga `debtSummary` dan `openReceivables`.
- Jadwal harian menghapus `runDueRules`, tetapi tetap membersihkan sesi dan log yang kedaluwarsa. Aturan berulang yang sudah ada berhenti berjalan.

### 5.6 Web

- **Halaman yang dihapus:** Users, Contacts, Debts, DebtDetail, debtParts, Invoices, Budgets, Recurring, Tax, Import, Audit, dan route-nya.
- **Halaman baru:** `Home.jsx` menggantikan `Dashboard.jsx`, dan halaman Catat Pengeluaran baru.
- **Disederhanakan:** `NewSale.jsx`, `SaleDetail.jsx`, `Settings.jsx`, `Categories.jsx`, `Reports.jsx`, `More.jsx`, `Guide.jsx`, `Layout.jsx`, `Auth.jsx`.
- `TransactionDrawer` tetap dipakai dari Riwayat Transaksi untuk pemasukan, transfer, dan perubahan transaksi.
- Alamat lama yang fiturnya dihapus menampilkan halaman "tidak ditemukan" yang sudah ada.
- `recharts` dihapus dari dependensi kalau tidak ada lagi yang memakainya.

### 5.7 Dokumen

- Perbarui `PRODUCT.md`, `DESIGN.md`, `Docs/CLAUDE.md`, Panduan, dan README. Di `Docs/CLAUDE.md`, hapus penyebutan tiga peran, aturan BR-011, dan aturan tarif pajak.
- Beri catatan di awal PRD, FRD, dan SRS bahwa versi sederhana berbeda dan mengacu ke spesifikasi ini.

## 6. Pengujian

**Tes API:**

- Hapus tes fitur yang dihapus dan sesuaikan tes yang tersisa.
- Penjualan kredit dan `contact_id` ditolak.
- Penjualan bon lama yang dimasukkan langsung ke basis data tetap bisa dibatalkan, dan piutangnya ikut batal.
- Migrasi menonaktifkan akun non-Pemilik, menghapus sesinya, dan tidak mengubah akun Pemilik.
- `today_profit` benar untuk penjualan, pengeluaran, pemasukan lain, dan pembelian stok.
- Laba Rugi periode lama tetap menghitung penjualan bon dan hutang lama.
- Route yang dihapus membalas 404.

**Pemeriksaan lain:**

- `npm test`, `npm run lint`, dan `npm run build` lolos.
- Di browser pada lebar 375px dan 1280px: masuk, catat penjualan, catat pengeluaran, buka Laporan, buka Menu lain, dan keluar.
- Navigasi keyboard dan ukuran tulisan minimum diperiksa.

## 7. Di luar cakupan

- Mendukung lebih dari satu akun per usaha.
- Fitur lupa kata sandi.
- Menghapus tabel lama dari basis data.
- Memindahkan data lama yang belum lunas ke tempat lain.

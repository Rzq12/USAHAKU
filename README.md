# usahaku

Pembukuan sederhana untuk UMKM Indonesia: penjualan, pengeluaran, stok, dan laporan laba rugi. Satu peran: Pemilik.

Dokumen acuan ada di `Docs/`: PRD, FRD, SRS, dan arah visual `notion-DESIGN.md`. Versi sederhana yang sekarang berjalan dijelaskan di `Docs/superpowers/specs/2026-11-04-usahaku-sederhana-design.md`. Keputusan desain yang sudah terpasang dicatat di `DESIGN.md`.

`npm run migrate` menonaktifkan akun Staf dan Akuntan lama. Barisnya tetap tersimpan, tetapi akun itu tidak bisa masuk lagi. Data kontak, hutang, piutang, dan faktur lama tetap ada di basis data dan bisa diambil lewat Ekspor Data.

## Menjalankan untuk pengembangan

Butuh Node.js 20.6 atau lebih baru dan Docker.

```bash
cp .env.example .env
```

Isi `.env`, misalnya:

```
API_PORT=3000
DATABASE_URL=postgres://usahaku:usahaku_dev@127.0.0.1:55432/usahaku
TEST_DATABASE_URL=postgres://usahaku:usahaku_dev@127.0.0.1:55432/usahaku_test
UPLOAD_DIR=./uploads
```

```bash
docker compose -p usahaku -f docker-compose.dev.yml up -d
```

```bash
npm install
```

```bash
npm run migrate
```

```bash
npm run dev
```

Web di http://localhost:5173, API di port 3000. Buka `/daftar` untuk membuat usaha pertama.

## Perintah

| Perintah | Fungsi |
|---|---|
| `npm run dev` | API dan web |
| `npm run migrate` | Terapkan migrasi SQL di `db/migrations` |
| `npm test` | `node:test` untuk API (butuh database tes) dan Vitest untuk web |
| `npm run lint` | ESLint dan Prettier |
| `npm run build` | Build produksi web |

## Produksi

Isi `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, dan `DOMAIN` di `.env` pada VPS, lalu:

```bash
docker compose up -d --build
```

Migrasi berjalan otomatis saat container API mulai. Jalankan hanya satu instance API karena scheduler ada di dalam proses API. Jadwalkan `scripts/backup.sh` setiap hari untuk cadangan database dan foto struk.

import { useState } from 'react';
import { downloadFile, query } from '../lib/api.js';
import { Page } from '../components/Layout.jsx';
import { useToast } from '../components/Toast.jsx';
import { FormError, PageHeader, TextField } from '../components/ui.jsx';

const ENTITIES = [
  'Transaksi',
  'Akun',
  'Kategori',
  'Produk',
  'Riwayat stok',
  'Penjualan',
  'Rincian penjualan',
  'Kontak',
  'Hutang dan piutang',
  'Pembayaran',
  'Faktur',
];

export default function DataExport() {
  const toast = useToast();
  const [range, setRange] = useState({ from: '', to: '' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function run() {
    setPending(true);
    setError(null);
    try {
      await downloadFile(`/export/data${query(range)}`);
      toast.show('Ekspor selesai.');
    } catch (failure) {
      setError(failure.message);
    } finally {
      setPending(false);
    }
  }

  return (
    <Page narrow>
      <PageHeader
        title="Ekspor Data"
        description="Unduh semua data usaha sebagai ZIP berisi file CSV UTF-8. Foto struk tidak ikut."
      />
      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <TextField
          label="Dari tanggal (boleh kosong)"
          type="date"
          value={range.from}
          onChange={(e) => setRange({ ...range, from: e.target.value })}
        />
        <TextField
          label="Sampai tanggal (boleh kosong)"
          type="date"
          value={range.to}
          onChange={(e) => setRange({ ...range, to: e.target.value })}
        />
      </div>
      <p className="mt-2 text-caption text-slate">
        Rentang hanya membatasi transaksi, penjualan, hutang piutang, dan faktur. Data dasar selalu
        lengkap.
      </p>
      <FormError message={error} />
      <button type="button" className="btn-primary mt-4" disabled={pending} onClick={run}>
        {pending ? 'Menyiapkan file...' : 'Ekspor semua data'}
      </button>
      <h2 className="mt-8 text-body-sm font-semibold">Isi file</h2>
      <ul className="mt-2 flex flex-wrap gap-2">
        {ENTITIES.map((entity) => (
          <li key={entity} className="rounded-sm bg-tint-gray px-2 py-1 text-caption text-charcoal">
            {entity}
          </li>
        ))}
      </ul>
    </Page>
  );
}

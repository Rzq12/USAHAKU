import { Link } from 'react-router-dom';
import { Page } from '../components/Layout.jsx';
import { PageHeader } from '../components/ui.jsx';

const GUIDES = [
  {
    tone: 'bg-tint-mint',
    title: 'Catat penjualan',
    to: '/penjualan/baru',
    link: 'Catat penjualan',
    steps: [
      'Ketuk barang yang terjual.',
      'Atur jumlahnya dengan tombol tambah dan kurang.',
      'Ketuk Simpan. Stok berkurang dan uang masuk tercatat sendiri.',
    ],
  },
  {
    tone: 'bg-tint-peach',
    title: 'Catat pengeluaran',
    to: '/pengeluaran/baru',
    link: 'Catat pengeluaran',
    steps: ['Isi berapa uang yang keluar.', 'Ketuk untuk apa uang itu dipakai.', 'Ketuk Simpan.'],
  },
  {
    tone: 'bg-tint-lavender',
    title: 'Membaca laba',
    to: '/laporan',
    link: 'Buka laporan',
    steps: [
      'Pendapatan dihitung dari penjualan pada tanggal penjualan.',
      'Laba kotor adalah pendapatan dikurangi harga modal barang yang terjual.',
      'Laba bersih adalah laba kotor dikurangi beban, ditambah pendapatan lain.',
      'Transfer dan pembelian stok bukan laba atau beban.',
      'Modal, pinjaman, dan pembelian peralatan hanya tampil di arus kas, bukan di laba rugi.',
    ],
  },
];

export default function Guide() {
  return (
    <Page narrow>
      <PageHeader title="Panduan" description="Tiga hal yang paling sering dibutuhkan." />
      <div className="space-y-4">
        {GUIDES.map((guide) => (
          <section
            key={guide.title}
            className={`rounded-lg p-5 text-charcoal sm:p-6 ${guide.tone}`}
          >
            <h2 className="text-h5 text-ink">{guide.title}</h2>
            <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-body-sm">
              {guide.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <Link to={guide.to} className="btn-secondary mt-4 border-charcoal bg-transparent">
              {guide.link}
            </Link>
          </section>
        ))}
      </div>
    </Page>
  );
}

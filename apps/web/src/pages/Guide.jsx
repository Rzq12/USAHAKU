import { Link } from 'react-router-dom';
import { Page } from '../components/Layout.jsx';
import { PageHeader } from '../components/ui.jsx';

const GUIDES = [
  {
    tone: 'bg-tint-mint',
    title: 'Catat penjualan pertama',
    to: '/penjualan/baru',
    link: 'Catat penjualan',
    steps: [
      'Pilih barang dari daftar produk, atau tambah baris bebas untuk jasa.',
      'Atur jumlah dan harga jika perlu.',
      'Pilih Lunas dan akun penerima, atau Kredit dengan pelanggan dan jatuh tempo.',
      'Simpan. Stok berkurang dan uang masuk atau piutang tercatat sendiri.',
    ],
  },
  {
    tone: 'bg-tint-sky',
    title: 'Buat faktur pertama',
    to: '/penjualan',
    link: 'Buka penjualan',
    steps: [
      'Isi alamat usaha di Pengaturan Usaha lebih dulu.',
      'Buka penjualan yang ingin ditagih, lalu pilih Buat faktur.',
      'Periksa tanggal dan jatuh tempo, lalu simpan.',
      'Unduh PDF dan kirim ke pelanggan, atau cetak dari penampil PDF.',
    ],
  },
  {
    tone: 'bg-tint-lavender',
    title: 'Membaca laba',
    to: '/laporan',
    link: 'Buka laporan',
    financial: true,
    steps: [
      'Pendapatan dihitung dari penjualan pada tanggal penjualan, lunas maupun kredit.',
      'Laba kotor adalah pendapatan dikurangi harga modal barang yang terjual.',
      'Laba bersih adalah laba kotor dikurangi beban, ditambah pendapatan lain.',
      'Transfer, pembayaran piutang atau hutang, dan pembelian stok bukan laba atau beban.',
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

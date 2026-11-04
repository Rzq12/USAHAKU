const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
export const MONTH_NAMES = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

export function rupiah(amount) {
  const value = Number(amount ?? 0);
  const digits = String(Math.abs(value)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${value < 0 ? '-' : ''}Rp${digits}`;
}

export function groupDigits(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function parseDigits(text) {
  const digits = String(text).replace(/[^\d]/g, '');
  return digits === '' ? null : Number(digits);
}

export function formatDate(dateString) {
  if (!dateString) return '';
  const [year, month, day] = String(dateString).slice(0, 10).split('-');
  return `${day} ${MONTHS[Number(month) - 1]} ${year}`;
}

export function formatDateTime(timestamp) {
  const date = new Date(timestamp);
  const local = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  const time = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
  return `${formatDate(local)}, ${time}`;
}

export function shortDay(dateString) {
  const [, month, day] = dateString.split('-');
  return `${Number(day)} ${MONTHS[Number(month) - 1]}`;
}

export function formatQty(qty) {
  return String(Number(qty ?? 0)).replace('.', ',');
}

export function todayJakarta(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(now);
}

function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

/** BR-009: the reporting period containing a date. Offset -1 is the previous period. */
export function periodFor(dateString, startDay, offset = 0) {
  const [year, month, day] = dateString.split('-').map(Number);
  const startMonth = (day >= startDay ? month - 1 : month - 2) + offset;
  return {
    from: toDateString(new Date(Date.UTC(year, startMonth, startDay))),
    to: toDateString(new Date(Date.UTC(year, startMonth + 1, startDay - 1))),
  };
}

export const ACCOUNT_TYPES = { cash: 'Tunai', bank: 'Bank', ewallet: 'Dompet digital' };
export const ROLE_NAMES = { owner: 'Pemilik', staff: 'Staf', accountant: 'Akuntan' };
export const TRANSACTION_TYPES = {
  income: 'Pemasukan',
  expense: 'Pengeluaran',
  transfer: 'Transfer',
};
export const CONTACT_TYPES = {
  customer: 'Pelanggan',
  supplier: 'Pemasok',
  both: 'Pelanggan dan pemasok',
};
export const PL_GROUPS = {
  operating_expense: 'Beban operasional',
  other_expense: 'Beban lain',
  inventory: 'Pembelian stok (bukan beban)',
};
export const FREQUENCIES = { daily: 'Harian', weekly: 'Mingguan', monthly: 'Bulanan' };
export const SOURCE_TYPES = {
  manual: 'Dicatat manual',
  sale: 'Dari penjualan',
  receivable_payment: 'Pembayaran piutang',
  payable_payment: 'Pembayaran hutang',
  recurring: 'Transaksi berulang',
  import: 'Hasil impor',
  restock: 'Stok masuk',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

const MONTHS_LONG = [
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

/** 2026-11-04 becomes 4 November 2026, for formal report headings. */
export function formatDateLong(dateString) {
  const [year, month, day] = dateString.split('-');
  return `${Number(day)} ${MONTHS_LONG[Number(month) - 1]} ${year}`;
}

/** The print moment in Asia/Jakarta, like 04 Nov 2026, 14.50 WIB. */
export function formatPrintedAt(now) {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(now);
  const time = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
  return `${formatDateId(date)}, ${time} WIB`;
}

/** 2026-11-04 becomes 04 Nov 2026. */
export function formatDateId(dateString) {
  const [year, month, day] = dateString.split('-');
  return `${day} ${MONTHS[Number(month) - 1]} ${year}`;
}

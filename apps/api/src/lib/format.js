const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** 2026-11-04 becomes 04 Nov 2026. */
export function formatDateId(dateString) {
  const [year, month, day] = dateString.split('-');
  return `${day} ${MONTHS[Number(month) - 1]} ${year}`;
}

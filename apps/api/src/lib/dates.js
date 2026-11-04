const MS_PER_DAY = 86_400_000;

export function todayJakarta(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(now);
}

function toUtc(dateString) {
  return new Date(`${dateString}T00:00:00Z`);
}

function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

export function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = toUtc(value);
  return !Number.isNaN(parsed.getTime()) && toDateString(parsed) === value;
}

export function addDays(dateString, days) {
  return toDateString(new Date(toUtc(dateString).getTime() + days * MS_PER_DAY));
}

export function daysBetween(fromDate, toDate) {
  return Math.round((toUtc(toDate).getTime() - toUtc(fromDate).getTime()) / MS_PER_DAY);
}

function lastDayOfMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** Adds whole months and clamps to the last day of shorter months (31 Jan + 1 = 28 Feb). */
export function addMonthsClamped(dateString, months) {
  const [year, month, day] = dateString.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = lastDayOfMonth(target.getUTCFullYear(), target.getUTCMonth());
  target.setUTCDate(Math.min(day, lastDay));
  return toDateString(target);
}

export function monthsBetween(fromDate, toDate) {
  const [fromYear, fromMonth] = fromDate.split('-').map(Number);
  const [toYear, toMonth] = toDate.split('-').map(Number);
  return (toYear - fromYear) * 12 + (toMonth - fromMonth);
}

/** BR-009: the reporting period containing a date, given the business period start day. */
export function periodContaining(dateString, startDay) {
  const [year, month, day] = dateString.split('-').map(Number);
  const startMonthIndex = day >= startDay ? month - 1 : month - 2;
  const from = toDateString(new Date(Date.UTC(year, startMonthIndex, startDay)));
  const to = addDays(toDateString(new Date(Date.UTC(year, startMonthIndex + 1, startDay))), -1);
  return { from, to };
}

export function previousPeriod(period, startDay) {
  return periodContaining(addDays(period.from, -1), startDay);
}

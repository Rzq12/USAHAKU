import { addDays } from './dates.js';

/*
 * Straight-line depreciation and amortization, the way the Zahir class workbook does it
 * (sheet Daftar-daftar). One share per month, recognized on the last day of each month from
 * the month of acquisition, like a month-end adjusting entry.
 *
 * - Before the opening date the amount sits in the opening balance: cost × months / life,
 *   rounded once (column "Akumulasi Penyusutan 3 bulan").
 * - From the opening date on, every month adds the same rounded share, cost / life
 *   (column "Amortisasi /bulan"), which is what the monthly adjusting entry posts.
 * - The last month of the useful life takes whatever rounding left, so the total is cost.
 * Without an opening date, the fixed share runs from the acquisition month.
 */

const monthIndex = (date) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
const isMonthEnd = (date) => addDays(date, 1).slice(8, 10) === '01';
/** Half-up rounding of a / b for non-negative integers, exact for large amounts. */
const roundedRatio = (a, b) => Math.floor((2 * a + b) / (2 * b));

/** Month ends from the acquisition month through `asOf`, capped at the useful life. */
export function monthsRecognized(asset, asOf) {
  if (asOf < asset.acquired_on) return 0;
  const months = monthIndex(asOf) - monthIndex(asset.acquired_on) + (isMonthEnd(asOf) ? 1 : 0);
  return Math.min(Math.max(months, 0), asset.useful_life_months);
}

/** The fixed share each month adds once the books are kept in usahaku. */
export const monthlyShare = (asset) => roundedRatio(asset.cost, asset.useful_life_months);

export function accumulatedAmortization(asset, asOf, openingDate = null) {
  const life = asset.useful_life_months;
  const months = monthsRecognized(asset, asOf);
  if (months === life) return asset.cost;
  const before = openingDate ? monthsRecognized(asset, addDays(openingDate, -1)) : 0;
  if (months <= before) return roundedRatio(asset.cost * months, life);
  const opening = roundedRatio(asset.cost * before, life);
  return Math.min(asset.cost, opening + monthlyShare(asset) * (months - before));
}

export const bookValue = (asset, asOf, openingDate = null) =>
  asset.cost - accumulatedAmortization(asset, asOf, openingDate);

/**
 * Expense recognized from `from` to `to`. Nothing before `openingDate` reaches profit:
 * it is already inside the opening retained earnings.
 */
export function amortizationBetween(asset, from, to, openingDate = null) {
  const start = openingDate && openingDate > from ? openingDate : from;
  if (start > to) return 0;
  return (
    accumulatedAmortization(asset, to, openingDate) -
    accumulatedAmortization(asset, addDays(start, -1), openingDate)
  );
}

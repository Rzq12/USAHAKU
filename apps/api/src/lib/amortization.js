import { addDays } from './dates.js';

/*
 * Straight-line depreciation and amortization, one share per month, recognized on the last
 * day of each month from the month of acquisition (the way a month-end adjusting entry is
 * posted). The running total is rounded to whole rupiah, so the shares always add up to cost.
 */

const monthIndex = (date) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
const isMonthEnd = (date) => addDays(date, 1).slice(8, 10) === '01';

/** Month ends from the acquisition month through `asOf`, capped at the useful life. */
export function monthsRecognized(asset, asOf) {
  if (asOf < asset.acquired_on) return 0;
  const months = monthIndex(asOf) - monthIndex(asset.acquired_on) + (isMonthEnd(asOf) ? 1 : 0);
  return Math.min(Math.max(months, 0), asset.useful_life_months);
}

/** Half-up rounding of cost × months / life, in integers so large costs stay exact. */
export function accumulatedAmortization(asset, asOf) {
  const months = monthsRecognized(asset, asOf);
  const life = asset.useful_life_months;
  return Math.floor((2 * asset.cost * months + life) / (2 * life));
}

export const bookValue = (asset, asOf) => asset.cost - accumulatedAmortization(asset, asOf);

/**
 * Expense recognized from `from` to `to`. Nothing before `openingDate` reaches profit:
 * it is already inside the opening retained earnings.
 */
export function amortizationBetween(asset, from, to, openingDate = null) {
  const start = openingDate && openingDate > from ? openingDate : from;
  if (start > to) return 0;
  return accumulatedAmortization(asset, to) - accumulatedAmortization(asset, addDays(start, -1));
}

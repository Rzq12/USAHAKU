const QTY_SCALE = 1000n;

function qtyToThousandths(qty) {
  return BigInt(Math.round(Number(qty) * Number(QTY_SCALE)));
}

/** Quantity times a whole rupiah price, rounded half up to whole rupiah. BR-001. */
export function lineAmount(qty, unitPrice) {
  const scaled = qtyToThousandths(qty) * BigInt(unitPrice);
  return Number((scaled + QTY_SCALE / 2n) / QTY_SCALE);
}

/** Basis points of an amount, rounded down to whole rupiah. */
export function basisPointsOf(amount, basisPoints) {
  return Number((BigInt(amount) * BigInt(basisPoints)) / 10_000n);
}

export function formatRupiah(amount) {
  const sign = amount < 0 ? '-' : '';
  const digits = String(Math.abs(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}Rp${digits}`;
}

export function formatQty(qty) {
  return String(Number(qty)).replace('.', ',');
}

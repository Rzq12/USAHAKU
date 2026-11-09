/** The account a sale or expense goes to when nobody picks one. */
export function defaultAccountId(accounts) {
  return accounts?.items.find((account) => !account.is_archived)?.id ?? '';
}

/** Everyday spending first, then Lainnya, then loan and asset categories an owner rarely needs. */
function rank(category) {
  if (category.cash_activity && category.cash_activity !== 'operating') return 2;
  return category.name === 'Lainnya' ? 1 : 0;
}

/** Expense categories shown as big buttons: active ones without active children. */
export function expenseCategories(categories) {
  const active = (categories?.items ?? []).filter(
    (category) => category.type === 'expense' && !category.is_archived,
  );
  return active
    .filter((category) => !active.some((child) => child.parent_id === category.id))
    .sort((a, b) => rank(a) - rank(b));
}

/** The quantity or product problem of one sale line. */
export function lineError(errors, index) {
  return errors[`items.${index}.qty`] ?? errors[`items.${index}.product_id`];
}

/** What to say near Simpan after a failed save, so the failure is never silent. */
export function saveProblem(formError, fieldErrors) {
  if (formError) return formError;
  if (Object.keys(fieldErrors).length > 0) {
    return 'Belum tersimpan. Periksa isian yang bertanda merah.';
  }
  return null;
}

/** Why Simpan is not available yet on the sale form. */
export function saleSaveHint({ lineCount }) {
  return lineCount === 0 ? 'Ketuk barang yang terjual dulu.' : null;
}

/** Why Simpan is not available yet on the expense form. */
export function expenseSaveHint({ amount, categoryId }) {
  if (!amount) return 'Isi berapa uangnya dulu.';
  return categoryId ? null : 'Pilih untuk apa uang ini.';
}

/** Tells the owner when the product cards do not show everything. */
export function pickerHint(shown, total) {
  return total > shown
    ? `Menampilkan ${shown} dari ${total} barang. Ketik nama untuk mencari.`
    : null;
}

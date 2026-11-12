/* Invoices are a retired feature. Only voiding an old sale still touches these rows. */

export async function setInvoiceStatusBySale(q, businessId, saleId, status) {
  await q.query(
    `UPDATE invoices SET status = $3 WHERE business_id = $1 AND sale_id = $2 AND status <> 'void'`,
    [businessId, saleId, status],
  );
}

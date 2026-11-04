const COLUMNS = `i.id, i.sale_id, i.number, i.issue_date, i.due_date, i.status, i.notes, i.created_at,
  s.total, s.sale_date, s.payment_type, c.name AS contact_name`;
const JOINS = `FROM invoices i
  JOIN sales s ON s.id = i.sale_id
  LEFT JOIN contacts c ON c.id = s.contact_id`;

/** The counter row is locked by the upsert, so concurrent invoices get consecutive numbers. */
export async function nextInvoiceNumber(q, businessId, year) {
  const { rows } = await q.query(
    `INSERT INTO invoice_counters (business_id, year, last_number) VALUES ($1, $2, 1)
     ON CONFLICT (business_id, year) DO UPDATE SET last_number = invoice_counters.last_number + 1
     RETURNING last_number`,
    [businessId, year],
  );
  return `INV/${year}/${String(rows[0].last_number).padStart(4, '0')}`;
}

export async function insertInvoice(q, businessId, invoice) {
  const { rows } = await q.query(
    `INSERT INTO invoices (business_id, sale_id, number, issue_date, due_date, status, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      businessId,
      invoice.sale_id,
      invoice.number,
      invoice.issue_date,
      invoice.due_date,
      invoice.status,
      invoice.notes,
      invoice.created_by,
    ],
  );
  return rows[0].id;
}

export async function getInvoice(q, businessId, invoiceId) {
  const { rows } = await q.query(
    `SELECT ${COLUMNS} ${JOINS} WHERE i.business_id = $1 AND i.id = $2`,
    [businessId, invoiceId],
  );
  return rows[0];
}

export async function findInvoiceBySale(q, businessId, saleId) {
  const { rows } = await q.query('SELECT * FROM invoices WHERE business_id = $1 AND sale_id = $2', [
    businessId,
    saleId,
  ]);
  return rows[0];
}

export async function listInvoices(q, businessId, filters) {
  const where = ['i.business_id = $1'];
  const params = [businessId];
  if (filters.status) {
    params.push(filters.status);
    where.push(`i.status = $${params.length}`);
  }
  const clause = where.join(' AND ');
  const count = await q.query(`SELECT count(*) FROM invoices i WHERE ${clause}`, params);
  const { rows } = await q.query(
    `SELECT ${COLUMNS} ${JOINS} WHERE ${clause}
     ORDER BY i.issue_date DESC, i.number DESC
     LIMIT ${filters.limit} OFFSET ${(filters.page - 1) * filters.limit}`,
    params,
  );
  return { items: rows, total: Number(count.rows[0].count) };
}

export async function updateInvoice(q, businessId, invoiceId, fields) {
  await q.query(
    `UPDATE invoices SET issue_date = $3, due_date = $4, notes = $5, status = $6
     WHERE business_id = $1 AND id = $2`,
    [businessId, invoiceId, fields.issue_date, fields.due_date, fields.notes, fields.status],
  );
}

export async function setInvoiceStatusBySale(q, businessId, saleId, status) {
  await q.query(
    `UPDATE invoices SET status = $3 WHERE business_id = $1 AND sale_id = $2 AND status <> 'void'`,
    [businessId, saleId, status],
  );
}

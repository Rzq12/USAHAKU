const OPEN_DEBT_BALANCE = (type) => `COALESCE((
  SELECT SUM(d.amount - d.paid_amount) FROM debts d
  WHERE d.business_id = c.business_id AND d.contact_id = c.id
    AND d.type = '${type}' AND d.status IN ('open', 'partial')
), 0)`;

const COLUMNS = `c.id, c.name, c.type, c.phone, c.email, c.address, c.notes, c.is_archived,
  ${OPEN_DEBT_BALANCE('receivable')} AS receivable_balance,
  ${OPEN_DEBT_BALANCE('payable')} AS payable_balance`;

export async function listContacts(q, businessId, filters) {
  const where = ['c.business_id = $1'];
  const params = [businessId];
  if (!filters.include_archived) where.push('NOT c.is_archived');
  if (filters.type) {
    params.push(filters.type);
    where.push(`(c.type = $${params.length} OR c.type = 'both')`);
  }
  if (filters.q) {
    params.push(filters.q);
    where.push(`(c.name ILIKE '%' || $${params.length} || '%' OR c.phone ILIKE '%' || $${params.length} || '%')`);
  }
  const clause = where.join(' AND ');
  const count = await q.query(`SELECT count(*) FROM contacts c WHERE ${clause}`, params);
  const { rows } = await q.query(
    `SELECT ${COLUMNS} FROM contacts c WHERE ${clause} ORDER BY c.name
     LIMIT ${filters.limit} OFFSET ${(filters.page - 1) * filters.limit}`,
    params,
  );
  return { items: rows, total: Number(count.rows[0].count) };
}

export async function getContact(q, businessId, contactId) {
  const { rows } = await q.query(
    `SELECT ${COLUMNS} FROM contacts c WHERE c.business_id = $1 AND c.id = $2`,
    [businessId, contactId],
  );
  return rows[0];
}

export async function insertContact(q, businessId, contact) {
  const { rows } = await q.query(
    `INSERT INTO contacts (business_id, name, type, phone, email, address, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [businessId, contact.name, contact.type, contact.phone, contact.email, contact.address, contact.notes],
  );
  return rows[0].id;
}

export async function updateContact(q, businessId, contactId, contact) {
  await q.query(
    `UPDATE contacts SET name = $3, type = $4, phone = $5, email = $6, address = $7, notes = $8,
       is_archived = $9
     WHERE business_id = $1 AND id = $2`,
    [
      businessId,
      contactId,
      contact.name,
      contact.type,
      contact.phone,
      contact.email,
      contact.address,
      contact.notes,
      contact.is_archived,
    ],
  );
}

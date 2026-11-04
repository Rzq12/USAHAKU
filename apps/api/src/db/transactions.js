const SELECT_COLUMNS = `t.id, t.type, t.amount, t.occurred_on, t.note, t.account_id, t.transfer_account_id,
  t.category_id, t.contact_id, t.attachment_id, t.source_type, t.source_id, t.is_excluded,
  t.created_by, t.created_at, t.updated_at,
  a.name AS account_name, ta.name AS transfer_account_name, c.name AS category_name,
  u.name AS created_by_name, ct.name AS contact_name,
  COALESCE((SELECT array_agg(g.name ORDER BY g.name)
            FROM transaction_tags tt JOIN tags g ON g.id = tt.tag_id
            WHERE tt.transaction_id = t.id), '{}') AS tags`;

const JOINS = `FROM transactions t
  JOIN accounts a ON a.id = t.account_id
  LEFT JOIN accounts ta ON ta.id = t.transfer_account_id
  LEFT JOIN categories c ON c.id = t.category_id
  LEFT JOIN users u ON u.id = t.created_by
  LEFT JOIN contacts ct ON ct.id = t.contact_id`;

export async function insertTransaction(q, t) {
  const { rows } = await q.query(
    `INSERT INTO transactions (business_id, account_id, transfer_account_id, type, amount,
       category_id, contact_id, occurred_on, note, source_type, source_id, import_hash, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id`,
    [
      t.businessId,
      t.account_id,
      t.transfer_account_id ?? null,
      t.type,
      t.amount,
      t.category_id ?? null,
      t.contact_id ?? null,
      t.occurred_on,
      t.note ?? null,
      t.source_type ?? 'manual',
      t.source_id ?? null,
      t.import_hash ?? null,
      t.created_by ?? null,
    ],
  );
  return rows[0].id;
}

export async function getTransaction(q, businessId, transactionId) {
  const { rows } = await q.query(
    `SELECT ${SELECT_COLUMNS} ${JOINS}
     WHERE t.business_id = $1 AND t.id = $2 AND t.deleted_at IS NULL`,
    [businessId, transactionId],
  );
  return rows[0];
}

export async function updateTransaction(q, businessId, transactionId, t) {
  await q.query(
    `UPDATE transactions SET amount = $3, account_id = $4, transfer_account_id = $5,
       category_id = $6, contact_id = $7, occurred_on = $8, note = $9, is_excluded = $10,
       updated_at = now()
     WHERE business_id = $1 AND id = $2`,
    [
      businessId,
      transactionId,
      t.amount,
      t.account_id,
      t.transfer_account_id,
      t.category_id,
      t.contact_id,
      t.occurred_on,
      t.note,
      t.is_excluded,
    ],
  );
}

export async function softDeleteTransaction(q, businessId, transactionId) {
  await q.query(
    `UPDATE transactions SET deleted_at = now(), updated_at = now()
     WHERE business_id = $1 AND id = $2`,
    [businessId, transactionId],
  );
}

export async function softDeleteBySource(q, businessId, sourceType, sourceId) {
  const { rows } = await q.query(
    `UPDATE transactions SET deleted_at = now(), updated_at = now()
     WHERE business_id = $1 AND source_type = $2 AND source_id = $3 AND deleted_at IS NULL
     RETURNING id`,
    [businessId, sourceType, sourceId],
  );
  return rows.map((row) => row.id);
}

export async function setTransactionSource(q, businessId, transactionId, sourceId) {
  await q.query('UPDATE transactions SET source_id = $3 WHERE business_id = $1 AND id = $2', [
    businessId,
    transactionId,
    sourceId,
  ]);
}

export async function setAttachment(q, businessId, transactionId, attachmentId) {
  await q.query(
    `UPDATE transactions SET attachment_id = $3, updated_at = now()
     WHERE business_id = $1 AND id = $2`,
    [businessId, transactionId, attachmentId],
  );
}

export async function insertAttachment(q, businessId, attachment) {
  const { rows } = await q.query(
    `INSERT INTO attachments (business_id, file_path, mime_type, size_bytes)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [businessId, attachment.file_path, attachment.mime_type, attachment.size_bytes],
  );
  return rows[0].id;
}

export async function getAttachment(q, businessId, attachmentId) {
  const { rows } = await q.query('SELECT * FROM attachments WHERE business_id = $1 AND id = $2', [
    businessId,
    attachmentId,
  ]);
  return rows[0];
}

export async function replaceTags(q, businessId, transactionId, tagNames) {
  await q.query('DELETE FROM transaction_tags WHERE transaction_id = $1', [transactionId]);
  for (const name of tagNames) {
    const { rows } = await q.query(
      `INSERT INTO tags (business_id, name) VALUES ($1, $2)
       ON CONFLICT (business_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [businessId, name],
    );
    await q.query('INSERT INTO transaction_tags (transaction_id, tag_id) VALUES ($1, $2)', [
      transactionId,
      rows[0].id,
    ]);
  }
}

function buildFilters(businessId, filters) {
  const where = ['t.business_id = $1', 't.deleted_at IS NULL'];
  const params = [businessId];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replaceAll('?', `$${params.length}`));
  };
  if (filters.created_by) add('t.created_by = ?', filters.created_by);
  if (filters.from) add('t.occurred_on >= ?', filters.from);
  if (filters.to) add('t.occurred_on <= ?', filters.to);
  if (filters.account_id) add('(t.account_id = ? OR t.transfer_account_id = ?)', filters.account_id);
  if (filters.type) add('t.type = ?', filters.type);
  if (filters.category_id) add('t.category_id = ?', filters.category_id);
  if (filters.tag) {
    add(
      `EXISTS (SELECT 1 FROM transaction_tags tt JOIN tags g ON g.id = tt.tag_id
               WHERE tt.transaction_id = t.id AND g.name = ?)`,
      filters.tag,
    );
  }
  if (filters.q) add(`t.note ILIKE '%' || ? || '%'`, filters.q);
  return { clause: where.join(' AND '), params };
}

export async function listTransactions(q, businessId, filters) {
  const { clause, params } = buildFilters(businessId, filters);
  const summary = await q.query(
    `SELECT count(*) AS total,
       COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'income' AND NOT t.is_excluded), 0) AS income,
       COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'expense' AND NOT t.is_excluded), 0) AS expense
     FROM transactions t WHERE ${clause}`,
    params,
  );
  const offset = (filters.page - 1) * filters.limit;
  const { rows } = await q.query(
    `SELECT ${SELECT_COLUMNS} ${JOINS}
     WHERE ${clause}
     ORDER BY t.occurred_on DESC, t.created_at DESC
     LIMIT ${filters.limit} OFFSET ${offset}`,
    params,
  );
  const { total, income, expense } = summary.rows[0];
  return { items: rows, total, totals: { income, expense, net: income - expense } };
}

export async function isWithinEditWindow(q, businessId, transactionId) {
  const { rows } = await q.query(
    `SELECT created_at > now() - interval '24 hours' AS within
     FROM transactions WHERE business_id = $1 AND id = $2`,
    [businessId, transactionId],
  );
  return rows[0]?.within ?? false;
}

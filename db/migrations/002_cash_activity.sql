-- Cash flow activity per category (SAK EMKM). Every existing category stays operating,
-- so no existing report figure changes until a category is reclassified.
ALTER TABLE categories
  ADD COLUMN cash_activity VARCHAR(10) NOT NULL DEFAULT 'operating'
  CHECK (cash_activity IN ('operating', 'investing', 'financing'));

-- System categories feed sales, stock, and tax logic, so they must stay operating.
ALTER TABLE categories
  ADD CONSTRAINT categories_system_key_operating
  CHECK (system_key IS NULL OR cash_activity = 'operating');

-- Give existing businesses the same non-operating starting categories as new ones.
-- A business that already has one of these names keeps its own category untouched.
INSERT INTO categories (business_id, name, type, pl_group, cash_activity)
SELECT b.id, d.name, d.type, d.pl_group, d.cash_activity
FROM businesses b
CROSS JOIN (VALUES
  ('Penjualan Aset', 'income', NULL, 'investing'),
  ('Pembelian Peralatan', 'expense', 'other_expense', 'investing'),
  ('Modal Pemilik', 'income', NULL, 'financing'),
  ('Pinjaman Diterima', 'income', NULL, 'financing'),
  ('Angsuran Pinjaman', 'expense', 'other_expense', 'financing'),
  ('Prive Pemilik', 'expense', 'other_expense', 'financing')
) AS d (name, type, pl_group, cash_activity)
ON CONFLICT DO NOTHING;

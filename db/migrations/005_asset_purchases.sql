-- An asset bought after the opening date is paid from a cash account. Its payment is an
-- expense transaction with source_type 'asset' and source_id = assets.id: it moves cash and
-- shows in cash flow, while profit and loss only sees the asset's monthly depreciation.
ALTER TABLE transactions DROP CONSTRAINT transactions_source_type_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_source_type_check CHECK (source_type IN
  ('manual', 'sale', 'receivable_payment', 'payable_payment', 'recurring', 'import', 'restock',
   'asset'));

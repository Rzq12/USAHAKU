-- Opening position of books moved in from another system (for example Zahir).
-- opening_date: the first day usahaku keeps the books; account opening balances are as of this day.
-- opening_capital: owner capital on that day. Retained earnings on that day are never typed in:
-- reports derive them as opening assets minus opening capital.
ALTER TABLE businesses
  ADD COLUMN opening_date DATE,
  ADD COLUMN opening_capital BIGINT CHECK (opening_capital >= 0),
  ADD COLUMN capital_name VARCHAR(60),
  ADD CONSTRAINT businesses_opening_capital_needs_date
    CHECK (opening_capital IS NULL OR opening_date IS NOT NULL);

-- Non-cash assets that wear off month by month: fixed assets (depreciation) and prepaid
-- expenses such as a year of rent paid up front (amortization). Each month's share is
-- recognized at that month's end, straight line, into expense_category_id.
CREATE TABLE assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  kind VARCHAR(10) NOT NULL CHECK (kind IN ('fixed', 'prepaid')),
  group_name VARCHAR(60) NOT NULL,
  name VARCHAR(120) NOT NULL,
  acquired_on DATE NOT NULL,
  cost BIGINT NOT NULL CHECK (cost > 0),
  useful_life_months INT NOT NULL CHECK (useful_life_months BETWEEN 1 AND 1200),
  expense_category_id UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX assets_business ON assets (business_id, acquired_on);

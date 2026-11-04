CREATE TABLE businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  address TEXT,
  phone VARCHAR(30),
  npwp VARCHAR(25),
  taxpayer_type VARCHAR(20) CHECK (taxpayer_type IN ('individual', 'company')),
  period_start_day SMALLINT NOT NULL DEFAULT 1 CHECK (period_start_day BETWEEN 1 AND 28),
  tax_rate_bp INT NOT NULL DEFAULT 50 CHECK (tax_rate_bp BETWEEN 0 AND 500),
  tax_threshold BIGINT NOT NULL DEFAULT 500000000 CHECK (tax_threshold >= 0),
  payment_info TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('owner', 'staff', 'accountant')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  must_change_password BOOLEAN NOT NULL DEFAULT false,
  failed_login_count INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  name VARCHAR(60) NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('cash', 'bank', 'ewallet')),
  opening_balance BIGINT NOT NULL DEFAULT 0,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, name)
);

CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  parent_id UUID REFERENCES categories(id) ON DELETE RESTRICT,
  name VARCHAR(60) NOT NULL,
  type VARCHAR(10) NOT NULL CHECK (type IN ('income', 'expense')),
  pl_group VARCHAR(20) CHECK (pl_group IN ('operating_expense', 'other_expense', 'inventory')),
  system_key VARCHAR(20) CHECK (system_key IN ('sales', 'inventory', 'tax')),
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((type = 'expense') = (pl_group IS NOT NULL))
);
CREATE UNIQUE INDEX categories_unique_name ON categories
  (business_id, type, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), name);
CREATE UNIQUE INDEX categories_unique_system_key ON categories (business_id, system_key)
  WHERE system_key IS NOT NULL;

CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  name VARCHAR(120) NOT NULL,
  type VARCHAR(10) NOT NULL CHECK (type IN ('customer', 'supplier', 'both')),
  phone VARCHAR(30),
  email VARCHAR(255),
  address TEXT,
  notes TEXT,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX contacts_business_name ON contacts (business_id, name);

CREATE TABLE attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  file_path TEXT NOT NULL,
  mime_type VARCHAR(50) NOT NULL,
  size_bytes INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  transfer_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
  type VARCHAR(10) NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),
  amount BIGINT NOT NULL CHECK (amount > 0),
  category_id UUID REFERENCES categories(id) ON DELETE RESTRICT,
  contact_id UUID REFERENCES contacts(id) ON DELETE RESTRICT,
  occurred_on DATE NOT NULL,
  note VARCHAR(500),
  attachment_id UUID REFERENCES attachments(id) ON DELETE RESTRICT,
  source_type VARCHAR(30) NOT NULL DEFAULT 'manual' CHECK (source_type IN
    ('manual', 'sale', 'receivable_payment', 'payable_payment', 'recurring', 'import', 'restock')),
  source_id UUID,
  import_hash VARCHAR(64),
  is_excluded BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CHECK (transfer_account_id IS NULL OR transfer_account_id <> account_id),
  CHECK ((type = 'transfer') = (transfer_account_id IS NOT NULL)),
  CHECK ((type = 'transfer') = (category_id IS NULL))
);
CREATE INDEX transactions_business_date ON transactions (business_id, occurred_on);
CREATE INDEX transactions_business_account_date ON transactions (business_id, account_id, occurred_on);
CREATE INDEX transactions_business_transfer ON transactions (business_id, transfer_account_id)
  WHERE transfer_account_id IS NOT NULL;
CREATE INDEX transactions_source ON transactions (source_id) WHERE source_id IS NOT NULL;
CREATE UNIQUE INDEX transactions_import_hash ON transactions (business_id, import_hash)
  WHERE import_hash IS NOT NULL;

CREATE TABLE tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  name VARCHAR(30) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, name)
);

CREATE TABLE transaction_tags (
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE RESTRICT,
  PRIMARY KEY (transaction_id, tag_id)
);

CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  sku VARCHAR(40),
  name VARCHAR(120) NOT NULL,
  unit VARCHAR(20) NOT NULL,
  sell_price BIGINT NOT NULL CHECK (sell_price >= 0),
  cost_price BIGINT NOT NULL CHECK (cost_price >= 0),
  track_stock BOOLEAN NOT NULL DEFAULT true,
  stock_qty NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  low_stock_threshold NUMERIC(12,3) CHECK (low_stock_threshold >= 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, name)
);
CREATE UNIQUE INDEX products_unique_sku ON products (business_id, sku) WHERE sku IS NOT NULL;

CREATE TABLE stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  movement_type VARCHAR(20) NOT NULL CHECK (movement_type IN
    ('opening', 'restock', 'sale', 'void', 'adjustment')),
  qty NUMERIC(12,3) NOT NULL,
  ref_id UUID,
  reason VARCHAR(200),
  created_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX stock_movements_product ON stock_movements (business_id, product_id, created_at);
CREATE INDEX stock_movements_ref ON stock_movements (ref_id) WHERE ref_id IS NOT NULL;

CREATE TABLE sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  contact_id UUID REFERENCES contacts(id) ON DELETE RESTRICT,
  sale_date DATE NOT NULL,
  subtotal BIGINT NOT NULL CHECK (subtotal >= 0),
  discount BIGINT NOT NULL DEFAULT 0 CHECK (discount >= 0 AND discount <= subtotal),
  total BIGINT NOT NULL CHECK (total >= 0),
  payment_type VARCHAR(10) NOT NULL CHECK (payment_type IN ('paid', 'credit')),
  account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
  status VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'void')),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (payment_type <> 'credit' OR contact_id IS NOT NULL),
  CHECK (payment_type <> 'paid' OR account_id IS NOT NULL)
);
CREATE INDEX sales_business_date ON sales (business_id, sale_date);

CREATE TABLE sale_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  product_id UUID REFERENCES products(id) ON DELETE RESTRICT,
  description VARCHAR(120) NOT NULL,
  qty NUMERIC(12,3) NOT NULL CHECK (qty > 0),
  unit_price BIGINT NOT NULL CHECK (unit_price >= 0),
  unit_cost BIGINT NOT NULL CHECK (unit_cost >= 0),
  line_total BIGINT NOT NULL,
  line_cost BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sale_items_sale ON sale_items (sale_id);

CREATE TABLE debts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  type VARCHAR(12) NOT NULL CHECK (type IN ('receivable', 'payable')),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  source_type VARCHAR(10) NOT NULL CHECK (source_type IN ('sale', 'manual')),
  source_id UUID,
  category_id UUID REFERENCES categories(id) ON DELETE RESTRICT,
  issue_date DATE NOT NULL,
  due_date DATE NOT NULL,
  amount BIGINT NOT NULL CHECK (amount > 0),
  paid_amount BIGINT NOT NULL DEFAULT 0,
  status VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'partial', 'paid', 'void')),
  note VARCHAR(500),
  created_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (due_date >= issue_date),
  CHECK (paid_amount >= 0 AND paid_amount <= amount),
  CHECK (type <> 'payable' OR category_id IS NOT NULL)
);
CREATE INDEX debts_lookup ON debts (business_id, type, status, due_date);
CREATE INDEX debts_contact ON debts (business_id, contact_id);
CREATE INDEX debts_source ON debts (source_id) WHERE source_id IS NOT NULL;

CREATE TABLE debt_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  debt_id UUID NOT NULL REFERENCES debts(id) ON DELETE RESTRICT,
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  amount BIGINT NOT NULL CHECK (amount > 0),
  paid_on DATE NOT NULL,
  is_void BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX debt_payments_debt ON debt_payments (debt_id);

CREATE TABLE invoice_counters (
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  year INT NOT NULL,
  last_number INT NOT NULL,
  PRIMARY KEY (business_id, year)
);

CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  sale_id UUID NOT NULL UNIQUE REFERENCES sales(id) ON DELETE RESTRICT,
  number VARCHAR(30) NOT NULL,
  issue_date DATE NOT NULL,
  due_date DATE,
  status VARCHAR(10) NOT NULL CHECK (status IN ('draft', 'issued', 'paid', 'void')),
  notes VARCHAR(500),
  created_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, number)
);

CREATE TABLE budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  period_start DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, period_start)
);

CREATE TABLE budget_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  budget_id UUID NOT NULL REFERENCES budgets(id) ON DELETE RESTRICT,
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  amount BIGINT NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (budget_id, category_id)
);

CREATE TABLE recurring_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  type VARCHAR(10) NOT NULL CHECK (type IN ('income', 'expense')),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  amount BIGINT NOT NULL CHECK (amount > 0),
  note VARCHAR(500),
  frequency VARCHAR(10) NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  start_on DATE NOT NULL,
  end_on DATE,
  next_run_on DATE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_run_on DATE,
  last_run_error VARCHAR(200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_on IS NULL OR end_on > start_on)
);
CREATE INDEX recurring_due ON recurring_rules (is_active, next_run_on);

CREATE TABLE category_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  keyword VARCHAR(50) NOT NULL,
  priority SMALLINT NOT NULL CHECK (priority BETWEEN 1 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX category_rules_business ON category_rules (business_id);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  action VARCHAR(30) NOT NULL,
  entity_type VARCHAR(30) NOT NULL,
  entity_id UUID,
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_business_date ON audit_logs (business_id, created_at);

CREATE INDEX sessions_token_hash ON sessions (token_hash);

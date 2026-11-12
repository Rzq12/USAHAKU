# FUNCTIONAL REQUIREMENTS DOCUMENT (FRD)

> **Catatan:** Versi sederhana berbeda dari dokumen ini. Lihat `Docs/superpowers/specs/2026-11-04-usahaku-sederhana-design.md`.

**Product Name:** usahaku (bookkeeping and finance app for UMKM)  
**Document Version:** 1.0  
**Status:** Draft  
**Date:** 04 November 2026  
**PRD Reference:** PRD v1.0 (`docs/PRD.md`)  
**Prepared By:** [To be decided: author name]  

---

# 1. Introduction

## 1.1 Document Purpose
This FRD describes what each function of usahaku does, step by step, with its inputs, outputs, rules, and messages. Developers use it to build, QA uses it to write test cases, and stakeholders use it to confirm behavior before development starts.

## 1.2 Scope
The document covers every In Scope item in PRD section 1.5: authentication and roles, accounts and transactions, products and sales, receivables and payables, invoicing, budgets, recurring transactions, dashboard, reports, tax estimate, import, export, and audit log. Out of Scope items (bank integration, payroll, VAT, offline mode, OCR, multi-currency) are not described here.

## 1.3 Definitions and Terms
| Term | Definition |
|---|---|
| UMKM | Usaha Mikro, Kecil, dan Menengah, the micro, small, and medium enterprises of Indonesia |
| Owner | The user who registered the business and has full access |
| Staff | A user who records sales and expenses with limited access |
| Accountant | A read-only user who can view reports and export data |
| Period | A reporting month that starts on the business's period start day |
| Receivable | Money a customer owes the business |
| Payable | Money the business owes a supplier |
| Void | Cancelling a record while keeping it in history, with its effects reversed |
| COGS | Cost of goods sold: quantity sold times the cost price saved on the sale item |
| PPh Final UMKM | Final income tax for UMKM, calculated as a percentage of gross turnover |
| PWA | Progressive Web App, a web app that can be installed on a phone |

## 1.4 References
- PRD v1.0 (`docs/PRD.md`)
- SRS v1.0 (`docs/SRS.md`)

---

# 2. System Overview

## 2.1 System Context
usahaku is a standalone web application. It does not connect to banks, marketplaces, or tax systems. Users reach it through a browser or the installed PWA. The system reads and writes to its own PostgreSQL database and file volume only. Output leaves the system as downloaded files (PDF, XLSX, CSV, ZIP).

## 2.2 Actors
| Actor | Description | Brief Access Rights |
|---|---|---|
| Owner | Business owner and admin of the business account | Everything, including users, settings, reports, import |
| Staff | Cashier or shop assistant | Record sales, expenses, and receivable payments. View products and contacts. No reports or settings |
| Accountant | Bookkeeper | Read-only access to data, reports, tax estimate, and audit log. Can export |
| System Scheduler | Daily background job | Posts recurring transactions |

## 2.3 Module List
| Code | Module | Brief Description |
|---|---|---|
| MOD-01 | Authentication & Access | Registration, login, users, roles, business settings |
| MOD-02 | Accounts & Transactions | Accounts, transactions, categories, tags, auto-rules |
| MOD-03 | Products & Sales | Product catalog, stock, sales recording |
| MOD-04 | Receivables & Payables | Contacts, debts and payments, invoices |
| MOD-05 | Budget & Recurring | Budgets and recurring transactions |
| MOD-06 | Dashboard, Reports & Tax | Dashboard, financial reports, exports, tax estimate |
| MOD-07 | Data Management | Import, full data export, audit log |

---

# 3. Functional Requirements

## 3.1 MOD-01: Authentication & Access

### FR-001: Authentication

| Attribute | Description |
|---|---|
| Actor | Visitor, Owner, Staff, Accountant |
| Priority | High |
| Preconditions | Registration: none. Login: an active user exists. |
| Postconditions | A session cookie exists after login or registration and is removed after logout. |
| PRD Reference | FR-001 |

**Description:**  
Visitors register a business and become its Owner. Users log in, log out, and change their own password.

**Normal Flow:**
1. The visitor opens the registration form and enters business name, own name, email, and password.
2. The system validates the data, creates the business with default accounts, categories, and settings, and creates the Owner user.
3. The system starts a session and opens the dashboard.
4. A returning user enters email and password on the login form.
5. The system checks credentials, resets the failed-login counter, starts a session, and opens the dashboard.
6. If `must_change_password` is true, the system opens the change-password form first and blocks other pages until it is done.
7. Logout removes the session on the server and clears the cookie.

**Alternative Flow:**
- A user changes their password: the system asks for the current password and the new one, saves the hash, and ends all other sessions of that user.

**Failure Flow:**
- Wrong email or password: one generic error, and the failed-login counter increases.
- Fifth failed login: the account is locked for 15 minutes and the error shows the remaining time.
- Deactivated user: the same generic error as wrong credentials.

**Input:**

| Field | Type | Required | Validation |
|---|---|---|---|
| business_name | String | Registration | 2 to 100 characters |
| name | String | Registration | 2 to 100 characters |
| email | String | Yes | Valid email, unique, stored in lowercase |
| password | String | Yes | At least 8 characters, not equal to the email |
| current_password | String | Change password | Must match the stored hash |

**Output:**

| Field | Type | Description |
|---|---|---|
| user.id, user.name, user.role | Object | Current user |
| must_change_password | Boolean | Forces the change-password form |
| session cookie | HTTP-only cookie | Valid for 7 days after last use |

**Business Rules:**
- BR-001: not applicable.
- NFR-001: sessions are checked on every request.

**System Messages:**

| Condition | Type | Message |
|---|---|---|
| Registration done | Success | "Akun berhasil dibuat. Selamat datang di usahaku." |
| Wrong credentials | Error | "Email atau kata sandi salah." |
| Account locked | Error | "Terlalu banyak percobaan. Coba lagi dalam {n} menit." |
| Email already used | Error | "Email sudah terdaftar." |
| Password changed | Success | "Kata sandi berhasil diubah." |

### FR-002: User & Role Management

| Attribute | Description |
|---|---|
| Actor | Owner |
| Priority | High |
| Preconditions | Owner is logged in. |
| Postconditions | The user list reflects the change and an audit entry exists. |
| PRD Reference | FR-002 |

**Description:**  
The Owner creates Staff and Accountant users, changes their role, resets their password, and deactivates them.

**Normal Flow:**
1. The Owner opens Settings, Users, and chooses "Add user".
2. The Owner enters name, email, role, and a temporary password.
3. The system saves the user with `must_change_password` true.
4. The Owner tells the new user the temporary password in person.
5. To deactivate, the Owner opens the user and confirms. The system sets `is_active` false and deletes the user's sessions.

**Alternative Flow:**
- Reset password: the Owner enters a new temporary password, the system sets `must_change_password` true and deletes the user's sessions.
- Change role: the system saves it and writes a `role_change` audit entry.

**Failure Flow:**
- Duplicate email: field error.
- Deactivating or demoting the last active Owner: refused.
- A non-Owner calls any user endpoint: 403.

**Input:**

| Field | Type | Required | Validation |
|---|---|---|---|
| name | String | Yes | 2 to 100 characters |
| email | String | Yes | Valid, unique |
| role | Enum | Yes | `staff` or `accountant` |
| temporary_password | String | Yes | At least 8 characters |
| is_active | Boolean | No | Update only |

**Output:**

| Field | Type | Description |
|---|---|---|
| id, name, email, role | String | User identity |
| is_active | Boolean | Active status |
| last_login_at | Timestamp | Most recent login |

**Business Rules:**
- There is always at least one active Owner. Only one Owner exists in version 1.0 (the registrant).

**System Messages:**

| Condition | Type | Message |
|---|---|---|
| User created | Success | "Pengguna berhasil ditambahkan." |
| User deactivated | Success | "Pengguna dinonaktifkan." |
| Last Owner | Error | "Pemilik terakhir tidak dapat dinonaktifkan." |

### FR-003: Business Settings

| Attribute | Description |
|---|---|
| Actor | Owner (edit), Accountant (view) |
| Priority | Medium |
| Preconditions | User is logged in. |
| Postconditions | Settings are saved and used by later calculations. |
| PRD Reference | FR-003 |

**Description:**  
The Owner edits the business profile and the options that change calculations.

**Normal Flow:**
1. The Owner opens Settings, Business.
2. The Owner edits name, address, phone, NPWP, taxpayer type, period start day, tax rate, tax threshold, and payment info for invoices.
3. The system validates and saves.
4. Reports, budgets, and the tax estimate use the new values from the next request.

**Alternative Flow:**
- Changing the period start day does not change stored transactions. It changes only how periods are drawn.

**Failure Flow:**
- Invalid values return field errors and nothing is saved.

**Input:**

| Field | Type | Required | Validation |
|---|---|---|---|
| name | String | Yes | 2 to 100 characters |
| taxpayer_type | Enum | Yes | `individual` or `company` |
| period_start_day | Integer | Yes | 1 to 28 |
| tax_rate | Decimal | Yes | 0 to 5 percent, up to 2 decimals |
| tax_threshold | Integer | Yes | 0 or more |
| npwp | String | No | 15 or 16 digits, separators allowed |

**Output:**

| Field | Type | Description |
|---|---|---|
| business | Object | Saved settings |

**Business Rules:**
- BR-009: reporting period.
- BR-012: tax rate and threshold.

**System Messages:**

| Condition | Type | Message |
|---|---|---|
| Saved | Success | "Pengaturan usaha disimpan." |
| Invalid day | Error | "Tanggal awal periode harus antara 1 dan 28." |

## 3.2 MOD-02: Accounts & Transactions

### FR-004: Account Management

| Attribute | Description |
|---|---|
| Actor | Owner (manage), Staff and Accountant (view) |
| Priority | High |
| Preconditions | Owner is logged in for changes. |
| Postconditions | The account list and balances are current. |
| PRD Reference | FR-004 |

**Description:**  
Cash, bank, and e-wallet accounts hold the business's money.

**Normal Flow:**
1. The Owner chooses "Add account" and enters name, type, and opening balance.
2. The system saves it and shows it with its balance.
3. The list shows each account's current balance (BR-003) and the total.

**Alternative Flow:**
- Edit name or type at any time. Editing the opening balance recalculates the current balance.
- Archive an account: it disappears from pickers and keeps its history.

**Failure Flow:**
- Duplicate name: field error.
- Delete attempt on an account with transactions: refused with an archive suggestion.

**Input:**

| Field | Type | Required | Validation |
|---|---|---|---|
| name | String | Yes | 1 to 60 characters, unique per business |
| type | Enum | Yes | `cash`, `bank`, `ewallet` |
| opening_balance | Integer | Yes | Any whole rupiah, may be negative for an overdraft |

**Output:**

| Field | Type | Description |
|---|---|---|
| id, name, type | String | Account |
| balance | Integer | Current balance |
| is_archived | Boolean | Archive status |

**Business Rules:**
- BR-001: money is integer rupiah.
- BR-003: account balance.

**System Messages:**

| Condition | Type | Message |
|---|---|---|
| Created | Success | "Akun berhasil dibuat." |
| Has transactions | Error | "Akun sudah punya transaksi. Arsipkan saja." |

### FR-005: Transaction Recording

| Attribute | Description |
|---|---|
| Actor | Owner, Staff (create, edit own), Accountant (view) |
| Priority | High |
| Preconditions | At least one active account. |
| Postconditions | The transaction is saved and balances change. |
| PRD Reference | FR-005 |

**Description:**  
Record, edit, delete, and list income, expense, and transfer transactions, with an optional receipt photo.

**Normal Flow:**
1. The user opens the Add drawer and picks the type.
2. The user fills amount, date, account, category (or destination account for a transfer), note, tags, and optionally a receipt photo.
3. While the user types the note, the system suggests a category (FR-006).
4. The client compresses the photo to at most 1600 px on the long side.
5. On save, the system stores the transaction, links the tags and photo, writes an audit entry, and returns the new account balance.
6. The list page shows transactions newest first with filters for date range, account, type, category, tag, and text.

**Alternative Flow:**
- Edit: allowed for the Owner, or for Staff on their own transaction within 24 hours (BR-013). The change is written to the audit log with old and new values.
- Delete (Owner): soft delete. Balances and reports exclude the transaction.
- Mark as excluded: the transaction stays in the list but is left out of reports.
- Transactions created by the system (sale, debt payment, recurring, import, restock) can be viewed but their amount, account, and date cannot be edited here. The user opens the source record instead.

**Failure Flow:**
- Validation errors return per-field messages.
- Photo upload fails: the transaction saves without the photo and the user can retry the upload.
- Staff edit after 24 hours: 403 with a message.

**Input:**

| Field | Type | Required | Validation |
|---|---|---|---|
| type | Enum | Yes | `income`, `expense`, `transfer` |
| amount | Integer | Yes | 1 to 999,999,999,999 |
| account_id | UUID | Yes | Active account |
| transfer_account_id | UUID | Transfer | Active, different from `account_id` |
| category_id | UUID | Income, expense | Matches the type |
| occurred_on | Date | Yes | Not more than 1 year ahead |
| note | String | No | Up to 500 characters |
| tags | String[] | No | Up to 10, each up to 30 characters |
| receipt | File | No | JPEG, PNG, WebP, up to 5 MB |

**Output:**

| Field | Type | Description |
|---|---|---|
| transaction | Object | Saved record |
| account_balance | Integer | New balance of the account |
| list totals | Object | Income, expense, and net for the filtered range, transfers excluded |

**Business Rules:**
- BR-001, BR-002, BR-003, BR-013.

**System Messages:**

| Condition | Type | Message |
|---|---|---|
| Saved | Success | "Transaksi disimpan." |
| Same account transfer | Error | "Akun asal dan tujuan harus berbeda." |
| Staff edit window over | Error | "Transaksi ini sudah tidak bisa diubah. Hubungi pemilik." |
| Photo failed | Error | "Foto gagal diunggah. Transaksi tetap tersimpan, coba unggah ulang." |

### FR-006: Categories, Tags & Auto-Rules

| Attribute | Description |
|---|---|
| Actor | Owner (manage), Staff and Accountant (view) |
| Priority | Medium |
| Preconditions | Owner is logged in for changes. |
| Postconditions | Categories and rules are saved and used in pickers and suggestions. |
| PRD Reference | FR-006 |

**Description:**  
Categories, free-form tags, and keyword rules that suggest a category.

**Normal Flow:**
1. A new business gets default income and expense categories at registration.
2. The Owner adds a category with name, type, optional parent, and (for expenses) a profit-and-loss group.
3. The Owner adds a rule with keyword, category, and priority.
4. In the rule tester, the Owner types a note and the system shows the category that would be chosen.
5. Tags are created on the fly when a user types a new tag in a transaction.

**Alternative Flow:**
- Archive a category: it leaves pickers and rule targets, history stays.
- Two rules match: the one with the higher priority wins. Equal priority: the longer keyword wins.

**Failure Flow:**
- Duplicate category name under the same type and parent: field error.
- Delete a category with transactions: refused, archive suggested.
- Rule pointing to an archived category: rejected.

**Input:**

| Field | Type | Required | Validation |
|---|---|---|---|
| name | String | Yes | 1 to 60 characters |
| type | Enum | Yes | `income`, `expense` |
| parent_id | UUID | No | A top-level category of the same type |
| pl_group | Enum | Expense | `operating_expense`, `other_expense`, `inventory` |
| keyword | String | Rule | 2 to 50 characters |
| priority | Integer | Rule | 1 to 100 |

**Output:**

| Field | Type | Description |
|---|---|---|
| categories | Tree | With transaction counts |
| matched_category | UUID | Result of the rule test, or null |

**Business Rules:**
- BR-010: the `inventory` group is excluded from profit and loss expenses.

**System Messages:**

| Condition | Type | Message |
|---|---|---|
| Saved | Success | "Kategori disimpan." |
| In use | Error | "Kategori sudah dipakai. Arsipkan saja." |
| No match | Info | "Tidak ada aturan yang cocok." |

## 3.3 MOD-03: Products & Sales

### FR-007: Product & Stock Management

| Attribute | Description |
|---|---|
| Actor | Owner (manage), Staff and Accountant (view) |
| Priority | High |
| Preconditions | Owner is logged in for changes. |
| Postconditions | Stock and movement history are consistent. |
| PRD Reference | FR-007 |

**Description:**  
A product catalog with prices, cost, stock tracking, and stock movements.

**Normal Flow:**
1. The Owner adds a product with name, SKU, unit, sell price, cost price, and tracking settings.
2. With tracking on, opening stock creates an `opening` movement.
3. The Owner records a restock with quantity, optional new cost price, and a switch "record as expense". When on, the system creates an expense in the Inventory Purchase category from a chosen account.
4. The Owner can adjust stock with a reason, which creates an `adjustment` movement.
5. The list shows stock and a low-stock badge when stock is at or below the threshold. Owner and Accountant also see margin.

**Alternative Flow:**
- Deactivate a product: it leaves the sales picker but its history stays.
- Staff view: the response omits `cost_price` and margin (BR-011).

**Failure Flow:**
- Duplicate name or SKU: field error.
- Adjustment below zero: rejected.

**Input:**

| Field | Type | Required | Validation |
|---|---|---|---|
| name | String | Yes | 1 to 120 characters, unique |
| sku | String | No | Up to 40 characters, unique |
| unit | String | Yes | Up to 20 characters |
| sell_price | Integer | Yes | 0 or more |
| cost_price | Integer | Yes | 0 or more |
| track_stock | Boolean | Yes | |
| opening_stock | Decimal | Tracked | 0 or more, 3 decimals |
| low_stock_threshold | Decimal | No | 0 or more |
| restock_qty | Decimal | Restock | Greater than 0 |
| reason | String | Adjustment | 3 to 200 characters |

**Output:**

| Field | Type | Description |
|---|---|---|
| product | Object | Product with current stock |
| movements | Array | Type, quantity, date, user |

**Business Rules:**
- BR-004, BR-011.

**System Messages:**

| Condition | Type | Message |
|---|---|---|
| Saved | Success | "Produk disimpan." |
| Stock below zero | Error | "Stok tidak boleh kurang dari 0." |
| Low stock | Warning | "Stok {produk} tinggal {n} {unit}." |

### FR-008: Sales Recording

| Attribute | Description |
|---|---|
| Actor | Owner, Staff (create, view own), Accountant (view) |
| Priority | High |
| Preconditions | At least one product or a free-text line, and an active account for paid sales. |
| Postconditions | Sale, stock, and cash or receivable records exist together. |
| PRD Reference | FR-008 |

**Description:**  
Record a sale of one or more items, paid now or on credit.

**Normal Flow:**
1. The user opens "New sale" and adds items by product or free text.
2. The user sets quantity and unit price per line, an optional discount, and an optional customer.
3. The user chooses Paid with an account, or Credit with a customer and due date.
4. On save, the system in one database transaction: stores the sale and items with `unit_cost`, reduces stock and writes `sale` movements for tracked products, and creates an income transaction (paid) or a receivable (credit).
5. The system shows the saved sale with a button to create an invoice.

**Alternative Flow:**
- Void (Owner): in one database transaction, set status `void`, restore stock with `void` movements, void the income transaction or the receivable and its payments, and void the invoice if one exists.
- Free-text line: no stock effect, `unit_cost` is 0.

**Failure Flow:**
- Quantity above stock: error naming the product and available quantity. Nothing is saved.
- Credit without a customer: field error.
- Any step fails: the whole save is rolled back.

**Input:**

| Field | Type | Required | Validation |
|---|---|---|---|
| items[].product_id | UUID | No | Active product |
| items[].description | String | Free-text | 1 to 120 characters |
| items[].qty | Decimal | Yes | Greater than 0 |
| items[].unit_price | Integer | Yes | 0 or more |
| discount | Integer | No | 0 to subtotal |
| payment_type | Enum | Yes | `paid`, `credit` |
| account_id | UUID | Paid | Active account |
| contact_id | UUID | Credit | Customer or both |
| due_date | Date | Credit | On or after the sale date |
| sale_date | Date | Yes | Not more than 1 year ahead |

**Output:**

| Field | Type | Description |
|---|---|---|
| sale | Object | With items, subtotal, discount, total |
| transaction_id or debt_id | UUID | Linked cash or receivable record |
| stock warnings | Array | Products now at or below threshold |

**Business Rules:**
- BR-004, BR-005, BR-008, BR-010, BR-011.

**System Messages:**

| Condition | Type | Message |
|---|---|---|
| Saved | Success | "Penjualan disimpan." |
| Not enough stock | Error | "Stok {produk} hanya {n} {unit}." |
| Voided | Success | "Penjualan dibatalkan. Stok dan saldo dikembalikan." |
| Credit without customer | Error | "Pilih pelanggan untuk penjualan kredit." |

## 3.4 MOD-04: Receivables & Payables

### FR-009: Contact Management

| Attribute | Description |
|---|---|
| Actor | Owner (manage), Staff (create, view), Accountant (view) |
| Priority | Medium |
| Preconditions | User is logged in. |
| Postconditions | The contact is available in sales and debts. |
| PRD Reference | FR-009 |

**Description:**  
A list of customers and suppliers.

**Normal Flow:**
1. The user chooses "Add contact" and fills name, type, phone, email, address, and notes.
2. The system saves it.
3. The list supports search by name or phone and filter by type, and shows the outstanding balance per contact.

**Alternative Flow:**
- Edit by the Owner. Archive by the Owner when no open debts exist.

**Failure Flow:**
- Archive with open debts: refused.

**Input:**

| Field | Type | Required | Validation |
|---|---|---|---|
| name | String | Yes | 1 to 120 characters |
| type | Enum | Yes | `customer`, `supplier`, `both` |
| phone | String | No | Digits, spaces, `+`, `-`, up to 30 characters |
| email | String | No | Valid email |

**Output:**

| Field | Type | Description |
|---|---|---|
| contact | Object | Contact with receivable and payable balances |

**Business Rules:**
- A contact is never hard deleted.

**System Messages:**

| Condition | Type | Message |
|---|---|---|
| Saved | Success | "Kontak disimpan." |
| Open debts | Error | "Kontak masih punya hutang atau piutang yang belum lunas." |

### FR-010: Receivables & Payables

| Attribute | Description |
|---|---|
| Actor | Owner (all), Staff (view receivables, record payments), Accountant (view) |
| Priority | High |
| Preconditions | A contact exists. For payments, an active account. |
| Postconditions | Debt balance, status, and cash records are consistent. |
| PRD Reference | FR-010 |

**Description:**  
Track what customers owe and what the business owes, with partial payments.

**Normal Flow:**
1. Credit sales create receivables automatically (FR-008).
2. The Owner can add a manual receivable or a payable bill with contact, amount, issue date, due date, and (for payables) an expense category.
3. A user opens a debt and chooses "Record payment" with date, amount, and account.
4. In one database transaction, the system saves the payment, creates an income transaction (receivable) or an expense transaction (payable) with the right `source_type`, adds to `paid_amount`, and sets the status.
5. The list shows status, remaining balance, and days overdue, sorted by due date.

**Alternative Flow:**
- Void a payment (Owner): the linked transaction is voided and the balance and status are recalculated.
- A debt whose source sale is voided becomes `void` and leaves all totals.

**Failure Flow:**
- Payment above the remaining balance: rejected.
- Payment on a `paid` or `void` debt: rejected.

**Input:**

| Field | Type | Required | Validation |
|---|---|---|---|
| type | Enum | Manual debt | `receivable`, `payable` |
| contact_id | UUID | Manual debt | Active contact |
| amount | Integer | Manual debt | Greater than 0 |
| issue_date | Date | Manual debt | Valid date |
| due_date | Date | Manual debt | On or after issue date |
| category_id | UUID | Payable | Expense category |
| payment.amount | Integer | Payment | 1 to remaining balance |
| payment.account_id | UUID | Payment | Active account |
| payment.paid_on | Date | Payment | Not before the issue date |

**Output:**

| Field | Type | Description |
|---|---|---|
| debt | Object | Amount, paid, remaining, status, overdue days |
| payments | Array | Payment history |

**Business Rules:**
- BR-007, BR-008, BR-010.

**System Messages:**

| Condition | Type | Message |
|---|---|---|
| Payment saved | Success | "Pembayaran dicatat." |
| Above balance | Error | "Pembayaran melebihi sisa tagihan (Rp{n})." |
| Overdue | Warning | "Terlambat {n} hari." |

### FR-011: Invoicing

| Attribute | Description |
|---|---|
| Actor | Owner, Staff (create, view), Accountant (view) |
| Priority | Medium |
| Preconditions | An active sale without an invoice. |
| Postconditions | An invoice with a unique number exists. |
| PRD Reference | FR-011 |

**Description:**  
Create a numbered invoice for a sale and download it as PDF.

**Normal Flow:**
1. The user opens a sale and chooses "Create invoice".
2. The user confirms issue date, due date, and notes.
3. The system assigns the next number, saves the invoice with status `issued`, and offers the PDF.
4. The PDF shows business name, address, NPWP, customer, items, discount, total, payment status, due date, and payment info.
5. When the linked receivable is fully paid, or the sale was paid at the time of sale, the status becomes `paid`.

**Alternative Flow:**
- Owner edits dates or notes while the invoice is `issued`.
- Owner voids an invoice. The number stays used.

**Failure Flow:**
- Second invoice for the same sale: rejected.
- Business address missing: the error links to Settings.
- PDF generation fails: the invoice record stays and the user can retry the download.

**Input:**

| Field | Type | Required | Validation |
|---|---|---|---|
| sale_id | UUID | Yes | Active sale without an invoice |
| issue_date | Date | Yes | Valid date |
| due_date | Date | No | On or after issue date |
| notes | String | No | Up to 500 characters |

**Output:**

| Field | Type | Description |
|---|---|---|
| invoice | Object | Number, dates, status |
| pdf | File | `application/pdf` |

**Business Rules:**
- BR-006, BR-005.

**System Messages:**

| Condition | Type | Message |
|---|---|---|
| Created | Success | "Faktur {nomor} dibuat." |
| Already exists | Error | "Penjualan ini sudah punya faktur." |
| No address | Error | "Lengkapi alamat usaha di Pengaturan sebelum membuat faktur." |

## 3.5 MOD-05: Budget & Recurring

### FR-012: Budgets

| Attribute | Description |
|---|---|
| Actor | Owner (manage), Accountant (view) |
| Priority | Medium |
| Preconditions | Expense categories exist. |
| Postconditions | The budget for the period is saved. |
| PRD Reference | FR-012 |

**Description:**  
A spending limit per expense category for one period.

**Normal Flow:**
1. The Owner picks a period and enters an amount for each category.
2. The system saves one budget per period (upsert).
3. The summary shows, per category and in total: budget, used, remaining, percentage, and remaining per day until the period ends.
4. Categories at or above 100% are flagged over budget. Categories at 80% to 99% are flagged as near the limit.
5. "Used" is the sum of expense transactions in the category within the period, excluding transfers, excluded transactions, and `inventory` categories.

**Alternative Flow:**
- Copy last period's budget into the new one as a starting point.

**Failure Flow:**
- Amount of 0 or negative: field error.
- Period that is not the first day of a period: the system aligns it to the period start.

**Input:**

| Field | Type | Required | Validation |
|---|---|---|---|
| period | Date | Yes | Any date inside the period |
| items[].category_id | UUID | Yes | Active expense category |
| items[].amount | Integer | Yes | Greater than 0 |

**Output:**

| Field | Type | Description |
|---|---|---|
| summary | Array | Per category: budget, used, remaining, percent, status |
| totals | Object | Same figures for all categories |

**Business Rules:**
- BR-009.

**System Messages:**

| Condition | Type | Message |
|---|---|---|
| Saved | Success | "Anggaran disimpan." |
| Over budget | Warning | "{kategori} melebihi anggaran sebesar Rp{n}." |

### FR-013: Recurring Transactions

| Attribute | Description |
|---|---|
| Actor | Owner (manage), Accountant (view), System Scheduler |
| Priority | Medium |
| Preconditions | An active account and category exist. |
| Postconditions | Due rules have posted transactions and moved their next run date. |
| PRD Reference | FR-013 |

**Description:**  
Rules that post income or expense on a schedule.

**Normal Flow:**
1. The Owner creates a rule with type, account, category, amount, note, frequency, start date, and optional end date.
2. The system sets `next_run_on` to the start date.
3. Every day at 00:05 Asia/Jakarta, the scheduler finds active rules with `next_run_on` on or before today.
4. For each such date, it creates a transaction with `source_type` `recurring`, then advances `next_run_on` by the frequency.
5. When `next_run_on` passes `end_on`, the rule becomes inactive.

**Alternative Flow:**
- "Post now": the Owner posts the next due occurrence immediately.
- Pause and resume a rule. Resuming does not backfill the paused days.
- Monthly rules on day 29 to 31 post on the last day of shorter months.

**Failure Flow:**
- A rule that fails to post (for example, its account is archived) is skipped, an error is written to the audit log, and the rule is tried again at the next run. Other rules are not affected.

**Input:**

| Field | Type | Required | Validation |
|---|---|---|---|
| type | Enum | Yes | `income`, `expense` |
| account_id | UUID | Yes | Active account |
| category_id | UUID | Yes | Matches type |
| amount | Integer | Yes | Greater than 0 |
| frequency | Enum | Yes | `daily`, `weekly`, `monthly` |
| start_on | Date | Yes | Valid date |
| end_on | Date | No | After `start_on` |

**Output:**

| Field | Type | Description |
|---|---|---|
| rule | Object | With next run date and last run result |
| posted | Array | Transactions created by a run |

**Business Rules:**
- BR-001, BR-003.

**System Messages:**

| Condition | Type | Message |
|---|---|---|
| Saved | Success | "Transaksi berulang disimpan." |
| Posted now | Success | "Transaksi berulang dicatat." |
| Archived account | Error | "Akun pada aturan ini sudah diarsipkan. Ganti akunnya." |

## 3.6 MOD-06: Dashboard, Reports & Tax

### FR-014: Dashboard

| Attribute | Description |
|---|---|
| Actor | Owner, Staff (limited), Accountant |
| Priority | High |
| Preconditions | User is logged in. |
| Postconditions | None. Read-only. |
| PRD Reference | FR-014 |

**Description:**  
A one-page summary for the current period.

**Normal Flow:**
1. The user opens the dashboard.
2. The system returns cards: today's sales, period revenue, period expenses, estimated net profit, total account balance, receivables and payables outstanding, and overdue count.
3. It also returns the daily revenue versus expense chart for the period, top 5 products by revenue, expense by category, low-stock products, and the 10 latest transactions.
4. The user can switch between this period and last period.

**Alternative Flow:**
- Staff dashboard: today's sales and the Staff user's own latest entries only. No profit, balances, or cost figures.

**Failure Flow:**
- A new business with no data shows empty states with shortcuts to add an account, a product, and a first sale.

**Input:**

| Field | Type | Required | Validation |
|---|---|---|---|
| period | Enum | No | `current`, `previous` |

**Output:**

| Field | Type | Description |
|---|---|---|
| cards | Object | Figures listed above |
| series | Array | Daily revenue and expense |
| top_products, expense_breakdown, low_stock, latest | Arrays | Widgets |

**Business Rules:**
- BR-002, BR-009, BR-010, BR-011.

**System Messages:**

| Condition | Type | Message |
|---|---|---|
| No data | Info | "Belum ada data. Mulai dengan mencatat penjualan pertama." |

### FR-015: Financial Reports & Export

| Attribute | Description |
|---|---|
| Actor | Owner, Accountant |
| Priority | High |
| Preconditions | The user has report access. |
| Postconditions | None. Read-only. |
| PRD Reference | FR-015 |

**Description:**  
Five reports over a date range, exportable as CSV, XLSX, and PDF.

**Normal Flow:**
1. The user picks a report and a range (this period, last period, last 3 periods, this year, or custom).
2. Profit and loss returns revenue, COGS, gross profit, operating expenses, other income, other expenses, and net profit.
3. Cash flow returns money in and out per account and per category, with opening and closing balance.
4. Sales by product returns quantity, revenue, COGS, and margin.
5. Expense by category returns amount and share of total.
6. Receivable aging returns open receivables in buckets 0 to 30, 31 to 60, 61 to 90, and over 90 days past the issue date.
7. "Export" produces a file with the same filters and totals as the screen.

**Alternative Flow:**
- "Compare" adds the previous range of equal length and shows the change.

**Failure Flow:**
- Invalid range: field error.
- Export takes more than 60 seconds: the request fails with a message and can be retried with a smaller range.
- No data in range: empty state.

**Input:**

| Field | Type | Required | Validation |
|---|---|---|---|
| from | Date | Yes | Valid date |
| to | Date | Yes | On or after `from`, at most 5 years apart |
| compare | Boolean | No | Default false |
| format | Enum | Export | `csv`, `xlsx`, `pdf` |

**Output:**

| Field | Type | Description |
|---|---|---|
| rows | Array | Report lines |
| totals | Object | Report totals |
| file | File | Export in the chosen format |

**Business Rules:**
- BR-002, BR-005, BR-008, BR-010, BR-011.

**System Messages:**

| Condition | Type | Message |
|---|---|---|
| Invalid range | Error | "Tanggal akhir harus sama dengan atau setelah tanggal awal." |
| No data | Info | "Tidak ada data pada rentang ini." |
| Export timeout | Error | "Ekspor terlalu lama. Persempit rentang tanggal." |

### FR-016: Tax Estimate

| Attribute | Description |
|---|---|
| Actor | Owner, Accountant |
| Priority | Medium |
| Preconditions | Taxpayer type and tax rate are set. |
| Postconditions | None. The optional "record payment" step creates an expense. |
| PRD Reference | FR-016 |

**Description:**  
Monthly estimate of final income tax from recorded turnover.

**Normal Flow:**
1. The user picks a calendar year.
2. For each month the system computes gross turnover: net sales revenue (sales not void, after discount) plus income transactions with no sale or debt payment source and an income category that is not excluded.
3. It adds a running cumulative turnover.
4. For an individual taxpayer, taxable cumulative turnover is `max(0, cumulative - threshold)`. For a company it equals cumulative turnover.
5. Taxable turnover for the month is this month's taxable cumulative minus the previous month's.
6. Estimated tax for the month is taxable turnover times the tax rate, rounded down to whole rupiah.
7. The page shows all 12 months, a year total, and the line "Perkiraan, bukan pelaporan pajak."

**Alternative Flow:**
- "Record payment" creates an expense in the Tax category on a chosen account and date for a chosen month's estimate.

**Failure Flow:**
- Missing taxpayer type: prompt to complete Settings.
- A year with no turnover shows zeros with an explanation.

**Input:**

| Field | Type | Required | Validation |
|---|---|---|---|
| year | Integer | Yes | 2020 to current year |

**Output:**

| Field | Type | Description |
|---|---|---|
| months | Array | Turnover, cumulative, taxable, tax |
| total_tax | Integer | Sum for the year |

**Business Rules:**
- BR-012.

**System Messages:**

| Condition | Type | Message |
|---|---|---|
| Disclaimer | Info | "Ini perkiraan. Konfirmasikan tarif dan ketentuan terbaru dengan konsultan pajak." |
| No settings | Error | "Lengkapi jenis wajib pajak di Pengaturan." |

## 3.7 MOD-07: Data Management

### FR-017: Data Import

| Attribute | Description |
|---|---|
| Actor | Owner |
| Priority | Medium |
| Preconditions | At least one active account. |
| Postconditions | Valid rows are saved as transactions with `source_type` `import`. |
| PRD Reference | FR-017 |

**Description:**  
Import transactions from CSV or XLSX files.

**Normal Flow:**
1. The Owner uploads a file.
2. The system reads the first sheet (XLSX) or the file (CSV) and returns the headers and the first 20 rows.
3. The Owner maps columns to date, amount, type (or sign of amount), note, and category, and picks the destination account and a default category.
4. The system builds a preview of all rows with status Valid, Invalid, or Duplicate.
5. The Owner confirms. The system saves all Valid rows (and Duplicates if chosen) in one batch and shows counts.

**Alternative Flow:**
- Amount column with negative values means expense and positive means income when no type column is mapped.
- The category column is matched by name. Unmatched names use the default category.

**Failure Flow:**
- Unreadable file or wrong type: error and nothing is saved.
- More than 5,000 rows or 5 MB: rejected.
- Batch save fails: nothing from the batch is stored.

**Input:**

| Field | Type | Required | Validation |
|---|---|---|---|
| file | File | Yes | CSV or XLSX, up to 5 MB and 5,000 rows |
| mapping | Object | Yes | Date and amount required |
| account_id | UUID | Yes | Active account |
| default_category_id | UUID | Yes | Active category |
| include_duplicates | Boolean | No | Default false |

**Output:**

| Field | Type | Description |
|---|---|---|
| preview | Array | Row, parsed values, status, reason |
| summary | Object | Imported, skipped, failed counts |

**Business Rules:**
- BR-001, BR-014.

**System Messages:**

| Condition | Type | Message |
|---|---|---|
| Done | Success | "{n} transaksi diimpor, {m} dilewati." |
| Too many rows | Error | "File melebihi 5.000 baris." |
| Bad date | Error | "Baris {n}: tanggal tidak dikenali." |

### FR-018: Data Export

| Attribute | Description |
|---|---|
| Actor | Owner, Accountant |
| Priority | Low |
| Preconditions | User has export access. |
| Postconditions | A ZIP file is delivered. An audit entry is written. |
| PRD Reference | FR-018 |

**Description:**  
Download all business data as a ZIP of CSV files.

**Normal Flow:**
1. The user chooses "Export all data".
2. The system builds one UTF-8 CSV per entity with a header row.
3. The system zips the files and starts the download.

**Alternative Flow:**
- Optional date range limits transactions, sales, and debts. Master data is always complete.

**Failure Flow:**
- More than 60 seconds: error with a retry message.

**Input:**

| Field | Type | Required | Validation |
|---|---|---|---|
| from, to | Date | No | Valid range |

**Output:**

| Field | Type | Description |
|---|---|---|
| file | ZIP | CSV per entity. Receipt photos are not included |

**Business Rules:**
- Staff cannot export.

**System Messages:**

| Condition | Type | Message |
|---|---|---|
| Ready | Success | "Ekspor selesai." |
| Timeout | Error | "Ekspor terlalu lama. Coba lagi dengan rentang tanggal lebih kecil." |

### FR-019: Audit Log

| Attribute | Description |
|---|---|
| Actor | Owner, Accountant (view), System |
| Priority | Medium |
| Preconditions | None for writing. View needs Owner or Accountant. |
| Postconditions | The log is append-only. |
| PRD Reference | FR-019 |

**Description:**  
A record of who did what and when.

**Normal Flow:**
1. On every create, update, delete, void, login, failed login, and role change, the system writes an entry in the same database transaction as the change.
2. The entry holds user, time, action, entity type, entity id, and the old and new values of changed fields.
3. The Owner or Accountant opens the log and filters by user, entity, action, and date range.

**Alternative Flow:**
- System jobs such as recurring posts write entries with no user.

**Failure Flow:**
- If the audit entry cannot be written, the change is rolled back.

**Input:**

| Field | Type | Required | Validation |
|---|---|---|---|
| user_id | UUID | No | User of this business |
| entity_type | String | No | Known entity |
| action | String | No | Known action |
| from, to | Date | No | Valid range |

**Output:**

| Field | Type | Description |
|---|---|---|
| entries | Array | Time, user, action, entity, detail |

**Business Rules:**
- Entries cannot be edited or deleted through the application. They are kept for 2 years.
- Passwords and tokens are never written to `detail`.

**System Messages:**

| Condition | Type | Message |
|---|---|---|
| No entries | Info | "Belum ada aktivitas pada filter ini." |

---

# 4. Data Requirements

## 4.1 Data Entities
| Entity | Description | Key Attributes |
|---|---|---|
| Business | The tenant that owns all data | name, taxpayer_type, period_start_day, tax_rate_bp |
| User | A person who logs in | email, role, is_active |
| Account | Cash, bank, or e-wallet | name, type, opening_balance |
| Category | Income or expense group | name, type, pl_group |
| Transaction | One money movement | type, amount, account, category, occurred_on, source_type |
| Product | Something the business sells | name, sell_price, cost_price, stock_qty |
| Stock Movement | A change in stock | product, movement_type, qty |
| Contact | Customer or supplier | name, type |
| Sale and Sale Item | A sale and its lines | total, payment_type, qty, unit_price, unit_cost |
| Debt and Debt Payment | A receivable or payable and its payments | type, amount, paid_amount, due_date, status |
| Invoice | Document for a sale | number, issue_date, status |
| Budget and Budget Item | Limit per category per period | period_start, category, amount |
| Recurring Rule | Scheduled transaction | frequency, next_run_on |
| Category Rule | Keyword to category | keyword, priority |
| Audit Log | Record of a change | user, action, entity, detail |

## 4.2 Data Validation Rules
| Field | Rule | Valid Example | Invalid Example |
|---|---|---|---|
| amount | Whole rupiah greater than 0 | 250000 | 250000.5, 0, -100 |
| email | Valid format, case-insensitive unique | `toko@contoh.id` | `toko@`, a repeated email |
| password | At least 8 characters | `kopi-susu-9` | `abc123` |
| occurred_on | Valid date, at most 1 year ahead | 2026-11-04 | 2028-01-01 |
| period_start_day | Integer 1 to 28 | 25 | 31 |
| tax_rate | 0 to 5 percent | 0.5 | 7 |
| qty | Decimal greater than 0, 3 decimals | 2.5 | 0, 1.2345 |
| invoice number | `INV/YYYY/NNNN` | `INV/2026/0007` | `INV-7` |
| receipt | JPEG, PNG, WebP up to 5 MB | `struk.jpg` 1.2 MB | `struk.pdf`, 9 MB |

## 4.3 Master and Reference Data
Created for each new business at registration:
- **Accounts:** Kas (cash), Bank (bank).
- **Income categories:** Sales (Penjualan), Other Income (Pendapatan Lain).
- **Expense categories:** Inventory Purchase (`inventory`), Rent, Utilities, Salaries, Transport, Marketing, Supplies, Other (`operating_expense`), Tax (`other_expense`).
- **Roles:** owner, staff, accountant.
- **Statuses:** debt (open, partial, paid, void), invoice (draft, issued, paid, void), sale (active, void).
- **Defaults:** period start day 1, tax rate 0.5%, tax threshold Rp500,000,000.

---

# 5. Interface Requirements

## 5.1 User Interface
| Page | Description | Actor | Related Functions |
|---|---|---|---|
| Register / Login | Forms for registration and login | Visitor | FR-001 |
| Change Password | Forced or voluntary password change | All | FR-001 |
| Users | List and edit users | Owner | FR-002 |
| Business Settings | Profile, period, tax, payment info | Owner | FR-003 |
| Accounts | Account list with balances | All | FR-004 |
| Transactions | Filterable list and Add drawer | All | FR-005, FR-006 |
| Categories & Rules | Category tree, rules, tester | Owner | FR-006 |
| Products | Catalog, stock, movements | All | FR-007 |
| New Sale / Sales | Sale form and list | Owner, Staff, Accountant | FR-008 |
| Contacts | Contact list | All | FR-009 |
| Receivables & Payables | Debt list and payment form | All | FR-010 |
| Invoices | Invoice list and detail | All | FR-011 |
| Budgets | Budget form and summary | Owner, Accountant | FR-012 |
| Recurring | Rule list and form | Owner, Accountant | FR-013 |
| Dashboard | Cards and charts | All | FR-014 |
| Reports | Five reports and export | Owner, Accountant | FR-015 |
| Tax Estimate | 12-month table | Owner, Accountant | FR-016 |
| Import | Upload, mapping, preview | Owner | FR-017 |
| Data Export | Export button and range | Owner, Accountant | FR-018 |
| Audit Log | Filterable list | Owner, Accountant | FR-019 |

## 5.2 External Interfaces
| External System | Integration Type | Data Exchanged |
|---|---|---|
| None in version 1.0 | Not applicable | Users move data in and out by file only (FR-015, FR-017, FR-018) |

## 5.3 Reports and Exports
| Report Name | Format | Filters | Actor |
|---|---|---|---|
| Profit and Loss | CSV, XLSX, PDF | Date range, compare | Owner, Accountant |
| Cash Flow | CSV, XLSX, PDF | Date range, account | Owner, Accountant |
| Sales by Product | CSV, XLSX, PDF | Date range | Owner, Accountant |
| Expense by Category | CSV, XLSX, PDF | Date range | Owner, Accountant |
| Receivable Aging | CSV, XLSX, PDF | As-of date | Owner, Accountant |
| Invoice | PDF | Single invoice | Owner, Staff, Accountant |
| All Data | ZIP of CSV | Optional date range | Owner, Accountant |

---

# 6. Traceability Matrix

| PRD ID | FRD ID | Module | Test Case |
|---|---|---|---|
| FR-001 | FR-001 | MOD-01 | TC-001 |
| FR-002 | FR-002 | MOD-01 | TC-002 |
| FR-003 | FR-003 | MOD-01 | TC-003 |
| FR-004 | FR-004 | MOD-02 | TC-004 |
| FR-005 | FR-005 | MOD-02 | TC-005, TC-006 |
| FR-006 | FR-006 | MOD-02 | TC-007 |
| FR-007 | FR-007 | MOD-03 | TC-008 |
| FR-008 | FR-008 | MOD-03 | TC-009, TC-010 |
| FR-009 | FR-009 | MOD-04 | TC-011 |
| FR-010 | FR-010 | MOD-04 | TC-012 |
| FR-011 | FR-011 | MOD-04 | TC-013 |
| FR-012 | FR-012 | MOD-05 | TC-014 |
| FR-013 | FR-013 | MOD-05 | TC-015 |
| FR-014 | FR-014 | MOD-06 | TC-016 |
| FR-015 | FR-015 | MOD-06 | TC-017 |
| FR-016 | FR-016 | MOD-06 | TC-018 |
| FR-017 | FR-017 | MOD-07 | TC-019 |
| FR-018 | FR-018 | MOD-07 | TC-020 |
| FR-019 | FR-019 | MOD-07 | TC-021 |

---

# 7. Acceptance Criteria

| ID | Function | Criteria | Status |
|---|---|---|---|
| AC-001 | FR-001 | Given a new visitor, when they register with valid data, then a business and an Owner exist and the visitor is logged in. | Pending |
| AC-002 | FR-001 | Given five failed logins, when a sixth is attempted within 15 minutes, then it is rejected even with the right password. | Pending |
| AC-003 | FR-002 | Given an Owner, when they deactivate a Staff user with an open session, then that user's next request returns 401. | Pending |
| AC-004 | FR-003 | Given a period start day of 25, when the dashboard loads on 10 November, then "this period" runs from 25 October. | Pending |
| AC-005 | FR-004 | Given an account with opening balance Rp1,000,000 and one expense of Rp250,000, when the list loads, then the balance is Rp750,000. | Pending |
| AC-006 | FR-005 | Given a transfer of Rp100,000 between two accounts, when reports run, then the transfer appears in neither income nor expense. | Pending |
| AC-007 | FR-005 | Given a Staff user, when they edit their own transaction after 24 hours, then the request is rejected. | Pending |
| AC-008 | FR-006 | Given a rule "listrik" for Utilities, when a user types "bayar listrik toko", then Utilities is suggested. | Pending |
| AC-009 | FR-007 | Given a Staff user, when they open a product, then `cost_price` and margin are absent from the response. | Pending |
| AC-010 | FR-008 | Given stock 10, when a sale of 3 is saved, then stock is 7. | Pending |
| AC-011 | FR-008 | Given stock 2, when a sale of 3 is submitted, then it is rejected and nothing changes. | Pending |
| AC-012 | FR-009 | Given a contact with an open receivable, when the Owner tries to archive it, then it is refused. | Pending |
| AC-013 | FR-010 | Given a receivable of Rp1,000,000, when Rp400,000 is paid, then the status is `partial` and the balance is Rp600,000. | Pending |
| AC-014 | FR-010 | Given a receivable payment, when the profit and loss report runs, then the payment adds nothing to revenue. | Pending |
| AC-015 | FR-011 | Given the first invoice of 2026, when it is created, then its number is `INV/2026/0001`. | Pending |
| AC-016 | FR-012 | Given a Rent budget of Rp1,000,000 and Rent expenses of Rp1,200,000, when the summary loads, then Rent shows 120% and over budget. | Pending |
| AC-017 | FR-013 | Given a monthly rule starting on 31 January, when February runs, then it posts on the last day of February. | Pending |
| AC-018 | FR-014 | Given a Staff session, when the dashboard loads, then no profit, balance, or cost figure is returned. | Pending |
| AC-019 | FR-015 | Given sales of Rp2,000,000 with COGS Rp1,200,000 and operating expenses Rp300,000, when profit and loss runs, then gross profit is Rp800,000 and net profit is Rp500,000. | Pending |
| AC-020 | FR-015 | Given a report on screen, when exported to XLSX, then its totals equal the screen totals. | Pending |
| AC-021 | FR-016 | Given a company taxpayer with Rp10,000,000 turnover in a month at 0.5%, when computed, then the tax is Rp50,000. | Pending |
| AC-022 | FR-016 | Given an individual taxpayer with Rp60,000,000 turnover per month, when computed, then month 9 tax is 0.5% of Rp40,000,000 and months 10 to 12 are 0.5% of Rp60,000,000 each. | Pending |
| AC-023 | FR-017 | Given a row identical to an existing transaction, when previewed, then it is marked Duplicate and skipped on import. | Pending |
| AC-024 | FR-018 | Given an export, when opened, then every CSV has a header row and UTF-8 encoding. | Pending |
| AC-025 | FR-019 | Given an edited transaction, when the audit log is opened, then the entry shows the user, the time, and the old and new values of the changed fields. | Pending |

---

# Revision History

| Version | Date | Changes | Author |
|---|---|---|---|
| 1.0 | 04 November 2026 | Initial document | [To be decided: author name] |

# Approval

| Role | Name | Status |
|---|---|---|
| Product Owner | [To be decided] | Pending |
| Technical Lead | [To be decided] | Pending |
| QA Lead | [To be decided] | Pending |

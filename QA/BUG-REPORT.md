# USAHAKU Bug Report

Audit date 25 November 2026. Branch `feat/usahaku-sederhana`, commit `fa7b18f`.

**Environment for every bug below, unless stated:** Windows 11, Node.js 20+, PostgreSQL 16 (database `usahaku_test` only), API from `apps/api/src/app.js`, web from the production build. Reproduction scripts are in `QA/probes/` and run with:

```
node --env-file=.env --test --test-concurrency=1 QA/probes/defects-batch1.test.mjs
node --env-file=.env --test --test-concurrency=1 QA/probes/defects-batch2.test.mjs
```

Each script prints `PROBE <id>: <json>` lines. The IDs below (P1, P2, ...) refer to those lines.

## Summary

| ID | Title | Severity | Module |
|---|---|---|---|
| QA-001 | Auto-created transactions can be re-categorised with no validation, so profit figures go wrong and disagree | High (P1) | Transactions, Reports |
| QA-002 | Transactions accept another business's category and contact IDs | Medium (P2) | Transactions, tenant isolation |
| QA-003 | Unknown or null IDs cause HTTP 500 instead of a field error | Medium (P2) | Transactions, Categories |
| QA-004 | No upper limit on quantity or sale total: overflow gives 500 and very large totals lose precision | Medium (P2) | Sales, Products |
| QA-005 | A transaction on an archived account cannot be edited at all, not even its note | Medium (P2) | Transactions, Accounts |
| QA-006 | The expense form offers "Pembelian Stok", which takes money out but adds no stock | Medium (P2) | Expenses, Inventory |
| QA-007 | Total balance on Akun Kas drops when an account holding money is archived | Low (P3) | Accounts |
| QA-008 | Sales by Product shows old sales under the product's new name | Low (P3) | Reports |
| QA-009 | A failed dashboard load says "Data Anda belum tersimpan" | Low (P3) | Dashboard |
| QA-010 | The removed `receivable-aging` report answers 400, not 404 | Low (P3) | Reports, Regression |
| QA-011 | Data export leaves out tags, receipt photos, and business settings | Low (P3) | Data Export |
| QA-012 | No security headers on API or web responses | Low (P3) | Security |
| QA-013 | Filter pills and the compare checkbox are small touch targets on tablet and desktop | Low (P3) | UI |
| QA-014 | Login throttling answers 400 and is in memory only | Informational (P4) | Auth |
| QA-015 | Login response time shows whether an email is registered | Informational (P4) | Auth |
| QA-016 | The new password may equal the current one | Informational (P4) | Auth |
| QA-017 | The same sale sent twice is stored twice | Informational (P4) | Sales |
| QA-018 | Sales and transactions accept any past date, such as 1900-01-01 | Informational (P4) | Sales, Transactions |

---

### BUG-ID: QA-001

**Title:** Auto-created transactions can be re-categorised with no validation, so profit figures go wrong and disagree

**Severity:** High (P1)

**Module:** Transactions (edit), Dashboard, Laba Rugi

**Environment:** See top. Also reproduced through the UI path: the Riwayat Transaksi drawer keeps the Kategori select enabled for auto-created transactions (`apps/web/src/components/TransactionDrawer.jsx:276-287`, only amount, date, and account are disabled).

**Preconditions:** A product with cost 5.000. Restock of 10 with "catat pengeluaran" on, which creates an expense with `source_type = 'restock'` in the system category Pembelian Stok.

**Steps to Reproduce:**
1. `PUT /api/transactions/{restockExpenseId}` with the same amount, account, and date, and `category_id` = the business's "Sewa" category.
2. Read `GET /api/dashboard` and `GET /api/reports/profit-loss` for today.
3. Repeat step 1 with `category_id` = "Pendapatan Lain" (an income category) and read both figures again.

**Expected Result:** Spec §5.5 and business rule 4: a stock purchase never reduces daily profit. An expense can only carry an active expense category of the same business. The dashboard and Laba Rugi always agree for the same day.

**Actual Result:** (probe P2, P2b)
- Step 1 returns 200. `today_profit` goes from 0 to −50.000, so a stock purchase now reduces profit.
- Step 3 returns 200: an expense now carries an income category. The dashboard shows −50.000 and Laba Rugi shows 0 for the same day.

**Evidence:**
- `PROBE P2_restock_recategorized: {"put":200,"category":"Sewa","profit_before":0,"profit_after":-50000,"pl_net":-50000}`
- `PROBE P2b_expense_with_income_category: {"put":200,"cat":"Pendapatan Lain","dashboard":-50000,"pl_net":0}`
- `apps/api/src/services/transactions.js:97-104`: for `source_type !== 'manual'` only amount, account, and date are compared. `validateLinks` (which checks category type, business, and archive state) runs only for manual transactions.
- `apps/api/src/services/dashboard.js:14` counts every non-inventory row. `apps/api/src/services/reports.js:23-24` keeps only `operating_expense` and `other_expense`, so a row with `pl_group = NULL` counts on one screen and not the other.

**Impact:** One edit by the owner, through a field the UI offers, changes "Laba hari ini" and Laba Rugi so they no longer match each other or the business rule. The owner cannot tell which number is right. A sale's income can also be moved to a financing category such as Modal Pemilik, which moves sales receipts out of operating cash flow.

**Root Cause:** The edit path skips category validation for auto-created transactions.

**Recommended Fix:** In `updateTransaction`, always validate `category_id` with `requireActiveCategory(client, businessId, category_id, before.type)` (or allow archived only when it is unchanged). For `source_type IN ('sale','restock')`, either lock the category (reject a change, like amount) or restrict it to categories with the same `system_key`/`pl_group`. Disable the Kategori select in the drawer for those sources.

**Regression Risk:** Editing notes and tags of auto-created transactions, legacy receivable and payable payment rows, and tests in `transactions.test.js` and `sales.test.js` ("editing an old transaction keeps its contact").

---

### BUG-ID: QA-002

**Title:** Transactions accept another business's category and contact IDs

**Severity:** Medium (P2). This is a broken tenant-isolation invariant, not an open read path: the attacker must already know the other business's UUIDs, and the API never shows them. It would become Critical (P0) if any ID ever leaked (logs, shared exports, screenshots).

**Module:** Transactions, Reports, Categories, tenant isolation

**Environment:** See top.

**Preconditions:** Two businesses, A (attacker) and B (victim). A knows the UUID of one of B's categories and one of B's legacy contacts.

**Steps to Reproduce:**
1. As A, create a cash sale, so A has a `source_type = 'sale'` income transaction.
2. As A, `PUT /api/transactions/{A's sale txn}` with `category_id` = B's category and `contact_id` = B's contact.
3. As A, `GET /api/transactions/{id}` and `GET /api/reports/cash-flow` for today.
4. As A, `POST /api/transactions` (manual expense) with `contact_id` = B's contact.
5. As B, create a new unused category. As A, point a restock expense at it (step 2). As B, `DELETE /api/categories/{that id}`.

**Expected Result:** Every referenced ID must belong to the caller's business, or the request is rejected with 400/404. B's data never appears in A's responses, and A can never affect B's records.

**Actual Result:**
- Step 2 returns 200. Step 3 shows B's category name "Sewa Ruko Rahasia" and B's contact "Pelanggan Rahasia B" in A's transaction and in A's Arus Kas.
- Step 4 returns 201 with `contact_name: "Pelanggan Rahasia B"`.
- Step 5: B's delete fails with HTTP 500, although B's own usage count is 0.

**Evidence:**
- `PROBE P3_cross_tenant_system_tx: {"put":200,"category_name":"Sewa Ruko Rahasia","contact_name":"Pelanggan Rahasia B","cash_flow_shows_victim_category":true}`
- `PROBE P3b_cross_tenant_contact_manual: {"status":201,"contact_name":"Pelanggan Rahasia B"}`
- `PROBE P17_cross_tenant_delete_block: {"attacker_put":200,"victim_delete":500,"victim_usage_count":0}`
- `apps/api/src/routes/transactions.js:25` accepts `contact_id`. `validateLinks` (`services/transactions.js:22-36`) never checks it.
- `apps/api/src/db/transactions.js:14-15` and `db/reports.js:38,114` join `categories` and `contacts` by ID only, with no `business_id` condition.
- `db/migrations/001_init.sql:99-100`: foreign keys reference `categories(id)` and `contacts(id)` alone, so the database cannot stop a cross-business reference.

**Impact:** The database invariant "a row only points at rows of its own business" does not hold. A owner can read the names of B's categories and contacts if the IDs are known, and can stop B from deleting B's own category.

**Root Cause:** Missing ownership checks for `contact_id` (all transactions) and for `category_id` (auto-created transactions), plus single-column foreign keys.

**Recommended Fix:**
1. Reject `contact_id` on create, since contacts are a removed feature. On update, accept only the stored value or null.
2. Validate `category_id` on every update (see QA-001).
3. Defence in depth: add `business_id` to the joins in `db/transactions.js` and `db/reports.js`, and plan composite foreign keys `(business_id, category_id) → categories(business_id, id)` with a data check first.

**Regression Risk:** Legacy transactions that already carry a contact (`sales.test.js` "editing an old transaction keeps its contact"), legacy debt payments, cash-flow grouping.

---

### BUG-ID: QA-003

**Title:** Unknown or null IDs cause HTTP 500 instead of a field error

**Severity:** Medium (P2)

**Module:** Transactions, Categories, error handling

**Environment:** See top.

**Preconditions:** One business.

**Steps to Reproduce:**
1. `POST /api/transactions` (expense) with `contact_id` = a random UUID.
2. `PUT /api/transactions/{restock or sale txn}` with `category_id: null`.
3. The same with `category_id` = a random UUID.
4. QA-002 step 5 (delete of a category referenced elsewhere).

**Expected Result:** 400 with a field message, such as "Pilih kategori aktif dengan jenis yang sesuai."

**Actual Result:** All four return 500 `INTERNAL_ERROR` "Terjadi kesalahan di server. Coba lagi." Nothing is saved, because the transaction rolls back.

**Evidence:**
- `PROBE P1_unknown_contact_status: {"status":500,...}`
- `PROBE P2c_null_category: {"put":500,...}` (CHECK `(type = 'transfer') = (category_id IS NULL)`)
- `PROBE P2d_random_category: {"put":500,...}` (foreign key violation)
- `apps/api/src/middleware/common.js:53-76` maps every non-`AppError` to 500. `lib/errors.js:22-29` handles only unique violations (`23505`), not `23503` or `23514`.

**Impact:** The owner sees "coba lagi" for a request that will never succeed. Monitoring logs a server error for what is a client error.

**Root Cause:** Missing validation before the write (QA-001, QA-002), and no mapping of foreign-key and check violations.

**Recommended Fix:** Fix the validation gaps. As a safety net, map `23503`/`23514` to 400 `VALIDATION_ERROR` in `errorHandler`.

**Regression Risk:** Low. Error-shape tests in `auth.test.js` and `transactions.test.js`.

---

### BUG-ID: QA-004

**Title:** No upper limit on quantity or sale total: overflow gives 500 and very large totals lose precision

**Severity:** Medium (P2)

**Module:** Sales, Products, money handling

**Environment:** See top.

**Preconditions:** One business.

**Steps to Reproduce:**
1. `POST /api/sales` with a free-text line `qty: 1e10, unit_price: 1`.
2. `POST /api/products` with `opening_stock: 1e10`.
3. `POST /api/sales` with a free-text line `qty: 999999, unit_price: 999999999999`.
4. `POST /api/sales` with three lines of `unit_price: 999999999999`.

**Expected Result:** Quantities above the column limit (`NUMERIC(12,3)`, at most 999.999.999,999) and totals above `MAX_AMOUNT` (999.999.999.999, `lib/schemas.js:29`) are rejected with a 400 field error. Stored money is exact.

**Actual Result:**
- Steps 1 and 2: HTTP 500 (numeric overflow).
- Step 3: 201. The true line total 999.998.999.999.000.001 is stored and returned as 999.998.999.999.000.000, losing precision. It is ~1.000.000 times `MAX_AMOUNT`.
- Step 4: 201 with total 2.999.999.999.997, three times `MAX_AMOUNT`.

**Evidence:**
- `PROBE P6a_sale_qty_1e10: {"status":500}`, `PROBE P6b_opening_stock_1e10: {"status":500}`
- `PROBE P6c_line_total_overflow: {"status":201, ... "line_total":999998999999000000}`
- `PROBE P6d_total_above_max_amount: {"status":201,"total":2999999999997}`
- `apps/api/src/lib/schemas.js:47-52`: `quantity` has no maximum. `lib/money.js:8-11` turns a BigInt into `Number`. `db/pool.js:8` parses BIGINT as `Number`. `services/sales.js:116-118` never checks `total <= MAX_AMOUNT`.

**Impact:** One mistyped quantity (for example 1000000 instead of 1) is accepted and puts an absurd figure in revenue, cash, and every report until someone voids the sale. Above 2^53 the stored number is not exact.

**Root Cause:** Missing range checks on quantity and on computed totals.

**Recommended Fix:** Cap `quantity` at 999.999.999 (or a business limit such as 1.000.000) in `lib/schemas.js`. After computing lines, reject any `line_total`, `subtotal`, or `total` above `MAX_AMOUNT`. Apply the same cap to `opening_stock`, restock `qty`, and `qty_delta`.

**Regression Risk:** Decimal-quantity tests (`units.test.js` BR-001), restock and adjustment tests.

---

### BUG-ID: QA-005

**Title:** A transaction on an archived account cannot be edited at all, not even its note

**Severity:** Medium (P2)

**Module:** Transactions, Accounts

**Environment:** See top.

**Preconditions:** A manual expense on account Bank. Bank is then archived.

**Steps to Reproduce:**
1. `PUT /api/transactions/{id}` with every field unchanged except `note: 'catatan baru saja'`.

**Expected Result:** Editing the note, tags, or "dikecualikan" flag of an old record works. Only moving money to an archived account is refused.

**Actual Result:** 400 `"Pilih akun yang masih aktif."` on `account_id`, although the account did not change. The same applies to a manual transaction whose category was archived.

**Evidence:** `PROBE P7_edit_note_on_archived_account: {"status":400,"body":{"error":{"code":"VALIDATION_ERROR","message":"Pilih akun yang masih aktif.","fields":{"account_id":"Pilih akun yang masih aktif."}}}}`. `services/transactions.js:102-103` calls `validateLinks`, which calls `requireActiveAccount` (`services/accounts.js:99-102`) without comparing to the stored value.

**Impact:** After archiving an account (which the app recommends instead of deleting), the owner can no longer fix a typo in the history of that account or exclude a wrong entry from reports.

**Root Cause:** The archive check applies to unchanged references.

**Recommended Fix:** In `validateLinks` for updates, skip the active check when `account_id`, `transfer_account_id`, or `category_id` equals the stored value.

**Regression Risk:** "BR-003: an account with transactions is archived" and transfer validation tests.

---

### BUG-ID: QA-006

**Title:** The expense form offers "Pembelian Stok", which takes money out but adds no stock

**Severity:** Medium (P2), a business-logic and usability trap for the target user

**Module:** Catat Pengeluaran, Inventory, Neraca

**Environment:** See top. Seen in the browser at 375px: the "Untuk apa?" buttons include "Pembelian Stok".

**Preconditions:** A tracked product with stock 0 and cost 5.000.

**Steps to Reproduce:**
1. Open Catat Pengeluaran, enter 50.000, tap "Pembelian Stok", Simpan. (API: `POST /api/transactions` with the Pembelian Stok category.)
2. Open the product and Neraca.

**Expected Result:** Buying stock goes through a flow that also adds the stock (Produk → Stok masuk with "catat pengeluaran"), or the expense form explains that stock must be added from Produk.

**Actual Result:** Cash drops 50.000, product stock stays 0, today's profit stays 0, and Neraca shows "Penyesuaian Saldo" −50.000. A tracked product still cannot be sold, because its stock is 0.

**Evidence:** `PROBE P14_stock_purchase_via_expense: {"profit":0,"is_empty":false,"stock":0,"adjustment":-50000,"inventory":0}`. `apps/web/src/lib/simpleForm.js:12-20` (`expenseCategories`) keeps every active expense category, including the system category `inventory`.

**Impact:** The spec's target user (older owner, little technical confidence) will naturally record a stock purchase here. The money disappears from the books (not in profit, not in inventory), and the next sale of that product is refused for low stock.

**Root Cause:** The expense form does not exclude or redirect the inventory system category.

**Recommended Fix:** Hide categories with `system_key = 'inventory'` from the expense buttons, and show a line such as "Beli stok barang? Catat dari Produk → Stok masuk." with a link. Optionally refuse that category on `POST /transactions` unless `source_type = 'restock'`.

**Regression Risk:** `simpleForm.test.js` category ordering, Guide text.

---

### BUG-ID: QA-007

**Title:** Total balance on Akun Kas drops when an account holding money is archived

**Severity:** Low (P3)

**Module:** Cash accounts

**Steps to Reproduce:** Record income 700.000 into Bank. Read `GET /api/accounts` `total_balance`. Archive Bank. Read it again, and read Neraca for today.

**Expected Result:** Money does not disappear from the owner's total because an account was archived, or archiving a non-zero account is refused or warned.

**Actual Result:** `total_balance` goes 700.000 → 0, while Neraca still shows cash 700.000. (`PROBE P8_archived_balance: {"before":700000,"afterArchive":0,"balance_sheet_cash":700000}`)

**Evidence:** `apps/api/src/services/accounts.js:12-17` filters out archived accounts before summing.

**Impact:** Two screens disagree on how much money the business has.

**Recommended Fix:** Warn or refuse archiving while the balance is not 0, or include archived balances in the total with a note.

**Regression Risk:** Accounts page totals, Neraca.

---

### BUG-ID: QA-008

**Title:** Sales by Product shows old sales under the product's new name

**Severity:** Low (P3)

**Module:** Reports

**Steps to Reproduce:** Sell 1 "Kopi Susu". Rename the product to "Es Teh". Open Penjualan per Produk for that day.

**Expected Result:** A historical report shows what was sold, "Kopi Susu", as the sale line still records.

**Actual Result:** The report lists "Es Teh". The sale detail still says "Kopi Susu". (`PROBE P12_rename: {"report_names":["Es Teh","Total"],"sale_item_desc":"Kopi Susu"}`)

**Evidence:** `apps/api/src/db/reports.js:66-72` uses `COALESCE(p.name, i.description)`.

**Impact:** Past reports change after a rename. Two different products can merge if one is renamed to the other's old name.

**Recommended Fix:** Group by `product_id` and show the current name with the stored description as a subtitle, or group by `i.description`. Decide and document.

**Regression Risk:** "reports: sales by product reconciles with revenue" test.

---

### BUG-ID: QA-009

**Title:** A failed dashboard load says "Data Anda belum tersimpan"

**Severity:** Low (P3)

**Module:** Dashboard, all read screens

**Steps to Reproduce:** In the browser, make `/api/dashboard` fail with a network error (done by overriding `fetch` in the page) and open Beranda.

**Expected Result:** A message about loading, such as "Laba hari ini belum bisa dimuat. Periksa koneksi, lalu coba lagi."

**Actual Result:** "Koneksi terputus. Data Anda belum tersimpan, coba lagi." The buttons stay usable and "Coba lagi" recovers correctly (both PASS).

**Evidence:** `apps/web/src/lib/api.js:126` uses one `CONNECTION_ERROR` text for every request, reads included.

**Impact:** A non-technical owner who just saved a sale may think it was lost and record it again (see QA-017).

**Recommended Fix:** Use a separate message for GET requests.

**Regression Risk:** Save-failure messages on forms.

---

### BUG-ID: QA-010

**Title:** The removed `receivable-aging` report answers 400, not 404

**Severity:** Low (P3)

**Module:** Reports, regression

**Steps to Reproduce:** `GET /api/reports/receivable-aging?from=...&to=...` while signed in.

**Expected Result:** Spec §6: "Route yang dihapus membalas 404."

**Actual Result:** 400 `VALIDATION_ERROR` "Pilihan tidak valid." (`PROBE P11_removed_routes`). The other removed routes (`/users`, `/contacts`, `/debts`, `/invoices`, `/budgets`, `/recurring`, `/tax`, `/import`, `/audit-logs`) correctly answer 404.

**Evidence:** `apps/api/src/routes/finance.js:36,79-85` validates `:name` as an enum.

**Recommended Fix:** Return `notFound()` when the report name is unknown.

**Regression Risk:** "reports validate the range" test.

---

### BUG-ID: QA-011

**Title:** Data export leaves out tags, receipt photos, and business settings

**Severity:** Low (P3)

**Module:** Data export

**Steps to Reproduce:** Record an expense with tag "penting" and a receipt photo. `GET /api/export/data` and list the ZIP entries.

**Expected Result:** "Verify data completeness": the owner's full data can be taken out.

**Actual Result:** The ZIP holds `accounts, categories, products, stock_movements, contacts, transactions, sales, sale_items, debts, payments, invoices`. It has no tags or transaction-tag links, no receipt photos or attachment index, no business profile, and no category rules. (`PROBE P13_export_files`). The legacy contacts, debts, payments, and invoices the spec requires are present (PASS).

**Evidence:** `apps/api/src/db/dataExport.js` `ENTITIES` list.

**Impact:** An owner leaving the app, or restoring from the export, loses tags and receipts.

**Recommended Fix:** Add `tags`, `transaction_tags`, `attachments` (and optionally the image files), `businesses` (own row), and `category_rules`.

**Regression Risk:** AC-024 export test.

---

### BUG-ID: QA-012

**Title:** No security headers on API or web responses

**Severity:** Low (P3)

**Module:** Security, deployment

**Steps to Reproduce:** Read the headers of `GET /api/auth/me` and `GET /api/transactions/{id}/receipt`.

**Expected Result:** At least `X-Content-Type-Options: nosniff`, frame protection (`X-Frame-Options: DENY` or CSP `frame-ancestors 'none'`), `Referrer-Policy`, and HSTS in production. `Cache-Control: no-store` on authenticated JSON.

**Actual Result:** None present (`PROBE P9_headers: {"nosniff":null,"frame":null,"csp":null,"cache":null}`, `P19_uploads ... "nosniff":null`). Neither `Caddyfile` nor `apps/web/Caddyfile` sets headers.

**Impact:** The app can be framed (clickjacking on actions like "Batalkan penjualan"). Uploaded files rely on browser defaults for type handling. Financial JSON may be cached by shared devices.

**Recommended Fix:** Add a `header` block in `Caddyfile`, or a small middleware in `app.js`.

**Regression Risk:** Low. Check PDF/XLSX downloads after adding headers.

---

### BUG-ID: QA-013

**Title:** Filter pills and the compare checkbox are small touch targets on tablet and desktop

**Severity:** Low (P3)

**Module:** UI

**Steps to Reproduce:** At 768px open Riwayat Transaksi, Produk, Akun Kas, Kategori, Laporan, and measure control heights.

**Expected Result:** `DESIGN.md:162`: "other buttons 48px". A 768px tablet is a touch device.

**Actual Result:** Filter pills (Semua, Pemasukan, Pengeluaran, Transfer, Stok menipis, Tampilkan arsip, report tabs) are 36px tall at 768px and above. The Laporan "Bandingkan" checkbox is 20px at 375/390px. At 375 and 390 the pills meet the size.

**Evidence:** In-page measurement during the layout scan (Phase 6).

**Recommended Fix:** Keep the mobile pill height up to the `lg` breakpoint, and wrap the checkbox in a 48px label.

**Regression Risk:** Layout of report tab rows.

---

### BUG-ID: QA-014

**Title:** Login throttling answers 400 and is in memory only

**Severity:** Informational (P4)

**Module:** Auth

**Evidence:** `apps/api/src/routes/auth.js:53-55` returns `AppError(400, 'RATE_LIMITED')`. `middleware/common.js:34-47` keeps counters in a `Map` that is cleared completely once it holds more than 10.000 keys, and resets on restart. The per-account lockout (5 failures, 15 minutes, `services/auth.js:11-12`) works (automated test AC-002 PASS).

**Recommended Fix:** Return 429 with `Retry-After`. Evict old minute buckets instead of clearing all.

---

### BUG-ID: QA-015

**Title:** Login response time shows whether an email is registered

**Severity:** Informational (P4)

**Module:** Auth

**Evidence:** `PROBE P9_login_timing_ms: {"unknown":[5,3,3],"known":[66,64,59]}`. `services/auth.js:105-107` returns before running argon2 when the email is unknown or inactive. Registration already says "Email sudah terdaftar", so this adds little new exposure.

**Recommended Fix:** Verify against a fixed dummy hash when the user is missing.

---

### BUG-ID: QA-016

**Title:** The new password may equal the current one

**Severity:** Informational (P4)

**Module:** Change password

**Evidence:** `PROBE P9_change_to_same_password: {"status":200}`. `services/auth.js:137-145` has no such check.

**Recommended Fix:** Refuse with "Kata sandi baru harus berbeda."

---

### BUG-ID: QA-017

**Title:** The same sale sent twice is stored twice

**Severity:** Informational (P4)

**Module:** Sales

**Evidence:** `PROBE P21_duplicate: {"statuses":[201,201],"sales_count":2}`. The web form blocks double clicks with an in-flight guard (`apps/web/src/lib/hooks.js` `useSubmit`, PASS), but a network retry or a second tab creates a duplicate.

**Recommended Fix:** Accept an optional `Idempotency-Key` header on `POST /sales` and `POST /transactions`.

---

### BUG-ID: QA-018

**Title:** Sales and transactions accept any past date, such as 1900-01-01

**Severity:** Informational (P4)

**Module:** Sales, Transactions

**Evidence:** `PROBE P20b_far_past_and_leap: {"sale_1900":201}`. `lib/schemas.js:33-36` (`notFarAhead`) only limits future dates.

**Impact:** A wrong year silently changes figures of a closed period.

**Recommended Fix:** Ask for confirmation in the UI for dates older than, for example, 90 days, and set a sensible lower bound in the API.

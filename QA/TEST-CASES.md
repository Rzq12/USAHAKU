# USAHAKU Test Case Catalog

Executed 25 November 2026 on commit `fa7b18f`. Evidence sources:

- **AT**: existing automated suite (`npm test`: 93 API tests, 22 web tests), named by test title.
- **P#/E#**: QA probes in `QA/probes/` (`defects-batch1`, `defects-batch2`, `edge-cases`), named by their `PROBE` line.
- **UI**: browser run against the production build on the isolated test database.
- **Code**: source inspection only. Used for NOT TESTED rows, never as the basis for a PASS.

Priority uses the bug scale: P0 critical to P4 informational.

## Authentication and session

| ID | Module | Scenario | Preconditions | Test Steps | Expected Result | Actual Result | Status | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-AUTH-01 | Auth | Register a new business | None | Fill all fields on `/daftar`, submit | 201, session cookie, Kas and Bank accounts, default categories, lands on Beranda | UI: landed on Beranda with toast "Akun berhasil dibuat". AT AC-001 PASS | PASS | P0 |
| TC-AUTH-02 | Auth | Register with empty fields | `/daftar` open | Submit empty form | Submission blocked with messages | All 4 inputs are `required`, browser blocks submit (UI) | PASS | P2 |
| TC-AUTH-03 | Auth | Register with password equal to email, or too short | None | POST `/auth/register` | 400 field error | AT "registration rejects a duplicate email and a password equal to the email" | PASS | P2 |
| TC-AUTH-04 | Auth | Register an existing email | Email registered | POST `/auth/register` again | 400 "Email sudah terdaftar." | AT PASS | PASS | P2 |
| TC-AUTH-05 | Auth | Login with valid credentials | Owner exists | POST `/auth/login` | 200, HttpOnly SameSite=Lax cookie | AT + P23 owner_login 200 | PASS | P0 |
| TC-AUTH-06 | Auth | Login with wrong password or unknown email | Owner exists | POST `/auth/login` | 401, one generic message | AT "wrong credentials return one generic message" | PASS | P1 |
| TC-AUTH-07 | Auth | Login response time does not reveal accounts | Owner exists | Time unknown vs known email | Similar timing | 3-5 ms vs 59-66 ms (P9). QA-015 | FAIL | P4 |
| TC-AUTH-08 | Auth | Login with a disabled legacy Staff account | Staff row, `is_active=false` | POST `/auth/login` | 401, row kept | P23 staff_login 401, row kept. AT PASS | PASS | P0 |
| TC-AUTH-09 | Auth | Lockout after 5 failures | Owner exists | 5 wrong logins, then the right one | 6th refused, 15 min lock | AT AC-002 PASS | PASS | P1 |
| TC-AUTH-10 | Auth | Rate limit per minute | None | 11 attempts in one minute | 429 with retry info | Unit test PASS for the count. Response is 400 `RATE_LIMITED` (code, QA-014) | FAIL | P4 |
| TC-AUTH-11 | Auth | Logout | Signed in | POST `/auth/logout`, then GET `/auth/me` | 204, then 401 | AT PASS | PASS | P1 |
| TC-AUTH-12 | Auth | API without session | Signed out | GET every protected endpoint | 401 | AT "every endpoint except register and login needs a session". P11 anon 401 | PASS | P0 |
| TC-AUTH-13 | Auth | Refresh page after login | Signed in | Full page navigations between pages | Stays signed in | UI: every `navigate` reloaded the page and the session held | PASS | P1 |
| TC-AUTH-14 | Auth | Expired session | Session `expires_at` in the past | GET `/auth/me`, POST `/auth/logout` | 401 | P18: 401 and 401 | PASS | P1 |
| TC-AUTH-15 | Auth | Sliding session renewal | Session older than 1 hour | Use the app | `expires_at` extended | Code only (`middleware/auth.js:25-28`) | NOT TESTED | P3 |
| TC-AUTH-16 | Auth | Change password | Signed in on two clients | Change password on one | Other session ended | AT "changing a password ends other sessions" | PASS | P1 |
| TC-AUTH-17 | Auth | Change password with wrong current password | Signed in | POST change-password | 400 on `current_password` | E3 wrongCurrent 400 | PASS | P2 |
| TC-AUTH-18 | Auth | New password too short | Signed in | POST with 6 chars | 400 | E3 shortNew 400 | PASS | P2 |
| TC-AUTH-19 | Auth | New password equal to current | Signed in | POST with the same password | 400 | 200 (P9). QA-016 | FAIL | P4 |
| TC-AUTH-20 | Auth | CSRF header required | Signed in | POST without `X-Usahaku-Client` | 403 | AT PASS | PASS | P1 |
| TC-AUTH-21 | Auth | Cookie `Secure` in production | `NODE_ENV=production` behind TLS | Inspect Set-Cookie | `Secure` set | Production stack not available | BLOCKED | P1 |

## Dashboard (Beranda)

| ID | Module | Scenario | Preconditions | Test Steps | Expected Result | Actual Result | Status | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-DASH-01 | Dashboard | Profit formula, independent calculation | Mixed day (P16) | Sales 50.000 + 20.000, cost 30.000, other income 5.000, expense 12.000, plus a voided sale, capital, drawings, a restock, and yesterday's expense | 33.000 | Dashboard 33.000, Laba Rugi 33.000 | PASS | P0 |
| TC-DASH-02 | Dashboard | Empty state | New business | Open `/` | Rp0 and "Belum ada catatan hari ini..." | UI matches | PASS | P2 |
| TC-DASH-03 | Dashboard | Negative profit | Expense larger than profit | Record expense 45.000 after profit 29.000 | −Rp16.000 shown in rose | UI −Rp16.000 | PASS | P1 |
| TC-DASH-04 | Dashboard | Zero profit with entries | Entries netting 0 | GET `/dashboard` | 0, not empty | AT "today_profit can be negative and a new business is empty" | PASS | P2 |
| TC-DASH-05 | Dashboard | Today's entries in, yesterday's out | Expense dated yesterday | GET `/dashboard` | Yesterday ignored | P16 (99.999 yesterday ignored). AT PASS | PASS | P1 |
| TC-DASH-06 | Dashboard | Stock purchase does not reduce profit | Restock with expense | GET `/dashboard` | Unchanged | AT "today_profit ignores ... stock purchases". P16 | PASS | P0 |
| TC-DASH-07 | Dashboard | API failure | Dashboard request fails | Open `/` | Reason shown, buttons usable | Buttons usable. Message says "Data Anda belum tersimpan" (QA-009) | FAIL | P3 |
| TC-DASH-08 | Dashboard | Retry | After TC-DASH-07 | Tap "Coba lagi" | Profit loads | UI: −Rp16.000 loaded | PASS | P2 |
| TC-DASH-09 | Dashboard | Navigation during load and error | Failing request | Use buttons and Menu lain | Work | UI PASS | PASS | P2 |
| TC-DASH-10 | Dashboard | Dashboard and Laba Rugi agree after editing a transaction | Restock expense re-categorised | Compare | Same figure | Dashboard −50.000, Laba Rugi 0 (P2b). QA-001 | FAIL | P1 |

## Sales

| ID | Module | Scenario | Preconditions | Test Steps | Expected Result | Actual Result | Status | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-SAL-01 | Sales | One product | Stock 10 | Sell 3 | Stock 7, movement, income | AT AC-010 PASS | PASS | P0 |
| TC-SAL-02 | Sales | Several products | 2 products | UI: Kopi ×2 + Nasi Goreng | Total 51.000, profit 29.000 | UI matches | PASS | P0 |
| TC-SAL-03 | Sales | Increase and decrease quantity | Line added | Tap card 3 times, then − | Qty 3 then 2, total updates | UI 69.000 then saved 51.000 | PASS | P1 |
| TC-SAL-04 | Sales | Zero quantity | Product | POST qty 0 | 400 | E1 400 | PASS | P1 |
| TC-SAL-05 | Sales | Negative quantity | Product | POST qty −1 | 400 | E1 400 | PASS | P1 |
| TC-SAL-06 | Sales | Fractional quantity | Product | Qty 2,5 and 1,0005 | 2,5 accepted, 4 decimals refused | P16 stock 47,5. E1 400 | PASS | P1 |
| TC-SAL-07 | Sales | Insufficient stock | Stock 2 | UI: qty 3, Simpan | Clear message, form kept | UI "Stok ... hanya 2 gelas.", lines kept | PASS | P0 |
| TC-SAL-08 | Sales | Zero stock | Stock 0 | Tap card, or POST | Card disabled, API 422 | UI card disabled. E1 422 | PASS | P1 |
| TC-SAL-09 | Sales | Custom item or service | None | Free-text line | Saved, no stock or cost | AT PASS. P16 Jasa antar | PASS | P1 |
| TC-SAL-10 | Sales | Discount | Subtotal 51.250 | Discount 1.250; then discount above subtotal | Total 50.000; above refused | P16 PASS. E1 400 | PASS | P1 |
| TC-SAL-11 | Sales | Different active account | Bank active | Sale into Bank | Bank balance rises | AT and UI select | PASS | P2 |
| TC-SAL-12 | Sales | Archived or missing account | Bank archived | POST with Bank, or null | 400 | E1 400 and 400 | PASS | P1 |
| TC-SAL-13 | Sales | Invalid dates | None | `2026-13-01`, `2099-01-01` | 400 | E1 400 and 400 | PASS | P2 |
| TC-SAL-14 | Sales | Very old date | None | `1900-01-01` | Refused or confirmed | 201 (P20b). QA-018 | FAIL | P4 |
| TC-SAL-15 | Sales | Duplicate submission | None | Two identical POSTs | One sale, or an idempotency key | 2 sales (P21). Client double-click guard works. QA-017 | FAIL | P4 |
| TC-SAL-16 | Sales | Concurrent sales of the last unit | Stock 1 | 4 parallel sales | 1 success, stock 0 | 201,422,422,422, stock 0 (P4) | PASS | P0 |
| TC-SAL-17 | Sales | Failed sale leaves nothing | Fault mid-save | Run | Nothing stored | AT SRS-F-008 PASS | PASS | P0 |
| TC-SAL-18 | Sales | Credit sale refused | None | `payment_type:'credit'` | 400 | E/P6i 400. AT PASS | PASS | P0 |
| TC-SAL-19 | Sales | `contact_id` refused | None | Include `contact_id` | 400 | P6i 400. AT PASS | PASS | P0 |
| TC-SAL-20 | Sales | Void a paid sale | Paid sale | Void | Stock back, income removed | AT BR-005. P5 stock 5, Kas 0 | PASS | P0 |
| TC-SAL-21 | Sales | Concurrent void | Paid sale | 3 parallel voids | 1 success, 2 × 409 | 200,409,409 (P5) | PASS | P1 |
| TC-SAL-22 | Sales | Void after product deactivated and repriced | Sold product changed | Void | Stock back, history kept | P22 200, stock 5, line cost 12.000 kept | PASS | P1 |
| TC-SAL-23 | Sales | Huge quantity | None | qty 1e10 | 400 | 500 (P6a). QA-004 | FAIL | P2 |
| TC-SAL-24 | Sales | Total above `MAX_AMOUNT` | None | Lines summing > 999.999.999.999 | 400 | 201, precision lost (P6c, P6d). QA-004 | FAIL | P2 |
| TC-SAL-25 | Sales | Low-stock warning | Threshold 1 | Sell to 0 | Warning on save | UI notice "tinggal 0 gelas". AT PASS | PASS | P2 |

## Expenses

| ID | Module | Scenario | Preconditions | Test Steps | Expected Result | Actual Result | Status | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-EXP-01 | Expenses | Record an expense | Kas active | UI: 45.000, Listrik dan Utilitas, Simpan | Saved, profit drops | UI −Rp16.000 | PASS | P0 |
| TC-EXP-02 | Expenses | Missing or wrong-type category | None | No category; income category | 400 | E2 400 and 400 | PASS | P1 |
| TC-EXP-03 | Expenses | Zero, negative, decimal amount | None | 0, −5, 10,5 | 400 | E2 400 ×3. AT BR-001 | PASS | P1 |
| TC-EXP-04 | Expenses | Invalid date | None | `2026-02-30` | 400 | E2 400 | PASS | P2 |
| TC-EXP-05 | Expenses | Note optional, length limit, Indonesian text | None | Note with "—" and "Rp"; 501 chars | Saved as typed; 501 refused | E2 note kept exactly, 400 for 501 | PASS | P2 |
| TC-EXP-06 | Expenses | Receipt JPEG/PNG/WebP | Expense | Upload real PNG bytes | Saved and served to owner only | AT receipts PASS. P19 served `image/png` | PASS | P1 |
| TC-EXP-07 | Expenses | Unsupported format | Expense | SVG/HTML renamed `.png` | 400 | P19 400 | PASS | P1 |
| TC-EXP-08 | Expenses | Oversized file | Expense | 6 MB | 400 "Foto melebihi 5 MB." | P19 400 | PASS | P2 |
| TC-EXP-09 | Expenses | Receipt through browser file picker | UI | Attach photo, Simpan | Uploaded or warned | Not run in the browser | NOT TESTED | P2 |
| TC-EXP-10 | Expenses | No active account | All accounts archived | Open form | Hint and Simpan disabled | Code only (`NewExpense.jsx:508-516,567`) | NOT TESTED | P2 |
| TC-EXP-11 | Expenses | Failed submission keeps input | Request fails | Save | Inputs kept, message | Same `useSubmit` path verified on the sale form (TC-SAL-07) | PASS | P2 |
| TC-EXP-12 | Expenses | Cash balance after expense | Kas 0 | Expense 12.500 | Balance −12.500 | E2 −12.500 (negative balances are allowed) | PASS | P1 |
| TC-EXP-13 | Expenses | "Pembelian Stok" offered on expense form | Tracked product | Record via expense | Stock flow or guidance | No stock added, Neraca adjustment −50.000 (P14). QA-006 | FAIL | P2 |

## Products and inventory

| ID | Module | Scenario | Preconditions | Test Steps | Expected Result | Actual Result | Status | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-PRD-01 | Products | Create product | None | POST `/products` | 201 | UI setup + AT | PASS | P1 |
| TC-PRD-02 | Products | Update product | Product | PUT name/price | Saved, history unchanged | P22 line cost kept | PASS | P1 |
| TC-PRD-03 | Products | Deactivate product | Product | `is_active:false` | Leaves picker, sale refused | AT "inactive products leave the picker" | PASS | P1 |
| TC-PRD-04 | Products | Duplicate name or SKU | Product exists | POST duplicate | 400 field error | E3 400 and 400 | PASS | P2 |
| TC-PRD-05 | Products | Negative stock via adjustment | Stock 10 | `qty_delta −999` | 422 | E3 422 | PASS | P1 |
| TC-PRD-06 | Products | Adjustment with decimals | Stock 10 | `−2,5` with reason | 7,5 | E3 7,5 | PASS | P1 |
| TC-PRD-07 | Products | Restock with expense | Product | Restock 10 with expense | Stock +10, Pembelian Stok expense, profit unchanged | AT PASS. P16 | PASS | P0 |
| TC-PRD-08 | Products | Restock an untracked product | Untracked | Restock | 409 | E3 409 | PASS | P2 |
| TC-PRD-09 | Products | Inventory valuation in Neraca | Stock bought | Neraca | Qty × current cost, note shown | AT balance-sheet suite PASS (documented policy) | PASS | P2 |
| TC-PRD-10 | Products | Opening stock overflow | None | `opening_stock 1e10` | 400 | 500 (P6b). QA-004 | FAIL | P2 |
| TC-PRD-11 | Products | History after rename | Sold product renamed | Penjualan per Produk | Old name for old sales | New name shown (P12). QA-008 | FAIL | P3 |

## Transaction history

| ID | Module | Scenario | Preconditions | Test Steps | Expected Result | Actual Result | Status | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-TRX-01 | Transactions | Order, filters, totals | Several entries | List with filters | Newest first, filters apply, totals exclude transfers | AT "soft delete ... list filters work", transfer test | PASS | P1 |
| TC-TRX-02 | Transactions | Transfer between accounts | Two accounts | Transfer; same account | Balances move; same account refused | AT AC-006, BR-002 | PASS | P1 |
| TC-TRX-03 | Transactions | Soft delete | Manual entry | Delete | Out of balances and reports | AT PASS | PASS | P1 |
| TC-TRX-04 | Transactions | Delete a sale transaction | Sale | DELETE | 409, void from the sale | Code + AT system-transaction rule | PASS | P1 |
| TC-TRX-05 | Transactions | Excluded flag | Entry | Mark excluded | Listed, out of totals | AT PASS | PASS | P2 |
| TC-TRX-06 | Transactions | Edit category of an auto-created transaction | Restock or sale entry | Change category | Refused or validated | Accepted with any category (P2, P2b). QA-001 | FAIL | P1 |
| TC-TRX-07 | Transactions | Null or unknown category on edit | Auto-created entry | PUT | 400 | 500 (P2c, P2d). QA-003 | FAIL | P2 |
| TC-TRX-08 | Transactions | Unknown `contact_id` | None | POST | 400 | 500 (P1). QA-003 | FAIL | P2 |
| TC-TRX-09 | Transactions | Edit note on archived account | Account archived | PUT note | 200 | 400 (P7). QA-005 | FAIL | P2 |
| TC-TRX-10 | Transactions | Audit trail of edits | Entry edited | Read audit rows | Old and new values | AT AC-025 PASS | PASS | P3 |
| TC-TRX-11 | Transactions | Pagination | > 25 entries | Pages | Correct slices | Code only (`limit/offset`, max 100) | NOT TESTED | P3 |

## Financial reports

| ID | Module | Scenario | Preconditions | Test Steps | Expected Result | Actual Result | Status | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-REP-01 | Reports | Laba Rugi figures | Known data | Run | Gross 800.000, net 500.000 | AT AC-019 PASS. UI 51.000/22.000/29.000 | PASS | P0 |
| TC-REP-02 | Reports | Compare with previous period | Data | `compare=true` | Previous range of equal length | AT PASS | PASS | P2 |
| TC-REP-03 | Reports | Arus Kas reconciles | Data | Run | Opening + flow + transfers = closing | AT reports suite (several) PASS | PASS | P1 |
| TC-REP-04 | Reports | Penjualan per Produk reconciles with revenue | Data | Run | Totals equal Laba Rugi revenue | AT PASS | PASS | P1 |
| TC-REP-05 | Reports | Pengeluaran per Kategori excludes stock, investing, financing | Data | Run | Excluded with note | AT PASS | PASS | P1 |
| TC-REP-06 | Reports | Neraca balances | Data | Run | Assets = liabilities + equity | AT balance-sheet suite (12) PASS | PASS | P1 |
| TC-REP-07 | Reports | Month and year boundaries | Sales on 31 Dec, 1 Jan, 31 Jan, 1 Feb | Run each month | 1.000 / 6.000 / 8.000; cross range 15.000 | P20 exactly | PASS | P1 |
| TC-REP-08 | Reports | Empty period | No data | Run every report | Empty state, files still export | AT PASS | PASS | P2 |
| TC-REP-09 | Reports | Invalid range | `from > to`, > 5 years, `2026-02-30` | Run | 400 | AT PASS. P6h 400 | PASS | P2 |
| TC-REP-10 | Reports | Daily, weekly, custom presets | UI | Pick presets | Correct ranges | UI shows Periode ini/lalu/3 periode/Tahun ini/Pilih tanggal; only "Periode ini" exercised | NOT TESTED | P3 |
| TC-REP-11 | Reports | Large values | Totals near `MAX_AMOUNT` | Run | Exact figures | Totals above the limit are accepted and lose precision (QA-004) | FAIL | P2 |
| TC-REP-12 | Reports | Capital, loans, equipment stay out of profit | Data | Run | Only cash flow and Neraca | AT PASS. P16 | PASS | P0 |
| TC-REP-13 | Reports | Export CSV/XLSX/PDF holds same totals | Data | Export | Same as screen | AT AC-020, XLSX, CSV, PDF tests | PASS | P1 |
| TC-REP-14 | Reports | Three-statement package | Data | Export XLSX/PDF | Three sheets/pages, agree | AT financial-statements suite | PASS | P2 |

## Cash accounts and categories

| ID | Module | Scenario | Preconditions | Test Steps | Expected Result | Actual Result | Status | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-ACC-01 | Accounts | Balance = opening ± entries | Account | Expense | Correct balance | AT AC-005 PASS | PASS | P0 |
| TC-ACC-02 | Accounts | Delete with history refused | Has entries | DELETE | 409, archive instead | AT BR-003 PASS | PASS | P1 |
| TC-ACC-03 | Accounts | Archive with money | Bank 700.000 | Archive | Total stays or archive refused | Total drops to 0, Neraca 700.000 (P8). QA-007 | FAIL | P3 |
| TC-ACC-04 | Accounts | Confirmation before archive or delete | UI | Code review | ConfirmDialog | `Accounts.jsx:180-198` | PASS | P2 |
| TC-CAT-01 | Categories | In-use category archived, not deleted | Used category | DELETE | 409 | AT PASS | PASS | P2 |
| TC-CAT-02 | Categories | System categories protected | Penjualan, Pembelian Stok | Archive or reclassify | Refused | AT "a category can be reclassified, except the system ones" | PASS | P1 |
| TC-CAT-03 | Categories | Keyword rule suggestion | Rules | Test note | Priority then length | AT AC-008 PASS | PASS | P3 |

## Data export, settings, guide

| ID | Module | Scenario | Preconditions | Test Steps | Expected Result | Actual Result | Status | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-EXP-D-01 | Export | ZIP of every entity as UTF-8 CSV with BOM | Data | GET `/export/data` | All entities, header rows, audited | AT AC-024 PASS | PASS | P1 |
| TC-EXP-D-02 | Export | Legacy contacts, debts, payments, invoices included | Legacy rows | Export | Present | P13 file list | PASS | P1 |
| TC-EXP-D-03 | Export | Indonesian characters and formula safety | Note with "—", "Rp", leading "=" | Export | Kept; formulas neutralised | AT CSV formula test. E2 note round-trip | PASS | P2 |
| TC-EXP-D-04 | Export | Completeness | Tags, receipts | Export | Included | Missing (P13). QA-011 | FAIL | P3 |
| TC-EXP-D-05 | Export | Large dataset | 100k rows in a test database | GET `/export/data` | Finishes within 60 s | Not run | NOT TESTED | P3 |
| TC-SET-01 | Settings | Save settings keeps legacy NPWP/tax | Legacy values | PUT | Kept | AT PASS | PASS | P2 |
| TC-GUI-01 | Guide | Guide page renders, no removed features | UI | Open `/panduan` | Renders | Layout scan PASS at 5 widths | PASS | P3 |

## Security

| ID | Module | Scenario | Preconditions | Test Steps | Expected Result | Actual Result | Status | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-SEC-01 | Security | IDOR on products, sales, transactions, accounts | Two businesses | A reads/voids/edits B's IDs | 404 | E4 404 ×5 | PASS | P0 |
| TC-SEC-02 | Security | Use another business's account or product in a sale | Two businesses | POST sale | 400 | E4 400 ×2 | PASS | P0 |
| TC-SEC-03 | Security | Tenant AT suite | Two businesses | Existing test | Isolated | AT "tenancy: a business cannot read or touch rows of another business" | PASS | P0 |
| TC-SEC-04 | Security | Cross-business category/contact references | Two businesses, known IDs | P3, P3b, P17 | Refused | Accepted; names leak; victim delete 500. QA-002 | FAIL | P2 |
| TC-SEC-05 | Security | SQL injection | Any | Review every query; search `q`, `tag` filters | Parameterised | All values bound as `$n`. `LIMIT/OFFSET` built from zod-validated integers | PASS | P0 |
| TC-SEC-06 | Security | Password hashing | None | Review | Argon2id | `services/auth.js:18-20` | PASS | P0 |
| TC-SEC-07 | Security | Session token storage | None | Review | Random 256-bit, stored hashed | `services/auth.js:28-31`, SHA-256 in DB | PASS | P1 |
| TC-SEC-08 | Security | Error disclosure | Force 500 | Read body | Generic message, no stack | P1/P6a: generic message only | PASS | P1 |
| TC-SEC-09 | Security | Audit log has no secrets | Login events | Read rows | No password/token | AT PASS | PASS | P1 |
| TC-SEC-10 | Security | Security headers | Any | Read headers | nosniff, frame, HSTS | None (P9, P19). QA-012 | FAIL | P3 |
| TC-SEC-11 | Security | Malformed JSON | Signed in | Broken body | 400 | P6f 400 | PASS | P2 |
| TC-SEC-12 | Security | Upload stored outside web root with random name | Upload | Review | Random name under business folder | `services/transactions.js:177-183` | PASS | P1 |
| TC-SEC-13 | Security | CORS | Any | Review | No permissive CORS | No CORS middleware; same-origin only | PASS | P2 |

## Regression (single-owner simplification)

| ID | Module | Scenario | Preconditions | Test Steps | Expected Result | Actual Result | Status | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-REG-01 | Regression | Removed API routes | Signed in | GET each | 404 | 9 routes 404 (P11) | PASS | P1 |
| TC-REG-02 | Regression | Removed report `receivable-aging` | Signed in | GET | 404 | 400 (P11). QA-010 | FAIL | P3 |
| TC-REG-03 | Regression | Removed web pages | Signed in | Open `/kontak` | "Halaman tidak ditemukan" | Layout scan rendered NotFound | PASS | P2 |
| TC-REG-04 | Regression | Migration 003 disables non-owners, ends sessions | Staff and Accountant rows | Run migration | Disabled, sessions gone, owner untouched | AT PASS | PASS | P0 |
| TC-REG-05 | Regression | Disabled account with an open session | Session existed | Call API | 401 | AT PASS | PASS | P0 |
| TC-REG-06 | Regression | Void a legacy credit sale | Credit sale + payment + invoice | Void | Debt void, payment void, Kas reversed, invoice void | P15: debt void, payment void, Kas 100.000 → 0. AT PASS | PASS | P0 |
| TC-REG-07 | Regression | Old periods keep credit sales and payables in Laba Rugi | Legacy rows | Laba Rugi | Counted on sale/issue date | AT BR-010, AC-014 PASS | PASS | P0 |
| TC-REG-08 | Regression | "Pelunasan piutang" stays in Arus Kas | Legacy payment | Arus Kas | Own line | AT PASS | PASS | P1 |
| TC-REG-09 | Regression | No stale nav links or role code in web | Build | Review Layout, More | Only current pages | `Layout.jsx:8-23` lists only kept pages; no `usePermissions`/`RoleRoute` found | PASS | P2 |
| TC-REG-10 | Regression | Migration on a real production snapshot | Snapshot | Dry run | Same as tests | No snapshot available | BLOCKED | P1 |

## UI and UX

| ID | Module | Scenario | Preconditions | Test Steps | Expected Result | Actual Result | Status | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-UI-01 | UI | No horizontal overflow at 375/390/768/1280/1440 | 14 pages | In-page scan | No overflow | 0 overflow on every page/width | PASS | P1 |
| TC-UI-02 | UI | No text under 16px | 14 pages × 5 widths | Scan | ≥ 16px | Min 16px everywhere | PASS | P1 |
| TC-UI-03 | UI | Primary buttons ≥ 56px | Same | Scan | ≥ 56px | 56px (forms), 72px (home) | PASS | P1 |
| TC-UI-04 | UI | Other controls ≥ 48px | Same | Scan | ≥ 48px | Pills 36px at ≥ 768px, checkbox 20px. QA-013 | FAIL | P3 |
| TC-UI-05 | UI | Desktop navbar | 1280px | Look | Beranda, Penjualan, Pengeluaran, Laporan, Menu lain | Matches spec §4.2 | PASS | P2 |
| TC-UI-06 | UI | Mobile "Kembali ke Beranda" | 375px | Inner pages | Present | Present on sale, expense, change password | PASS | P2 |
| TC-UI-07 | UI | Confirmations before void/delete/archive | UI | Review | ConfirmDialog | Sale void, transaction delete, account and category archive/delete, product deactivate | PASS | P1 |
| TC-UI-08 | UI | Keyboard and focus | UI | Review | Visible focus, dialog traps focus, Escape closes | `:focus-visible` style; native `<dialog>`; skip link | PASS | P2 |
| TC-UI-09 | UI | Light theme only | UI | Review | No dark mode | No dark tokens or `prefers-color-scheme` | PASS | P3 |
| TC-UI-10 | UI | Screen reader pass | UI | NVDA/VoiceOver | Usable | Not run | NOT TESTED | P2 |
| TC-UI-11 | UI | Long product names | 50-char name | Picker card | Wraps, no overflow | UI wraps over 4 lines | PASS | P3 |

## Deployment and operations

| ID | Module | Scenario | Preconditions | Test Steps | Expected Result | Actual Result | Status | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-OPS-01 | Build | `npm test`, `npm run lint`, `npm run build` | Repo | Run | All green | 93 + 22 tests pass, lint clean, build OK | PASS | P0 |
| TC-OPS-02 | Deploy | `docker compose up -d --build` with Caddy TLS | VPS | Run | App served over HTTPS | No production environment | BLOCKED | P1 |
| TC-OPS-03 | Backup | `scripts/backup.sh` and restore | Running stack | Run and restore | Dump and receipts restorable | Not run; reviewed only | BLOCKED | P1 |
| TC-OPS-04 | Ops | Only one API instance (scheduler) | Deploy | Review | Documented | README states it | PASS | P3 |

## Totals

| Status | Count |
|---|---|
| PASS | 123 |
| FAIL | 23 |
| BLOCKED | 4 |
| NOT TESTED | 7 |
| **Total** | **157** |

Failed cases by priority: P1 2, P2 9, P3 7, P4 5. Each FAIL maps to a bug in `BUG-REPORT.md` (one bug can fail several cases).

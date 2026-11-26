# USAHAKU QA Final Report

Audit date 25 November 2026. Branch `feat/usahaku-sederhana`, commit `fa7b18f`. Related documents: [TEST-PLAN.md](TEST-PLAN.md), [TEST-CASES.md](TEST-CASES.md), [BUG-REPORT.md](BUG-REPORT.md), [REGRESSION-REPORT.md](REGRESSION-REPORT.md). Reproduction scripts: [probes/](probes/).

## 1. Overall status

**Not ready for production.** The core workflows (register, record a sale, record an expense, see today's profit, read reports) work, and every profit, cash, and stock figure checked by hand was correct. One P1 defect lets a normal edit in Riwayat Transaksi make "Laba hari ini" and Laba Rugi wrong and inconsistent. Several P2 defects affect validation, tenant isolation, and the expense flow. Production infrastructure, backup and restore, and the migration on real data were not tested.

No P0 defect was found.

## 2. Test summary

| Measure | Count |
|---|---|
| Test cases | 157 |
| Passed | 123 |
| Failed | 23 |
| Blocked | 4 |
| Not tested | 7 |
| Existing automated tests | 93 API + 22 web, all passing |
| `npm run lint` | Passing |
| `npm run build` | Passing |

## 3. Defects by severity

| Severity | Count | IDs |
|---|---|---|
| Critical (P0) | 0 | none |
| High (P1) | 1 | QA-001 |
| Medium (P2) | 5 | QA-002, QA-003, QA-004, QA-005, QA-006 |
| Low (P3) | 7 | QA-007 to QA-013 |
| Informational (P4) | 5 | QA-014 to QA-018 |
| **Total** | **18** | |

## 4. What was verified correct

- **Profit formula.** A mixed day (two sales with a discount, a fractional quantity, a free-text service, a voided sale, other income, capital, drawings, an expense, a restock purchase, and an expense dated yesterday) gave a hand-calculated profit of 33.000. The dashboard and Laba Rugi both showed 33.000. Cash and stock also matched by hand.
- **Business rules from the spec.** New sales are always paid; credit sales and `contact_id` are refused; stock purchases do not reduce daily profit; capital, loans, and equipment never reach profit.
- **Stock and concurrency.** Four parallel sales of the last unit: one succeeded, stock ended at 0. Three parallel voids: one succeeded, two got 409. A failed sale stores nothing.
- **Legacy data.** Voiding an old credit sale reverses the receivable, its payment, the cash, and the invoice. Old periods keep their figures. Disabled Staff and Accountant rows cannot log in and are kept.
- **Tenant isolation on main resources.** Another business's products, sales, transactions, and accounts answer 404, and cannot be used in a sale.
- **Validation.** Zero, negative, and decimal money; invalid dates; malformed JSON; invalid IDs all give 400.
- **UI.** No horizontal overflow, no text under 16px, primary buttons at least 56px, on 14 pages at 375, 390, 768, 1280, and 1440px. Confirmations exist before void, delete, and archive.

## 5. Critical business risks

1. **Profit can be made wrong from the UI (QA-001).** The Kategori field stays editable on auto-created sale and restock transactions, and the API accepts any category there. Moving a stock purchase to "Sewa" reduces profit. Moving it to an income category makes the dashboard and Laba Rugi disagree. The owner has no way to know which number is right.
2. **Stock bought through the expense form disappears from the books (QA-006).** "Pembelian Stok" is a big button on Catat Pengeluaran. Using it takes cash out, adds no stock, does not touch profit, and creates a balance-sheet adjustment. The spec's target user will very likely use it.
3. **A typo in quantity is accepted (QA-004).** There is no upper limit on quantity or sale total. Absurd totals go into every report, and above 2^53 the stored amount is not exact.
4. **History becomes partly read-only after archiving (QA-005).** Archiving an account, which the app recommends, blocks editing any of its old transactions.

## 6. Security findings

| Finding | Severity | Notes |
|---|---|---|
| Cross-business category and contact references accepted (QA-002) | P2 | Needs the other business's UUIDs, which the API never exposes. Names leak into the caller's responses, and the other business's category delete fails with 500. The database foreign keys cannot block it. |
| HTTP 500 on unknown IDs (QA-003) | P2 | No internal details leak; the error body is generic. |
| No security headers (QA-012) | P3 | No nosniff, frame protection, or HSTS in the API or Caddy config. |
| Login timing reveals registered emails (QA-015) | P4 | Registration already reveals it. |
| Login throttling 400 and in-memory only (QA-014) | P4 | Per-account lockout works. |
| Verified controls | — | Argon2id hashing; 256-bit session tokens stored as SHA-256; HttpOnly SameSite=Lax cookie; CSRF header on every write; parameterised SQL everywhere; uploads typed by magic bytes, 5 MB limit, random names per business; generic error bodies; no secrets in audit logs. |

## 7. Regression findings

The simplification is clean. Removed routes answer 404 (except `receivable-aging`, QA-010). No role code or stale navigation remains. Legacy credit sales, receivables, payables, and invoices stay correct in reports, voids, and the export. Remaining compatibility risks are in `REGRESSION-REPORT.md` §3: reactivating a legacy user gives full owner access, and migration 003 has only been tested on synthetic rows.

## 8. Prioritised remediation plan

| Order | Fix | Bugs | Effort |
|---|---|---|---|
| 1 | Validate `category_id` on every transaction update (same business, right type, active unless unchanged). Lock or restrict the category of sale and restock transactions, and disable that select in the drawer. | QA-001, part of QA-002, QA-003 | Small |
| 2 | Refuse a new `contact_id` on transactions; keep only the stored value on update. Add `business_id` to the category and contact joins. Plan composite foreign keys. | QA-002, QA-003 | Small to medium |
| 3 | Cap quantity and stock values, and refuse any line total, subtotal, or total above `MAX_AMOUNT`. Map foreign-key and check violations to 400. | QA-004, QA-003 | Small |
| 4 | Hide "Pembelian Stok" from the expense form and point to Produk → Stok masuk. | QA-006 | Small |
| 5 | Skip the "active" check for an unchanged account or category on update. | QA-005 | Small |
| 6 | Add security headers in Caddy. | QA-012 | Small |
| 7 | Fix the read-error message, return 404 for the removed report, decide the archive and rename rules, and complete the export. | QA-007 to QA-011 | Small each |
| 8 | Informational items: 429 for throttling, constant-time login, same-password check, idempotency key, past-date guard, tablet touch sizes. | QA-013 to QA-018 | Optional |

For each fix, add the matching probe from `QA/probes/` to `apps/api/tests/` as a regression test, with the expected (fixed) behaviour.

## 9. Production readiness assessment

| Criterion | Status |
|---|---|
| All critical workflows verified | Met |
| Financial calculations independently validated | Met for normal input. Not met for edited auto-created transactions (QA-001) and very large values (QA-004). |
| No unresolved P0 | Met |
| No unresolved P1 affecting core operations | **Not met** (QA-001) |
| Database integrity verified | Partly. Transactions roll back correctly, but cross-business references are possible (QA-002). |
| Authentication and data isolation verified | Met for main resources; gap in QA-002. |
| Legacy data compatibility verified | Met on synthetic legacy rows. Not verified on a production snapshot. |
| Important regression tests passed | Met, one minor failure (QA-010). |
| Deployment and backup reviewed | **Not met.** Reviewed by reading only; not run. |

**Recommendation:** fix items 1 to 5 of the plan (all small), rerun `npm test` with the new regression tests, then run the blocked checks below before go-live.

## 10. Limitations

These were not tested and must not be read as passing:

- Production Docker Compose stack, Caddy TLS, the `Secure` cookie flag, and real response headers behind Caddy (BLOCKED).
- `scripts/backup.sh` and a restore drill (BLOCKED).
- Migration 003 on a copy of production data (BLOCKED).
- Load and performance, including export of a large dataset within the 60-second limit.
- Screen-reader testing; keyboard behaviour was reviewed in code, not driven end to end.
- Receipt upload through the browser file picker (tested through the API).
- Report presets other than "Periode ini", sliding session renewal, transaction list pagination, and the "no active account" state of the forms (reviewed in code only).
- Browsers other than Chromium.

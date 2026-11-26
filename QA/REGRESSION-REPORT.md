# USAHAKU Regression Report

Scope: regressions from the change of the multi-role app to the single-owner app (spec dated 4 November 2026), commits `f091585` to `fa7b18f`.

## 1. Result summary

| Area | Result |
|---|---|
| Removed API routes | 9 of 10 answer 404. `GET /reports/receivable-aging` answers 400 (QA-010). |
| Removed web pages | Old addresses such as `/kontak` show "Halaman tidak ditemukan". |
| Legacy Staff and Accountant accounts | Cannot log in, open sessions are refused, rows are kept. |
| Owner accounts | Login, session, and every remaining feature work. |
| Historical data kept | No table or column dropped. Contacts, debts, payments, and invoices remain and are in the export. |
| Legacy financial figures | Old credit sales and payable bills still count in Laba Rugi on their original dates. Old receivable payments still show as "Pelunasan piutang" in Arus Kas. |
| Voiding an old credit sale | Receivable voided, payments voided, cash reversed, invoice voided, stock restored. |
| Stale role code or navigation | None found in web or API. |
| New-sale rules | Credit sales and `contact_id` are refused. |
| Contact field on transactions | Still accepted, without validation (QA-002, QA-003). This is a leftover of the removed Contacts feature. |

## 2. Detailed results

| Check | Method | Evidence | Status |
|---|---|---|---|
| `/users`, `/contacts`, `/debts`, `/invoices`, `/budgets`, `/recurring`, `/tax`, `/import`, `/audit-logs` → 404 | Probe P11, AT "removed commerce routes answer 404", "removed finance routes answer 404" | All 404 when signed in, 401 when signed out | PASS |
| `/reports/receivable-aging` → 404 | Probe P11 | 400 "Pilihan tidak valid." | FAIL (QA-010) |
| Migration 003 disables non-owners and deletes their sessions; owner unchanged | AT "the single-role migration disables non-Owners and ends their sessions" | Passes | PASS |
| Disabled account with an existing session | AT "a disabled old account cannot use an open session or log in" | 401 | PASS |
| Disabled Staff login, row kept | Probe P23 | `staff_login 401`, `staff_row_kept true`, owner 200 | PASS |
| `/auth/me` has no role | AT "the users route is gone and /auth/me carries no role" | Passes | PASS |
| Void legacy credit sale (spec §5.4) | AT "BR-005: voiding an old credit sale voids the receivable, its payments, and its invoice"; Probe P15 | Debt `void`, `paid_amount 0`; payment `is_void true`; Kas 100.000 → 0; June net profit 200.000 → 0 | PASS |
| Old credit sales still in Laba Rugi | AT "BR-010: old credit sales keep counting on the sale date" | Passes | PASS |
| Old payables still in expenses (`EXPENSE_LINES`) | AT "AC-014 / BR-008", reports suite | Passes | PASS |
| "Pelunasan piutang" line in Arus Kas | AT "old receivable payments show apart from cash sales" | Passes | PASS |
| Export keeps contacts, debts, payments, invoices | Probe P13, AT AC-024 | Files present | PASS |
| Settings save keeps NPWP and tax values | AT "saving settings keeps stored NPWP and tax values" | Passes | PASS |
| Daily job no longer runs recurring rules | Code `jobs/scheduler.js:6-10` | Only sessions and audit logs cleaned | PASS |
| No `usePermissions`, `RoleRoute`, `ROLE_NAMES`, `requireRole` | Code search of `apps/` | None found | PASS |
| Navigation lists only kept pages | `components/Layout.jsx:8-23` | Matches spec §4.2 and §4.5 | PASS |
| `recharts` removed | `apps/web/package.json` | Not a dependency | PASS |

## 3. Compatibility risks

| Risk | Detail | Recommendation |
|---|---|---|
| A reactivated legacy user gets full owner access | Spec §5.2 accepts this, but `is_active = true` alone gives a Staff or Accountant row every owner power, including Neraca and export. | Document in the operations runbook. Consider requiring a role change to `owner` before reactivation. |
| Legacy transactions carrying a contact | They still show a contact name and the edit path keeps `contact_id`. The same path accepts any contact ID (QA-002). | Keep the stored contact on update but refuse new values. |
| Recurring rules stopped silently | Spec §5.5 accepts this. Owners who relied on them will see missing entries. | Mention in release notes. |
| Open legacy receivables | Still counted in Neraca as Piutang Usaha, but there is no screen to collect them. | Release notes; export lists them. |
| Migration tested only on synthetic rows | Legacy rows in tests are inserted by SQL. | Dry-run migration 003 on a copy of production data and compare Laba Rugi for past months before and after (spec §3: "Angka laba periode lama tidak boleh berubah"). |
| Product rename changes past report labels | QA-008 | Decide grouping rule before release. |

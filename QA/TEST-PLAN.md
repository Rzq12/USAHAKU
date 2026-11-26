# USAHAKU QA Test Plan

Version 1.0, 25 November 2026. Branch `feat/usahaku-sederhana`, commit `fa7b18f`.

## 1. Objectives

- Confirm the simplified single-owner app (spec dated 4 November 2026, `Docs/superpowers/specs/2026-11-04-usahaku-sederhana-design.md`) behaves as specified.
- Check every financial figure against values calculated by hand, not against the app's own output.
- Find data-integrity, tenant-isolation, and security defects that would block production.
- Confirm that legacy data (credit sales, receivables, invoices, payables, Staff and Accountant users) stays compatible.
- Check the UI against `DESIGN.md`: text at least 16px, main buttons at least 56px, light theme only, no horizontal overflow.

## 2. Scope

**In scope:** authentication and sessions, dashboard (Beranda), sales, expenses, transaction history, products and stock, cash accounts, categories, reports (Neraca, Laba Rugi, Arus Kas, Penjualan per Produk, Pengeluaran per Kategori), report export (CSV, XLSX, PDF, the three-statement package), full data export (ZIP), settings, change password, guide, removed routes, migration `003_single_role.sql`, and the database schema.

**Out of scope (spec §7 or by decision):** more than one user per business, forgotten password, dropping legacy tables, moving open legacy debts elsewhere. Features the spec removed (Users, Contacts, Debts, Invoices, Budgets, Recurring, Tax, Import, Audit log UI) were tested only to confirm they are gone.

**Not executed in this cycle:** production Docker Compose stack, Caddy TLS, `scripts/backup.sh` run and restore, load and performance testing, screen-reader testing, real 7-day session expiry (simulated in the database instead), and receipt upload through the browser file picker (tested through the API).

## 3. Strategy

| Level | Approach |
|---|---|
| Static review | Read every API route, service, and query, every migration, and the web pages. Mapped spec rules to code. |
| Automated | Ran `npm test` (93 API, 22 web), `npm run lint`, `npm run build`. |
| API and integration | Two probe suites in `QA/probes/` call the real HTTP API against an isolated database and check results and database side effects. |
| Business logic | Hand-calculated expected profit, cash, and stock for a mixed scenario, then compared with the dashboard, Laba Rugi, account balances, and product stock. |
| Security | Tenant isolation, IDOR, CSRF header, session handling, upload type checks, error disclosure, response headers, login throttling. |
| Regression | Removed routes, legacy credit-sale void, migration behaviour, disabled legacy users. |
| UI | Browser automation on a QA instance: register, sell (including over-stock), expense, dashboard error and retry, reports. Automated layout scan of 14 pages at 375, 390, 768, 1280, and 1440 px. |

High-risk modules, in priority order: transactions (edit path), sales and void, reports and dashboard formulas, tenant isolation, products and stock.

## 4. Test environment

| Item | Value |
|---|---|
| OS | Windows 11, Node.js 20+, Docker Desktop |
| Database | PostgreSQL 16 (`usahaku-postgres-1`, local port 55432). Tests used only `usahaku_test`. `apps/api/tests/support.js` refuses a URL without `test` and resets that schema. |
| API | Express app from `apps/api/src/app.js`, run in-process by the test harness and by a QA-only server |
| Web | Production build from `apps/web/dist`, served with the API on `127.0.0.1:5180` and wired to `usahaku_test` |
| Browser | Claude built-in browser (Chromium) |
| Data | Only throwaway businesses created by the tests; the dev database `usahaku` and the developer's running dev server were not touched |

## 5. Tools

`node:test`, Vitest, ESLint, Prettier, Vite build, the custom HTTP probe suites, and browser automation with in-page JavaScript measurement.

## 6. Entry criteria

- The repository builds and the dev Postgres container is running.
- An isolated test database exists and the harness guard is in place.
- The 4 November 2026 spec is available as the reference.

## 7. Exit criteria

- Every test case has a recorded status of PASS, FAIL, BLOCKED, or NOT TESTED.
- Every FAIL is a reproducible bug in `BUG-REPORT.md` with evidence.
- No open P0. No open P1 on core workflows before release.
- Untested areas are listed in `QA-FINAL-REPORT.md`.

## 8. Risks and dependencies

| Risk | Effect | Mitigation |
|---|---|---|
| Production infrastructure not available locally | Caddy headers, TLS, cookies with `secure`, backup and restore are not verified | Marked NOT TESTED; review before go-live |
| Shared dev Postgres container | Accidental writes to dev data | Used only `usahaku_test`; harness guard checked |
| Single API instance with an in-process scheduler and in-memory rate limiter | Limits reset on restart and are not shared | Documented as a risk (QA-014) |
| Legacy data shapes come from direct SQL inserts in tests | Real legacy rows may differ | Recommend a dry run of migration `003` on a production snapshot |

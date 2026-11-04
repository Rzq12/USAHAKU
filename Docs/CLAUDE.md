# CLAUDE.md

Instructions for Claude Code in this repository. This file is read automatically in every session.

## About the Project

usahaku is a bookkeeping and finance web app for Indonesian UMKM. It records sales, expenses, stock, receivables, and payables, and produces profit and tax estimate reports for three roles: Owner, Staff, and Accountant.

- Stack: React 18, Vite, Tailwind CSS, Node.js 20, Express, Zod, PostgreSQL 16, Docker Compose
- UI language: Indonesian (code, API fields, and docs in English)
- Reference documents: @docs/PRD.md, @docs/FRD.md, @docs/SRS.md

## Commands

```bash
npm install        # Install dependencies
npm run dev        # Run API (:3000) and web (:5173)
npm run migrate    # Apply SQL migrations in db/migrations
npm test           # Run Vitest (web) and node:test (api)
npm run lint       # Lint and format
npm run build      # Production build
```

## Architecture

- `apps/web/` : React pages, components, and API client
- `apps/api/src/routes/` : thin Express handlers, one file per module
- `apps/api/src/services/` : business rules (sales, debts, reports, tax)
- `apps/api/src/db/` : parameterized SQL and the connection pool
- `apps/api/src/jobs/` : daily scheduler for recurring transactions
- `db/migrations/` : versioned SQL files

Main data flow: page, API client, route, service, SQL, PostgreSQL.

## Code Rules

- Write simple code. Avoid abstractions that are not needed yet.
- Do not add fallback logic or backward compatibility unless I ask.
- Follow the patterns in the surrounding files before creating a new one.
- Do not add dependencies without asking.
- Validation and authorization happen in the backend, not only in the frontend.
- Money is integer rupiah. Never use floats for money.
- Every query filters by `business_id`.
- Writes that touch several tables run in one database transaction and include the audit entry.

## How to Work

- For a task that touches more than three files, explain a short plan before changing code.
- Run tests and lint after changes and report the results as they are.
- If a requirement is unclear or conflicts with the reference documents, ask. Do not guess.
- Do not change files outside the task scope.

## Do Not

- Do not read or change `.env` files with real values.
- Do not commit or push unless I ask.
- Do not run destructive commands (`rm -rf`, `DROP`, `git reset --hard`) without confirmation.
- Do not delete or weaken tests to make them pass.

## Notes

- Profit and loss counts revenue from `sales`, not from income transactions. Transfers and debt payments are never income or expense (BR-002, BR-008).
- Staff API responses must not include cost price, margin, profit, or balances (BR-011).
- Tax rate and threshold come from business settings. Do not hard code them.
- The scheduler runs in the API process, so deploy a single API instance.
- Stock changes only through stock movements. Never update `stock_qty` without writing a movement.

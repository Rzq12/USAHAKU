# AGENT.md

Guide for AI coding agents working in this repository. Read this whole file before changing code.

## Project Summary

usahaku is a bookkeeping and finance web app for Indonesian UMKM (small businesses). Owners, staff, and accountants record sales, expenses, stock, receivables, and payables, and read profit, cash flow, and tax estimate reports.

- Name: usahaku
- Stack: React 18, Vite, Tailwind CSS (web); Node.js 20, Express, Zod (API); PostgreSQL 16; Docker Compose
- Reference documents: `docs/PRD.md`, `docs/FRD.md`, `docs/SRS.md`

## Key Commands

```bash
# Install dependencies (npm workspaces, run from the repo root)
npm install

# Run development mode (API on :3000, web on :5173, needs a local PostgreSQL)
npm run dev

# Run database migrations
npm run migrate

# Run tests (Vitest for apps/web, node:test for apps/api)
npm test

# Lint and format
npm run lint

# Build
npm run build
```

## Directory Structure

```
usahaku/
├── apps/
│   ├── web/              # React app (pages, components, lib)
│   └── api/              # Express API
│       ├── src/routes/   # One file per module, thin handlers
│       ├── src/services/ # Business rules (sales, debts, reports, tax)
│       ├── src/db/       # SQL queries and the pg pool
│       └── src/jobs/     # Daily scheduler (recurring posts)
├── db/migrations/        # Versioned SQL migration files
├── docs/                 # PRD.md, FRD.md, SRS.md
├── docker-compose.yml    # api, web, postgres, caddy
└── .env.example          # Variable names only, no real values
```

## Code Style

- Write simple, readable code. Pick the plainest way, not the cleverest.
- Do not add fallback logic or backward compatibility unless explicitly asked.
- One function, one job. Names of functions and variables must be clear without comments.
- Follow the naming conventions already in the repository.
- Do not add new dependencies without a clear reason.
- Store money as integer rupiah. Never use floating point for money.
- Write plain SQL with parameters in `src/db`. Do not add an ORM.
- Keep business rules in `src/services`. Route handlers only check input, call a service, and return the result.

## Testing

- Every behavior change needs a test.
- Run the tests before saying the work is done.
- Never delete or weaken a test to make it pass.
- Business rules BR-001 to BR-014 in `docs/PRD.md` each need at least one test.

## Boundaries

**Allowed without asking:**
- Reading files, running tests, lint, and build.
- Changing code inside the scope of the requested task.

**Ask first:**
- Adding or replacing dependencies.
- Changing the database schema or any existing migration file.
- Changing CI/CD, Docker, or deployment configuration.
- Changing a role permission in the access control table of `docs/PRD.md`.

**Never:**
- Store secrets, passwords, or tokens in code or commits.
- Change `.env` files that hold real values.
- Force push or rewrite git history.
- Delete production data.

## Git and Commits

- Commit format: `type: short description` (example: `fix: reject sale above stock`).
- One commit per logical change.
- Do not commit build output or temporary files.

## Project-Specific Notes

- Every query must filter by `business_id`. A query that can return another business's rows is a security bug.
- Role checks happen in the API on every endpoint. Hiding a button in the web app is not authorization.
- A sale, a debt payment, a void, and an import each write several tables. Run them in one database transaction, including the audit entry.
- Transfers and debt payments must never count as income or expense in profit and loss (BR-002, BR-008). Revenue comes from the `sales` table, not from income transactions linked to sales.
- Staff responses must not contain `cost_price`, margin, profit, or account balances (BR-011).
- Tax rate and threshold are business settings. Do not hard code 0.5% or Rp500,000,000 in calculations.
- The scheduler runs inside the API process, so run only one API instance.

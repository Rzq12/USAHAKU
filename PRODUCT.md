# Product

## What it is

usahaku is a bookkeeping and finance web app for Indonesian UMKM (micro, small, and medium businesses). It records sales, expenses, stock, receivables, and payables, and shows real profit, cash flow, and a final-tax estimate.

## Register

Product UI. Visitors come to complete a task. No marketing site is in scope.

## Users and their scene

- **Owner (pemilik):** basic skills, little accounting training, checks the business daily on a phone between customers. Wants to know "am I making money" and "who do I chase today".
- **Staff (kasir):** at a shop counter in daylight, often one hand free, many entries a day. Needs the sale saved in a few taps while a customer waits. Must never see cost, margin, profit, or balances.
- **Accountant (akuntan):** weekly or monthly on a desktop. Needs exact figures, filters, exports, and the audit log. Read-only.

## Brand commitments

- Visual direction is pinned by `Docs/notion-DESIGN.md`, requested at full fidelity by the owner: navy bands with sticky-note dots and wires, the purple primary, 8px buttons, 12px cards, and pastel tints. It borrows the visual language only, never the Notion name or logo.
- Notion Sans is proprietary, so Inter is used, which is the fallback that document names.
- Interface language is Indonesian. Money is `Rp1.250.000`. Dates are `04 Nov 2026`.

## Tone

Plain Indonesian, the words a shop owner uses: laba, piutang, hutang, stok. Controls name the action. Errors say what happened and what to do next.

## Must not happen

- Anything that makes a figure look more certain than it is: the tax page always says it is an estimate.
- Invented numbers, sample people, or fake activity. Empty states teach the next step instead.
- Showing Staff any cost, profit, or balance, in the UI or in an API response.

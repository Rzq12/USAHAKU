import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { addContact, addUser, newBusiness, paidSale, startApi, stopApi } from './support.js';

const { formatAccounting } = await import('../src/lib/money.js');
const { reportPdf } = await import('../src/lib/pdf.js');
const { formatDateLong } = await import('../src/lib/format.js');

before(startApi);
after(stopApi);

const RANGE = 'from=2026-10-01&to=2026-10-31';

const OPERATING_TITLE = 'Arus kas dari aktivitas operasi';

function sectionNamed(sections, title) {
  return sections.find((section) => section.title === title);
}

function amountOf(section, label) {
  return section.rows.find((row) => row.label === label)?.amount;
}

async function businessWithCashMovements() {
  const business = await newBusiness();
  await business.owner.put(`/accounts/${business.kas.id}`, {
    name: 'Kas',
    type: 'cash',
    opening_balance: 1_000_000,
  });
  await paidSale(business, [{ description: 'Jasa', qty: 1, unit_price: 200_000 }], {
    sale_date: '2026-10-05',
  });
  await business.owner.post('/transactions', {
    type: 'expense',
    amount: 500_000,
    account_id: business.kas.id,
    category_id: business.category('Sewa').id,
    occurred_on: '2026-10-06',
  });
  return business;
}

test('accounting format puts negative amounts in parentheses', () => {
  assert.equal(formatAccounting(2_675_000), '2.675.000');
  assert.equal(formatAccounting(-177_000), '(177.000)');
  assert.equal(formatAccounting(0), '0');
  assert.equal(formatDateLong('2026-11-01'), '1 November 2026');
});

test('a long report flows across pages without footers adding blank ones', async () => {
  const rowCount = 120;
  const rowsPerPageAtMost = 40;
  const buffer = await reportPdf(
    {
      title: 'Laporan Uji',
      subtitle: 'Untuk periode uji',
      basis: 'Dalam Rupiah',
      sections: [
        {
          title: 'Rincian',
          columns: [
            { key: 'label', label: 'Keterangan' },
            { key: 'amount', label: 'Jumlah', numeric: true, money: true },
          ],
          rows: Array.from({ length: rowCount }, (_, index) => ({
            label: `Baris ${index + 1}`,
            amount: index,
          })),
        },
      ],
    },
    { businessName: 'Toko Uji', printedBy: 'Pemilik Uji', printedAt: '04 Nov 2026, 10.00 WIB' },
  );
  const pages = buffer.toString('latin1').match(/\/Type \/Page\b/g).length;
  assert.ok(pages >= Math.ceil(rowCount / rowsPerPageAtMost), `too few pages: ${pages}`);
  assert.ok(pages <= 6, `footers must not add blank pages, got ${pages}`);
});

test('a section that fits on one page moves whole instead of splitting', async () => {
  const section = (title, rows) => ({
    title,
    plain: true,
    columns: [
      { key: 'label', label: 'Keterangan' },
      { key: 'amount', label: 'Jumlah', numeric: true, money: true },
    ],
    rows: Array.from({ length: rows }, (_, index) => ({ label: `Baris ${index}`, amount: index })),
  });
  const pagesFor = async (sections) => {
    const buffer = await reportPdf(
      { title: 'Laporan Uji', subtitle: 'Uji', basis: 'Dalam Rupiah', sections },
      { businessName: 'Toko Uji', printedBy: 'Pemilik', printedAt: '04 Nov 2026, 10.00 WIB' },
    );
    return buffer.toString('latin1').match(/\/Type \/Page\b/g).length;
  };
  // 20 rows then 12 rows would straddle page one; the second section moves as a block, and the
  // signatures fit beneath it, so the count stays at two pages.
  assert.equal(await pagesFor([section('Satu', 20), section('Dua', 12)]), 2);
  assert.equal(await pagesFor([section('Satu', 5)]), 1);
});

test('cash flow shows a summary that reconciles opening, net flow, and closing', async () => {
  const business = await businessWithCashMovements();
  const report = (await business.owner.get(`/reports/cash-flow?${RANGE}`)).body;

  assert.equal(report.title, 'Laporan Arus Kas');
  assert.equal(report.subtitle, 'Untuk periode 1 Oktober 2026 s.d. 31 Oktober 2026');
  assert.equal(report.basis, 'Basis kas, dalam Rupiah');
  assert.deepEqual(
    report.sections.map((section) => section.title),
    ['Ringkasan', OPERATING_TITLE, 'Rincian per akun'],
  );

  const [summary] = report.sections;
  const opening = amountOf(summary, 'Saldo awal kas dan bank');
  const net = amountOf(summary, 'Arus kas bersih');
  assert.equal(opening, 1_000_000);
  assert.equal(amountOf(summary, 'Penerimaan kas'), 200_000);
  assert.equal(amountOf(summary, 'Pengeluaran kas'), -500_000);
  assert.equal(net, -300_000);
  assert.equal(amountOf(summary, 'Saldo akhir kas dan bank'), opening + net);
  assert.equal(report.totals.net_cash_flow, -300_000);
});

test('cash flow keeps receipts and payments apart, each with its own total', async () => {
  const business = await businessWithCashMovements();
  const { sections } = (await business.owner.get(`/reports/cash-flow?${RANGE}`)).body;
  const operating = sectionNamed(sections, OPERATING_TITLE);

  assert.equal(amountOf(operating, 'Penjualan'), 200_000);
  assert.equal(amountOf(operating, 'Total penerimaan'), 200_000);
  assert.equal(amountOf(operating, 'Sewa'), -500_000);
  assert.equal(amountOf(operating, 'Total pengeluaran'), -500_000);
  assert.equal(amountOf(operating, 'Arus kas bersih dari aktivitas operasi'), -300_000);
});

async function addCashLine(business, categoryName, type, amount) {
  const response = await business.owner.post('/transactions', {
    type,
    amount,
    account_id: business.kas.id,
    category_id: business.category(categoryName).id,
    occurred_on: '2026-10-10',
  });
  assert.equal(response.status, 201);
}

test('cash flow groups by activity, and the activity nets add up to the net cash flow', async () => {
  const business = await businessWithCashMovements();
  await addCashLine(business, 'Pembelian Peralatan', 'expense', 150_000);
  await addCashLine(business, 'Modal Pemilik', 'income', 1_000_000);
  await addCashLine(business, 'Prive Pemilik', 'expense', 50_000);

  const report = (await business.owner.get(`/reports/cash-flow?${RANGE}`)).body;
  const net = (activity, title) =>
    amountOf(sectionNamed(report.sections, title), `Arus kas bersih dari aktivitas ${activity}`);
  const operatingNet = net('operasi', OPERATING_TITLE);
  const investingNet = net('investasi', 'Arus kas dari aktivitas investasi');
  const financingNet = net('pendanaan', 'Arus kas dari aktivitas pendanaan');

  assert.equal(operatingNet, -300_000);
  assert.equal(investingNet, -150_000);
  assert.equal(financingNet, 950_000);
  assert.equal(operatingNet + investingNet + financingNet, report.totals.net_cash_flow);

  const summary = report.sections[0];
  assert.equal(amountOf(summary, 'Dari aktivitas investasi'), -150_000);
  assert.equal(amountOf(summary, 'Saldo akhir kas dan bank'), 1_500_000);
});

test('without non-operating cash, only the operating section and no activity lines appear', async () => {
  const business = await businessWithCashMovements();
  const { sections } = (await business.owner.get(`/reports/cash-flow?${RANGE}`)).body;
  assert.equal(sectionNamed(sections, 'Arus kas dari aktivitas investasi'), undefined);
  assert.equal(amountOf(sections[0], 'Dari aktivitas operasi'), undefined);
});

test('capital, loans, and equipment move cash but never reach profit or tax turnover', async () => {
  const business = await newBusiness();
  await business.owner.put('/business', {
    name: 'Toko Uji',
    taxpayer_type: 'company',
    period_start_day: 1,
    tax_rate: 0.5,
    tax_threshold: 0,
  });
  await addCashLine(business, 'Modal Pemilik', 'income', 10_000_000);
  await addCashLine(business, 'Pinjaman Diterima', 'income', 5_000_000);
  await addCashLine(business, 'Pembelian Peralatan', 'expense', 2_000_000);
  await addCashLine(business, 'Pendapatan Lain', 'income', 700);

  const pl = (await business.owner.get(`/reports/profit-loss?${RANGE}`)).body;
  assert.equal(pl.totals.other_income, 700);
  assert.equal(pl.totals.other_expenses, 0);
  assert.equal(pl.totals.net_profit, 700);

  const expenses = (await business.owner.get(`/reports/expense-by-category?${RANGE}`)).body;
  assert.equal(expenses.is_empty, true);

  const tax = (await business.owner.get('/tax/estimate?year=2026')).body;
  assert.equal(tax.months[9].turnover, 700);

  const flow = (await business.owner.get(`/reports/cash-flow?${RANGE}`)).body;
  assert.equal(flow.totals.money_in, 15_000_700);
  assert.equal(flow.totals.money_out, 2_000_000);
});

test('a payable bill for equipment is not an expense when issued, only cash when paid', async () => {
  const business = await newBusiness();
  const contact = await addContact(business, { type: 'supplier' });
  const debt = await business.owner.post('/debts', {
    type: 'payable',
    contact_id: contact.id,
    amount: 800_000,
    issue_date: '2026-10-01',
    due_date: '2026-10-31',
    category_id: business.category('Pembelian Peralatan').id,
  });
  await business.owner.post(`/debts/${debt.body.id}/payments`, {
    amount: 800_000,
    account_id: business.kas.id,
    paid_on: '2026-10-15',
  });
  const pl = (await business.owner.get(`/reports/profit-loss?${RANGE}`)).body;
  assert.equal(pl.totals.net_profit, 0);
  const { sections } = (await business.owner.get(`/reports/cash-flow?${RANGE}`)).body;
  const investing = sectionNamed(sections, 'Arus kas dari aktivitas investasi');
  assert.equal(amountOf(investing, 'Pembelian Peralatan'), -800_000);
});

test('receivable payments show apart from cash sales in the operating section', async () => {
  const business = await businessWithCashMovements();
  const contact = await addContact(business);
  const debt = await business.owner.post('/debts', {
    type: 'receivable',
    contact_id: contact.id,
    amount: 90_000,
    issue_date: '2026-10-01',
    due_date: '2026-10-31',
  });
  await business.owner.post(`/debts/${debt.body.id}/payments`, {
    amount: 90_000,
    account_id: business.kas.id,
    paid_on: '2026-10-08',
  });
  const { sections } = (await business.owner.get(`/reports/cash-flow?${RANGE}`)).body;
  const operating = sectionNamed(sections, OPERATING_TITLE);
  assert.equal(amountOf(operating, 'Penjualan'), 200_000);
  assert.equal(amountOf(operating, 'Pelunasan piutang'), 90_000);
  assert.equal(amountOf(operating, 'Total penerimaan'), 290_000);
});

test('a category can be reclassified, except the system ones that drive sales, stock, and tax', async () => {
  const business = await newBusiness();
  const rent = business.category('Sewa');
  const moved = await business.owner.put(`/categories/${rent.id}`, { cash_activity: 'financing' });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.cash_activity, 'financing');

  for (const name of ['Penjualan', 'Pembelian Stok', 'Pajak']) {
    const refused = await business.owner.put(`/categories/${business.category(name).id}`, {
      cash_activity: 'investing',
    });
    assert.equal(refused.status, 400, name);
    assert.ok(refused.body.error.fields.cash_activity);
  }

  const created = await business.owner.post('/categories', {
    name: 'Hibah',
    type: 'income',
    cash_activity: 'financing',
  });
  assert.equal(created.body.cash_activity, 'financing');
  const invalid = await business.owner.post('/categories', {
    name: 'Salah',
    type: 'income',
    cash_activity: 'lainnya',
  });
  assert.equal(invalid.status, 400);

  const staff = await addUser(business, 'staff');
  const denied = await staff.client.put(`/categories/${rent.id}`, { cash_activity: 'operating' });
  assert.equal(denied.status, 403);
});

test('the excluded column and its note appear only when something is excluded', async () => {
  const business = await businessWithCashMovements();
  const hasColumn = (report) =>
    sectionNamed(report.sections, 'Rincian per akun').columns.some(
      (column) => column.key === 'excluded_net',
    );

  const plain = (await business.owner.get(`/reports/cash-flow?${RANGE}`)).body;
  assert.equal(hasColumn(plain), false);
  assert.ok(!plain.notes.some((note) => note.startsWith('Dikecualikan')));

  const { items } = (await business.owner.get('/transactions?type=expense')).body;
  const [expense] = items;
  await business.owner.put(`/transactions/${expense.id}`, {
    amount: expense.amount,
    account_id: expense.account_id,
    category_id: expense.category_id,
    occurred_on: expense.occurred_on,
    tags: [],
    is_excluded: true,
  });

  const excluded = (await business.owner.get(`/reports/cash-flow?${RANGE}`)).body;
  assert.equal(hasColumn(excluded), true);
  assert.ok(excluded.notes.some((note) => note.startsWith('Dikecualikan')));
  const summary = excluded.sections[0];
  assert.equal(amountOf(summary, 'Transaksi dikecualikan'), -500_000);
  assert.equal(amountOf(summary, 'Saldo akhir kas dan bank'), 700_000);
});

test('with one account selected, a transfer shows in the reconciliation', async () => {
  const business = await businessWithCashMovements();
  await business.owner.post('/transactions', {
    type: 'transfer',
    amount: 100_000,
    account_id: business.kas.id,
    transfer_account_id: business.bank.id,
    occurred_on: '2026-10-07',
  });
  const query = `/reports/cash-flow?${RANGE}&account_id=${business.kas.id}`;
  const { sections, notes } = (await business.owner.get(query)).body;
  assert.equal(amountOf(sections[0], 'Transfer bersih'), -100_000);
  assert.equal(amountOf(sections[0], 'Saldo akhir kas dan bank'), 600_000);
  assert.ok(notes.some((note) => note.includes('satu akun')));

  const all = (await business.owner.get(`/reports/cash-flow?${RANGE}`)).body;
  assert.equal(amountOf(all.sections[0], 'Transfer bersih'), undefined, 'nets to zero overall');
});

test('XLSX export carries the business name, every section, and the same figures', async () => {
  const business = await businessWithCashMovements();
  const file = await business.owner.get(`/reports/cash-flow/export?${RANGE}&format=xlsx`);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file.body);
  const sheet = workbook.worksheets[0];

  const byLabel = {};
  sheet.eachRow((row) => {
    byLabel[row.getCell(1).value] = row.getCell(2);
  });
  assert.equal(sheet.getCell('A1').value, 'Toko Uji');
  assert.equal(sheet.getCell('A2').value, 'Laporan Arus Kas');
  assert.ok(OPERATING_TITLE in byLabel);
  assert.ok('Rincian per akun' in byLabel);
  assert.equal(byLabel['Arus kas bersih'].value, -300_000);
  assert.ok(byLabel['Arus kas bersih'].numFmt.includes('('), 'negatives use parentheses');
  assert.equal(byLabel['Saldo akhir kas dan bank'].value, 700_000);
});

test('CSV export lists each section under its title', async () => {
  const business = await businessWithCashMovements();
  const file = await business.owner.get(`/reports/cash-flow/export?${RANGE}&format=csv`);
  const text = file.body.toString('utf8');
  assert.ok(text.includes('Ringkasan'));
  assert.ok(text.includes(OPERATING_TITLE));
  assert.ok(text.includes('Arus kas bersih,-300000'));
  assert.ok(text.includes('Total pengeluaran,-500000'));
});

test('every report exports a PDF, for Owner and Accountant, and empty ranges still work', async () => {
  const business = await businessWithCashMovements();
  const accountant = await addUser(business, 'accountant');
  const names = [
    'profit-loss',
    'cash-flow',
    'sales-by-product',
    'expense-by-category',
    'receivable-aging',
  ];
  for (const name of names) {
    for (const client of [business.owner, accountant.client]) {
      const file = await client.get(`/reports/${name}/export?${RANGE}&format=pdf`);
      assert.equal(file.status, 200, name);
      assert.equal(file.body.subarray(0, 5).toString(), '%PDF-', name);
    }
    const empty = await business.owner.get(
      `/reports/${name}/export?from=2001-01-01&to=2001-01-31&format=pdf`,
    );
    assert.equal(empty.status, 200, `${name} empty`);
  }
});

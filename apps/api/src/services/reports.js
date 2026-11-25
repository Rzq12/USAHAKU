import ExcelJS from 'exceljs';
import { pool } from '../db/pool.js';
import * as reports from '../db/reports.js';
import { addDays, daysBetween } from '../lib/dates.js';
import { formatDateLong, formatPrintedAt } from '../lib/format.js';
import { toCsv } from '../lib/csv.js';
import { reportPdf } from '../lib/pdf.js';
import { formatQty } from '../lib/money.js';

const money = (key, label) => ({ key, label, numeric: true, money: true });
const text = (key, label) => ({ key, label });
const periodLabel = (from, to) =>
  `Untuk periode ${formatDateLong(from)} s.d. ${formatDateLong(to)}`;
const ACCRUAL_BASIS = 'Basis akrual, dalam Rupiah';
const LABEL_AMOUNT_COLUMNS = [text('label', 'Keterangan'), money('amount', 'Jumlah')];

async function profitLossFigures(businessId, from, to) {
  const [sales, other, expenses] = await Promise.all([
    reports.salesTotals(pool, businessId, from, to),
    reports.otherIncome(pool, businessId, from, to),
    reports.expensesByCategory(pool, businessId, from, to),
  ]);
  const operating = expenses.filter((row) => row.pl_group === 'operating_expense');
  const otherExpense = expenses.filter((row) => row.pl_group === 'other_expense');
  const sum = (rows) => rows.reduce((total, row) => total + row.amount, 0);
  const grossProfit = sales.revenue - sales.cogs;
  const operatingTotal = sum(operating);
  const otherExpenseTotal = sum(otherExpense);
  const operatingProfit = grossProfit - operatingTotal;
  return {
    revenue: sales.revenue,
    cogs: sales.cogs,
    gross_profit: grossProfit,
    operating,
    operating_total: operatingTotal,
    operating_profit: operatingProfit,
    other_income: other.amount,
    other_expense: otherExpense,
    other_expense_total: otherExpenseTotal,
    net_profit: operatingProfit + other.amount - otherExpenseTotal,
    has_data: sales.sale_count > 0 || expenses.length > 0 || other.line_count > 0,
  };
}

/**
 * Expense categories of one group, each child under its parent, largest first.
 * Both periods share one list so a category that only spent last period still shows.
 */
function expenseGroups(current, previous, group) {
  const groups = new Map();
  const collect = (figures, key) => {
    for (const row of figures?.[group] ?? []) {
      const groupName = row.parent_name ?? row.name;
      if (!groups.has(groupName)) groups.set(groupName, new Map());
      const lines = groups.get(groupName);
      const line = lines.get(row.name) ?? { name: row.name, current: 0, previous: 0 };
      line[key] += row.amount;
      lines.set(row.name, line);
    }
  };
  collect(current, 'current');
  collect(previous, 'previous');
  const total = (lines, key) => lines.reduce((sum, line) => sum + line[key], 0);
  return [...groups.entries()]
    .map(([name, lines]) => ({
      name,
      lines: [...lines.values()].sort((a, b) => b.current - a.current),
    }))
    .map((item) => ({
      ...item,
      current: total(item.lines, 'current'),
      previous: total(item.lines, 'previous'),
    }))
    .sort((a, b) => b.current - a.current);
}

/** Zahir's order: revenue, cost of revenue, gross, operating groups, operating profit, other, net. */
function plRows(current, previous) {
  const line = (label, value, previousValue, style = {}) => {
    const row = { label, amount: value, ...style };
    if (previous) {
      row.previous = previousValue;
      row.change = value - previousValue;
    }
    return row;
  };
  const heading = (label, indent = 0) => {
    const row = { label, amount: null, heading: true, indent };
    if (previous) Object.assign(row, { previous: null, change: null });
    return row;
  };
  const total = (label, figure, style = {}) =>
    line(label, current[figure], previous?.[figure], { emphasis: true, ...style });

  const groupRows = (group) =>
    expenseGroups(current, previous, group).flatMap((item) => {
      const [only] = item.lines;
      if (item.lines.length === 1 && only.name === item.name) {
        return [line(item.name, only.current, only.previous, { indent: 1 })];
      }
      return [
        heading(item.name, 1),
        ...item.lines.map((child) =>
          line(
            child.name === item.name ? `${child.name} lainnya` : child.name,
            child.current,
            child.previous,
            {
              indent: 2,
            },
          ),
        ),
        line(`Total ${item.name}`, item.current, item.previous, { emphasis: true, indent: 1 }),
      ];
    });
  const otherExpenseRows = groupRows('other_expense');

  return [
    heading('Pendapatan'),
    line('Pendapatan penjualan', current.revenue, previous?.revenue, { indent: 1 }),
    total('Total pendapatan', 'revenue'),
    heading('Beban atas Pendapatan'),
    line('Harga pokok penjualan', current.cogs, previous?.cogs, { indent: 1 }),
    total('Total beban atas pendapatan', 'cogs'),
    total('Laba kotor', 'gross_profit'),
    heading('Beban Operasional'),
    ...groupRows('operating'),
    total('Total beban operasional', 'operating_total'),
    total('Laba operasi', 'operating_profit'),
    line('Pendapatan lain', current.other_income, previous?.other_income),
    ...(otherExpenseRows.length === 0
      ? []
      : [
          heading('Beban Lain'),
          ...otherExpenseRows,
          total('Total beban lain', 'other_expense_total'),
        ]),
    total('Laba bersih', 'net_profit', { double: true }),
  ];
}

async function profitLoss(businessId, { from, to, compare }) {
  const current = await profitLossFigures(businessId, from, to);
  let previous = null;
  let previousRange = null;
  if (compare) {
    const previousTo = addDays(from, -1);
    const previousFrom = addDays(previousTo, -daysBetween(from, to));
    previous = await profitLossFigures(businessId, previousFrom, previousTo);
    previousRange = { from: previousFrom, to: previousTo };
  }
  const columns = [text('label', 'Keterangan'), money('amount', 'Periode ini')];
  if (previous) columns.push(money('previous', 'Periode sebelumnya'), money('change', 'Selisih'));
  return {
    title: 'Laporan Laba Rugi',
    subtitle: periodLabel(from, to),
    basis: ACCRUAL_BASIS,
    columns,
    rows: plRows(current, previous),
    notes: previousRange
      ? [
          `Periode sebelumnya: ${formatDateLong(previousRange.from)} s.d. ${formatDateLong(previousRange.to)}.`,
        ]
      : [],
    totals: {
      revenue: current.revenue,
      cogs: current.cogs,
      gross_profit: current.gross_profit,
      operating_expenses: current.operating_total,
      operating_profit: current.operating_profit,
      other_income: current.other_income,
      other_expenses: current.other_expense_total,
      net_profit: current.net_profit,
    },
    previous_range: previousRange,
    is_empty: !current.has_data && !previous?.has_data,
  };
}

const CASH_ACTIVITIES = [
  { key: 'operating', label: 'operasi' },
  { key: 'investing', label: 'investasi' },
  { key: 'financing', label: 'pendanaan' },
];

function activityNet(categories, activity) {
  return categories
    .filter((row) => row.activity === activity)
    .reduce((sum, row) => sum + (row.type === 'income' ? row.amount : -row.amount), 0);
}

function cashSummaryRows(totals, categories) {
  const rows = [
    { label: 'Saldo awal kas dan bank', amount: totals.opening },
    { label: 'Penerimaan kas', amount: totals.money_in },
    { label: 'Pengeluaran kas', amount: -totals.money_out },
    { label: 'Arus kas bersih', amount: totals.net_cash_flow, emphasis: true },
  ];
  if (categories.some((row) => row.activity !== 'operating')) {
    for (const activity of CASH_ACTIVITIES) {
      rows.push({
        label: `Dari aktivitas ${activity.label}`,
        amount: activityNet(categories, activity.key),
        indent: true,
      });
    }
  }
  if (totals.transfer_net !== 0) {
    rows.push({ label: 'Transfer bersih', amount: totals.transfer_net });
  }
  if (totals.excluded_net !== 0) {
    rows.push({ label: 'Transaksi dikecualikan', amount: totals.excluded_net });
  }
  rows.push({
    label: 'Saldo akhir kas dan bank',
    amount: totals.closing,
    emphasis: true,
    double: true,
  });
  return rows;
}

/** One SAK EMKM activity: receipts, payments in parentheses, and the net of the two. */
function cashActivitySection(activity, categories) {
  const lines = categories.filter((row) => row.activity === activity.key);
  const receipts = lines.filter((row) => row.type === 'income');
  const payments = lines.filter((row) => row.type === 'expense');
  const sum = (rows) => rows.reduce((total, row) => total + row.amount, 0);
  const rows = [];
  if (receipts.length > 0) {
    rows.push(...receipts.map((row) => ({ label: row.name, amount: row.amount })));
    rows.push({ label: 'Total penerimaan', amount: sum(receipts), emphasis: true });
  }
  if (payments.length > 0) {
    rows.push(...payments.map((row) => ({ label: row.name, amount: -row.amount })));
    rows.push({ label: 'Total pengeluaran', amount: -sum(payments), emphasis: true });
  }
  rows.push({
    label: `Arus kas bersih dari aktivitas ${activity.label}`,
    amount: sum(receipts) - sum(payments),
    emphasis: true,
    double: true,
  });
  return {
    title: `Arus kas dari aktivitas ${activity.label}`,
    plain: true,
    columns: LABEL_AMOUNT_COLUMNS,
    rows,
  };
}

function cashActivitySections(categories) {
  return CASH_ACTIVITIES.filter(
    (activity) =>
      activity.key === 'operating' || categories.some((row) => row.activity === activity.key),
  ).map((activity) => cashActivitySection(activity, categories));
}

/*
 * Zahir closes with the net change, the opening balance, and the closing balance. Transfers
 * and excluded transactions move a balance without being receipts or payments, so they
 * get their own lines here; otherwise opening plus change would not reach the closing.
 */
function cashClosingSection(totals) {
  return {
    title: 'Perubahan kas',
    plain: true,
    columns: LABEL_AMOUNT_COLUMNS,
    rows: [
      { label: 'Kenaikan (penurunan) kas', amount: totals.net_cash_flow, emphasis: true },
      ...lineIfAny('Transfer bersih', totals.transfer_net),
      ...lineIfAny('Transaksi dikecualikan', totals.excluded_net),
      { label: 'Saldo awal kas dan bank', amount: totals.opening },
      { label: 'Saldo akhir kas dan bank', amount: totals.closing, emphasis: true, double: true },
    ],
  };
}

function cashFlowNotes(totals, accountId) {
  const notes = [
    'Transfer antar akun tidak dihitung sebagai penerimaan atau pengeluaran.',
    'Aktivitas mengikuti pengaturan pada setiap kategori.',
  ];
  if (accountId) notes.push('Laporan ini hanya mencakup satu akun.');
  if (totals.excluded_net !== 0) {
    notes.push(
      'Dikecualikan: transaksi yang ditandai keluar dari laporan. Tetap memengaruhi saldo, tetapi tidak dihitung sebagai penerimaan atau pengeluaran.',
    );
  }
  return notes;
}

async function cashFlow(businessId, { from, to, account_id }) {
  const [accounts, categories] = await Promise.all([
    reports.cashFlowByAccount(pool, businessId, from, to, account_id),
    reports.cashFlowByCategory(pool, businessId, from, to, account_id),
  ]);
  const accountRows = accounts.map((account) => ({
    name: account.name,
    opening: account.opening,
    money_in: account.money_in,
    money_out: account.money_out,
    transfer_net: account.transfer_net,
    excluded_net: account.excluded_net,
    closing:
      account.opening +
      account.money_in -
      account.money_out +
      account.transfer_net +
      account.excluded_net,
  }));
  const moneyIn = accountRows.reduce((sum, row) => sum + row.money_in, 0);
  const moneyOut = accountRows.reduce((sum, row) => sum + row.money_out, 0);
  const totals = {
    opening: accountRows.reduce((sum, row) => sum + row.opening, 0),
    money_in: moneyIn,
    money_out: moneyOut,
    net_cash_flow: moneyIn - moneyOut,
    transfer_net: accountRows.reduce((sum, row) => sum + row.transfer_net, 0),
    excluded_net: accountRows.reduce((sum, row) => sum + row.excluded_net, 0),
    closing: accountRows.reduce((sum, row) => sum + row.closing, 0),
  };
  const hasExcluded = accountRows.some((row) => row.excluded_net !== 0);
  return {
    title: 'Laporan Arus Kas',
    subtitle: periodLabel(from, to),
    basis: 'Basis kas, dalam Rupiah',
    sections: [
      {
        title: 'Ringkasan',
        plain: true,
        // The PDF reads top to bottom like Zahir and ends with the closing block instead.
        screen_only: true,
        columns: LABEL_AMOUNT_COLUMNS,
        rows: cashSummaryRows(totals, categories),
      },
      ...cashActivitySections(categories),
      cashClosingSection(totals),
      {
        title: 'Rincian per akun',
        columns: [
          text('name', 'Akun'),
          money('opening', 'Saldo awal'),
          money('money_in', 'Masuk'),
          money('money_out', 'Keluar'),
          money('transfer_net', 'Transfer bersih'),
          ...(hasExcluded ? [money('excluded_net', 'Dikecualikan')] : []),
          money('closing', 'Saldo akhir'),
        ],
        rows: [...accountRows, { name: 'Total', ...totals, emphasis: true, double: true }],
      },
    ],
    notes: cashFlowNotes(totals, account_id),
    totals,
    is_empty: moneyIn === 0 && moneyOut === 0 && !accountRows.some((row) => row.transfer_net !== 0),
  };
}

async function salesByProduct(businessId, { from, to }) {
  const [lines, sales] = await Promise.all([
    reports.salesByProduct(pool, businessId, from, to),
    reports.salesTotals(pool, businessId, from, to),
  ]);
  const rows = lines.map((line) => ({
    name: line.name,
    qty: `${formatQty(line.qty)} ${line.unit}`.trim(),
    revenue: line.revenue,
    cogs: line.cogs,
    margin: line.revenue - line.cogs,
  }));
  if (sales.discount > 0) {
    rows.push({ name: 'Diskon penjualan', revenue: -sales.discount, margin: -sales.discount });
  }
  const totals = {
    revenue: sales.revenue,
    cogs: sales.cogs,
    margin: sales.revenue - sales.cogs,
  };
  return {
    title: 'Laporan Penjualan per Produk',
    subtitle: periodLabel(from, to),
    basis: ACCRUAL_BASIS,
    columns: [
      text('name', 'Produk'),
      { key: 'qty', label: 'Jumlah', numeric: true },
      money('revenue', 'Pendapatan'),
      money('cogs', 'HPP'),
      money('margin', 'Margin'),
    ],
    rows: [...rows, { name: 'Total', ...totals, emphasis: true, double: true }],
    totals,
    is_empty: lines.length === 0,
  };
}

async function expenseByCategory(businessId, { from, to }) {
  const expenses = await reports.expensesByCategory(pool, businessId, from, to);
  const counted = expenses.filter((row) => row.pl_group !== 'inventory');
  const total = counted.reduce((sum, row) => sum + row.amount, 0);
  return {
    title: 'Laporan Pengeluaran per Kategori',
    subtitle: periodLabel(from, to),
    basis: ACCRUAL_BASIS,
    notes: ['Tidak termasuk pembelian stok serta aktivitas investasi dan pendanaan.'],
    columns: [
      text('name', 'Kategori'),
      money('amount', 'Jumlah'),
      { key: 'share', label: 'Porsi', numeric: true },
    ],
    rows: [
      ...counted.map((row) => ({
        name: row.name,
        amount: row.amount,
        share: `${((row.amount * 100) / total).toFixed(1).replace('.', ',')}%`,
      })),
      {
        name: 'Total',
        amount: total,
        share: counted.length ? '100%' : '',
        emphasis: true,
        double: true,
      },
    ],
    totals: { amount: total },
    is_empty: counted.length === 0,
  };
}

/*
 * usahaku keeps single-entry books, so the balance sheet is derived, not read from a ledger.
 * Financing categories carry no loan or equity flag: a name with "pinjam" or "angsuran"
 * is a loan, other financing receipts are capital, other financing payments are drawings.
 */
const LOAN_NAME = /pinjam|angsuran/i;
const EARLIEST_DATE = '1900-01-01';

function nonOperatingTotals(rows) {
  const sum = (filter) => rows.filter(filter).reduce((total, row) => total + row.amount, 0);
  const financing = (row) => row.activity === 'financing';
  const isLoan = (row) => financing(row) && LOAN_NAME.test(row.name);
  return {
    fixed_assets:
      sum((row) => row.activity === 'investing' && row.type === 'expense') -
      sum((row) => row.activity === 'investing' && row.type === 'income'),
    loans:
      sum((row) => isLoan(row) && row.type === 'income') -
      sum((row) => isLoan(row) && row.type === 'expense'),
    paid_in_capital: sum((row) => financing(row) && !isLoan(row) && row.type === 'income'),
    drawings: 0 - sum((row) => financing(row) && !isLoan(row) && row.type === 'expense'),
    has_financing: rows.some(financing),
  };
}

function balanceSheetNotes(totals, year, hasFinancing) {
  const notes = [
    'Persediaan dinilai dengan harga modal produk saat ini.',
    `Laba Tahun Berjalan dihitung sejak 1 Januari ${year}. Laba sebelum tanggal itu masuk Laba Ditahan.`,
  ];
  if (totals.fixed_assets !== 0) {
    notes.push('Harta tetap dicatat sebesar harga beli, tanpa penyusutan.');
  }
  if (hasFinancing) {
    notes.push(
      'Kategori pendanaan yang namanya memuat "pinjam" atau "angsuran" dihitung sebagai Utang Jangka Panjang. Pemasukan pendanaan lain dihitung sebagai Modal Disetor, pengeluarannya sebagai Prive.',
    );
  }
  if (totals.adjustment !== 0) {
    notes.push(
      'Penyesuaian Saldo: selisih antara harta dan sumbernya karena pencatatan satu sisi, misalnya harga modal produk yang diubah, stok masuk tanpa pengeluaran, penjualan produk yang stoknya tidak dilacak, atau transaksi yang dikecualikan dari laporan.',
    );
  }
  return notes;
}

/** Rows whose amount is zero are left out, except the ones every balance sheet carries. */
const lineIfAny = (label, amount, extra = {}) =>
  amount === 0 ? [] : [{ label, amount, ...extra }];

function balanceSheetSections(accounts, totals) {
  const section = (title, rows) => ({ title, plain: true, columns: LABEL_AMOUNT_COLUMNS, rows });
  const total = (label, amount, double = false) => ({ label, amount, emphasis: true, double });
  return [
    section('Harta', [
      ...accounts
        .filter((account) => account.balance !== 0)
        .map((account) => ({ label: account.name, amount: account.balance, indent: true })),
      total('Total Kas dan Bank', totals.cash),
      ...lineIfAny('Piutang Usaha', totals.receivables),
      ...lineIfAny('Persediaan Barang', totals.inventory),
      total('Total Harta Lancar', totals.current_assets),
      ...(totals.fixed_assets === 0
        ? []
        : [
            { label: 'Harta Tetap Berwujud', amount: totals.fixed_assets, indent: true },
            total('Total Harta Tetap', totals.fixed_assets),
          ]),
      total('Total Harta', totals.total_assets, true),
    ]),
    section('Kewajiban', [
      ...lineIfAny('Utang Usaha', totals.payables),
      ...lineIfAny('Utang Jangka Panjang', totals.loans),
      total('Total Kewajiban', totals.total_liabilities),
    ]),
    section('Modal', [
      { label: 'Modal Awal', amount: totals.opening_equity },
      ...lineIfAny('Modal Disetor', totals.paid_in_capital),
      ...lineIfAny('Prive', totals.drawings),
      { label: 'Laba Ditahan', amount: totals.retained_earnings },
      { label: 'Laba Tahun Berjalan', amount: totals.current_year_profit },
      ...lineIfAny('Penyesuaian Saldo', totals.adjustment),
      total('Total Modal', totals.total_equity),
      total('Total Kewajiban dan Modal', totals.total_liabilities_and_equity, true),
    ]),
  ];
}

/** Position on one date (`to`). Profit splits at 1 January of that date's year, like Zahir. */
async function balanceSheet(businessId, { to }) {
  const year = Number(to.slice(0, 4));
  const [figures, retained, currentYear] = await Promise.all([
    reports.balanceSheetFigures(pool, businessId, to),
    profitLossFigures(businessId, EARLIEST_DATE, `${year - 1}-12-31`),
    profitLossFigures(businessId, `${year}-01-01`, to),
  ]);
  const other = nonOperatingTotals(figures.non_operating);
  const cash = figures.accounts.reduce((sum, account) => sum + account.balance, 0);
  const currentAssets = cash + figures.receivables + figures.inventory;
  const totalAssets = currentAssets + other.fixed_assets;
  const totalLiabilities = figures.payables + other.loans;
  const openingEquity =
    figures.accounts.reduce((sum, account) => sum + account.opening_balance, 0) +
    figures.opening_stock;
  const equityBeforeAdjustment =
    openingEquity +
    other.paid_in_capital +
    other.drawings +
    retained.net_profit +
    currentYear.net_profit;
  const adjustment = totalAssets - totalLiabilities - equityBeforeAdjustment;
  const totalEquity = equityBeforeAdjustment + adjustment;
  const totals = {
    cash,
    receivables: figures.receivables,
    inventory: figures.inventory,
    current_assets: currentAssets,
    fixed_assets: other.fixed_assets,
    total_assets: totalAssets,
    payables: figures.payables,
    loans: other.loans,
    total_liabilities: totalLiabilities,
    opening_equity: openingEquity,
    paid_in_capital: other.paid_in_capital,
    drawings: other.drawings,
    retained_earnings: retained.net_profit,
    current_year_profit: currentYear.net_profit,
    adjustment,
    total_equity: totalEquity,
    total_liabilities_and_equity: totalLiabilities + totalEquity,
  };
  return {
    title: 'Neraca',
    subtitle: `Per ${formatDateLong(to)}`,
    basis: ACCRUAL_BASIS,
    as_of: to,
    sections: balanceSheetSections(figures.accounts, totals),
    notes: balanceSheetNotes(totals, year, other.has_financing),
    totals,
    is_empty: Object.values(totals).every((value) => value === 0),
  };
}

export const REPORTS = {
  'balance-sheet': balanceSheet,
  'profit-loss': profitLoss,
  'cash-flow': cashFlow,
  'sales-by-product': salesByProduct,
  'expense-by-category': expenseByCategory,
};

export const runReport = (actor, name, query) => REPORTS[name](actor.business_id, query);

/** Most reports are one table; Arus Kas has several, each with its own columns. */
function sectionsOf(table) {
  return table.sections ?? [{ columns: table.columns, rows: table.rows }];
}

function csvFile(table, baseName) {
  const lines = [];
  sectionsOf(table).forEach((section, index) => {
    if (index > 0) lines.push([]);
    if (section.title) lines.push([section.title]);
    lines.push(section.columns.map((column) => column.label));
    for (const row of section.rows) {
      lines.push(section.columns.map((column) => row[column.key] ?? ''));
    }
  });
  const [headers, ...rows] = lines;
  return {
    filename: `${baseName}.csv`,
    contentType: 'text/csv; charset=utf-8',
    buffer: Buffer.from(toCsv(headers, rows), 'utf8'),
  };
}

const XLSX_ACCOUNTING = '"Rp"#,##0;("Rp"#,##0)';
const XLSX_HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0EEEC' } };

function addXlsxRow(sheet, section, row) {
  const added = sheet.addRow(section.columns.map((column) => row[column.key] ?? null));
  if (row.emphasis || row.heading) added.font = { bold: true };
  const indent = row.indent === true ? 1 : row.indent || 0;
  if (indent) added.getCell(1).alignment = { indent };
  section.columns.forEach((column, index) => {
    const cell = added.getCell(index + 1);
    if (column.money) cell.numFmt = XLSX_ACCOUNTING;
    if (column.numeric) cell.alignment = { horizontal: 'right' };
    if (row.emphasis) {
      cell.border = {
        top: { style: 'thin' },
        ...(row.double ? { bottom: { style: 'double' } } : {}),
      };
    }
  });
}

async function xlsxFile(table, baseName, meta) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(table.title.slice(0, 31));
  sheet.addRow([meta.businessName]).font = { bold: true };
  sheet.addRow([table.title]).font = { bold: true, size: 14 };
  sheet.addRow([table.subtitle]);
  sheet.addRow([table.basis]);
  for (const section of sectionsOf(table)) {
    sheet.addRow([]);
    if (section.title) sheet.addRow([section.title]).font = { bold: true };
    const header = sheet.addRow(section.columns.map((column) => column.label));
    header.font = { bold: true };
    section.columns.forEach((column, index) => {
      const cell = header.getCell(index + 1);
      cell.fill = XLSX_HEADER_FILL;
      if (column.numeric) cell.alignment = { horizontal: 'right' };
    });
    for (const row of section.rows) addXlsxRow(sheet, section, row);
  }
  for (const note of table.notes ?? []) {
    if (note === table.notes[0]) sheet.addRow([]);
    sheet.addRow([note]);
  }
  sheet.addRow([]);
  sheet.addRow([`Dicetak ${meta.printedAt} oleh ${meta.printedBy}`]);
  const columnCount = Math.max(...sectionsOf(table).map((section) => section.columns.length));
  for (let index = 1; index <= columnCount; index += 1) {
    sheet.getColumn(index).width = index === 1 ? 34 : 18;
  }
  return {
    filename: `${baseName}.xlsx`,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
  };
}

async function pdfFile(table, baseName, meta) {
  return {
    filename: `${baseName}.pdf`,
    contentType: 'application/pdf',
    buffer: await reportPdf({ ...table, sections: sectionsOf(table) }, meta),
  };
}

const EXPORTERS = { csv: csvFile, xlsx: xlsxFile, pdf: pdfFile };

/** The file is built from the same table object the screen shows, so totals cannot differ. */
export async function exportReport(actor, name, query) {
  const table = await runReport(actor, name, query);
  const meta = {
    businessName: actor.business_name,
    printedBy: actor.name,
    printedAt: formatPrintedAt(new Date()),
  };
  // A balance sheet is one date, so its file is named by that date alone.
  const period = table.as_of ?? `${query.from}_${query.to}`;
  return EXPORTERS[query.format](table, `${name}_${period}`, meta);
}

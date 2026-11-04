import ExcelJS from 'exceljs';
import { pool } from '../db/pool.js';
import * as reports from '../db/reports.js';
import { addDays, daysBetween } from '../lib/dates.js';
import { formatDateId } from '../lib/format.js';
import { toCsv } from '../lib/csv.js';
import { reportPdf } from '../lib/pdf.js';
import { formatQty } from '../lib/money.js';

const money = (key, label) => ({ key, label, numeric: true, money: true });
const text = (key, label) => ({ key, label });
const rangeLabel = (from, to) => `${formatDateId(from)} s.d. ${formatDateId(to)}`;

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
  return {
    revenue: sales.revenue,
    cogs: sales.cogs,
    gross_profit: grossProfit,
    operating,
    operating_total: operatingTotal,
    other_income: other.amount,
    other_expense: otherExpense,
    other_expense_total: otherExpenseTotal,
    net_profit: grossProfit - operatingTotal + other.amount - otherExpenseTotal,
    has_data: sales.sale_count > 0 || expenses.length > 0 || other.line_count > 0,
  };
}

function plRows(current, previous) {
  const categoryNames = (group) => {
    const names = new Map();
    for (const row of current[group]) names.set(row.name, true);
    for (const row of previous?.[group] ?? []) names.set(row.name, true);
    return [...names.keys()];
  };
  const amountOf = (figures, group, name) =>
    figures?.[group].find((row) => row.name === name)?.amount ?? 0;

  const line = (label, value, previousValue, emphasis = false, indent = false) => {
    const row = { label, amount: value, emphasis, indent };
    if (previous) {
      row.previous = previousValue;
      row.change = value - previousValue;
    }
    return row;
  };

  return [
    line('Pendapatan penjualan', current.revenue, previous?.revenue),
    line('Harga pokok penjualan', current.cogs, previous?.cogs),
    line('Laba kotor', current.gross_profit, previous?.gross_profit, true),
    ...categoryNames('operating').map((name) =>
      line(name, amountOf(current, 'operating', name), amountOf(previous, 'operating', name), false, true),
    ),
    line('Total beban operasional', current.operating_total, previous?.operating_total, true),
    line('Pendapatan lain', current.other_income, previous?.other_income),
    ...categoryNames('other_expense').map((name) =>
      line(name, amountOf(current, 'other_expense', name), amountOf(previous, 'other_expense', name), false, true),
    ),
    line('Total beban lain', current.other_expense_total, previous?.other_expense_total, true),
    line('Laba bersih', current.net_profit, previous?.net_profit, true),
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
    title: 'Laba Rugi',
    subtitle: rangeLabel(from, to),
    columns,
    rows: plRows(current, previous),
    totals: {
      revenue: current.revenue,
      cogs: current.cogs,
      gross_profit: current.gross_profit,
      operating_expenses: current.operating_total,
      other_income: current.other_income,
      other_expenses: current.other_expense_total,
      net_profit: current.net_profit,
    },
    previous_range: previousRange,
    is_empty: !current.has_data && !previous?.has_data,
  };
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
    indent: true,
  }));
  const moneyIn = accountRows.reduce((sum, row) => sum + row.money_in, 0);
  const moneyOut = accountRows.reduce((sum, row) => sum + row.money_out, 0);
  const categoryRows = categories.map((row) => ({
    name: row.name,
    money_in: row.type === 'income' ? row.amount : null,
    money_out: row.type === 'expense' ? row.amount : null,
    indent: true,
  }));
  const totals = {
    opening: accountRows.reduce((sum, row) => sum + row.opening, 0),
    money_in: moneyIn,
    money_out: moneyOut,
    transfer_net: accountRows.reduce((sum, row) => sum + row.transfer_net, 0),
    excluded_net: accountRows.reduce((sum, row) => sum + row.excluded_net, 0),
    closing: accountRows.reduce((sum, row) => sum + row.closing, 0),
  };
  return {
    title: 'Arus Kas',
    subtitle: rangeLabel(from, to),
    columns: [
      text('name', 'Nama'),
      money('opening', 'Saldo awal'),
      money('money_in', 'Masuk'),
      money('money_out', 'Keluar'),
      money('transfer_net', 'Transfer bersih'),
      money('excluded_net', 'Dikecualikan'),
      money('closing', 'Saldo akhir'),
    ],
    rows: [
      { name: 'Per akun', emphasis: true },
      ...accountRows,
      { name: 'Total', ...totals, emphasis: true },
      { name: 'Per kategori', emphasis: true },
      ...categoryRows,
    ],
    totals,
    is_empty: moneyIn === 0 && moneyOut === 0 && totals.transfer_net === 0 && categoryRows.length === 0,
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
    title: 'Penjualan per Produk',
    subtitle: rangeLabel(from, to),
    columns: [
      text('name', 'Produk'),
      { key: 'qty', label: 'Jumlah', numeric: true },
      money('revenue', 'Pendapatan'),
      money('cogs', 'HPP'),
      money('margin', 'Margin'),
    ],
    rows: [...rows, { name: 'Total', ...totals, emphasis: true }],
    totals,
    is_empty: lines.length === 0,
  };
}

async function expenseByCategory(businessId, { from, to }) {
  const expenses = await reports.expensesByCategory(pool, businessId, from, to);
  const counted = expenses.filter((row) => row.pl_group !== 'inventory');
  const total = counted.reduce((sum, row) => sum + row.amount, 0);
  return {
    title: 'Pengeluaran per Kategori',
    subtitle: rangeLabel(from, to),
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
      { name: 'Total', amount: total, share: counted.length ? '100%' : '', emphasis: true },
    ],
    totals: { amount: total },
    is_empty: counted.length === 0,
  };
}

const AGING_BUCKETS = [
  { key: 'days_0_30', label: '0 sampai 30 hari', max: 30 },
  { key: 'days_31_60', label: '31 sampai 60 hari', max: 60 },
  { key: 'days_61_90', label: '61 sampai 90 hari', max: 90 },
  { key: 'days_over_90', label: 'Lebih dari 90 hari', max: Infinity },
];

export function agingBucket(ageDays) {
  return AGING_BUCKETS.find((bucket) => ageDays <= bucket.max).key;
}

async function receivableAging(businessId, { to }) {
  const receivables = await reports.openReceivables(pool, businessId, to);
  const totals = Object.fromEntries(AGING_BUCKETS.map((bucket) => [bucket.key, 0]));
  totals.remaining = 0;
  const rows = receivables.map((debt) => {
    const bucket = agingBucket(debt.age_days);
    totals[bucket] += debt.remaining;
    totals.remaining += debt.remaining;
    return {
      name: debt.contact_name,
      issue_date: formatDateId(debt.issue_date),
      age: `${debt.age_days} hari`,
      remaining: debt.remaining,
      [bucket]: debt.remaining,
    };
  });
  return {
    title: 'Umur Piutang',
    subtitle: `Per ${formatDateId(to)}`,
    columns: [
      text('name', 'Pelanggan'),
      text('issue_date', 'Tanggal'),
      { key: 'age', label: 'Umur', numeric: true },
      ...AGING_BUCKETS.map((bucket) => money(bucket.key, bucket.label)),
      money('remaining', 'Sisa'),
    ],
    rows: [...rows, { name: 'Total', ...totals, emphasis: true }],
    totals,
    is_empty: rows.length === 0,
  };
}

export const REPORTS = {
  'profit-loss': profitLoss,
  'cash-flow': cashFlow,
  'sales-by-product': salesByProduct,
  'expense-by-category': expenseByCategory,
  'receivable-aging': receivableAging,
};

export const runReport = (actor, name, query) => REPORTS[name](actor.business_id, query);

function csvFile(table, baseName) {
  const headers = table.columns.map((column) => column.label);
  const rows = table.rows.map((row) => table.columns.map((column) => row[column.key] ?? ''));
  return {
    filename: `${baseName}.csv`,
    contentType: 'text/csv; charset=utf-8',
    buffer: Buffer.from(toCsv(headers, rows), 'utf8'),
  };
}

async function xlsxFile(table, baseName) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(table.title.slice(0, 31));
  sheet.addRow([table.title]).font = { bold: true, size: 14 };
  sheet.addRow([table.subtitle]);
  sheet.addRow([]);
  sheet.addRow(table.columns.map((column) => column.label)).font = { bold: true };
  for (const row of table.rows) {
    const added = sheet.addRow(table.columns.map((column) => row[column.key] ?? null));
    if (row.emphasis) added.font = { bold: true };
  }
  table.columns.forEach((column, index) => {
    const sheetColumn = sheet.getColumn(index + 1);
    sheetColumn.width = index === 0 ? 34 : 18;
    if (column.money) sheetColumn.numFmt = '"Rp"#,##0;-"Rp"#,##0';
    if (column.numeric) sheetColumn.alignment = { horizontal: 'right' };
  });
  return {
    filename: `${baseName}.xlsx`,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
  };
}

async function pdfFile(table, baseName) {
  return {
    filename: `${baseName}.pdf`,
    contentType: 'application/pdf',
    buffer: await reportPdf(table),
  };
}

const EXPORTERS = { csv: csvFile, xlsx: xlsxFile, pdf: pdfFile };

/** The file is built from the same table object the screen shows, so totals cannot differ. */
export async function exportReport(actor, name, query) {
  const table = await runReport(actor, name, query);
  return EXPORTERS[query.format](table, `${name}_${query.from}_${query.to}`);
}

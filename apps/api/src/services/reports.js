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

  const line = (label, value, previousValue, emphasis = false, indent = false, double = false) => {
    const row = { label, amount: value, emphasis, indent, double };
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
      line(
        name,
        amountOf(current, 'operating', name),
        amountOf(previous, 'operating', name),
        false,
        true,
      ),
    ),
    line('Total beban operasional', current.operating_total, previous?.operating_total, true),
    line('Pendapatan lain', current.other_income, previous?.other_income),
    ...categoryNames('other_expense').map((name) =>
      line(
        name,
        amountOf(current, 'other_expense', name),
        amountOf(previous, 'other_expense', name),
        false,
        true,
      ),
    ),
    line('Total beban lain', current.other_expense_total, previous?.other_expense_total, true),
    line('Laba bersih', current.net_profit, previous?.net_profit, true, false, true),
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
        columns: LABEL_AMOUNT_COLUMNS,
        rows: cashSummaryRows(totals, categories),
      },
      ...cashActivitySections(categories),
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

export const REPORTS = {
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
  if (row.emphasis) added.font = { bold: true };
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
  return EXPORTERS[query.format](table, `${name}_${query.from}_${query.to}`, meta);
}

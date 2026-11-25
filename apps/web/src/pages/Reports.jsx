import { useMemo, useState } from 'react';
import { downloadFile, query } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useFetch } from '../lib/hooks.js';
import { accounting, formatDate, periodFor, todayJakarta } from '../lib/format.js';
import { Page } from '../components/Layout.jsx';
import { Icon } from '../components/Icon.jsx';
import {
  CheckField,
  EmptyState,
  FormError,
  ListSkeleton,
  Loaded,
  PageHeader,
  PillTabs,
  SelectField,
  TextField,
  useAccounts,
} from '../components/ui.jsx';

const REPORTS = [
  { value: 'balance-sheet', label: 'Neraca' },
  { value: 'profit-loss', label: 'Laba Rugi' },
  { value: 'cash-flow', label: 'Arus Kas' },
  { value: 'sales-by-product', label: 'Penjualan per Produk' },
  { value: 'expense-by-category', label: 'Pengeluaran per Kategori' },
];

const RANGE_OPTIONS = [
  { value: 'current', label: 'Periode ini' },
  { value: 'previous', label: 'Periode lalu' },
  { value: 'last3', label: '3 periode terakhir' },
  { value: 'year', label: 'Tahun ini' },
  { value: 'custom', label: 'Pilih tanggal' },
];

function presetRange(preset, startDay) {
  const today = todayJakarta();
  const current = periodFor(today, startDay);
  if (preset === 'previous') return periodFor(today, startDay, -1);
  if (preset === 'last3') return { from: periodFor(today, startDay, -2).from, to: current.to };
  if (preset === 'year')
    return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
  return current;
}

function rowClass(row) {
  if (row.double) {
    return 'bg-surface-soft font-semibold [&>td]:border-b-[3px] [&>td]:border-double [&>td]:border-b-ink';
  }
  if (row.emphasis) return 'bg-surface-soft font-semibold';
  return row.heading ? 'font-semibold' : '';
}

/** Indent is a level (1 or 2); older reports send true for one level. */
const INDENT_CLASS = { 1: 'pl-8', 2: 'pl-14' };
const indentClass = (row) => INDENT_CLASS[row.indent === true ? 1 : row.indent] ?? '';

function ReportSection({ section, caption }) {
  const cell = (row, column) => {
    const value = row[column.key];
    if (value === null || value === undefined) return '';
    return column.money ? accounting(value) : value;
  };
  return (
    <section>
      {section.title && <h3 className="mb-2 text-h5">{section.title}</h3>}
      <div className="card relative overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse">
          <caption className="sr-only">
            {section.title ?? caption}, {caption}
          </caption>
          <thead className={section.plain ? 'sr-only' : 'bg-tint-gray'}>
            <tr>
              {section.columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={`table-head ${column.numeric ? 'text-right' : ''}`}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {section.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className={rowClass(row)}>
                {section.columns.map((column, columnIndex) => (
                  <td
                    key={column.key}
                    className={`table-cell ${column.numeric ? 'num whitespace-nowrap text-right' : ''} ${
                      columnIndex === 0 ? indentClass(row) : ''
                    }`}
                  >
                    {cell(row, column)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ReportTable({ table }) {
  const sections = table.sections ?? [{ columns: table.columns, rows: table.rows }];
  return (
    <div className="space-y-6">
      {sections.map((section, index) => (
        <ReportSection key={section.title ?? index} section={section} caption={table.title} />
      ))}
      {table.notes?.length > 0 && (
        <ul className="space-y-1 text-caption text-slate">
          {table.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Reports() {
  const { business } = useAuth();
  const accounts = useAccounts();
  const [report, setReport] = useState('profit-loss');
  const [preset, setPreset] = useState('current');
  const [custom, setCustom] = useState(() => presetRange('current', business.period_start_day));
  const [compare, setCompare] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [asOf, setAsOf] = useState(() => todayJakarta());
  const [exporting, setExporting] = useState(null);
  const [exportError, setExportError] = useState(null);
  const isBalanceSheet = report === 'balance-sheet';

  const range = useMemo(() => {
    // A balance sheet is one date; its profit splits at 1 January of that year.
    if (isBalanceSheet) return { from: `${asOf.slice(0, 4)}-01-01`, to: asOf };
    return preset === 'custom' ? custom : presetRange(preset, business.period_start_day);
  }, [isBalanceSheet, asOf, preset, custom, business.period_start_day]);
  const params = {
    ...range,
    compare: report === 'profit-loss' && compare ? 'true' : '',
    account_id: report === 'cash-flow' ? accountId : '',
  };
  const state = useFetch(`/reports/${report}${query(params)}`);

  // `key` tells the buttons apart, so only the one pressed says it is preparing.
  async function download(key, path) {
    setExporting(key);
    setExportError(null);
    try {
      await downloadFile(path);
    } catch (error) {
      setExportError(error.message);
    } finally {
      setExporting(null);
    }
  }
  const exportAs = (format) =>
    download(format, `/reports/${report}/export${query({ ...params, format })}`);
  const exportPackage = (format) =>
    download(
      `package-${format}`,
      `/reports/financial-statements/export${query({ ...range, format })}`,
    );

  return (
    <Page>
      <PageHeader title="Laporan" description="Transfer tidak dihitung sebagai laba." />
      <div className="space-y-3">
        <PillTabs label="Pilih laporan" options={REPORTS} value={report} onChange={setReport} />
        {isBalanceSheet ? (
          <div className="sm:max-w-[14rem]">
            <TextField
              label="Per tanggal"
              type="date"
              value={asOf}
              onChange={(e) => e.target.value && setAsOf(e.target.value)}
            />
          </div>
        ) : (
          <PillTabs label="Rentang" options={RANGE_OPTIONS} value={preset} onChange={setPreset} />
        )}
        {!isBalanceSheet && preset === 'custom' && (
          <div className="grid grid-cols-2 gap-3 sm:max-w-md">
            <TextField
              label="Dari tanggal"
              type="date"
              value={custom.from}
              onChange={(e) => setCustom({ ...custom, from: e.target.value })}
            />
            <TextField
              label="Sampai tanggal"
              type="date"
              value={custom.to}
              onChange={(e) => setCustom({ ...custom, to: e.target.value })}
            />
          </div>
        )}
        {report === 'profit-loss' && (
          <CheckField
            label="Bandingkan dengan rentang sebelumnya"
            checked={compare}
            onChange={(e) => setCompare(e.target.checked)}
          />
        )}
        {report === 'cash-flow' && (
          <div className="sm:max-w-xs">
            <SelectField
              label="Akun"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value="">Semua akun</option>
              {accounts.data && <AccountList accounts={accounts.data} />}
            </SelectField>
          </div>
        )}
      </div>

      <div className="card mt-4 flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <h2 className="text-h5">Laporan keuangan lengkap</h2>
          <p className="num text-body-sm text-slate">
            Neraca per {formatDate(range.to)}, Laba Rugi dan Arus Kas {formatDate(range.from)} s.d.{' '}
            {formatDate(range.to)}, dalam satu file.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            { format: 'xlsx', label: 'Excel' },
            { format: 'pdf', label: 'PDF' },
          ].map(({ format, label }) => (
            <button
              key={format}
              type="button"
              className="btn-secondary"
              disabled={Boolean(exporting)}
              onClick={() => exportPackage(format)}
            >
              <Icon name="download" size={16} />
              {exporting === `package-${format}` ? 'Menyiapkan...' : label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6">
        <Loaded state={state} skeleton={<ListSkeleton rows={6} />}>
          {(table) => (
            <>
              <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-h4">{table.title}</h2>
                  <p className="num text-body-sm text-slate">
                    {table.subtitle} · {table.basis}
                  </p>
                </div>
                {!table.is_empty && (
                  <div className="flex flex-wrap gap-2">
                    {['csv', 'xlsx', 'pdf'].map((format) => (
                      <button
                        key={format}
                        type="button"
                        className="btn-secondary"
                        disabled={Boolean(exporting)}
                        onClick={() => exportAs(format)}
                      >
                        <Icon name="download" size={16} />
                        {exporting === format ? 'Menyiapkan...' : format.toUpperCase()}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <FormError message={exportError} />
              {table.is_empty ? (
                <EmptyState
                  title={
                    isBalanceSheet
                      ? 'Belum ada saldo pada tanggal ini.'
                      : 'Tidak ada data pada rentang ini.'
                  }
                  body={
                    isBalanceSheet
                      ? 'Pilih tanggal lain, atau isi saldo awal akun lebih dulu.'
                      : 'Pilih rentang lain, atau catat transaksi lebih dulu.'
                  }
                />
              ) : (
                <ReportTable table={table} />
              )}
            </>
          )}
        </Loaded>
      </div>
    </Page>
  );
}

function AccountList({ accounts }) {
  return accounts.items.map((account) => (
    <option key={account.id} value={account.id}>
      {account.name}
    </option>
  ));
}

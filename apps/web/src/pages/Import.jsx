import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { notifyChanged } from '../lib/hooks.js';
import { formatDate, rupiah } from '../lib/format.js';
import { Page } from '../components/Layout.jsx';
import { useToast } from '../components/Toast.jsx';
import {
  AccountOptions,
  Badge,
  CategoryOptions,
  CheckField,
  FormError,
  PageHeader,
  SelectField,
  useAccounts,
  useCategories,
} from '../components/ui.jsx';

const COLUMNS = [
  { key: 'date', label: 'Tanggal', required: true },
  {
    key: 'amount',
    label: 'Nominal',
    required: true,
    hint: 'Nilai minus dibaca sebagai pengeluaran jika kolom jenis kosong.',
  },
  { key: 'type', label: 'Jenis' },
  { key: 'note', label: 'Catatan' },
  { key: 'category', label: 'Kategori' },
];

const STATUS = {
  valid: { label: 'Valid', tone: 'green' },
  invalid: { label: 'Tidak valid', tone: 'red' },
  duplicate: { label: 'Duplikat', tone: 'orange' },
};

const PREVIEW_LIMIT = 200;

function guessColumn(headers, words) {
  return headers.findIndex((header) => words.some((word) => header.toLowerCase().includes(word)));
}

function guessMapping(headers) {
  const guess = (words) => {
    const index = guessColumn(headers, words);
    return index >= 0 ? String(index) : '';
  };
  return {
    date: guess(['tanggal', 'date', 'tgl']),
    amount: guess(['nominal', 'jumlah', 'amount']),
    type: guess(['jenis', 'tipe', 'type']),
    note: guess(['catatan', 'keterangan', 'note', 'deskripsi']),
    category: guess(['kategori', 'category']),
  };
}

export default function Import() {
  const toast = useToast();
  const accounts = useAccounts();
  const categories = useCategories();
  const [file, setFile] = useState(null);
  const [table, setTable] = useState(null);
  const [mapping, setMapping] = useState({});
  const [form, setForm] = useState({
    account_id: '',
    default_category_id: '',
    default_income_category_id: '',
  });
  const [preview, setPreview] = useState(null);
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [result, setResult] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  function buildForm() {
    const data = new FormData();
    data.append('file', file);
    const chosen = Object.fromEntries(
      Object.entries(mapping)
        .filter(([, value]) => value !== '')
        .map(([key, value]) => [key, Number(value)]),
    );
    data.append('mapping', JSON.stringify(chosen));
    data.append('account_id', form.account_id);
    data.append('default_category_id', form.default_category_id);
    data.append('default_income_category_id', form.default_income_category_id);
    data.append('include_duplicates', String(includeDuplicates));
    return data;
  }

  async function run(action) {
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      await action();
    } catch (failure) {
      setFieldErrors(failure.fields ?? {});
      setError(failure.message);
    } finally {
      setPending(false);
    }
  }

  const readFile = (picked) =>
    run(async () => {
      setFile(null);
      setTable(null);
      setPreview(null);
      setResult(null);
      const data = new FormData();
      data.append('file', picked);
      const response = await api.upload('/import/preview', data);
      setFile(picked);
      setTable(response);
      setMapping(guessMapping(response.headers));
    });

  const buildPreview = () =>
    run(async () => {
      const response = await api.upload('/import/preview', buildForm());
      setPreview(response);
    });

  const commit = () =>
    run(async () => {
      const response = await api.upload('/import/commit', buildForm());
      setResult(response);
      toast.show(response.message);
      notifyChanged();
    });

  function reset() {
    setFile(null);
    setTable(null);
    setPreview(null);
    setResult(null);
    setError(null);
  }

  if (result) {
    return (
      <Page narrow>
        <PageHeader title="Impor selesai" description={result.message} />
        <dl className="grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-tint-mint p-4">
            <dt className="text-body-sm text-charcoal">Diimpor</dt>
            <dd className="num text-h3">{result.summary.imported}</dd>
          </div>
          <div className="rounded-lg bg-tint-yellow p-4">
            <dt className="text-body-sm text-charcoal">Dilewati</dt>
            <dd className="num text-h3">{result.summary.skipped}</dd>
          </div>
          <div className="rounded-lg bg-tint-rose p-4">
            <dt className="text-body-sm text-charcoal">Gagal</dt>
            <dd className="num text-h3">{result.summary.failed}</dd>
          </div>
        </dl>
        {result.failed_rows.length > 0 && (
          <ul className="card mt-4 divide-y divide-hairline-soft text-body-sm">
            {result.failed_rows.slice(0, 50).map((row) => (
              <li key={row.row} className="px-4 py-2">
                Baris {row.row}: {row.reason}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-6 flex flex-wrap gap-2">
          <Link to="/transaksi" className="btn-primary">
            Lihat transaksi
          </Link>
          <button type="button" className="btn-secondary" onClick={reset}>
            Impor file lain
          </button>
        </div>
      </Page>
    );
  }

  return (
    <Page narrow>
      <PageHeader
        title="Impor Data"
        description="Masukkan transaksi dari CSV atau XLSX, paling besar 5 MB dan 5.000 baris."
      />
      <div>
        <label htmlFor="import-file" className="field-label">
          File
        </label>
        <input
          id="import-file"
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          disabled={pending}
          className="block min-h-[44px] w-full text-body-sm text-slate file:mr-3 file:min-h-[44px] file:cursor-pointer file:rounded-md file:border file:border-hairline-strong file:bg-white file:px-4 file:text-body-sm file:font-medium file:text-ink"
          onChange={(event) => event.target.files[0] && readFile(event.target.files[0])}
        />
        {pending && !table && <p className="mt-2 text-body-sm text-slate">Membaca file...</p>}
      </div>
      <FormError message={!table || !preview ? error : null} />

      {table && (
        <section className="mt-8" aria-labelledby="map-heading">
          <h2 id="map-heading" className="text-h5">
            Cocokkan kolom
          </h2>
          <p className="mt-0.5 text-body-sm text-slate">
            {table.row_count} baris ditemukan di {file.name}.
          </p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {COLUMNS.map((column) => (
              <SelectField
                key={column.key}
                label={column.required ? column.label : `${column.label} (boleh kosong)`}
                hint={column.hint}
                value={mapping[column.key] ?? ''}
                onChange={(event) => {
                  setMapping({ ...mapping, [column.key]: event.target.value });
                  setPreview(null);
                }}
              >
                <option value="">Tidak dipakai</option>
                {table.headers.map((header, index) => (
                  <option key={`${header}-${index}`} value={index}>
                    {header || `Kolom ${index + 1}`}
                  </option>
                ))}
              </SelectField>
            ))}
            <SelectField
              label="Masuk ke akun"
              value={form.account_id}
              error={fieldErrors.account_id}
              onChange={(e) => {
                setForm({ ...form, account_id: e.target.value });
                setPreview(null);
              }}
            >
              <AccountOptions accounts={accounts.data} />
            </SelectField>
            <SelectField
              label="Kategori pengeluaran bawaan"
              hint="Untuk baris yang kategorinya kosong atau tidak dikenal."
              value={form.default_category_id}
              error={fieldErrors.default_category_id}
              onChange={(e) => {
                setForm({ ...form, default_category_id: e.target.value });
                setPreview(null);
              }}
            >
              <CategoryOptions categories={categories.data} type="expense" />
            </SelectField>
            <SelectField
              label="Kategori pemasukan bawaan"
              value={form.default_income_category_id}
              onChange={(e) => {
                setForm({ ...form, default_income_category_id: e.target.value });
                setPreview(null);
              }}
            >
              <CategoryOptions categories={categories.data} type="income" />
            </SelectField>
          </div>
          {!preview && <FormError message={error} />}
          <button
            type="button"
            className="btn-primary mt-4"
            disabled={pending || mapping.date === '' || mapping.amount === ''}
            onClick={buildPreview}
          >
            {pending ? 'Memeriksa...' : 'Periksa semua baris'}
          </button>
        </section>
      )}

      {preview && (
        <section className="mt-8" aria-labelledby="preview-heading">
          <h2 id="preview-heading" className="text-h5">
            Pratinjau
          </h2>
          <p className="mt-0.5 text-body-sm text-slate">
            {preview.counts.valid} valid · {preview.counts.duplicate} duplikat ·{' '}
            {preview.counts.invalid} tidak valid. Belum ada yang disimpan.
          </p>
          <div className="card mt-3 max-h-96 overflow-auto">
            <table className="w-full min-w-[560px] border-collapse">
              <thead className="sticky top-0 bg-white">
                <tr>
                  <th scope="col" className="table-head">
                    Baris
                  </th>
                  <th scope="col" className="table-head">
                    Status
                  </th>
                  <th scope="col" className="table-head">
                    Tanggal
                  </th>
                  <th scope="col" className="table-head text-right">
                    Nominal
                  </th>
                  <th scope="col" className="table-head">
                    Catatan atau alasan
                  </th>
                </tr>
              </thead>
              <tbody>
                {preview.preview.slice(0, PREVIEW_LIMIT).map((row) => (
                  <tr key={row.row}>
                    <td className="table-cell num">{row.row}</td>
                    <td className="table-cell">
                      <Badge tone={STATUS[row.status].tone}>{STATUS[row.status].label}</Badge>
                    </td>
                    <td className="table-cell whitespace-nowrap">
                      {row.occurred_on ? formatDate(row.occurred_on) : ''}
                    </td>
                    <td className="table-cell num whitespace-nowrap text-right">
                      {row.amount
                        ? `${row.type === 'expense' ? '-' : '+'}${rupiah(row.amount)}`
                        : ''}
                    </td>
                    <td className="table-cell">{row.reason ?? row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.preview.length > PREVIEW_LIMIT && (
            <p className="mt-1 text-caption text-slate">
              Menampilkan {PREVIEW_LIMIT} baris pertama.
            </p>
          )}
          <div className="mt-4">
            <CheckField
              label="Tetap masukkan baris duplikat"
              hint="Baris duplikat dilewati kecuali ini dicentang."
              checked={includeDuplicates}
              onChange={(event) => setIncludeDuplicates(event.target.checked)}
            />
          </div>
          <FormError message={error} />
          <button type="button" className="btn-primary mt-4" disabled={pending} onClick={commit}>
            {pending
              ? 'Menyimpan...'
              : `Simpan ${preview.counts.valid + (includeDuplicates ? preview.counts.duplicate : 0)} transaksi`}
          </button>
        </section>
      )}
    </Page>
  );
}

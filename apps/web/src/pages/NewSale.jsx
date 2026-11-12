import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, query } from '../lib/api.js';
import {
  defaultAccountId,
  lineError,
  pickerHint,
  saleSaveHint,
  saveProblem,
} from '../lib/simpleForm.js';
import { notifyChanged, useDebounced, useFetch, useSubmit } from '../lib/hooks.js';
import { formatQty, rupiah, todayJakarta } from '../lib/format.js';
import { Page } from '../components/Layout.jsx';
import { Icon } from '../components/Icon.jsx';
import {
  AccountOptions,
  Badge,
  FormError,
  MoneyField,
  PageHeader,
  SearchInput,
  SelectField,
  TextField,
  useAccounts,
} from '../components/ui.jsx';

let nextLineKey = 1;

function newLine(product) {
  return {
    key: nextLineKey++,
    product_id: product?.id ?? null,
    description: product?.name ?? '',
    unit: product?.unit ?? '',
    stock: product?.track_stock ? product.stock_qty : null,
    qty: '1',
    unit_price: product?.sell_price ?? null,
  };
}

function parseQty(text) {
  const value = Number(String(text).replace(',', '.'));
  return Number.isFinite(value) ? value : 0;
}

function lineTotal(line) {
  return Math.round(parseQty(line.qty) * (line.unit_price ?? 0));
}

function ProductPicker({ onPick }) {
  const [search, setSearch] = useState('');
  const q = useDebounced(search, 200);
  const state = useFetch(`/products${query({ q, limit: 8 })}`);
  const products = state.data?.items ?? [];
  const hint = state.data ? pickerHint(products.length, state.data.total) : null;
  return (
    <section aria-labelledby="picker-heading">
      <h2 id="picker-heading" className="mb-2 text-h5">
        Pilih barang
      </h2>
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Cari nama barang"
        label="Cari barang"
      />
      <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-3">
        {state.error && <FormError message={state.error.message} />}
        {!state.data &&
          !state.error &&
          [0, 1, 2, 3].map((index) => <div key={index} className="skeleton h-[88px] rounded-md" />)}
        {products.map((product) => {
          const empty = product.track_stock && product.stock_qty <= 0;
          return (
            <button
              key={product.id}
              type="button"
              disabled={empty}
              onClick={() => onPick(product)}
              className="min-h-[88px] rounded-md border border-hairline bg-white px-3 py-2 text-left transition-colors duration-150 hover:border-primary hover:bg-tint-lavender disabled:cursor-not-allowed disabled:bg-surface disabled:text-slate"
            >
              <span className="block break-words text-body font-medium">{product.name}</span>
              <span className="num block text-caption text-slate">
                {rupiah(product.sell_price)}
                {product.track_stock && ` · stok ${formatQty(product.stock_qty)}`}
              </span>
            </button>
          );
        })}
      </div>
      {hint && <p className="mt-2 text-body-sm text-slate">{hint}</p>}
      {state.data && products.length === 0 && (
        <p className="mt-3 rounded-md bg-surface px-4 py-3 text-body-sm text-slate">
          {q ? 'Barang tidak ditemukan.' : 'Belum ada barang.'} Pakai tombol di bawah, atau{' '}
          <Link to="/produk" className="link">
            buka daftar produk
          </Link>
          .
        </p>
      )}
    </section>
  );
}

function LineEditor({ line, index, errors, onChange, onRemove }) {
  const overStock = line.stock !== null && parseQty(line.qty) > line.stock;
  const problem = lineError(errors, index);
  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-3">
        {line.product_id ? (
          <p className="min-w-0 break-words pt-2 font-medium">{line.description}</p>
        ) : (
          <div className="min-w-0 flex-1">
            <TextField
              label="Nama barang atau jasa"
              value={line.description}
              onChange={(event) => onChange({ description: event.target.value })}
              error={errors[`items.${index}.description`]}
              maxLength={120}
            />
          </div>
        )}
        <button
          type="button"
          className="btn-ghost w-11 shrink-0 px-0 text-slate"
          aria-label={`Hapus ${line.description || 'baris'}`}
          onClick={onRemove}
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="mt-2 grid grid-cols-[auto_1fr] items-end gap-3">
        <div>
          <span className="field-label" id={`qty-${line.key}`}>
            Jumlah{line.unit ? ` (${line.unit})` : ''}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="btn-secondary w-11 px-0 text-h5"
              aria-label="Kurangi jumlah"
              onClick={() =>
                onChange({ qty: String(Math.max(1, Math.ceil(parseQty(line.qty)) - 1)) })
              }
            >
              −
            </button>
            <input
              aria-labelledby={`qty-${line.key}`}
              inputMode="decimal"
              className="field-input num w-16 px-1 text-center"
              value={line.qty}
              onChange={(event) => onChange({ qty: event.target.value })}
            />
            <button
              type="button"
              className="btn-secondary w-11 px-0 text-h5"
              aria-label="Tambah jumlah"
              onClick={() => onChange({ qty: String(Math.floor(parseQty(line.qty)) + 1) })}
            >
              +
            </button>
          </div>
        </div>
        <MoneyField
          label="Harga"
          value={line.unit_price}
          onChange={(unit_price) => onChange({ unit_price })}
          error={errors[`items.${index}.unit_price`]}
        />
      </div>
      {problem && <p className="mt-1 text-caption text-danger-deep">{problem}</p>}
      <div className="mt-2 flex items-center justify-between gap-3 text-body-sm">
        {overStock ? (
          <Badge tone="red">
            Stok hanya {formatQty(line.stock)} {line.unit}
          </Badge>
        ) : (
          <span />
        )}
        <span className="num font-medium">{rupiah(lineTotal(line))}</span>
      </div>
    </li>
  );
}

const OPTION_FIELDS = ['sale_date', 'discount', 'account_id'];

export default function NewSale() {
  const navigate = useNavigate();
  const accounts = useAccounts();
  const [lines, setLines] = useState([]);
  const [discount, setDiscount] = useState(null);
  const [form, setForm] = useState({ account_id: '', sale_date: todayJakarta() });

  const subtotal = useMemo(() => lines.reduce((sum, line) => sum + lineTotal(line), 0), [lines]);
  const total = Math.max(0, subtotal - (discount ?? 0));
  const accountId = form.account_id || defaultAccountId(accounts.data);

  function addProduct(product) {
    setLines((current) => {
      const existing = current.find((line) => line.product_id === product.id);
      if (!existing) return [...current, newLine(product)];
      return current.map((line) =>
        line === existing ? { ...line, qty: String(parseQty(line.qty) + 1) } : line,
      );
    });
  }

  const save = useCallback(
    () =>
      api.post('/sales', {
        items: lines.map((line) => ({
          product_id: line.product_id,
          description: line.description,
          qty: parseQty(line.qty),
          unit_price: line.unit_price ?? 0,
        })),
        discount: discount ?? 0,
        account_id: accountId,
        sale_date: form.sale_date,
      }),
    [lines, discount, form.sale_date, accountId],
  );

  const onDone = useCallback(
    (result) => {
      notifyChanged();
      navigate('/', {
        replace: true,
        state: {
          saved: {
            message: 'Penjualan tersimpan.',
            warning: result.stock_warnings.join(' ') || undefined,
          },
        },
      });
    },
    [navigate],
  );

  const { submit, pending, fieldErrors, formError } = useSubmit(save, { onDone });
  const hasOptionError = OPTION_FIELDS.some((field) => fieldErrors[field]);
  const cannotSave = pending || lines.length === 0 || !accountId;
  const problem = saveProblem(formError, fieldErrors);
  const hint = saleSaveHint({ lineCount: lines.length });

  return (
    <Page>
      <PageHeader
        title="Catat Penjualan"
        actions={
          <Link to="/" className="btn-ghost">
            Batal
          </Link>
        }
      />
      <form
        className="grid items-start gap-x-10 gap-y-6 pb-44 lg:grid-cols-[1.4fr_1fr] lg:pb-0"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div>
          <ProductPicker onPick={addProduct} />
          <button
            type="button"
            className="btn-secondary mt-3"
            onClick={() => setLines((current) => [...current, newLine()])}
          >
            <Icon name="plus" size={18} /> Barang atau jasa lain
          </button>
          {lines.length > 0 && (
            <ul className="mt-4 divide-y divide-hairline-soft border-y border-hairline-soft">
              {lines.map((line, index) => (
                <LineEditor
                  key={line.key}
                  line={line}
                  index={index}
                  errors={fieldErrors}
                  onChange={(patch) =>
                    setLines((current) =>
                      current.map((item) => (item === line ? { ...item, ...patch } : item)),
                    )
                  }
                  onRemove={() => setLines((current) => current.filter((item) => item !== line))}
                />
              ))}
            </ul>
          )}
          {fieldErrors.items && <FormError message={fieldErrors.items} />}
        </div>

        <div className="space-y-4 lg:sticky lg:top-24">
          {accounts.data && !accountId && (
            <p className="rounded-md bg-surface px-4 py-3 text-body">
              Belum ada akun kas. Buat dulu di Menu lain,{' '}
              <Link to="/akun" className="link">
                Akun Kas
              </Link>
              .
            </p>
          )}
          {accounts.error && <FormError message={accounts.error.message} />}
          <details open={hasOptionError} className="rounded-md border border-hairline">
            <summary className="flex min-h-[52px] cursor-pointer items-center px-4 text-body font-medium">
              Pilihan lain
            </summary>
            <div className="space-y-4 border-t border-hairline p-4">
              <TextField
                label="Tanggal penjualan"
                type="date"
                value={form.sale_date}
                onChange={(e) => setForm({ ...form, sale_date: e.target.value })}
                error={fieldErrors.sale_date}
              />
              <MoneyField
                label="Diskon"
                value={discount}
                onChange={setDiscount}
                error={fieldErrors.discount}
              />
              <SelectField
                label="Uang masuk ke akun"
                value={accountId}
                onChange={(e) => setForm({ ...form, account_id: e.target.value })}
                error={fieldErrors.account_id}
              >
                <AccountOptions accounts={accounts.data} />
              </SelectField>
            </div>
          </details>
          <div className="hidden lg:block">
            <FormError message={problem} />
          </div>
          <dl className="hidden border-t border-hairline pt-3 lg:block">
            <div className="flex items-baseline justify-between">
              <dt className="font-medium">Total</dt>
              <dd className="num text-h3">{rupiah(total)}</dd>
            </div>
          </dl>
          {hint && <p className="hidden text-body-sm text-slate lg:block">{hint}</p>}
          <button
            type="submit"
            className="btn-primary hidden w-full lg:inline-flex"
            disabled={cannotSave}
          >
            {pending ? 'Menyimpan...' : 'Simpan'}
          </button>
        </div>

        <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-hairline bg-white px-4 pt-2 lg:hidden">
          <FormError message={problem} />
          {hint && <p className="pb-1 text-body-sm text-slate">{hint}</p>}
          <div className="flex items-center justify-between gap-4 pb-2">
            <div className="min-w-0">
              <p className="text-caption text-slate">Total</p>
              <p className="num truncate text-h4">{rupiah(total)}</p>
            </div>
            <button type="submit" className="btn-primary" disabled={cannotSave}>
              {pending ? 'Menyimpan...' : 'Simpan'}
            </button>
          </div>
        </div>
      </form>
    </Page>
  );
}

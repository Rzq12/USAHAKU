import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, query } from '../lib/api.js';
import { notifyChanged, useDebounced, useFetch, useSubmit } from '../lib/hooks.js';
import { formatQty, rupiah, todayJakarta } from '../lib/format.js';
import { Page } from '../components/Layout.jsx';
import { Drawer } from '../components/Drawer.jsx';
import { Icon } from '../components/Icon.jsx';
import { useToast } from '../components/Toast.jsx';
import {
  AccountOptions,
  Badge,
  FormError,
  MoneyField,
  PageHeader,
  PillTabs,
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
  return (
    <section aria-labelledby="picker-heading">
      <h2 id="picker-heading" className="mb-2 text-h5">
        Pilih barang
      </h2>
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Cari nama atau SKU"
        label="Cari produk"
      />
      <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {state.error && <FormError message={state.error.message} />}
        {!state.data &&
          !state.error &&
          [0, 1, 2, 3].map((index) => <div key={index} className="skeleton h-[68px] rounded-md" />)}
        {products.map((product) => {
          const empty = product.track_stock && product.stock_qty <= 0;
          return (
            <button
              key={product.id}
              type="button"
              disabled={empty}
              onClick={() => onPick(product)}
              className="min-h-[68px] rounded-md border border-hairline bg-white px-3 py-2 text-left transition-colors duration-150 hover:border-primary hover:bg-tint-lavender disabled:cursor-not-allowed disabled:bg-surface disabled:text-slate"
            >
              <span className="block break-words text-body-sm font-medium">{product.name}</span>
              <span className="num block text-caption text-slate">
                {rupiah(product.sell_price)}
                {product.track_stock && ` · stok ${formatQty(product.stock_qty)}`}
              </span>
            </button>
          );
        })}
      </div>
      {state.data && products.length === 0 && (
        <p className="mt-3 rounded-md bg-surface px-4 py-3 text-body-sm text-slate">
          {q ? 'Produk tidak ditemukan.' : 'Belum ada produk.'} Pakai baris bebas di bawah, atau{' '}
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

function NewCustomerDrawer({ open, onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', phone: '' });
  const action = useCallback(() => api.post('/contacts', { ...form, type: 'customer' }), [form]);
  const { submit, pending, fieldErrors, formError } = useSubmit(action, {
    success: 'Kontak disimpan.',
    onDone: (contact) => {
      setForm({ name: '', phone: '' });
      onCreated(contact);
    },
  });
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Tambah pelanggan"
      footer={
        <button type="button" className="btn-primary" disabled={pending} onClick={() => submit()}>
          {pending ? 'Menyimpan...' : 'Simpan pelanggan'}
        </button>
      }
    >
      <div className="space-y-4">
        <TextField
          label="Nama"
          autoFocus
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          error={fieldErrors.name}
        />
        <TextField
          label="Telepon"
          inputMode="tel"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          error={fieldErrors.phone}
        />
        <FormError message={formError} />
      </div>
    </Drawer>
  );
}

const PAYMENT_OPTIONS = [
  { value: 'paid', label: 'Lunas' },
  { value: 'credit', label: 'Kredit' },
];

export default function NewSale() {
  const navigate = useNavigate();
  const toast = useToast();
  const accounts = useAccounts();
  const contacts = useFetch('/contacts?type=customer&limit=100');
  const [lines, setLines] = useState([]);
  const [discount, setDiscount] = useState(null);
  const [form, setForm] = useState({
    payment_type: 'paid',
    account_id: '',
    contact_id: '',
    due_date: '',
    sale_date: todayJakarta(),
  });
  const [customerOpen, setCustomerOpen] = useState(false);

  const subtotal = useMemo(() => lines.reduce((sum, line) => sum + lineTotal(line), 0), [lines]);
  const total = Math.max(0, subtotal - (discount ?? 0));
  const selectedAccount = form.account_id || accounts.data?.items[0]?.id || '';

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
        payment_type: form.payment_type,
        account_id: form.payment_type === 'paid' ? selectedAccount : null,
        contact_id: form.contact_id || null,
        due_date: form.payment_type === 'credit' ? form.due_date || null : null,
        sale_date: form.sale_date,
      }),
    [lines, discount, form, selectedAccount],
  );

  const onDone = useCallback(
    (result) => {
      notifyChanged();
      if (result.stock_warnings.length > 0) toast.show(result.stock_warnings.join(' '), 'warning');
      else toast.show('Penjualan disimpan.');
      navigate(`/penjualan/${result.sale.id}`, { replace: true });
    },
    [navigate, toast],
  );

  const { submit, pending, fieldErrors, formError } = useSubmit(save, { onDone });

  return (
    <Page>
      <PageHeader
        title="Catat penjualan"
        actions={
          <Link to="/penjualan" className="btn-ghost">
            Batal
          </Link>
        }
      />
      <form
        className="grid items-start gap-x-10 gap-y-8 pb-24 lg:grid-cols-[1.4fr_1fr] lg:pb-0"
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
          <h2 className="text-h5">Pembayaran</h2>
          <PillTabs
            label="Cara bayar"
            options={PAYMENT_OPTIONS}
            value={form.payment_type}
            onChange={(payment_type) => setForm({ ...form, payment_type })}
          />
          {form.payment_type === 'paid' && (
            <SelectField
              label="Uang masuk ke akun"
              value={selectedAccount}
              onChange={(e) => setForm({ ...form, account_id: e.target.value })}
              error={fieldErrors.account_id}
            >
              <AccountOptions accounts={accounts.data} />
            </SelectField>
          )}
          <div>
            <SelectField
              label={form.payment_type === 'credit' ? 'Pelanggan' : 'Pelanggan (boleh kosong)'}
              value={form.contact_id}
              onChange={(e) => setForm({ ...form, contact_id: e.target.value })}
              error={fieldErrors.contact_id}
            >
              <option value="">Pelanggan umum</option>
              {contacts.data?.items.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.name}
                </option>
              ))}
            </SelectField>
            <button
              type="button"
              className="link-tap text-body-sm"
              onClick={() => setCustomerOpen(true)}
            >
              Tambah pelanggan baru
            </button>
          </div>
          {form.payment_type === 'credit' && (
            <TextField
              label="Jatuh tempo"
              type="date"
              min={form.sale_date}
              value={form.due_date}
              onChange={(e) => setForm({ ...form, due_date: e.target.value })}
              error={fieldErrors.due_date}
            />
          )}
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
          <FormError message={formError} />
          <dl className="hidden border-t border-hairline pt-3 lg:block">
            <div className="flex justify-between text-body-sm text-slate">
              <dt>Subtotal</dt>
              <dd className="num">{rupiah(subtotal)}</dd>
            </div>
            <div className="mt-1 flex items-baseline justify-between">
              <dt className="font-medium">Total</dt>
              <dd className="num text-h3">{rupiah(total)}</dd>
            </div>
          </dl>
          <button
            type="submit"
            className="btn-primary hidden w-full lg:inline-flex"
            disabled={pending || lines.length === 0}
          >
            {pending ? 'Menyimpan...' : 'Simpan penjualan'}
          </button>
        </div>

        <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-hairline bg-white px-4 pt-2 lg:hidden">
          <div className="flex items-center justify-between gap-4 pb-2">
            <div className="min-w-0">
              <p className="text-caption text-slate">Total</p>
              <p className="num truncate text-h4">{rupiah(total)}</p>
            </div>
            <button
              type="submit"
              className="btn-primary min-h-[48px]"
              disabled={pending || lines.length === 0}
            >
              {pending ? 'Menyimpan...' : 'Simpan'}
            </button>
          </div>
        </div>
      </form>
      <NewCustomerDrawer
        open={customerOpen}
        onClose={() => setCustomerOpen(false)}
        onCreated={(contact) => {
          contacts.reload();
          setForm((current) => ({ ...current, contact_id: contact.id }));
          setCustomerOpen(false);
        }}
      />
    </Page>
  );
}

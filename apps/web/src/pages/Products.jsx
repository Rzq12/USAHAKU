import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, query } from '../lib/api.js';
import { notifyChanged, useDebounced, useFetch, useSubmit } from '../lib/hooks.js';
import { formatDateTime, formatQty, rupiah } from '../lib/format.js';
import { Page } from '../components/Layout.jsx';
import { ConfirmDialog, Drawer } from '../components/Drawer.jsx';
import { useToast } from '../components/Toast.jsx';
import {
  AccountOptions,
  Badge,
  CheckField,
  EmptyState,
  FormError,
  ListSkeleton,
  Loaded,
  MoneyField,
  PageHeader,
  Pagination,
  PillTabs,
  Row,
  RowList,
  SearchInput,
  SelectField,
  TextField,
  useAccounts,
} from '../components/ui.jsx';

const EMPTY = {
  name: '',
  sku: '',
  unit: 'pcs',
  sell_price: null,
  cost_price: null,
  track_stock: true,
  opening_stock: '0',
  low_stock_threshold: '',
};

const toNumber = (text) => Number(String(text).replace(',', '.'));
const optionalNumber = (text) => (String(text).trim() === '' ? null : toNumber(text));

function ProductDrawer({ open, onClose, product }) {
  const [form, setForm] = useState(EMPTY);
  useEffect(() => {
    if (!open) return;
    setForm(
      product
        ? {
            ...product,
            sku: product.sku ?? '',
            low_stock_threshold: product.low_stock_threshold ?? '',
          }
        : EMPTY,
    );
  }, [open, product]);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  const action = useCallback(() => {
    const payload = {
      name: form.name,
      sku: form.sku,
      unit: form.unit,
      sell_price: form.sell_price ?? 0,
      cost_price: form.cost_price ?? 0,
      track_stock: form.track_stock,
      low_stock_threshold: form.track_stock ? optionalNumber(form.low_stock_threshold) : null,
    };
    if (product) return api.put(`/products/${product.id}`, payload);
    return api.post('/products', {
      ...payload,
      opening_stock: form.track_stock ? toNumber(form.opening_stock || 0) : 0,
    });
  }, [form, product]);

  const { submit, pending, fieldErrors, formError } = useSubmit(action, {
    success: 'Produk disimpan.',
    onDone: () => {
      notifyChanged();
      onClose();
    },
  });

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={product ? 'Ubah produk' : 'Tambah produk'}
      footer={
        <button type="button" className="btn-primary" disabled={pending} onClick={() => submit()}>
          {pending ? 'Menyimpan...' : 'Simpan produk'}
        </button>
      }
    >
      <div className="space-y-4">
        <TextField
          label="Nama produk"
          value={form.name}
          onChange={set('name')}
          error={fieldErrors.name}
          maxLength={120}
        />
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Satuan"
            hint="pcs, kg, porsi"
            value={form.unit}
            onChange={set('unit')}
            error={fieldErrors.unit}
            maxLength={20}
          />
          <TextField
            label="SKU (boleh kosong)"
            value={form.sku}
            onChange={set('sku')}
            error={fieldErrors.sku}
            maxLength={40}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <MoneyField
            label="Harga jual"
            value={form.sell_price}
            onChange={(sell_price) => setForm({ ...form, sell_price })}
            error={fieldErrors.sell_price}
          />
          <MoneyField
            label="Harga modal"
            value={form.cost_price}
            onChange={(cost_price) => setForm({ ...form, cost_price })}
            error={fieldErrors.cost_price}
          />
        </div>
        <CheckField
          label="Lacak stok"
          hint="Penjualan ditolak jika melebihi stok."
          checked={form.track_stock}
          onChange={(event) => setForm({ ...form, track_stock: event.target.checked })}
        />
        {form.track_stock && (
          <div className="grid grid-cols-2 gap-3">
            {!product && (
              <TextField
                label="Stok awal"
                inputMode="decimal"
                value={form.opening_stock}
                onChange={set('opening_stock')}
                error={fieldErrors.opening_stock}
              />
            )}
            <TextField
              label="Batas stok menipis"
              inputMode="decimal"
              value={form.low_stock_threshold}
              onChange={set('low_stock_threshold')}
              error={fieldErrors.low_stock_threshold}
            />
          </div>
        )}
        <FormError message={formError} />
      </div>
    </Drawer>
  );
}

const STOCK_KINDS = [
  { value: 'restock', label: 'Stok masuk' },
  { value: 'adjustment', label: 'Penyesuaian' },
];

function StockDrawer({ product, onClose }) {
  const accounts = useAccounts();
  const [kind, setKind] = useState('restock');
  const [form, setForm] = useState({
    qty: '',
    cost_price: null,
    record_expense: false,
    account_id: '',
    qty_delta: '',
    reason: '',
  });
  useEffect(() => {
    if (!product) return;
    setKind('restock');
    setForm({
      qty: '',
      cost_price: product.cost_price,
      record_expense: false,
      account_id: '',
      qty_delta: '',
      reason: '',
    });
  }, [product]);

  const action = useCallback(() => {
    if (kind === 'restock') {
      return api.post(`/products/${product.id}/stock`, {
        kind,
        qty: toNumber(form.qty),
        cost_price: form.cost_price ?? undefined,
        record_expense: form.record_expense,
        account_id: form.record_expense && form.account_id ? form.account_id : undefined,
      });
    }
    return api.post(`/products/${product.id}/stock`, {
      kind,
      qty_delta: toNumber(form.qty_delta),
      reason: form.reason,
    });
  }, [kind, form, product]);

  const { submit, pending, fieldErrors, formError } = useSubmit(action, {
    success: 'Stok diperbarui.',
    onDone: () => {
      notifyChanged();
      onClose();
    },
  });

  return (
    <Drawer
      open={Boolean(product)}
      onClose={onClose}
      title={product ? `Ubah stok ${product.name}` : ''}
      footer={
        <button type="button" className="btn-primary" disabled={pending} onClick={() => submit()}>
          {pending ? 'Menyimpan...' : 'Simpan stok'}
        </button>
      }
    >
      {product && (
        <div className="space-y-4">
          <p className="text-body-sm text-slate">
            Stok sekarang{' '}
            <span className="num font-semibold text-ink">
              {formatQty(product.stock_qty)} {product.unit}
            </span>
          </p>
          <PillTabs label="Jenis perubahan" options={STOCK_KINDS} value={kind} onChange={setKind} />
          {kind === 'restock' ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <TextField
                  label="Jumlah masuk"
                  inputMode="decimal"
                  autoFocus
                  value={form.qty}
                  onChange={(e) => setForm({ ...form, qty: e.target.value })}
                  error={fieldErrors.qty}
                />
                <MoneyField
                  label="Harga modal baru"
                  value={form.cost_price}
                  onChange={(cost_price) => setForm({ ...form, cost_price })}
                  error={fieldErrors.cost_price}
                />
              </div>
              <CheckField
                label="Catat sebagai pengeluaran pembelian stok"
                hint="Masuk arus kas, tetapi tidak mengurangi laba."
                checked={form.record_expense}
                onChange={(event) => setForm({ ...form, record_expense: event.target.checked })}
              />
              {form.record_expense && (
                <SelectField
                  label="Bayar dari akun"
                  value={form.account_id}
                  onChange={(e) => setForm({ ...form, account_id: e.target.value })}
                  error={fieldErrors.account_id}
                >
                  <AccountOptions accounts={accounts.data} />
                </SelectField>
              )}
            </>
          ) : (
            <>
              <TextField
                label="Perubahan jumlah"
                hint="Tulis minus untuk mengurangi, misalnya -2."
                inputMode="text"
                autoFocus
                value={form.qty_delta}
                onChange={(e) => setForm({ ...form, qty_delta: e.target.value })}
                error={fieldErrors.qty_delta}
              />
              <TextField
                label="Alasan"
                value={form.reason}
                maxLength={200}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                error={fieldErrors.reason}
              />
            </>
          )}
          <FormError message={formError} />
        </div>
      )}
    </Drawer>
  );
}

const MOVEMENTS = {
  opening: 'Stok awal',
  restock: 'Stok masuk',
  sale: 'Penjualan',
  void: 'Pembatalan penjualan',
  adjustment: 'Penyesuaian',
};

function ProductDetail({ product, onClose, onEdit, onStock, onToggleActive }) {
  const movements = useFetch(
    product && product.track_stock ? `/products/${product.id}/movements?limit=20` : null,
  );
  return (
    <Drawer
      open={Boolean(product)}
      onClose={onClose}
      title={product?.name ?? ''}
      footer={
        product && (
          <>
            <button type="button" className="btn-ghost mr-auto" onClick={onToggleActive}>
              {product.is_active ? 'Nonaktifkan' : 'Aktifkan'}
            </button>
            <button type="button" className="btn-secondary" onClick={onEdit}>
              Ubah
            </button>
            {product.track_stock && (
              <button type="button" className="btn-primary" onClick={onStock}>
                Ubah stok
              </button>
            )}
          </>
        )
      }
    >
      {product && (
        <>
          <dl className="grid grid-cols-2 gap-4 text-body-sm">
            <div>
              <dt className="text-slate">Harga jual</dt>
              <dd className="num font-semibold">{rupiah(product.sell_price)}</dd>
            </div>
            <div>
              <dt className="text-slate">Stok</dt>
              <dd className="num font-semibold">
                {product.track_stock
                  ? `${formatQty(product.stock_qty)} ${product.unit}`
                  : 'Tidak dilacak'}
              </dd>
            </div>
            <div>
              <dt className="text-slate">Harga modal</dt>
              <dd className="num font-semibold">{rupiah(product.cost_price)}</dd>
            </div>
            <div>
              <dt className="text-slate">Margin</dt>
              <dd className="num font-semibold">{rupiah(product.margin)}</dd>
            </div>
          </dl>
          {product.track_stock && (
            <section className="mt-6">
              <h3 className="mb-2 text-body-sm font-semibold">Riwayat stok</h3>
              <Loaded state={movements} skeleton={<ListSkeleton rows={2} />}>
                {(data) =>
                  data.items.length === 0 ? (
                    <EmptyState compact title="Belum ada perubahan stok" />
                  ) : (
                    <ul className="divide-y divide-hairline-soft text-body-sm">
                      {data.items.map((movement) => (
                        <li key={movement.id} className="flex justify-between gap-3 py-2">
                          <div className="min-w-0">
                            <p>{MOVEMENTS[movement.movement_type]}</p>
                            <p className="text-caption text-slate">
                              {formatDateTime(movement.created_at)}
                              {movement.reason ? ` · ${movement.reason}` : ''}
                            </p>
                          </div>
                          <span className="num shrink-0 font-medium">
                            {movement.qty > 0 ? '+' : ''}
                            {formatQty(movement.qty)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )
                }
              </Loaded>
            </section>
          )}
        </>
      )}
    </Drawer>
  );
}

export default function Products() {
  const toast = useToast();
  const [params] = useSearchParams();
  const [search, setSearch] = useState('');
  const [lowOnly, setLowOnly] = useState(params.get('stok') === 'menipis');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [page, setPage] = useState(1);
  const q = useDebounced(search);
  const state = useFetch(
    `/products${query({ q, page, low_stock: lowOnly ? 'true' : '', include_inactive: includeInactive ? 'true' : '' })}`,
  );
  const [detailId, setDetailId] = useState(null);
  const [drawer, setDrawer] = useState({ open: false, product: null });
  const [stockFor, setStockFor] = useState(null);
  const [deactivate, setDeactivate] = useState(null);
  const detail = state.data?.items.find((product) => product.id === detailId) ?? null;

  async function setActive(product, is_active) {
    await api.put(`/products/${product.id}`, { is_active });
    toast.show(is_active ? 'Produk diaktifkan.' : 'Produk dinonaktifkan.');
    notifyChanged();
  }

  return (
    <Page>
      <PageHeader
        title="Produk"
        description="Harga dan stok barang yang Anda jual."
        actions={
          <button
            type="button"
            className="btn-primary"
            onClick={() => setDrawer({ open: true, product: null })}
          >
            Tambah produk
          </button>
        }
      />
      <div className="space-y-3">
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          placeholder="Cari nama barang"
          label="Cari produk"
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="pill-tab"
            aria-pressed={lowOnly}
            onClick={() => {
              setLowOnly(!lowOnly);
              setPage(1);
            }}
          >
            Stok menipis
          </button>
          <button
            type="button"
            className="pill-tab"
            aria-pressed={includeInactive}
            onClick={() => setIncludeInactive(!includeInactive)}
          >
            Tampilkan nonaktif
          </button>
        </div>
      </div>
      <div className="mt-4">
        <Loaded state={state}>
          {(data) =>
            data.items.length === 0 ? (
              <EmptyState
                title={q || lowOnly ? 'Tidak ada produk yang cocok' : 'Belum ada produk'}
                body={
                  q || lowOnly
                    ? 'Coba ubah saringan.'
                    : 'Tambahkan produk agar penjualan cukup dengan beberapa ketukan.'
                }
                action={
                  !q && !lowOnly ? (
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => setDrawer({ open: true, product: null })}
                    >
                      Tambah produk pertama
                    </button>
                  ) : undefined
                }
              />
            ) : (
              <>
                <RowList>
                  {data.items.map((product) => (
                    <Row
                      key={product.id}
                      title={product.name}
                      subtitle={[
                        product.sku,
                        rupiah(product.sell_price),
                        `margin ${rupiah(product.margin)}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                      badge={
                        <>
                          {product.low_stock && <Badge tone="orange">Stok menipis</Badge>}
                          {!product.is_active && <Badge>Nonaktif</Badge>}
                        </>
                      }
                      right={
                        product.track_stock
                          ? `${formatQty(product.stock_qty)} ${product.unit}`
                          : 'Tanpa stok'
                      }
                      onClick={() => setDetailId(product.id)}
                    />
                  ))}
                </RowList>
                <Pagination
                  page={data.page}
                  limit={data.limit}
                  total={data.total}
                  onPage={setPage}
                />
              </>
            )
          }
        </Loaded>
      </div>
      <ProductDetail
        product={detail}
        onClose={() => setDetailId(null)}
        onEdit={() => {
          setDrawer({ open: true, product: detail });
          setDetailId(null);
        }}
        onStock={() => {
          setStockFor(detail);
          setDetailId(null);
        }}
        onToggleActive={() => {
          if (detail.is_active) setDeactivate(detail);
          else setActive(detail, true);
          setDetailId(null);
        }}
      />
      <ProductDrawer
        open={drawer.open}
        product={drawer.product}
        onClose={() => setDrawer({ open: false, product: null })}
      />
      <StockDrawer product={stockFor} onClose={() => setStockFor(null)} />
      <ConfirmDialog
        open={Boolean(deactivate)}
        onClose={() => setDeactivate(null)}
        title="Nonaktifkan produk ini?"
        body={
          deactivate
            ? `${deactivate.name} hilang dari pilihan penjualan. Riwayatnya tetap ada.`
            : ''
        }
        confirmLabel="Nonaktifkan"
        onConfirm={() => setActive(deactivate, false)}
      />
    </Page>
  );
}

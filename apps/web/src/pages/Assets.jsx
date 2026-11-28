import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, query } from '../lib/api.js';
import { notifyChanged, useFetch, useSubmit } from '../lib/hooks.js';
import { formatDate, rupiah, todayJakarta } from '../lib/format.js';
import { Page } from '../components/Layout.jsx';
import { ConfirmDialog, Drawer } from '../components/Drawer.jsx';
import { useToast } from '../components/Toast.jsx';
import {
  CategoryOptions,
  EmptyState,
  FormError,
  Loaded,
  MoneyField,
  PageHeader,
  Row,
  RowList,
  SelectField,
  TextField,
  useAccounts,
  useCategories,
} from '../components/ui.jsx';

const KINDS = {
  fixed: { label: 'Harta tetap', group: 'Peralatan' },
  prepaid: { label: 'Biaya dibayar dimuka', group: 'Sewa Dibayar di Muka' },
};

/** Same rule as the server: cost / life, rounded half up to whole rupiah. */
const monthlyShare = (cost, months) => (cost > 0 && months > 0 ? Math.round(cost / months) : 0);

const lifeLabel = (months) => (months % 12 === 0 ? `${months / 12} tahun` : `${months} bulan`);

/* ---------- Opening position ---------- */

function OpeningDrawer({ open, onClose, business }) {
  const [form, setForm] = useState({ opening_date: '', opening_capital: null, capital_name: '' });
  useEffect(() => {
    if (open) {
      setForm({
        opening_date: business.opening_date ?? '',
        opening_capital: business.opening_capital,
        capital_name: business.capital_name ?? '',
      });
    }
  }, [open, business]);
  const action = useCallback(
    () =>
      api.put('/business/opening', {
        opening_date: form.opening_date || null,
        opening_capital: form.opening_capital,
        capital_name: form.capital_name,
      }),
    [form],
  );
  const { submit, pending, fieldErrors, formError } = useSubmit(action, {
    success: 'Saldo awal disimpan.',
    onDone: () => {
      notifyChanged();
      onClose();
    },
  });
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Ubah saldo awal"
      footer={
        <button type="button" className="btn-primary" disabled={pending} onClick={() => submit()}>
          {pending ? 'Menyimpan...' : 'Simpan saldo awal'}
        </button>
      }
    >
      <div className="space-y-4">
        <TextField
          label="Tanggal saldo awal"
          type="date"
          hint="Hari pertama pembukuan di usahaku. Harus sebelum transaksi pertama."
          value={form.opening_date}
          onChange={(e) => setForm({ ...form, opening_date: e.target.value })}
          error={fieldErrors.opening_date}
        />
        <MoneyField
          label="Modal pemilik pada tanggal itu"
          hint="Kosongkan bila semua saldo awal dihitung sebagai Modal Awal."
          value={form.opening_capital}
          onChange={(opening_capital) => setForm({ ...form, opening_capital })}
          error={fieldErrors.opening_capital}
        />
        <TextField
          label="Nama akun modal di neraca"
          placeholder="Modal Pemilik"
          maxLength={60}
          value={form.capital_name}
          onChange={(e) => setForm({ ...form, capital_name: e.target.value })}
          error={fieldErrors.capital_name}
        />
        <FormError message={formError} />
      </div>
    </Drawer>
  );
}

function OpeningCard({ business, onEdit }) {
  const hasCapital = business.opening_capital !== null;
  return (
    <section aria-labelledby="opening-title" className="card mb-6 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="opening-title" className="text-h5">
            Saldo awal
          </h2>
          <p className="mt-1 text-body-sm text-slate">
            {business.opening_date
              ? `Pembukuan dimulai ${formatDate(business.opening_date)}.`
              : 'Belum diatur. Isi bila pembukuan dipindah dari aplikasi lain, misalnya Zahir.'}
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={onEdit}>
          {business.opening_date ? 'Ubah' : 'Atur saldo awal'}
        </button>
      </div>
      {hasCapital && (
        <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <div>
            <dt className="text-caption text-slate">{business.capital_name || 'Modal Pemilik'}</dt>
            <dd className="num text-h5">{rupiah(business.opening_capital)}</dd>
          </div>
          <div>
            <dt className="text-caption text-slate">Laba Ditahan awal</dt>
            <dd className="text-body-sm text-charcoal">
              Dihitung otomatis: harta awal dikurangi modal.
            </dd>
          </div>
        </dl>
      )}
      <p className="mt-4 text-caption text-slate">
        Saldo awal kas dan bank diatur di{' '}
        <Link to="/akun" className="font-medium text-ink underline underline-offset-2">
          Akun Kas
        </Link>
        .
      </p>
    </section>
  );
}

/* ---------- Asset register ---------- */

const EMPTY_ASSET = {
  kind: 'fixed',
  group_name: KINDS.fixed.group,
  name: '',
  acquired_on: '',
  cost: null,
  life: '',
  lifeUnit: 'years',
  expense_category_id: '',
  paid: false,
  paid_from_account_id: '',
  purchase_category_id: '',
};

/** The form's shape for an existing asset; whole years show in years, as the workbook does. */
function toForm(asset) {
  const inYears = asset.useful_life_months % 12 === 0;
  return {
    kind: asset.kind,
    group_name: asset.group_name,
    name: asset.name,
    acquired_on: asset.acquired_on,
    cost: asset.cost,
    life: String(inYears ? asset.useful_life_months / 12 : asset.useful_life_months),
    lifeUnit: inYears ? 'years' : 'months',
    expense_category_id: asset.expense_category_id,
    paid: Boolean(asset.purchase_transaction_id),
    paid_from_account_id: asset.paid_from_account_id ?? '',
    purchase_category_id: asset.purchase_category_id ?? '',
  };
}

/*
 * Same rule as the server: with an opening date, an asset acquired before it belongs to the
 * opening position and one acquired from it on is a purchase paid from an account. Without
 * an opening date the owner says which it is.
 */
const isPurchase = (form, openingDate) =>
  openingDate ? Boolean(form.acquired_on) && form.acquired_on >= openingDate : form.paid;

/** Payment of a purchase: the account that paid and the category it shows under in cash flow. */
function PurchaseFields({ form, setForm, asset, fieldErrors }) {
  const accounts = useAccounts();
  const categories = useCategories();
  const accountItems = useMemo(
    () =>
      (accounts.data?.items ?? []).filter(
        (account) => account.id === asset?.paid_from_account_id || !account.is_archived,
      ),
    [accounts.data, asset],
  );
  const purchaseCategories = useMemo(
    () =>
      categories.data && {
        items: categories.data.items.filter(
          (category) =>
            category.id === asset?.purchase_category_id ||
            (category.type === 'expense' &&
              !category.is_archived &&
              category.pl_group !== 'inventory'),
        ),
      },
    [categories.data, asset],
  );
  // Start from the first account and the equipment purchase category, as most purchases are.
  useEffect(() => {
    const updates = {};
    if (!form.paid_from_account_id && accountItems[0]) {
      updates.paid_from_account_id = accountItems[0].id;
    }
    if (!form.purchase_category_id && purchaseCategories) {
      const investing = purchaseCategories.items.filter(
        (category) => category.cash_activity === 'investing',
      );
      const preferred =
        investing.find((category) => /peralatan/i.test(category.name)) ?? investing[0];
      if (preferred) updates.purchase_category_id = preferred.id;
    }
    if (Object.keys(updates).length > 0) setForm((current) => ({ ...current, ...updates }));
  }, [
    accountItems,
    purchaseCategories,
    form.paid_from_account_id,
    form.purchase_category_id,
    setForm,
  ]);

  return (
    <>
      <SelectField
        label="Dibayar dari akun"
        hint="Harga perolehan dicatat sebagai pengeluaran dari akun ini pada tanggal perolehan."
        value={form.paid_from_account_id}
        onChange={(e) => setForm({ ...form, paid_from_account_id: e.target.value })}
        error={fieldErrors.paid_from_account_id}
      >
        <option value="">Pilih akun</option>
        {accountItems.map((account) => (
          <option key={account.id} value={account.id}>
            {account.name}
          </option>
        ))}
      </SelectField>
      <SelectField
        label="Kategori pembelian"
        hint="Muncul di arus kas. Laba rugi hanya mencatat penyusutannya, bukan harga belinya."
        value={form.purchase_category_id}
        onChange={(e) => setForm({ ...form, purchase_category_id: e.target.value })}
        error={fieldErrors.purchase_category_id}
      >
        <CategoryOptions categories={purchaseCategories} type="expense" />
      </SelectField>
    </>
  );
}

/** Adds an asset, or edits `asset` when one is given. */
function AssetFormDrawer({ open, onClose, asset, groups, openingDate }) {
  const categories = useCategories();
  const [form, setForm] = useState(EMPTY_ASSET);
  useEffect(() => {
    if (open) setForm(asset ? toForm(asset) : EMPTY_ASSET);
  }, [open, asset]);
  const months = Number(form.life) * (form.lifeUnit === 'years' ? 12 : 1);
  // Amortization lands in profit and loss, so only operating expense categories qualify.
  // An edited asset keeps its current category in the list even if it was archived since.
  const expenseCategories = useMemo(
    () =>
      categories.data && {
        items: categories.data.items.filter(
          (category) =>
            category.id === asset?.expense_category_id ||
            (category.type === 'expense' &&
              !category.is_archived &&
              category.pl_group !== 'inventory' &&
              category.cash_activity === 'operating'),
        ),
      },
    [categories.data, asset],
  );
  const purchase = isPurchase(form, openingDate);
  const action = useCallback(() => {
    const paid = isPurchase(form, openingDate);
    const payload = {
      kind: form.kind,
      group_name: form.group_name,
      name: form.name,
      acquired_on: form.acquired_on,
      cost: form.cost,
      useful_life_months: months > 0 ? months : null,
      expense_category_id: form.expense_category_id || null,
      paid_from_account_id: paid ? form.paid_from_account_id || null : null,
      purchase_category_id: paid ? form.purchase_category_id || null : null,
    };
    return asset ? api.put(`/assets/${asset.id}`, payload) : api.post('/assets', payload);
  }, [form, months, asset, openingDate]);
  const { submit, pending, fieldErrors, formError } = useSubmit(action, {
    success: asset ? 'Harta disimpan.' : 'Harta ditambahkan.',
    onDone: () => {
      notifyChanged();
      onClose();
    },
  });
  const share = monthlyShare(form.cost, months);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={asset ? 'Ubah harta' : 'Tambah harta'}
      footer={
        <button type="button" className="btn-primary" disabled={pending} onClick={() => submit()}>
          {pending ? 'Menyimpan...' : 'Simpan harta'}
        </button>
      }
    >
      <div className="space-y-4">
        <SelectField
          label="Jenis"
          value={form.kind}
          onChange={(e) => {
            const kind = e.target.value;
            const typedGroup = form.group_name && form.group_name !== KINDS[form.kind].group;
            setForm({
              ...form,
              kind,
              group_name: typedGroup ? form.group_name : KINDS[kind].group,
            });
          }}
          error={fieldErrors.kind}
        >
          {Object.entries(KINDS).map(([value, kind]) => (
            <option key={value} value={value}>
              {kind.label}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Baris di neraca"
          hint="Harta dengan baris yang sama dijumlahkan di neraca."
          list="asset-groups"
          maxLength={60}
          value={form.group_name}
          onChange={(e) => setForm({ ...form, group_name: e.target.value })}
          error={fieldErrors.group_name}
        />
        <datalist id="asset-groups">
          {groups.map((group) => (
            <option key={group} value={group} />
          ))}
        </datalist>
        <TextField
          label="Nama harta"
          placeholder={form.kind === 'fixed' ? 'Kursi Barber (2 unit)' : 'Sewa tempat 1 tahun'}
          maxLength={120}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          error={fieldErrors.name}
        />
        <TextField
          label="Tanggal perolehan"
          type="date"
          hint={
            openingDate
              ? `Sebelum ${formatDate(openingDate)} termasuk saldo awal. Sejak tanggal itu dicatat sebagai pembelian. Penyusutan dihitung mulai bulan perolehan.`
              : 'Penyusutan dihitung mulai bulan ini.'
          }
          value={form.acquired_on}
          onChange={(e) => setForm({ ...form, acquired_on: e.target.value })}
          error={fieldErrors.acquired_on}
        />
        <MoneyField
          label="Harga perolehan (total)"
          value={form.cost}
          onChange={(cost) => setForm({ ...form, cost })}
          error={fieldErrors.cost}
        />
        {!openingDate && (
          <label className="flex items-start gap-3 text-body-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={form.paid}
              onChange={(e) => setForm({ ...form, paid: e.target.checked })}
            />
            <span>Dibeli dengan uang usaha (dicatat sebagai pengeluaran)</span>
          </label>
        )}
        {purchase ? (
          <PurchaseFields form={form} setForm={setForm} asset={asset} fieldErrors={fieldErrors} />
        ) : (
          fieldErrors.paid_from_account_id && (
            <p className="text-caption text-danger-deep">{fieldErrors.paid_from_account_id}</p>
          )
        )}
        <div className="grid grid-cols-[1fr_auto] items-end gap-2">
          <TextField
            label="Umur ekonomis"
            inputMode="numeric"
            value={form.life}
            onChange={(e) => setForm({ ...form, life: e.target.value.replace(/\D/g, '') })}
            error={fieldErrors.useful_life_months}
          />
          <select
            aria-label="Satuan umur ekonomis"
            className={`field-input w-auto ${fieldErrors.useful_life_months ? 'mb-6' : ''}`}
            value={form.lifeUnit}
            onChange={(e) => setForm({ ...form, lifeUnit: e.target.value })}
          >
            <option value="years">tahun</option>
            <option value="months">bulan</option>
          </select>
        </div>
        <SelectField
          label={form.kind === 'fixed' ? 'Kategori beban penyusutan' : 'Kategori beban'}
          value={form.expense_category_id}
          onChange={(e) => setForm({ ...form, expense_category_id: e.target.value })}
          error={fieldErrors.expense_category_id}
        >
          <CategoryOptions categories={expenseCategories} type="expense" />
        </SelectField>
        <div className="rounded-md bg-tint-lavender px-4 py-3" aria-live="polite">
          <p className="text-caption text-charcoal">
            {form.kind === 'fixed' ? 'Penyusutan per bulan' : 'Amortisasi per bulan'}
          </p>
          <p className="num text-h5">{share ? rupiah(share) : '–'}</p>
          <p className="mt-1 text-caption text-slate">
            Harga perolehan dibagi umur ekonomis, dicatat setiap akhir bulan. Bulan terakhir
            mengambil sisa pembulatan.
          </p>
        </div>
        <FormError message={formError} />
      </div>
    </Drawer>
  );
}

function AssetDrawer({ asset, onClose, onEdit, onDelete }) {
  const facts = asset
    ? [
        ['Jenis', KINDS[asset.kind].label],
        ['Baris di neraca', asset.group_name],
        ['Tanggal perolehan', formatDate(asset.acquired_on)],
        ['Harga perolehan', rupiah(asset.cost)],
        ['Umur ekonomis', `${lifeLabel(asset.useful_life_months)}`],
        [
          asset.kind === 'fixed' ? 'Penyusutan per bulan' : 'Amortisasi per bulan',
          rupiah(asset.monthly_share),
        ],
        ['Kategori beban', asset.expense_category_name],
        ...(asset.purchase_transaction_id
          ? [
              ['Dibayar dari', asset.paid_from_account_name],
              ['Kategori pembelian', asset.purchase_category_name],
            ]
          : [['Asal', 'Saldo awal']]),
        ['Akumulasi', rupiah(asset.accumulated)],
        ['Nilai buku', rupiah(asset.book_value)],
      ]
    : [];
  return (
    <Drawer
      open={Boolean(asset)}
      onClose={onClose}
      title={asset?.name ?? ''}
      footer={
        <>
          <button type="button" className="btn-ghost mr-auto text-danger-deep" onClick={onDelete}>
            Hapus harta
          </button>
          <button type="button" className="btn-primary" onClick={onEdit}>
            Ubah harta
          </button>
        </>
      }
    >
      <dl className="divide-y divide-hairline-soft">
        {facts.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 py-3">
            <dt className="text-body-sm text-slate">{label}</dt>
            <dd className="num text-right text-body-sm font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </Drawer>
  );
}

function groupAssets(items) {
  const groups = new Map();
  for (const item of items) {
    const key = `${item.kind}:${item.group_name}`;
    if (!groups.has(key))
      groups.set(key, { key, kind: item.kind, name: item.group_name, items: [] });
    groups.get(key).items.push(item);
  }
  const sum = (rows, field) => rows.reduce((total, row) => total + row[field], 0);
  return [...groups.values()].map((group) => ({
    ...group,
    cost: sum(group.items, 'cost'),
    accumulated: sum(group.items, 'accumulated'),
    book_value: sum(group.items, 'book_value'),
    month_amortization: sum(group.items, 'month_amortization'),
  }));
}

function AssetGroup({ group, onOpen }) {
  const isFixed = group.kind === 'fixed';
  return (
    <section aria-label={group.name} className="mb-6">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-1">
        <h3 className="text-body font-semibold">{group.name}</h3>
        <p className="num text-body-sm text-slate">
          Nilai buku <span className="font-semibold text-ink">{rupiah(group.book_value)}</span>
        </p>
      </div>
      <RowList>
        {group.items.map((asset) => (
          <Row
            key={asset.id}
            title={asset.name}
            subtitle={`${formatDate(asset.acquired_on)} · ${lifeLabel(asset.useful_life_months)} · ${rupiah(asset.monthly_share)}/bulan`}
            right={rupiah(asset.book_value)}
            rightSub={`dari ${rupiah(asset.cost)}`}
            onClick={() => onOpen(asset)}
          />
        ))}
      </RowList>
      <dl className="mt-2 space-y-1 px-1 text-caption text-slate sm:grid sm:grid-cols-3 sm:gap-2 sm:space-y-0">
        <div className="flex items-baseline justify-between gap-3 sm:block">
          <dt>Harga perolehan</dt>
          <dd className="num text-body-sm text-ink">{rupiah(group.cost)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 sm:block">
          <dt>{isFixed ? 'Akumulasi penyusutan' : 'Sudah diamortisasi'}</dt>
          <dd className="num text-body-sm text-ink">{rupiah(group.accumulated)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 sm:block">
          <dt>{isFixed ? 'Penyusutan bulan ini' : 'Amortisasi bulan ini'}</dt>
          <dd className="num text-body-sm text-ink">{rupiah(group.month_amortization)}</dd>
        </div>
      </dl>
    </section>
  );
}

export default function Assets() {
  const toast = useToast();
  const [asOf, setAsOf] = useState(todayJakarta());
  const business = useFetch('/business');
  const assets = useFetch(`/assets${query({ as_of: asOf })}`);
  const [editingOpening, setEditingOpening] = useState(false);
  // { asset: null } adds, { asset } edits, null is closed.
  const [formFor, setFormFor] = useState(null);
  const [selected, setSelected] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const groups = useMemo(() => groupAssets(assets.data?.items ?? []), [assets.data]);
  const groupNames = [...new Set(groups.map((group) => group.name))];

  return (
    <Page narrow>
      <PageHeader
        title="Saldo Awal dan Harta"
        description="Harta tetap dan biaya dibayar dimuka. Penyusutan dan amortisasinya masuk laporan secara otomatis."
        actions={
          <button type="button" className="btn-primary" onClick={() => setFormFor({ asset: null })}>
            Tambah harta
          </button>
        }
      />
      <Loaded state={business}>
        {(data) => <OpeningCard business={data} onEdit={() => setEditingOpening(true)} />}
      </Loaded>

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-h5">Daftar harta</h2>
        <div className="w-48">
          <TextField
            label="Nilai per tanggal"
            type="date"
            value={asOf}
            onChange={(e) => e.target.value && setAsOf(e.target.value)}
          />
        </div>
      </div>
      <Loaded state={assets}>
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState
              title="Belum ada harta"
              body="Tambah peralatan atau biaya yang dibayar dimuka, misalnya sewa setahun."
            />
          ) : (
            groups.map((group) => <AssetGroup key={group.key} group={group} onOpen={setSelected} />)
          )
        }
      </Loaded>

      {business.data && (
        <OpeningDrawer
          open={editingOpening}
          onClose={() => setEditingOpening(false)}
          business={business.data}
        />
      )}
      <AssetFormDrawer
        open={Boolean(formFor)}
        asset={formFor?.asset ?? null}
        onClose={() => setFormFor(null)}
        groups={groupNames}
        openingDate={business.data?.opening_date}
      />
      <AssetDrawer
        asset={selected}
        onClose={() => setSelected(null)}
        onEdit={() => {
          setFormFor({ asset: selected });
          setSelected(null);
        }}
        onDelete={() => {
          setConfirming(selected);
          setSelected(null);
        }}
      />
      <ConfirmDialog
        open={Boolean(confirming)}
        onClose={() => setConfirming(null)}
        title="Hapus harta ini?"
        body={`${confirming?.name ?? ''} hilang dari neraca, dan penyusutannya hilang dari laba rugi semua periode.${
          confirming?.purchase_transaction_id
            ? ` Pengeluaran pembeliannya juga dihapus, jadi saldo ${confirming.paid_from_account_name} kembali.`
            : ''
        }`}
        confirmLabel="Hapus harta"
        onConfirm={async () => {
          await api.del(`/assets/${confirming.id}`);
          toast.show('Harta dihapus.');
          notifyChanged();
        }}
      />
    </Page>
  );
}

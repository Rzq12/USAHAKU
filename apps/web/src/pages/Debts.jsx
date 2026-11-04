import { useCallback, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, query } from '../lib/api.js';
import { usePermissions } from '../lib/auth.jsx';
import { notifyChanged, useFetch, useSubmit } from '../lib/hooks.js';
import { formatDate, rupiah, todayJakarta } from '../lib/format.js';
import { Page } from '../components/Layout.jsx';
import { Drawer } from '../components/Drawer.jsx';
import {
  CategoryOptions,
  EmptyState,
  FormError,
  Loaded,
  MoneyField,
  PageHeader,
  Pagination,
  PillTabs,
  Row,
  RowList,
  SelectField,
  TextField,
  useCategories,
} from '../components/ui.jsx';
import { DebtBadge } from './debtParts.jsx';

const TYPE_TABS = [
  { value: 'receivable', label: 'Piutang' },
  { value: 'payable', label: 'Hutang' },
];
const STATUS_FILTERS = [
  { value: 'unpaid', label: 'Belum lunas' },
  { value: 'overdue', label: 'Terlambat' },
  { value: 'paid', label: 'Lunas' },
  { value: '', label: 'Semua' },
];

function NewDebtDrawer({ open, onClose, type }) {
  const contacts = useFetch(open ? '/contacts?limit=100' : null);
  const categories = useCategories();
  const [form, setForm] = useState({
    contact_id: '',
    amount: null,
    issue_date: todayJakarta(),
    due_date: '',
    category_id: '',
    note: '',
  });
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const action = useCallback(
    () => api.post('/debts', { ...form, type, category_id: form.category_id || null }),
    [form, type],
  );
  const { submit, pending, fieldErrors, formError } = useSubmit(action, {
    success: 'Tagihan disimpan.',
    onDone: () => {
      notifyChanged();
      onClose();
    },
  });
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={type === 'receivable' ? 'Tambah piutang' : 'Tambah tagihan pemasok'}
      footer={
        <button type="button" className="btn-primary" disabled={pending} onClick={() => submit()}>
          {pending ? 'Menyimpan...' : 'Simpan tagihan'}
        </button>
      }
    >
      <div className="space-y-4">
        <SelectField
          label="Kontak"
          value={form.contact_id}
          onChange={set('contact_id')}
          error={fieldErrors.contact_id}
        >
          <option value="">Pilih kontak</option>
          {contacts.data?.items.map((contact) => (
            <option key={contact.id} value={contact.id}>
              {contact.name}
            </option>
          ))}
        </SelectField>
        <MoneyField
          label="Nominal"
          value={form.amount}
          onChange={(amount) => setForm({ ...form, amount })}
          error={fieldErrors.amount}
        />
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Tanggal tagihan"
            type="date"
            value={form.issue_date}
            onChange={set('issue_date')}
            error={fieldErrors.issue_date}
          />
          <TextField
            label="Jatuh tempo"
            type="date"
            value={form.due_date}
            onChange={set('due_date')}
            error={fieldErrors.due_date}
          />
        </div>
        {type === 'payable' && (
          <SelectField
            label="Kategori pengeluaran"
            value={form.category_id}
            onChange={set('category_id')}
            error={fieldErrors.category_id}
            hint="Dihitung sebagai beban pada tanggal tagihan."
          >
            <CategoryOptions categories={categories.data} type="expense" />
          </SelectField>
        )}
        <TextField
          label="Catatan"
          value={form.note}
          maxLength={500}
          onChange={set('note')}
          error={fieldErrors.note}
        />
        <FormError message={formError} />
      </div>
    </Drawer>
  );
}

export default function Debts() {
  const { isOwner, isStaff } = usePermissions();
  const [params] = useSearchParams();
  const [type, setType] = useState(
    params.get('tipe') === 'payable' && !isStaff ? 'payable' : 'receivable',
  );
  const [status, setStatus] = useState(params.get('status') ?? 'unpaid');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const state = useFetch(`/debts${query({ type, status, page })}`);
  const noun = type === 'receivable' ? 'piutang' : 'hutang';

  return (
    <Page>
      <PageHeader
        title={isStaff ? 'Piutang' : 'Hutang dan Piutang'}
        description={
          type === 'receivable'
            ? 'Uang yang masih harus dibayar pelanggan.'
            : 'Tagihan pemasok yang belum Anda bayar.'
        }
        actions={
          isOwner && (
            <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
              Tambah {noun}
            </button>
          )
        }
      />
      <div className="space-y-3">
        {!isStaff && (
          <PillTabs
            label="Jenis tagihan"
            options={TYPE_TABS}
            value={type}
            onChange={(value) => {
              setType(value);
              setPage(1);
            }}
          />
        )}
        <PillTabs
          label="Status"
          options={STATUS_FILTERS}
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        />
      </div>
      <div className="mt-4">
        <Loaded state={state}>
          {(data) =>
            data.items.length === 0 ? (
              <EmptyState
                title={
                  status === 'overdue'
                    ? `Tidak ada ${noun} yang terlambat`
                    : `Tidak ada ${noun} di sini`
                }
                body={
                  type === 'receivable'
                    ? 'Penjualan kredit otomatis tercatat sebagai piutang dan muncul di daftar ini.'
                    : 'Catat tagihan pemasok agar jatuh temponya terlihat.'
                }
              />
            ) : (
              <>
                {data.remaining > 0 && (
                  <p className="mb-4 rounded-lg bg-tint-yellow px-4 py-3 text-body-sm text-charcoal">
                    Sisa {noun} pada daftar ini:{' '}
                    <span className="num font-semibold">{rupiah(data.remaining)}</span>
                  </p>
                )}
                <RowList>
                  {data.items.map((debt) => (
                    <Row
                      key={debt.id}
                      LinkComponent={Link}
                      href={`/tagihan/${debt.id}`}
                      title={debt.contact_name}
                      subtitle={`Jatuh tempo ${formatDate(debt.due_date)}${debt.days_overdue > 0 ? ` · Terlambat ${debt.days_overdue} hari` : ''}`}
                      badge={<DebtBadge debt={debt} />}
                      right={rupiah(debt.remaining)}
                      rightSub={debt.paid_amount > 0 ? `dari ${rupiah(debt.amount)}` : undefined}
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
      {isOwner && <NewDebtDrawer open={adding} type={type} onClose={() => setAdding(false)} />}
    </Page>
  );
}

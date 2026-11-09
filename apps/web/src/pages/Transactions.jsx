import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, query } from '../lib/api.js';
import { notifyChanged, useDebounced, useFetch } from '../lib/hooks.js';
import { formatDate, rupiah, SOURCE_TYPES, TRANSACTION_TYPES } from '../lib/format.js';
import { Page } from '../components/Layout.jsx';
import { ConfirmDialog, Drawer } from '../components/Drawer.jsx';
import { TransactionDrawer } from '../components/TransactionDrawer.jsx';
import { useToast } from '../components/Toast.jsx';
import {
  AccountOptions,
  Badge,
  CategoryOptions,
  EmptyState,
  Loaded,
  PageHeader,
  Pagination,
  PillTabs,
  Row,
  RowList,
  SearchInput,
  SelectField,
  TextField,
  useAccounts,
  useCategories,
} from '../components/ui.jsx';

const TYPE_TONE = { income: 'green', expense: 'orange', transfer: 'sky' };
const TYPE_FILTERS = [
  { value: '', label: 'Semua' },
  ...Object.entries(TRANSACTION_TYPES).map(([value, label]) => ({ value, label })),
];

function signed(transaction) {
  const sign = { income: '+', expense: '-', transfer: '' }[transaction.type];
  return `${sign}${rupiah(transaction.amount)}`;
}

function DetailDrawer({ transaction, onClose, onEdit, onDelete }) {
  const lines = transaction && [
    ['Tanggal', formatDate(transaction.occurred_on)],
    [
      'Akun',
      transaction.transfer_account_name
        ? `${transaction.account_name} ke ${transaction.transfer_account_name}`
        : transaction.account_name,
    ],
    ['Kategori', transaction.category_name],
    ['Kontak', transaction.contact_name],
    ['Catatan', transaction.note],
    ['Tag', transaction.tags.join(', ')],
    ['Sumber', SOURCE_TYPES[transaction.source_type]],
    ['Dicatat oleh', transaction.created_by_name ?? 'Sistem'],
  ];
  const removable =
    transaction &&
    !['sale', 'receivable_payment', 'payable_payment'].includes(transaction.source_type);
  return (
    <Drawer
      open={Boolean(transaction)}
      onClose={onClose}
      title={transaction ? TRANSACTION_TYPES[transaction.type] : ''}
      footer={
        <>
          {removable && (
            <button type="button" className="btn-ghost mr-auto text-danger-deep" onClick={onDelete}>
              Hapus
            </button>
          )}
          <button type="button" className="btn-primary" onClick={onEdit}>
            Ubah
          </button>
        </>
      }
    >
      {transaction && (
        <>
          <p className="num text-h3">{signed(transaction)}</p>
          {transaction.is_excluded && (
            <p className="mt-1">
              <Badge>Dikecualikan dari laporan</Badge>
            </p>
          )}
          <dl className="mt-4 divide-y divide-hairline-soft">
            {lines
              .filter(([, value]) => value)
              .map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 py-2 text-body-sm">
                  <dt className="shrink-0 text-slate">{label}</dt>
                  <dd className="min-w-0 break-words text-right">{value}</dd>
                </div>
              ))}
          </dl>
          {transaction.attachment_id && (
            <a
              href={`/api/transactions/${transaction.id}/receipt`}
              target="_blank"
              rel="noreferrer"
              className="link-tap mt-1 text-body-sm"
            >
              Lihat foto struk
            </a>
          )}
        </>
      )}
    </Drawer>
  );
}

export default function Transactions() {
  const toast = useToast();
  const accounts = useAccounts();
  const categories = useCategories();
  const [filters, setFilters] = useState({
    type: '',
    from: '',
    to: '',
    account_id: '',
    category_id: '',
    tag: '',
  });
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const [adding, setAdding] = useState(null);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const q = useDebounced(search);

  const state = useFetch(`/transactions${query({ ...filters, q, page })}`);
  const setFilter = (key) => (value) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };
  const hasFilter = q || Object.values(filters).some(Boolean);

  return (
    <Page>
      <PageHeader
        title="Riwayat Transaksi"
        description="Semua uang masuk, keluar, dan pindah antar akun."
        actions={
          <>
            <button type="button" className="btn-secondary" onClick={() => setAdding('income')}>
              Pemasukan lain
            </button>
            <button type="button" className="btn-secondary" onClick={() => setAdding('transfer')}>
              Transfer
            </button>
          </>
        }
      />
      <div className="space-y-3">
        <PillTabs
          label="Jenis"
          options={TYPE_FILTERS}
          value={filters.type}
          onChange={setFilter('type')}
        />
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          placeholder="Cari di catatan"
          label="Cari catatan"
        />
        <details className="rounded-md border border-hairline">
          <summary className="flex min-h-[44px] cursor-pointer items-center px-4 text-body-sm font-medium">
            Saring tanggal, akun, kategori, dan tag
          </summary>
          <div className="grid gap-3 border-t border-hairline p-4 sm:grid-cols-2 lg:grid-cols-5">
            <TextField
              label="Dari tanggal"
              type="date"
              value={filters.from}
              onChange={(e) => setFilter('from')(e.target.value)}
            />
            <TextField
              label="Sampai tanggal"
              type="date"
              value={filters.to}
              onChange={(e) => setFilter('to')(e.target.value)}
            />
            <SelectField
              label="Akun"
              value={filters.account_id}
              onChange={(e) => setFilter('account_id')(e.target.value)}
            >
              <AccountOptions accounts={accounts.data} />
            </SelectField>
            <SelectField
              label="Kategori"
              value={filters.category_id}
              onChange={(e) => setFilter('category_id')(e.target.value)}
            >
              <CategoryOptions categories={categories.data} placeholder="Semua kategori" />
            </SelectField>
            <TextField
              label="Tag"
              value={filters.tag}
              onChange={(e) => setFilter('tag')(e.target.value.toLowerCase())}
            />
          </div>
        </details>
      </div>

      <div className="mt-4">
        <Loaded state={state}>
          {(data) =>
            data.items.length === 0 ? (
              <EmptyState
                title={hasFilter ? 'Tidak ada transaksi pada saringan ini' : 'Belum ada transaksi'}
                body={
                  hasFilter
                    ? 'Coba ubah atau hapus saringan.'
                    : 'Catat pengeluaran pertama, atau penjualan lunas akan masuk otomatis.'
                }
                action={
                  !hasFilter ? (
                    <Link to="/pengeluaran/baru" className="btn-primary">
                      Catat pengeluaran pertama
                    </Link>
                  ) : undefined
                }
              />
            ) : (
              <>
                <dl className="mb-4 flex flex-wrap gap-x-8 gap-y-2 rounded-lg bg-surface px-4 py-3 text-body-sm">
                  <div>
                    <dt className="text-slate">Pemasukan</dt>
                    <dd className="num font-semibold">{rupiah(data.totals.income)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate">Pengeluaran</dt>
                    <dd className="num font-semibold">{rupiah(data.totals.expense)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate">Selisih</dt>
                    <dd className="num font-semibold">{rupiah(data.totals.net)}</dd>
                  </div>
                  <p className="basis-full text-caption text-slate sm:ml-auto sm:basis-auto sm:self-end">
                    Transfer tidak dihitung. {data.total} transaksi.
                  </p>
                </dl>
                <RowList>
                  {data.items.map((transaction) => (
                    <Row
                      key={transaction.id}
                      title={
                        transaction.note ||
                        transaction.category_name ||
                        TRANSACTION_TYPES[transaction.type]
                      }
                      subtitle={`${formatDate(transaction.occurred_on)} · ${transaction.transfer_account_name ? `${transaction.account_name} ke ${transaction.transfer_account_name}` : transaction.account_name}${transaction.note && transaction.category_name ? ` · ${transaction.category_name}` : ''}`}
                      badge={
                        <Badge tone={TYPE_TONE[transaction.type]}>
                          {TRANSACTION_TYPES[transaction.type]}
                        </Badge>
                      }
                      right={signed(transaction)}
                      rightSub={transaction.is_excluded ? 'Dikecualikan' : undefined}
                      onClick={() => setSelected(transaction)}
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

      <DetailDrawer
        transaction={selected}
        onClose={() => setSelected(null)}
        onEdit={() => {
          setEditing(selected);
          setSelected(null);
        }}
        onDelete={() => {
          setDeleting(selected);
          setSelected(null);
        }}
      />
      <TransactionDrawer
        open={Boolean(adding)}
        initialType={adding ?? undefined}
        onClose={() => setAdding(null)}
      />
      <TransactionDrawer
        open={Boolean(editing)}
        transaction={editing}
        onClose={() => setEditing(null)}
      />
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Hapus transaksi ini?"
        body={
          deleting
            ? `${signed(deleting)} pada ${formatDate(deleting.occurred_on)} keluar dari saldo dan laporan.`
            : ''
        }
        confirmLabel="Hapus transaksi"
        onConfirm={async () => {
          await api.del(`/transactions/${deleting.id}`);
          toast.show('Transaksi dihapus.');
          notifyChanged();
        }}
      />
    </Page>
  );
}

import { useState } from 'react';
import { query } from '../lib/api.js';
import { usePermissions } from '../lib/auth.jsx';
import { useFetch } from '../lib/hooks.js';
import { formatDateTime } from '../lib/format.js';
import { Page } from '../components/Layout.jsx';
import {
  Badge,
  EmptyState,
  Loaded,
  PageHeader,
  Pagination,
  SelectField,
  TextField,
} from '../components/ui.jsx';

const ACTIONS = {
  create: { label: 'Membuat', tone: 'green' },
  update: { label: 'Mengubah', tone: 'sky' },
  delete: { label: 'Menghapus', tone: 'red' },
  void: { label: 'Membatalkan', tone: 'orange' },
  login: { label: 'Masuk', tone: 'gray' },
  login_failed: { label: 'Gagal masuk', tone: 'red' },
  role_change: { label: 'Mengubah peran', tone: 'purple' },
  export: { label: 'Mengekspor', tone: 'gray' },
  recurring_failed: { label: 'Berulang gagal', tone: 'red' },
};

const ENTITIES = {
  business: 'Usaha',
  user: 'Pengguna',
  account: 'Akun',
  category: 'Kategori',
  category_rule: 'Aturan kategori',
  transaction: 'Transaksi',
  product: 'Produk',
  stock: 'Stok',
  sale: 'Penjualan',
  contact: 'Kontak',
  debt: 'Hutang atau piutang',
  debt_payment: 'Pembayaran',
  invoice: 'Faktur',
  budget: 'Anggaran',
  recurring_rule: 'Transaksi berulang',
  import: 'Impor',
  data_export: 'Ekspor data',
};

function formatValue(value) {
  if (value === null || value === undefined) return 'kosong';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function Detail({ detail }) {
  if (!detail || Object.keys(detail).length === 0) return null;
  return (
    <dl className="mt-1.5 space-y-0.5 text-caption text-slate">
      {Object.entries(detail).map(([field, value]) => {
        const isChange = value && typeof value === 'object' && 'new' in value;
        return (
          <div key={field} className="break-words">
            <dt className="inline font-medium text-charcoal">{field}: </dt>
            <dd className="inline">
              {isChange
                ? `${'old' in value ? `${formatValue(value.old)} menjadi ` : ''}${formatValue(value.new)}`
                : formatValue(value)}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

export default function Audit() {
  const { isOwner } = usePermissions();
  const [filters, setFilters] = useState({
    user_id: '',
    entity_type: '',
    action: '',
    from: '',
    to: '',
  });
  const [page, setPage] = useState(1);
  const users = useFetch(isOwner ? '/users' : null);
  const state = useFetch(`/audit-logs${query({ ...filters, page })}`);
  const set = (key) => (event) => {
    setFilters({ ...filters, [key]: event.target.value });
    setPage(1);
  };

  return (
    <Page>
      <PageHeader
        title="Log Aktivitas"
        description="Siapa mengubah apa dan kapan. Tidak dapat diubah, disimpan 2 tahun."
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {isOwner && (
          <SelectField label="Pengguna" value={filters.user_id} onChange={set('user_id')}>
            <option value="">Semua pengguna</option>
            {users.data?.items.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </SelectField>
        )}
        <SelectField label="Data" value={filters.entity_type} onChange={set('entity_type')}>
          <option value="">Semua data</option>
          {Object.entries(ENTITIES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectField>
        <SelectField label="Tindakan" value={filters.action} onChange={set('action')}>
          <option value="">Semua tindakan</option>
          {Object.entries(ACTIONS).map(([value, { label }]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectField>
        <TextField label="Dari tanggal" type="date" value={filters.from} onChange={set('from')} />
        <TextField label="Sampai tanggal" type="date" value={filters.to} onChange={set('to')} />
      </div>
      <div className="mt-4">
        <Loaded state={state}>
          {(data) =>
            data.items.length === 0 ? (
              <EmptyState title="Belum ada aktivitas pada filter ini." />
            ) : (
              <>
                <ul className="card divide-y divide-hairline-soft">
                  {data.items.map((entry) => {
                    const action = ACTIONS[entry.action] ?? { label: entry.action, tone: 'gray' };
                    return (
                      <li key={entry.id} className="px-4 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                          <p className="flex flex-wrap items-center gap-2 text-body-sm">
                            <span className="font-medium">{entry.user_name ?? 'Sistem'}</span>
                            <Badge tone={action.tone}>{action.label}</Badge>
                            <span>{ENTITIES[entry.entity_type] ?? entry.entity_type}</span>
                          </p>
                          <time className="num text-caption text-slate">
                            {formatDateTime(entry.created_at)}
                          </time>
                        </div>
                        <Detail detail={entry.detail} />
                      </li>
                    );
                  })}
                </ul>
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
    </Page>
  );
}

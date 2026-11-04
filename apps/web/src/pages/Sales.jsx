import { useState } from 'react';
import { Link } from 'react-router-dom';
import { query } from '../lib/api.js';
import { usePermissions } from '../lib/auth.jsx';
import { useFetch } from '../lib/hooks.js';
import { formatDate, rupiah } from '../lib/format.js';
import { Page } from '../components/Layout.jsx';
import {
  EmptyState,
  Loaded,
  PageHeader,
  Pagination,
  PillTabs,
  Row,
  RowList,
  TextField,
} from '../components/ui.jsx';
import { PaymentBadge } from './saleParts.jsx';

const STATUS_FILTERS = [
  { value: '', label: 'Semua' },
  { value: 'paid', label: 'Lunas' },
  { value: 'open', label: 'Belum dibayar' },
  { value: 'partial', label: 'Sebagian' },
  { value: 'void', label: 'Dibatalkan' },
];

export default function Sales() {
  const { canRecord, isStaff } = usePermissions();
  const [filters, setFilters] = useState({ payment_status: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const state = useFetch(`/sales${query({ ...filters, page })}`);
  const set = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };
  const hasFilter = Object.values(filters).some(Boolean);

  return (
    <Page>
      <PageHeader
        title="Penjualan"
        description={
          isStaff ? 'Penjualan yang Anda catat.' : 'Semua penjualan, lunas maupun kredit.'
        }
        actions={
          canRecord && (
            <Link to="/penjualan/baru" className="btn-primary">
              Catat penjualan
            </Link>
          )
        }
      />
      <div className="space-y-3">
        <PillTabs
          label="Status pembayaran"
          options={STATUS_FILTERS}
          value={filters.payment_status}
          onChange={(value) => set('payment_status', value)}
        />
        <div className="grid grid-cols-2 gap-3 sm:max-w-md">
          <TextField
            label="Dari tanggal"
            type="date"
            value={filters.from}
            onChange={(e) => set('from', e.target.value)}
          />
          <TextField
            label="Sampai tanggal"
            type="date"
            value={filters.to}
            onChange={(e) => set('to', e.target.value)}
          />
        </div>
      </div>
      <div className="mt-4">
        <Loaded state={state}>
          {(data) =>
            data.items.length === 0 ? (
              <EmptyState
                title={hasFilter ? 'Tidak ada penjualan pada saringan ini' : 'Belum ada penjualan'}
                body={
                  hasFilter
                    ? 'Coba ubah saringan.'
                    : 'Penjualan pertama Anda hanya perlu beberapa ketukan.'
                }
                action={
                  !hasFilter && canRecord ? (
                    <Link to="/penjualan/baru" className="btn-primary">
                      Catat penjualan pertama
                    </Link>
                  ) : undefined
                }
              />
            ) : (
              <>
                <RowList>
                  {data.items.map((sale) => (
                    <Row
                      key={sale.id}
                      LinkComponent={Link}
                      href={`/penjualan/${sale.id}`}
                      title={sale.contact_name ?? 'Pelanggan umum'}
                      subtitle={`${formatDate(sale.sale_date)}${sale.invoice_number ? ` · ${sale.invoice_number}` : ''}`}
                      badge={<PaymentBadge status={sale.payment_status} />}
                      right={rupiah(sale.total)}
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
    </Page>
  );
}

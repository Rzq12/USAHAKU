import { useState } from 'react';
import { Link } from 'react-router-dom';
import { query } from '../lib/api.js';
import { useFetch } from '../lib/hooks.js';
import { formatDate, rupiah } from '../lib/format.js';
import { Page } from '../components/Layout.jsx';
import {
  EmptyState,
  Loaded,
  PageHeader,
  Pagination,
  Row,
  RowList,
  TextField,
} from '../components/ui.jsx';
import { PaymentBadge } from './saleParts.jsx';

export default function Sales() {
  const [filters, setFilters] = useState({ from: '', to: '' });
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
        title="Riwayat Penjualan"
        description="Semua penjualan."
        actions={
          <Link to="/penjualan/baru" className="btn-primary">
            Catat penjualan
          </Link>
        }
      />
      <div className="space-y-3">
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
                  !hasFilter ? (
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
                      subtitle={formatDate(sale.sale_date)}
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

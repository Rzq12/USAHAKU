import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { notifyChanged, useFetch } from '../lib/hooks.js';
import { formatDate, formatQty, rupiah } from '../lib/format.js';
import { Page } from '../components/Layout.jsx';
import { ConfirmDialog } from '../components/Drawer.jsx';
import { Icon } from '../components/Icon.jsx';
import { useToast } from '../components/Toast.jsx';
import { Loaded } from '../components/ui.jsx';
import { PaymentBadge } from './saleParts.jsx';

export default function SaleDetail() {
  const { id } = useParams();
  const toast = useToast();
  const state = useFetch(`/sales/${id}`);
  const [voidOpen, setVoidOpen] = useState(false);

  return (
    <Page narrow>
      <Link to="/penjualan" className="btn-ghost -ml-3 mb-2">
        <Icon name="back" size={18} /> Riwayat Penjualan
      </Link>
      <Loaded state={state}>
        {(sale) => {
          const cost = sale.items.reduce((sum, item) => sum + (item.line_cost ?? 0), 0);
          return (
            <>
              <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-h4">{sale.contact_name ?? 'Pelanggan umum'}</h1>
                    <PaymentBadge status={sale.payment_status} />
                  </div>
                  <p className="mt-1 text-body-sm text-slate">
                    {formatDate(sale.sale_date)} · Dicatat oleh {sale.created_by_name}
                  </p>
                </div>
                <p className="num text-h3">{rupiah(sale.total)}</p>
              </header>

              <ul className="card mt-5 divide-y divide-hairline-soft">
                {sale.items.map((item) => (
                  <li key={item.id} className="flex justify-between gap-4 px-4 py-3 text-body-sm">
                    <div className="min-w-0">
                      <p className="break-words font-medium">{item.description}</p>
                      <p className="num text-caption text-slate">
                        {formatQty(item.qty)} x {rupiah(item.unit_price)}
                      </p>
                    </div>
                    <span className="num shrink-0 font-medium">{rupiah(item.line_total)}</span>
                  </li>
                ))}
              </ul>
              <dl className="mt-4 space-y-1 text-body-sm">
                <div className="flex justify-between">
                  <dt className="text-slate">Subtotal</dt>
                  <dd className="num">{rupiah(sale.subtotal)}</dd>
                </div>
                {sale.discount > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-slate">Diskon</dt>
                    <dd className="num">-{rupiah(sale.discount)}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-slate">Harga pokok</dt>
                  <dd className="num">{rupiah(cost)}</dd>
                </div>
                {sale.account_name && (
                  <div className="flex justify-between">
                    <dt className="text-slate">Masuk ke akun</dt>
                    <dd>{sale.account_name}</dd>
                  </div>
                )}
              </dl>

              <div className="mt-6 flex flex-wrap gap-2">
                {sale.status === 'active' && (
                  <button
                    type="button"
                    className="btn-ghost text-danger-deep"
                    onClick={() => setVoidOpen(true)}
                  >
                    Batalkan penjualan
                  </button>
                )}
              </div>
              <ConfirmDialog
                open={voidOpen}
                onClose={() => setVoidOpen(false)}
                title="Batalkan penjualan ini?"
                body={`Stok dikembalikan dan ${sale.payment_type === 'paid' ? 'uang masuknya dibatalkan' : 'piutang serta pembayarannya dibatalkan'}. Catatan tetap tersimpan sebagai dibatalkan.`}
                confirmLabel="Batalkan penjualan"
                onConfirm={async () => {
                  await api.post(`/sales/${sale.id}/void`);
                  toast.show('Penjualan dibatalkan. Stok dan saldo dikembalikan.');
                  notifyChanged();
                }}
              />
            </>
          );
        }}
      </Loaded>
    </Page>
  );
}

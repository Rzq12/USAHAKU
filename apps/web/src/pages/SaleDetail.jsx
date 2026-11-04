import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, downloadFile } from '../lib/api.js';
import { usePermissions } from '../lib/auth.jsx';
import { notifyChanged, useFetch, useSubmit } from '../lib/hooks.js';
import { formatDate, formatQty, rupiah, todayJakarta } from '../lib/format.js';
import { Page } from '../components/Layout.jsx';
import { ConfirmDialog, Drawer } from '../components/Drawer.jsx';
import { Icon } from '../components/Icon.jsx';
import { useToast } from '../components/Toast.jsx';
import { FormError, Loaded, TextAreaField, TextField } from '../components/ui.jsx';
import { PaymentBadge } from './saleParts.jsx';

function InvoiceDrawer({ open, onClose, sale }) {
  const [form, setForm] = useState({
    issue_date: todayJakarta(),
    due_date: '',
    notes: '',
  });
  const action = useCallback(
    () => api.post('/invoices', { sale_id: sale.id, ...form, due_date: form.due_date || null }),
    [form, sale.id],
  );
  const { submit, pending, fieldErrors, formError } = useSubmit(action, {
    success: (invoice) => `Faktur ${invoice.number} dibuat.`,
    onDone: () => {
      notifyChanged();
      onClose();
    },
  });
  const needsAddress = formError?.includes('alamat usaha');
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Buat faktur"
      footer={
        <button type="button" className="btn-primary" disabled={pending} onClick={() => submit()}>
          {pending ? 'Membuat...' : 'Buat faktur'}
        </button>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Tanggal faktur"
            type="date"
            value={form.issue_date}
            onChange={(e) => setForm({ ...form, issue_date: e.target.value })}
            error={fieldErrors.issue_date}
          />
          <TextField
            label="Jatuh tempo"
            type="date"
            value={form.due_date}
            onChange={(e) => setForm({ ...form, due_date: e.target.value })}
            error={fieldErrors.due_date}
          />
        </div>
        <TextAreaField
          label="Catatan pada faktur"
          value={form.notes}
          maxLength={500}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          error={fieldErrors.notes}
        />
        <FormError message={formError} />
        {needsAddress && (
          <Link to="/pengaturan" className="link-tap text-body-sm">
            Buka Pengaturan Usaha
          </Link>
        )}
      </div>
    </Drawer>
  );
}

export default function SaleDetail() {
  const { id } = useParams();
  const toast = useToast();
  const { isOwner, canRecord, canSeeFinancials } = usePermissions();
  const state = useFetch(`/sales/${id}`);
  const [voidOpen, setVoidOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [downloadError, setDownloadError] = useState(null);

  return (
    <Page narrow>
      <Link to="/penjualan" className="btn-ghost -ml-3 mb-2">
        <Icon name="back" size={18} /> Penjualan
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
                {canSeeFinancials && (
                  <div className="flex justify-between">
                    <dt className="text-slate">Harga pokok</dt>
                    <dd className="num">{rupiah(cost)}</dd>
                  </div>
                )}
                {sale.account_name && (
                  <div className="flex justify-between">
                    <dt className="text-slate">Masuk ke akun</dt>
                    <dd>{sale.account_name}</dd>
                  </div>
                )}
              </dl>

              <div className="mt-6 flex flex-wrap gap-2">
                {sale.invoice_id ? (
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => {
                      setDownloadError(null);
                      downloadFile(`/invoices/${sale.invoice_id}/pdf`).catch((error) =>
                        setDownloadError(error.message),
                      );
                    }}
                  >
                    <Icon name="download" size={18} /> Unduh faktur {sale.invoice_number}
                  </button>
                ) : (
                  canRecord &&
                  sale.status === 'active' && (
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => setInvoiceOpen(true)}
                    >
                      Buat faktur
                    </button>
                  )
                )}
                {sale.debt_id && (
                  <Link to={`/tagihan/${sale.debt_id}`} className="btn-secondary">
                    Lihat piutang
                  </Link>
                )}
                {isOwner && sale.status === 'active' && (
                  <button
                    type="button"
                    className="btn-ghost text-danger-deep"
                    onClick={() => setVoidOpen(true)}
                  >
                    Batalkan penjualan
                  </button>
                )}
              </div>
              <FormError message={downloadError} />

              {canRecord && sale.status === 'active' && !sale.invoice_id && (
                <InvoiceDrawer
                  open={invoiceOpen}
                  onClose={() => setInvoiceOpen(false)}
                  sale={sale}
                />
              )}
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

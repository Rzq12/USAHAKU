import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, downloadFile, query } from '../lib/api.js';
import { usePermissions } from '../lib/auth.jsx';
import { notifyChanged, useFetch, useSubmit } from '../lib/hooks.js';
import { formatDate, rupiah } from '../lib/format.js';
import { Page } from '../components/Layout.jsx';
import { ConfirmDialog, Drawer } from '../components/Drawer.jsx';
import { useToast } from '../components/Toast.jsx';
import {
  EmptyState,
  FormError,
  Loaded,
  PageHeader,
  Pagination,
  PillTabs,
  Row,
  RowList,
  TextAreaField,
  TextField,
} from '../components/ui.jsx';
import { InvoiceBadge } from './saleParts.jsx';

const STATUS_FILTERS = [
  { value: '', label: 'Semua' },
  { value: 'issued', label: 'Belum lunas' },
  { value: 'paid', label: 'Lunas' },
  { value: 'void', label: 'Dibatalkan' },
];

function InvoiceDrawer({ invoice, onClose, onVoid }) {
  const { isOwner } = usePermissions();
  const [form, setForm] = useState({ issue_date: '', due_date: '', notes: '' });
  const [downloadError, setDownloadError] = useState(null);
  useEffect(() => {
    if (invoice) {
      setForm({
        issue_date: invoice.issue_date,
        due_date: invoice.due_date ?? '',
        notes: invoice.notes ?? '',
      });
      setDownloadError(null);
    }
  }, [invoice]);
  const action = useCallback(
    () => api.put(`/invoices/${invoice.id}`, { ...form, due_date: form.due_date || null }),
    [form, invoice],
  );
  const { submit, pending, fieldErrors, formError } = useSubmit(action, {
    success: 'Faktur disimpan.',
    onDone: () => {
      notifyChanged();
      onClose();
    },
  });
  const editable = isOwner && invoice?.status === 'issued';
  return (
    <Drawer
      open={Boolean(invoice)}
      onClose={onClose}
      title={invoice ? `Faktur ${invoice.number}` : ''}
      footer={
        invoice && (
          <>
            {isOwner && invoice.status !== 'void' && (
              <button type="button" className="btn-ghost mr-auto text-danger-deep" onClick={onVoid}>
                Batalkan faktur
              </button>
            )}
            {editable && (
              <button
                type="button"
                className="btn-secondary"
                disabled={pending}
                onClick={() => submit()}
              >
                {pending ? 'Menyimpan...' : 'Simpan perubahan'}
              </button>
            )}
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                setDownloadError(null);
                downloadFile(`/invoices/${invoice.id}/pdf`).catch((error) =>
                  setDownloadError(error.message),
                );
              }}
            >
              Unduh PDF
            </button>
          </>
        )
      }
    >
      {invoice && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-medium">{invoice.contact_name ?? 'Pelanggan umum'}</p>
              <InvoiceBadge status={invoice.status} />
            </div>
            <p className="num text-h4">{rupiah(invoice.total)}</p>
          </div>
          <Link to={`/penjualan/${invoice.sale_id}`} className="link-tap text-body-sm">
            Lihat penjualan
          </Link>
          {editable ? (
            <>
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
                label="Catatan"
                maxLength={500}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                error={fieldErrors.notes}
              />
            </>
          ) : (
            <p className="text-body-sm text-slate">
              Tanggal {formatDate(invoice.issue_date)}
              {invoice.due_date ? ` · Jatuh tempo ${formatDate(invoice.due_date)}` : ''}
            </p>
          )}
          <FormError message={formError ?? downloadError} />
        </div>
      )}
    </Drawer>
  );
}

export default function Invoices() {
  const toast = useToast();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const state = useFetch(`/invoices${query({ status, page })}`);
  const [selectedId, setSelectedId] = useState(null);
  const [voiding, setVoiding] = useState(null);
  const selected = state.data?.items.find((invoice) => invoice.id === selectedId) ?? null;

  return (
    <Page>
      <PageHeader
        title="Faktur"
        description="Faktur dibuat dari halaman penjualan, satu faktur untuk satu penjualan."
      />
      <PillTabs
        label="Status faktur"
        options={STATUS_FILTERS}
        value={status}
        onChange={(value) => {
          setStatus(value);
          setPage(1);
        }}
      />
      <div className="mt-4">
        <Loaded state={state}>
          {(data) =>
            data.items.length === 0 ? (
              <EmptyState
                title="Belum ada faktur"
                body="Buka sebuah penjualan, lalu pilih Buat faktur."
                action={
                  <Link to="/penjualan" className="btn-secondary">
                    Buka daftar penjualan
                  </Link>
                }
              />
            ) : (
              <>
                <RowList>
                  {data.items.map((invoice) => (
                    <Row
                      key={invoice.id}
                      title={invoice.number}
                      subtitle={`${invoice.contact_name ?? 'Pelanggan umum'} · ${formatDate(invoice.issue_date)}`}
                      badge={<InvoiceBadge status={invoice.status} />}
                      right={rupiah(invoice.total)}
                      onClick={() => setSelectedId(invoice.id)}
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
      <InvoiceDrawer
        invoice={selected}
        onClose={() => setSelectedId(null)}
        onVoid={() => {
          setVoiding(selected);
          setSelectedId(null);
        }}
      />
      <ConfirmDialog
        open={Boolean(voiding)}
        onClose={() => setVoiding(null)}
        title="Batalkan faktur ini?"
        body={voiding ? `Nomor ${voiding.number} tetap terpakai dan tidak digunakan lagi.` : ''}
        confirmLabel="Batalkan faktur"
        onConfirm={async () => {
          await api.put(`/invoices/${voiding.id}`, { status: 'void' });
          toast.show('Faktur dibatalkan.');
          notifyChanged();
        }}
      />
    </Page>
  );
}

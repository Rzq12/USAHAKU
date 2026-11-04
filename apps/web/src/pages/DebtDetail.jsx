import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { usePermissions } from '../lib/auth.jsx';
import { notifyChanged, useFetch, useSubmit } from '../lib/hooks.js';
import { formatDate, rupiah, todayJakarta } from '../lib/format.js';
import { Page } from '../components/Layout.jsx';
import { ConfirmDialog } from '../components/Drawer.jsx';
import { Icon } from '../components/Icon.jsx';
import { useToast } from '../components/Toast.jsx';
import {
  AccountOptions,
  Badge,
  EmptyState,
  FormError,
  Loaded,
  MoneyField,
  SelectField,
  TextField,
  useAccounts,
} from '../components/ui.jsx';
import { DebtBadge } from './debtParts.jsx';

function PaymentForm({ debt }) {
  const accounts = useAccounts();
  const [form, setForm] = useState({
    amount: debt.remaining,
    account_id: '',
    paid_on: todayJakarta(),
  });
  useEffect(() => {
    setForm((current) => ({ ...current, amount: debt.remaining }));
  }, [debt.remaining]);
  const action = useCallback(() => api.post(`/debts/${debt.id}/payments`, form), [form, debt.id]);
  const { submit, pending, fieldErrors, formError } = useSubmit(action, {
    success: 'Pembayaran dicatat.',
    onDone: notifyChanged,
  });
  return (
    <form
      className="card space-y-4 p-4 sm:p-6"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <h2 className="text-h5">Catat pembayaran</h2>
      <MoneyField
        label="Nominal"
        hint={`Sisa ${rupiah(debt.remaining)}`}
        value={form.amount}
        onChange={(amount) => setForm({ ...form, amount })}
        error={fieldErrors.amount}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label={debt.type === 'receivable' ? 'Uang masuk ke akun' : 'Bayar dari akun'}
          value={form.account_id}
          onChange={(e) => setForm({ ...form, account_id: e.target.value })}
          error={fieldErrors.account_id}
        >
          <AccountOptions accounts={accounts.data} />
        </SelectField>
        <TextField
          label="Tanggal bayar"
          type="date"
          value={form.paid_on}
          onChange={(e) => setForm({ ...form, paid_on: e.target.value })}
          error={fieldErrors.paid_on}
        />
      </div>
      <FormError message={formError} />
      <button type="submit" className="btn-primary w-full sm:w-auto" disabled={pending}>
        {pending ? 'Menyimpan...' : 'Simpan pembayaran'}
      </button>
    </form>
  );
}

export default function DebtDetail() {
  const { id } = useParams();
  const toast = useToast();
  const { isOwner, canRecord } = usePermissions();
  const state = useFetch(`/debts/${id}`);
  const [voiding, setVoiding] = useState(null);

  return (
    <Page narrow>
      <Link to="/tagihan" className="btn-ghost -ml-3 mb-2">
        <Icon name="back" size={18} /> Tagihan
      </Link>
      <Loaded state={state}>
        {(debt) => (
          <>
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-h4">{debt.contact_name}</h1>
                  <DebtBadge debt={debt} />
                </div>
                <p className="mt-1 text-body-sm text-slate">
                  {debt.type === 'receivable' ? 'Piutang' : 'Hutang'} · Tagihan{' '}
                  {formatDate(debt.issue_date)} · Jatuh tempo {formatDate(debt.due_date)}
                </p>
                {debt.days_overdue > 0 && (
                  <p className="mt-1 text-body-sm font-medium text-danger-deep">
                    Terlambat {debt.days_overdue} hari.
                  </p>
                )}
              </div>
              <div className="text-right">
                <p className="num text-h3">{rupiah(debt.remaining)}</p>
                <p className="num text-caption text-slate">sisa dari {rupiah(debt.amount)}</p>
              </div>
            </header>
            {debt.source_type === 'sale' && (
              <Link to={`/penjualan/${debt.source_id}`} className="link-tap text-body-sm">
                Lihat penjualan asal
              </Link>
            )}
            {debt.note && <p className="mt-2 text-body-sm text-charcoal">{debt.note}</p>}

            {canRecord && ['open', 'partial'].includes(debt.status) && (
              <div className="mt-6">
                <PaymentForm debt={debt} />
              </div>
            )}

            <section className="mt-8">
              <h2 className="mb-3 text-h5">Riwayat pembayaran</h2>
              {debt.payments.length === 0 ? (
                <EmptyState
                  compact
                  title="Belum ada pembayaran"
                  body="Pembayaran bisa dicatat sebagian atau sekaligus."
                />
              ) : (
                <ul className="card divide-y divide-hairline-soft">
                  {debt.payments.map((payment) => (
                    <li
                      key={payment.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-body-sm"
                    >
                      <div className="min-w-0">
                        <p
                          className={
                            payment.is_void ? 'text-slate line-through' : 'num font-medium'
                          }
                        >
                          {rupiah(payment.amount)}
                        </p>
                        <p className="text-caption text-slate">
                          {formatDate(payment.paid_on)} · {payment.account_name} ·{' '}
                          {payment.created_by_name}
                        </p>
                      </div>
                      {payment.is_void ? (
                        <Badge>Dibatalkan</Badge>
                      ) : (
                        isOwner &&
                        debt.status !== 'void' && (
                          <button
                            type="button"
                            className="btn-ghost text-danger-deep"
                            onClick={() => setVoiding(payment)}
                          >
                            Batalkan
                          </button>
                        )
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <ConfirmDialog
              open={Boolean(voiding)}
              onClose={() => setVoiding(null)}
              title="Batalkan pembayaran ini?"
              body={
                voiding
                  ? `Pembayaran ${rupiah(voiding.amount)} dibatalkan. Saldo akun dan sisa tagihan dikembalikan.`
                  : ''
              }
              confirmLabel="Batalkan pembayaran"
              onConfirm={async () => {
                await api.post(`/debts/${debt.id}/payments/${voiding.id}/void`);
                toast.show('Pembayaran dibatalkan.');
                notifyChanged();
              }}
            />
          </>
        )}
      </Loaded>
    </Page>
  );
}

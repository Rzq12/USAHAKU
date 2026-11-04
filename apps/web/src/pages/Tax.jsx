import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, query } from '../lib/api.js';
import { usePermissions } from '../lib/auth.jsx';
import { notifyChanged, useFetch, useSubmit } from '../lib/hooks.js';
import { MONTH_NAMES, rupiah, todayJakarta } from '../lib/format.js';
import { Page } from '../components/Layout.jsx';
import { Drawer } from '../components/Drawer.jsx';
import {
  AccountOptions,
  EmptyState,
  ErrorState,
  FormError,
  ListSkeleton,
  MoneyField,
  PageHeader,
  SelectField,
  TextField,
  useAccounts,
} from '../components/ui.jsx';

const FIRST_YEAR = 2020;
const TAXPAYER = { individual: 'Orang pribadi', company: 'Badan usaha' };

function PaymentDrawer({ payment, onClose }) {
  const accounts = useAccounts();
  const [form, setForm] = useState({ amount: null, account_id: '', paid_on: todayJakarta() });
  useEffect(() => {
    if (payment) setForm({ amount: payment.tax, account_id: '', paid_on: todayJakarta() });
  }, [payment]);
  const action = useCallback(
    () => api.post('/tax/record-payment', { ...form, year: payment.year, month: payment.month }),
    [form, payment],
  );
  const { submit, pending, fieldErrors, formError } = useSubmit(action, {
    success: 'Pembayaran pajak dicatat sebagai pengeluaran.',
    onDone: () => {
      notifyChanged();
      onClose();
    },
  });
  return (
    <Drawer
      open={Boolean(payment)}
      onClose={onClose}
      title={payment ? `Catat pajak ${MONTH_NAMES[payment.month - 1]} ${payment.year}` : ''}
      footer={
        <button type="button" className="btn-primary" disabled={pending} onClick={() => submit()}>
          {pending ? 'Menyimpan...' : 'Catat pembayaran'}
        </button>
      }
    >
      <div className="space-y-4">
        <MoneyField
          label="Nominal dibayar"
          value={form.amount}
          onChange={(amount) => setForm({ ...form, amount })}
          error={fieldErrors.amount}
        />
        <SelectField
          label="Bayar dari akun"
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
        <FormError message={formError} />
      </div>
    </Drawer>
  );
}

export default function Tax() {
  const { isOwner } = usePermissions();
  const currentYear = Number(todayJakarta().slice(0, 4));
  const [year, setYear] = useState(currentYear);
  const [payment, setPayment] = useState(null);
  const state = useFetch(`/tax/estimate${query({ year })}`);
  const years = Array.from(
    { length: currentYear - FIRST_YEAR + 1 },
    (_, index) => currentYear - index,
  );
  const missingSettings = state.error?.code === 'TAXPAYER_TYPE_MISSING';

  return (
    <Page>
      <PageHeader
        title="Perkiraan Pajak"
        description="Perkiraan PPh Final UMKM dari omzet yang tercatat."
      />
      <div className="mb-4 sm:max-w-[200px]">
        <SelectField
          label="Tahun pajak"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
        >
          {years.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </SelectField>
      </div>

      {missingSettings && (
        <EmptyState
          title={state.error.message}
          body="Tarif dan batas omzet berbeda untuk orang pribadi dan badan usaha."
          action={
            <Link to="/pengaturan" className="btn-primary">
              Buka Pengaturan Usaha
            </Link>
          }
        />
      )}
      {state.error && !missingSettings && <ErrorState error={state.error} onRetry={state.reload} />}
      {!state.data && !state.error && <ListSkeleton rows={6} />}
      {state.data && (
        <>
          <div className="mb-4 rounded-lg bg-tint-yellow-bold p-5 text-charcoal">
            <p className="text-body-sm">Perkiraan pajak {year}</p>
            <p className="num text-h3 text-ink">{rupiah(state.data.total_tax)}</p>
            <p className="mt-1 text-body-sm">{state.data.disclaimer}</p>
          </div>
          <p className="mb-3 text-body-sm text-slate">
            {TAXPAYER[state.data.taxpayer_type]} · Tarif{' '}
            {String(state.data.tax_rate).replace('.', ',')}%
            {state.data.taxpayer_type === 'individual' &&
              ` · Omzet sampai ${rupiah(state.data.tax_threshold)} per tahun tidak dikenai pajak`}
          </p>
          {state.data.total_turnover === 0 && (
            <p className="mb-3 rounded-md bg-surface px-4 py-3 text-body-sm text-slate">
              Belum ada omzet tercatat pada {year}, sehingga semua bulan bernilai nol.
            </p>
          )}
          <div className="card relative overflow-x-auto">
            <table className="w-full min-w-[620px] border-collapse">
              <caption className="sr-only">Perkiraan pajak per bulan tahun {year}</caption>
              <thead>
                <tr>
                  <th scope="col" className="table-head">
                    Bulan
                  </th>
                  <th scope="col" className="table-head text-right">
                    Omzet
                  </th>
                  <th scope="col" className="table-head text-right">
                    Omzet kumulatif
                  </th>
                  <th scope="col" className="table-head text-right">
                    Kena pajak
                  </th>
                  <th scope="col" className="table-head text-right">
                    Perkiraan pajak
                  </th>
                  {isOwner && (
                    <th scope="col" className="table-head">
                      <span className="sr-only">Aksi</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {state.data.months.map((month) => (
                  <tr key={month.month}>
                    <td className="table-cell">{MONTH_NAMES[month.month - 1]}</td>
                    <td className="table-cell num text-right">{rupiah(month.turnover)}</td>
                    <td className="table-cell num text-right">{rupiah(month.cumulative)}</td>
                    <td className="table-cell num text-right">{rupiah(month.taxable)}</td>
                    <td className="table-cell num text-right font-medium">{rupiah(month.tax)}</td>
                    {isOwner && (
                      <td className="table-cell py-1 text-right">
                        {month.tax > 0 && (
                          <button
                            type="button"
                            className="btn-ghost text-primary"
                            onClick={() => setPayment({ ...month, year })}
                          >
                            Catat bayar
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-surface-soft font-semibold">
                  <td className="table-cell">Total</td>
                  <td className="table-cell num text-right">{rupiah(state.data.total_turnover)}</td>
                  <td className="table-cell" />
                  <td className="table-cell" />
                  <td className="table-cell num text-right">{rupiah(state.data.total_tax)}</td>
                  {isOwner && <td className="table-cell" />}
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
      {isOwner && <PaymentDrawer payment={payment} onClose={() => setPayment(null)} />}
    </Page>
  );
}

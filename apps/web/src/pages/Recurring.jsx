import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { usePermissions } from '../lib/auth.jsx';
import { notifyChanged, useFetch, useSubmit } from '../lib/hooks.js';
import { formatDate, FREQUENCIES, rupiah, todayJakarta } from '../lib/format.js';
import { Page } from '../components/Layout.jsx';
import { ConfirmDialog, Drawer } from '../components/Drawer.jsx';
import { useToast } from '../components/Toast.jsx';
import {
  AccountOptions,
  Badge,
  CategoryOptions,
  EmptyState,
  FormError,
  Loaded,
  MoneyField,
  PageHeader,
  PillTabs,
  SelectField,
  TextField,
  useAccounts,
  useCategories,
} from '../components/ui.jsx';

const emptyForm = () => ({
  type: 'expense',
  account_id: '',
  category_id: '',
  amount: null,
  note: '',
  frequency: 'monthly',
  start_on: todayJakarta(),
  end_on: '',
});

const TYPE_OPTIONS = [
  { value: 'expense', label: 'Pengeluaran' },
  { value: 'income', label: 'Pemasukan' },
];

function RuleDrawer({ open, onClose, rule }) {
  const accounts = useAccounts();
  const categories = useCategories();
  const [form, setForm] = useState(emptyForm);
  useEffect(() => {
    if (open)
      setForm(
        rule
          ? { ...emptyForm(), ...rule, note: rule.note ?? '', end_on: rule.end_on ?? '' }
          : emptyForm(),
      );
  }, [open, rule]);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  const action = useCallback(() => {
    if (rule) {
      const { account_id, category_id, amount, note } = form;
      return api.put(`/recurring/${rule.id}`, {
        account_id,
        category_id,
        amount,
        note,
        end_on: form.end_on || null,
      });
    }
    return api.post('/recurring', { ...form, end_on: form.end_on || null });
  }, [form, rule]);
  const { submit, pending, fieldErrors, formError } = useSubmit(action, {
    success: 'Transaksi berulang disimpan.',
    onDone: () => {
      notifyChanged();
      onClose();
    },
  });

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={rule ? 'Ubah transaksi berulang' : 'Tambah transaksi berulang'}
      footer={
        <button type="button" className="btn-primary" disabled={pending} onClick={() => submit()}>
          {pending ? 'Menyimpan...' : 'Simpan aturan'}
        </button>
      }
    >
      <div className="space-y-4">
        {!rule && (
          <PillTabs
            label="Jenis"
            options={TYPE_OPTIONS}
            value={form.type}
            onChange={(type) => setForm({ ...form, type, category_id: '' })}
          />
        )}
        <MoneyField
          label="Nominal"
          value={form.amount}
          onChange={(amount) => setForm({ ...form, amount })}
          error={fieldErrors.amount}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label="Akun"
            value={form.account_id}
            onChange={set('account_id')}
            error={fieldErrors.account_id}
          >
            <AccountOptions accounts={accounts.data} />
          </SelectField>
          <SelectField
            label="Kategori"
            value={form.category_id}
            onChange={set('category_id')}
            error={fieldErrors.category_id}
          >
            <CategoryOptions categories={categories.data} type={form.type} />
          </SelectField>
        </div>
        <TextField
          label="Catatan"
          value={form.note}
          maxLength={500}
          onChange={set('note')}
          error={fieldErrors.note}
        />
        {!rule && (
          <SelectField
            label="Berulang setiap"
            value={form.frequency}
            onChange={set('frequency')}
            error={fieldErrors.frequency}
          >
            {Object.entries(FREQUENCIES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectField>
        )}
        <div className="grid grid-cols-2 gap-3">
          {!rule && (
            <TextField
              label="Mulai"
              type="date"
              value={form.start_on}
              onChange={set('start_on')}
              error={fieldErrors.start_on}
            />
          )}
          <TextField
            label="Berakhir (boleh kosong)"
            type="date"
            value={form.end_on}
            onChange={set('end_on')}
            error={fieldErrors.end_on}
          />
        </div>
        <FormError message={formError} />
      </div>
    </Drawer>
  );
}

function RuleCard({ rule, isOwner, onEdit, onRun, onToggle, onEnd }) {
  return (
    <li className="px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="break-words font-medium">{rule.note || rule.category_name}</span>
            <Badge tone={rule.is_active ? 'green' : 'gray'}>
              {rule.is_active ? 'Aktif' : 'Berhenti'}
            </Badge>
          </div>
          <p className="mt-0.5 text-caption text-slate">
            {FREQUENCIES[rule.frequency]} · {rule.account_name} · {rule.category_name}
          </p>
          {rule.is_active && (
            <p className="text-caption text-slate">Berikutnya {formatDate(rule.next_run_on)}</p>
          )}
          {rule.last_run_on && (
            <p className="text-caption text-slate">
              Terakhir dicatat {formatDate(rule.last_run_on)}
            </p>
          )}
          {rule.last_run_error && (
            <p className="mt-1 text-caption text-danger-deep">{rule.last_run_error}</p>
          )}
        </div>
        <span className="num font-medium">{rupiah(rule.amount)}</span>
      </div>
      {isOwner && (
        <div className="mt-2 flex flex-wrap gap-1">
          {rule.is_active && (
            <button type="button" className="btn-secondary" onClick={onRun}>
              Catat sekarang
            </button>
          )}
          <button type="button" className="btn-ghost" onClick={onEdit}>
            Ubah
          </button>
          <button type="button" className="btn-ghost" onClick={onToggle}>
            {rule.is_active ? 'Jeda' : 'Lanjutkan'}
          </button>
          {rule.is_active && (
            <button type="button" className="btn-ghost text-danger-deep" onClick={onEnd}>
              Akhiri
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export default function Recurring() {
  const toast = useToast();
  const { isOwner } = usePermissions();
  const state = useFetch('/recurring');
  const [drawer, setDrawer] = useState({ open: false, rule: null });
  const [ending, setEnding] = useState(null);
  const [actionError, setActionError] = useState(null);

  async function run(rule, message, request) {
    setActionError(null);
    try {
      await request();
      toast.show(message);
      notifyChanged();
    } catch (error) {
      setActionError(error.message);
    }
    return rule;
  }

  return (
    <Page narrow>
      <PageHeader
        title="Transaksi Berulang"
        description="Sewa, internet, dan tagihan rutin lain tercatat sendiri setiap pukul 00.05 WIB."
        actions={
          isOwner && (
            <button
              type="button"
              className="btn-primary"
              onClick={() => setDrawer({ open: true, rule: null })}
            >
              Tambah aturan
            </button>
          )
        }
      />
      <FormError message={actionError} />
      <div className="mt-3">
        <Loaded state={state}>
          {(data) =>
            data.items.length === 0 ? (
              <EmptyState
                title="Belum ada transaksi berulang"
                body="Buat aturan untuk biaya rutin agar laporan tetap lengkap."
                action={
                  isOwner ? (
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => setDrawer({ open: true, rule: null })}
                    >
                      Tambah aturan pertama
                    </button>
                  ) : undefined
                }
              />
            ) : (
              <ul className="card divide-y divide-hairline-soft">
                {data.items.map((rule) => (
                  <RuleCard
                    key={rule.id}
                    rule={rule}
                    isOwner={isOwner}
                    onEdit={() => setDrawer({ open: true, rule })}
                    onRun={() =>
                      run(rule, 'Transaksi berulang dicatat.', () =>
                        api.post(`/recurring/${rule.id}/run`),
                      )
                    }
                    onToggle={() =>
                      run(rule, rule.is_active ? 'Aturan dijeda.' : 'Aturan dilanjutkan.', () =>
                        api.put(`/recurring/${rule.id}`, { is_active: !rule.is_active }),
                      )
                    }
                    onEnd={() => setEnding(rule)}
                  />
                ))}
              </ul>
            )
          }
        </Loaded>
      </div>
      {isOwner && (
        <RuleDrawer
          open={drawer.open}
          rule={drawer.rule}
          onClose={() => setDrawer({ open: false, rule: null })}
        />
      )}
      <ConfirmDialog
        open={Boolean(ending)}
        onClose={() => setEnding(null)}
        title="Akhiri aturan ini?"
        body="Tidak ada lagi transaksi yang dicatat otomatis dari aturan ini. Transaksi yang sudah ada tetap tersimpan."
        confirmLabel="Akhiri aturan"
        onConfirm={async () => {
          await api.put(`/recurring/${ending.id}`, { is_active: false });
          toast.show('Aturan diakhiri.');
          notifyChanged();
        }}
      />
    </Page>
  );
}

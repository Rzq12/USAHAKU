import { useCallback, useEffect, useState } from 'react';
import { api, query } from '../lib/api.js';
import { notifyChanged, useFetch, useSubmit } from '../lib/hooks.js';
import { ACCOUNT_TYPES, rupiah } from '../lib/format.js';
import { Page } from '../components/Layout.jsx';
import { ConfirmDialog, Drawer } from '../components/Drawer.jsx';
import { useToast } from '../components/Toast.jsx';
import {
  Badge,
  EmptyState,
  FormError,
  Loaded,
  MoneyField,
  PageHeader,
  Row,
  RowList,
  SelectField,
  TextField,
} from '../components/ui.jsx';

const EMPTY = { name: '', type: 'cash', opening_balance: 0 };

function AccountDrawer({ open, onClose, account, onDelete, onArchive }) {
  const [form, setForm] = useState(EMPTY);
  useEffect(() => {
    if (open)
      setForm(
        account
          ? { name: account.name, type: account.type, opening_balance: account.opening_balance }
          : EMPTY,
      );
  }, [open, account]);
  const action = useCallback(() => {
    const payload = { ...form, opening_balance: form.opening_balance ?? 0 };
    return account ? api.put(`/accounts/${account.id}`, payload) : api.post('/accounts', payload);
  }, [form, account]);
  const { submit, pending, fieldErrors, formError } = useSubmit(action, {
    success: account ? 'Akun disimpan.' : 'Akun berhasil dibuat.',
    onDone: () => {
      notifyChanged();
      onClose();
    },
  });
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={account ? 'Ubah akun' : 'Tambah akun'}
      footer={
        <>
          {account && (
            <>
              <button type="button" className="btn-ghost text-danger-deep" onClick={onDelete}>
                Hapus
              </button>
              <button type="button" className="btn-ghost mr-auto" onClick={onArchive}>
                {account.is_archived ? 'Aktifkan' : 'Arsipkan'}
              </button>
            </>
          )}
          <button type="button" className="btn-primary" disabled={pending} onClick={() => submit()}>
            {pending ? 'Menyimpan...' : 'Simpan akun'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <TextField
          label="Nama akun"
          value={form.name}
          maxLength={60}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          error={fieldErrors.name}
        />
        <SelectField
          label="Jenis"
          value={form.type}
          onChange={(e) => setForm({ ...form, type: e.target.value })}
          error={fieldErrors.type}
        >
          {Object.entries(ACCOUNT_TYPES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectField>
        <MoneyField
          label="Saldo awal"
          hint="Tekan tombol minus untuk saldo negatif."
          allowNegative
          value={form.opening_balance}
          onChange={(opening_balance) => setForm({ ...form, opening_balance })}
          error={fieldErrors.opening_balance}
        />
        <FormError message={formError} />
      </div>
    </Drawer>
  );
}

export default function Accounts() {
  const toast = useToast();
  const [showArchived, setShowArchived] = useState(false);
  const state = useFetch(`/accounts${query({ include_archived: showArchived ? 'true' : '' })}`);
  const [drawer, setDrawer] = useState({ open: false, account: null });
  const [confirming, setConfirming] = useState(null);

  async function toggleArchive(account) {
    await api.post(`/accounts/${account.id}/archive`, { is_archived: !account.is_archived });
    toast.show(account.is_archived ? 'Akun diaktifkan.' : 'Akun diarsipkan.');
    notifyChanged();
  }

  return (
    <Page narrow>
      <PageHeader
        title="Akun Kas dan Bank"
        description="Saldo dihitung dari saldo awal dan semua transaksi."
        actions={
          <button
            type="button"
            className="btn-primary"
            onClick={() => setDrawer({ open: true, account: null })}
          >
            Tambah akun
          </button>
        }
      />
      <button
        type="button"
        className="pill-tab mb-4"
        aria-pressed={showArchived}
        onClick={() => setShowArchived(!showArchived)}
      >
        Tampilkan arsip
      </button>
      <Loaded state={state}>
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState
              title="Belum ada akun"
              body="Tambah akun kas atau bank untuk mulai mencatat."
            />
          ) : (
            <>
              <div className="mb-4 rounded-lg bg-tint-lavender px-5 py-4">
                <p className="text-body-sm text-charcoal">Total saldo aktif</p>
                <p className="num text-h3">{rupiah(data.total_balance)}</p>
              </div>
              <RowList>
                {data.items.map((account) => (
                  <Row
                    key={account.id}
                    title={account.name}
                    subtitle={ACCOUNT_TYPES[account.type]}
                    badge={account.is_archived ? <Badge>Arsip</Badge> : undefined}
                    right={rupiah(account.balance)}
                    onClick={() => setDrawer({ open: true, account })}
                  />
                ))}
              </RowList>
            </>
          )
        }
      </Loaded>
      <AccountDrawer
        open={drawer.open}
        account={drawer.account}
        onClose={() => setDrawer({ open: false, account: null })}
        onDelete={() => {
          setConfirming({ kind: 'delete', account: drawer.account });
          setDrawer({ open: false, account: null });
        }}
        onArchive={() => {
          if (drawer.account.is_archived) toggleArchive(drawer.account);
          else setConfirming({ kind: 'archive', account: drawer.account });
          setDrawer({ open: false, account: null });
        }}
      />
      <ConfirmDialog
        open={Boolean(confirming)}
        onClose={() => setConfirming(null)}
        title={confirming?.kind === 'delete' ? 'Hapus akun ini?' : 'Arsipkan akun ini?'}
        body={
          confirming?.kind === 'delete'
            ? `${confirming.account.name} hanya bisa dihapus jika belum punya transaksi.`
            : `${confirming?.account.name ?? ''} hilang dari pilihan. Riwayat dan saldonya tetap ada.`
        }
        confirmLabel={confirming?.kind === 'delete' ? 'Hapus akun' : 'Arsipkan'}
        onConfirm={async () => {
          if (confirming.kind === 'delete') {
            await api.del(`/accounts/${confirming.account.id}`);
            toast.show('Akun dihapus.');
            notifyChanged();
          } else {
            await toggleArchive(confirming.account);
          }
        }}
      />
    </Page>
  );
}

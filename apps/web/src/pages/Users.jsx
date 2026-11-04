import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { notifyChanged, useFetch, useSubmit } from '../lib/hooks.js';
import { formatDateTime, ROLE_NAMES } from '../lib/format.js';
import { Page } from '../components/Layout.jsx';
import { ConfirmDialog, Drawer } from '../components/Drawer.jsx';
import { useToast } from '../components/Toast.jsx';
import {
  Badge,
  EmptyState,
  FormError,
  Loaded,
  PageHeader,
  Row,
  RowList,
  SelectField,
  TextField,
} from '../components/ui.jsx';

const EMPTY = { name: '', email: '', role: 'staff', temporary_password: '' };

function UserDrawer({ open, onClose, user, onDeactivate, onReset }) {
  const [form, setForm] = useState(EMPTY);
  useEffect(() => {
    if (open)
      setForm(user ? { ...EMPTY, name: user.name, email: user.email, role: user.role } : EMPTY);
  }, [open, user]);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const action = useCallback(() => {
    if (user) return api.put(`/users/${user.id}`, { name: form.name, role: form.role });
    return api.post('/users', form);
  }, [form, user]);
  const { submit, pending, fieldErrors, formError } = useSubmit(action, {
    success: user ? 'Pengguna disimpan.' : 'Pengguna berhasil ditambahkan.',
    onDone: () => {
      notifyChanged();
      onClose();
    },
  });
  const isOwnerRow = user?.role === 'owner';
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={user ? 'Ubah pengguna' : 'Tambah pengguna'}
      footer={
        <>
          {user && user.is_active && !isOwnerRow && (
            <button type="button" className="btn-ghost text-danger-deep" onClick={onDeactivate}>
              Nonaktifkan
            </button>
          )}
          {user && !isOwnerRow && (
            <button type="button" className="btn-ghost mr-auto" onClick={onReset}>
              Atur ulang sandi
            </button>
          )}
          <button type="button" className="btn-primary" disabled={pending} onClick={() => submit()}>
            {pending ? 'Menyimpan...' : 'Simpan pengguna'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <TextField
          label="Nama"
          value={form.name}
          maxLength={100}
          onChange={set('name')}
          error={fieldErrors.name}
        />
        <TextField
          label="Email"
          type="email"
          disabled={Boolean(user)}
          value={form.email}
          onChange={set('email')}
          error={fieldErrors.email}
        />
        {!isOwnerRow && (
          <SelectField
            label="Peran"
            value={form.role}
            onChange={set('role')}
            error={fieldErrors.role}
            hint={
              form.role === 'staff'
                ? 'Mencatat penjualan dan pengeluaran. Tidak melihat modal, laba, atau saldo.'
                : 'Hanya melihat dan mengekspor data serta laporan.'
            }
          >
            <option value="staff">Staf</option>
            <option value="accountant">Akuntan</option>
          </SelectField>
        )}
        {!user && (
          <TextField
            label="Kata sandi sementara"
            hint="Sampaikan langsung ke pengguna. Mereka wajib menggantinya saat pertama masuk."
            type="text"
            autoComplete="off"
            value={form.temporary_password}
            onChange={set('temporary_password')}
            error={fieldErrors.temporary_password ?? fieldErrors.password}
          />
        )}
        <FormError message={formError} />
      </div>
    </Drawer>
  );
}

function ResetDrawer({ user, onClose }) {
  const [password, setPassword] = useState('');
  useEffect(() => {
    if (user) setPassword('');
  }, [user]);
  const action = useCallback(
    () => api.post(`/users/${user.id}/reset-password`, { temporary_password: password }),
    [user, password],
  );
  const { submit, pending, fieldErrors, formError } = useSubmit(action, {
    success: 'Kata sandi sementara disimpan. Sesi lama pengguna berakhir.',
    onDone: onClose,
  });
  return (
    <Drawer
      open={Boolean(user)}
      onClose={onClose}
      title={user ? `Atur ulang sandi ${user.name}` : ''}
      footer={
        <button type="button" className="btn-primary" disabled={pending} onClick={() => submit()}>
          {pending ? 'Menyimpan...' : 'Simpan sandi sementara'}
        </button>
      }
    >
      <TextField
        label="Kata sandi sementara"
        hint="Minimal 8 karakter. Pengguna wajib menggantinya saat masuk."
        type="text"
        autoComplete="off"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        error={fieldErrors.temporary_password ?? fieldErrors.password}
      />
      <FormError message={formError} />
    </Drawer>
  );
}

export default function Users() {
  const toast = useToast();
  const { user: me } = useAuth();
  const state = useFetch('/users');
  const [drawer, setDrawer] = useState({ open: false, user: null });
  const [deactivating, setDeactivating] = useState(null);
  const [resetting, setResetting] = useState(null);
  const [activateError, setActivateError] = useState(null);

  async function activate(user) {
    setActivateError(null);
    try {
      await api.put(`/users/${user.id}`, { is_active: true });
      toast.show('Pengguna diaktifkan.');
      notifyChanged();
    } catch (error) {
      setActivateError(error.message);
    }
  }

  return (
    <Page narrow>
      <PageHeader
        title="Pengguna"
        description="Beri kasir dan akuntan akses sesuai perannya."
        actions={
          <button
            type="button"
            className="btn-primary"
            onClick={() => setDrawer({ open: true, user: null })}
          >
            Tambah pengguna
          </button>
        }
      />
      <FormError message={activateError} />
      <div className="mt-3">
        <Loaded state={state}>
          {(data) =>
            data.items.length <= 1 && !data.items.some((user) => user.id !== me.id) ? (
              <>
                <RowList>
                  {data.items.map((user) => (
                    <Row
                      key={user.id}
                      title={user.name}
                      subtitle={user.email}
                      badge={<Badge tone="purple">{ROLE_NAMES[user.role]}</Badge>}
                      onClick={() => setDrawer({ open: true, user })}
                    />
                  ))}
                </RowList>
                <div className="mt-4">
                  <EmptyState
                    compact
                    title="Baru Anda yang punya akses"
                    body="Tambahkan kasir atau akuntan dengan kata sandi sementara."
                  />
                </div>
              </>
            ) : (
              <RowList>
                {data.items.map((user) => (
                  <Row
                    key={user.id}
                    title={user.name}
                    subtitle={`${user.email}${user.last_login_at ? ` · Terakhir masuk ${formatDateTime(user.last_login_at)}` : ''}`}
                    badge={
                      <>
                        <Badge tone={user.role === 'owner' ? 'purple' : 'gray'}>
                          {ROLE_NAMES[user.role]}
                        </Badge>
                        {!user.is_active && <Badge tone="red">Nonaktif</Badge>}
                      </>
                    }
                    onClick={() =>
                      user.is_active ? setDrawer({ open: true, user }) : activate(user)
                    }
                    rightSub={!user.is_active ? 'Ketuk untuk mengaktifkan' : undefined}
                  />
                ))}
              </RowList>
            )
          }
        </Loaded>
      </div>
      <UserDrawer
        open={drawer.open}
        user={drawer.user}
        onClose={() => setDrawer({ open: false, user: null })}
        onDeactivate={() => {
          setDeactivating(drawer.user);
          setDrawer({ open: false, user: null });
        }}
        onReset={() => {
          setResetting(drawer.user);
          setDrawer({ open: false, user: null });
        }}
      />
      <ResetDrawer user={resetting} onClose={() => setResetting(null)} />
      <ConfirmDialog
        open={Boolean(deactivating)}
        onClose={() => setDeactivating(null)}
        title="Nonaktifkan pengguna ini?"
        body={
          deactivating
            ? `${deactivating.name} langsung keluar dari semua perangkat dan tidak bisa masuk. Catatannya tetap ada.`
            : ''
        }
        confirmLabel="Nonaktifkan"
        onConfirm={async () => {
          await api.put(`/users/${deactivating.id}`, { is_active: false });
          toast.show('Pengguna dinonaktifkan.');
          notifyChanged();
        }}
      />
    </Page>
  );
}

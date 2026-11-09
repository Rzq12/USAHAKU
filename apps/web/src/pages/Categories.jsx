import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { notifyChanged, useFetch, useSubmit } from '../lib/hooks.js';
import { CASH_ACTIVITIES, PL_GROUPS } from '../lib/format.js';
import { Page } from '../components/Layout.jsx';
import { ConfirmDialog, Drawer } from '../components/Drawer.jsx';
import { useToast } from '../components/Toast.jsx';
import {
  Badge,
  FormError,
  Loaded,
  PageHeader,
  PillTabs,
  Row,
  RowList,
  SelectField,
  TextField,
} from '../components/ui.jsx';

const TYPE_TABS = [
  { value: 'expense', label: 'Pengeluaran' },
  { value: 'income', label: 'Pemasukan' },
];

const EMPTY_CATEGORY = {
  name: '',
  parent_id: '',
  pl_group: 'operating_expense',
  cash_activity: 'operating',
};

function CategoryDrawer({ open, onClose, category, type, parents, onArchive, onDelete }) {
  const [form, setForm] = useState(EMPTY_CATEGORY);
  useEffect(() => {
    if (open) {
      setForm(
        category
          ? {
              name: category.name,
              parent_id: category.parent_id ?? '',
              pl_group: category.pl_group ?? 'operating_expense',
              cash_activity: category.cash_activity,
            }
          : EMPTY_CATEGORY,
      );
    }
  }, [open, category]);
  const action = useCallback(() => {
    if (category) {
      const changes = { name: form.name, cash_activity: form.cash_activity };
      if (category.type === 'expense') changes.pl_group = form.pl_group;
      return api.put(`/categories/${category.id}`, changes);
    }
    return api.post('/categories', {
      name: form.name,
      type,
      parent_id: form.parent_id || null,
      pl_group: type === 'expense' ? form.pl_group : null,
      cash_activity: form.cash_activity,
    });
  }, [form, category, type]);
  const { submit, pending, fieldErrors, formError } = useSubmit(action, {
    success: 'Kategori disimpan.',
    onDone: () => {
      notifyChanged();
      onClose();
    },
  });
  const isExpense = (category?.type ?? type) === 'expense';
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={category ? 'Ubah kategori' : 'Tambah kategori'}
      footer={
        <>
          {category && !category.system_key && (
            <>
              <button type="button" className="btn-ghost text-danger-deep" onClick={onDelete}>
                Hapus
              </button>
              <button type="button" className="btn-ghost mr-auto" onClick={onArchive}>
                {category.is_archived ? 'Aktifkan' : 'Arsipkan'}
              </button>
            </>
          )}
          <button type="button" className="btn-primary" disabled={pending} onClick={() => submit()}>
            {pending ? 'Menyimpan...' : 'Simpan kategori'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <TextField
          label="Nama"
          value={form.name}
          maxLength={60}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          error={fieldErrors.name}
        />
        {!category && (
          <SelectField
            label="Induk (boleh kosong)"
            value={form.parent_id}
            onChange={(e) => setForm({ ...form, parent_id: e.target.value })}
            error={fieldErrors.parent_id}
          >
            <option value="">Kategori utama</option>
            {parents.map((parent) => (
              <option key={parent.id} value={parent.id}>
                {parent.name}
              </option>
            ))}
          </SelectField>
        )}
        <SelectField
          label="Aktivitas arus kas"
          value={form.cash_activity}
          onChange={(e) => setForm({ ...form, cash_activity: e.target.value })}
          error={fieldErrors.cash_activity}
          disabled={Boolean(category?.system_key)}
          hint={
            form.cash_activity === 'operating'
              ? 'Kegiatan usaha sehari-hari. Masuk ke laba rugi.'
              : 'Hanya tampil di arus kas. Tidak dihitung sebagai laba atau beban.'
          }
        >
          {Object.entries(CASH_ACTIVITIES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectField>
        {isExpense && form.cash_activity === 'operating' && (
          <SelectField
            label="Kelompok laba rugi"
            value={form.pl_group}
            onChange={(e) => setForm({ ...form, pl_group: e.target.value })}
            error={fieldErrors.pl_group}
            disabled={Boolean(category?.system_key)}
          >
            {Object.entries(PL_GROUPS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectField>
        )}
        <FormError message={formError} />
      </div>
    </Drawer>
  );
}

export default function Categories() {
  const toast = useToast();
  const state = useFetch('/categories?include_archived=true');
  const [type, setType] = useState('expense');
  const [drawer, setDrawer] = useState({ open: false, category: null });
  const [confirming, setConfirming] = useState(null);

  const all = state.data?.items ?? [];
  const parents = all.filter(
    (category) => category.type === type && !category.parent_id && !category.is_archived,
  );

  async function setArchived(category, is_archived) {
    await api.put(`/categories/${category.id}`, { is_archived });
    toast.show(is_archived ? 'Kategori diarsipkan.' : 'Kategori diaktifkan.');
    notifyChanged();
  }

  return (
    <Page narrow>
      <PageHeader
        title="Kategori"
        description="Kategori mengelompokkan transaksi untuk laporan."
        actions={
          <button
            type="button"
            className="btn-primary"
            onClick={() => setDrawer({ open: true, category: null })}
          >
            Tambah kategori
          </button>
        }
      />
      <PillTabs label="Jenis kategori" options={TYPE_TABS} value={type} onChange={setType} />
      <div className="mt-4">
        <Loaded state={state}>
          {() => {
            const items = all.filter((category) => category.type === type);
            const top = items.filter((category) => !category.parent_id);
            const ordered = top.flatMap((parent) => [
              parent,
              ...items.filter((c) => c.parent_id === parent.id),
            ]);
            return (
              <RowList>
                {ordered.map((category) => (
                  <Row
                    key={category.id}
                    title={category.parent_id ? `↳ ${category.name}` : category.name}
                    subtitle={[
                      category.cash_activity !== 'operating'
                        ? CASH_ACTIVITIES[category.cash_activity]
                        : category.pl_group && PL_GROUPS[category.pl_group],
                      `${category.usage_count} transaksi`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    badge={category.is_archived ? <Badge>Arsip</Badge> : undefined}
                    onClick={() => setDrawer({ open: true, category })}
                  />
                ))}
              </RowList>
            );
          }}
        </Loaded>
      </div>
      <CategoryDrawer
        open={drawer.open}
        category={drawer.category}
        type={type}
        parents={parents}
        onClose={() => setDrawer({ open: false, category: null })}
        onArchive={() => {
          if (drawer.category.is_archived) setArchived(drawer.category, false);
          else setConfirming({ kind: 'archive', category: drawer.category });
          setDrawer({ open: false, category: null });
        }}
        onDelete={() => {
          setConfirming({ kind: 'delete', category: drawer.category });
          setDrawer({ open: false, category: null });
        }}
      />
      <ConfirmDialog
        open={Boolean(confirming)}
        onClose={() => setConfirming(null)}
        title={confirming?.kind === 'delete' ? 'Hapus kategori ini?' : 'Arsipkan kategori ini?'}
        body={
          confirming?.kind === 'delete'
            ? 'Kategori yang sudah dipakai tidak bisa dihapus, hanya diarsipkan.'
            : 'Kategori hilang dari pilihan. Riwayat transaksinya tetap ada.'
        }
        confirmLabel={confirming?.kind === 'delete' ? 'Hapus kategori' : 'Arsipkan'}
        onConfirm={async () => {
          if (confirming.kind === 'delete') {
            await api.del(`/categories/${confirming.category.id}`);
            toast.show('Kategori dihapus.');
            notifyChanged();
          } else {
            await setArchived(confirming.category, true);
          }
        }}
      />
    </Page>
  );
}

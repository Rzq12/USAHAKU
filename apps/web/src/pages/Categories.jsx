import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { usePermissions } from '../lib/auth.jsx';
import { notifyChanged, useDebounced, useFetch, useSubmit } from '../lib/hooks.js';
import { CASH_ACTIVITIES, PL_GROUPS } from '../lib/format.js';
import { Page } from '../components/Layout.jsx';
import { ConfirmDialog, Drawer } from '../components/Drawer.jsx';
import { useToast } from '../components/Toast.jsx';
import {
  Badge,
  CategoryOptions,
  EmptyState,
  FormError,
  ListSkeleton,
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
              : 'Hanya tampil di arus kas. Tidak dihitung sebagai laba, beban, atau omzet pajak.'
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

function RuleDrawer({ open, onClose, rule, categories }) {
  const [form, setForm] = useState({ keyword: '', category_id: '', priority: 10 });
  useEffect(() => {
    if (open)
      setForm(
        rule
          ? { keyword: rule.keyword, category_id: rule.category_id, priority: rule.priority }
          : { keyword: '', category_id: '', priority: 10 },
      );
  }, [open, rule]);
  const action = useCallback(() => {
    const payload = { ...form, priority: Number(form.priority) };
    return rule
      ? api.put(`/category-rules/${rule.id}`, payload)
      : api.post('/category-rules', payload);
  }, [form, rule]);
  const { submit, pending, fieldErrors, formError } = useSubmit(action, {
    success: 'Aturan disimpan.',
    onDone: () => {
      notifyChanged();
      onClose();
    },
  });
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={rule ? 'Ubah aturan' : 'Tambah aturan'}
      footer={
        <button type="button" className="btn-primary" disabled={pending} onClick={() => submit()}>
          {pending ? 'Menyimpan...' : 'Simpan aturan'}
        </button>
      }
    >
      <div className="space-y-4">
        <TextField
          label="Jika catatan mengandung"
          placeholder="listrik"
          value={form.keyword}
          maxLength={50}
          onChange={(e) => setForm({ ...form, keyword: e.target.value })}
          error={fieldErrors.keyword}
        />
        <SelectField
          label="Pakai kategori"
          value={form.category_id}
          onChange={(e) => setForm({ ...form, category_id: e.target.value })}
          error={fieldErrors.category_id}
        >
          <CategoryOptions categories={categories} />
        </SelectField>
        <TextField
          label="Prioritas (1 sampai 100)"
          hint="Angka lebih tinggi menang jika beberapa aturan cocok."
          type="number"
          min={1}
          max={100}
          value={form.priority}
          onChange={(e) => setForm({ ...form, priority: e.target.value })}
          error={fieldErrors.priority}
        />
        <FormError message={formError} />
      </div>
    </Drawer>
  );
}

function RuleTester() {
  const [note, setNote] = useState('');
  const debounced = useDebounced(note);
  const [result, setResult] = useState(null);
  useEffect(() => {
    if (debounced.trim().length < 2) {
      setResult(null);
      return undefined;
    }
    let cancelled = false;
    api
      .post('/category-rules/test', { note: debounced })
      .then((match) => !cancelled && setResult(match))
      .catch(() => !cancelled && setResult(null));
    return () => {
      cancelled = true;
    };
  }, [debounced]);
  return (
    <div className="mb-4 rounded-lg bg-surface p-4">
      <TextField
        label="Coba catatan"
        placeholder="bayar listrik toko"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {result && (
        <p aria-live="polite" className="mt-2 text-body-sm text-charcoal">
          {result.matched_category ? (
            <>
              Masuk ke kategori <strong>{result.category_name}</strong>.
            </>
          ) : (
            'Tidak ada aturan yang cocok.'
          )}
        </p>
      )}
    </div>
  );
}

function RulesSection({ categories, isOwner }) {
  const toast = useToast();
  const state = useFetch('/category-rules');
  const [drawer, setDrawer] = useState({ open: false, rule: null });
  const [deleting, setDeleting] = useState(null);
  return (
    <section className="mt-10" aria-labelledby="rules-heading">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="rules-heading" className="text-h5">
            Aturan otomatis
          </h2>
          <p className="text-body-sm text-slate">Kategori terisi sendiri dari kata di catatan.</p>
        </div>
        {isOwner && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setDrawer({ open: true, rule: null })}
          >
            Tambah aturan
          </button>
        )}
      </div>
      {isOwner && <RuleTester />}
      <Loaded state={state} skeleton={<ListSkeleton rows={2} />}>
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState
              compact
              title="Belum ada aturan"
              body="Contoh: catatan berisi listrik masuk ke Listrik dan Utilitas."
            />
          ) : (
            <RowList>
              {data.items.map((rule) => (
                <li
                  key={rule.id}
                  className="flex min-h-[56px] flex-wrap items-center justify-between gap-2 px-4 py-2"
                >
                  <div className="min-w-0">
                    <p className="break-words font-medium">{rule.keyword}</p>
                    <p className="text-caption text-slate">
                      {rule.category_name} · prioritas {rule.priority}
                    </p>
                  </div>
                  {isOwner && (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => setDrawer({ open: true, rule })}
                      >
                        Ubah
                      </button>
                      <button
                        type="button"
                        className="btn-ghost text-danger-deep"
                        onClick={() => setDeleting(rule)}
                      >
                        Hapus
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </RowList>
          )
        }
      </Loaded>
      <RuleDrawer
        open={drawer.open}
        rule={drawer.rule}
        categories={categories}
        onClose={() => setDrawer({ open: false, rule: null })}
      />
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Hapus aturan ini?"
        body={deleting ? `Catatan berisi "${deleting.keyword}" tidak lagi terisi otomatis.` : ''}
        confirmLabel="Hapus aturan"
        onConfirm={async () => {
          await api.del(`/category-rules/${deleting.id}`);
          toast.show('Aturan dihapus.');
          notifyChanged();
        }}
      />
    </section>
  );
}

export default function Categories() {
  const toast = useToast();
  const { isOwner, canSeeFinancials } = usePermissions();
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
        title="Kategori dan Aturan"
        description="Kategori mengelompokkan transaksi untuk laporan dan anggaran."
        actions={
          isOwner && (
            <button
              type="button"
              className="btn-primary"
              onClick={() => setDrawer({ open: true, category: null })}
            >
              Tambah kategori
            </button>
          )
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
                    onClick={isOwner ? () => setDrawer({ open: true, category }) : undefined}
                  />
                ))}
              </RowList>
            );
          }}
        </Loaded>
      </div>
      {canSeeFinancials && <RulesSection categories={state.data} isOwner={isOwner} />}
      {isOwner && (
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
      )}
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

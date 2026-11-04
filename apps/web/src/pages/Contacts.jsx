import { useCallback, useEffect, useState } from 'react';
import { api, query } from '../lib/api.js';
import { usePermissions } from '../lib/auth.jsx';
import { notifyChanged, useDebounced, useFetch, useSubmit } from '../lib/hooks.js';
import { CONTACT_TYPES, rupiah } from '../lib/format.js';
import { Page } from '../components/Layout.jsx';
import { ConfirmDialog, Drawer } from '../components/Drawer.jsx';
import { useToast } from '../components/Toast.jsx';
import {
  Badge,
  EmptyState,
  FormError,
  Loaded,
  PageHeader,
  Pagination,
  PillTabs,
  Row,
  RowList,
  SearchInput,
  SelectField,
  TextAreaField,
  TextField,
} from '../components/ui.jsx';

const EMPTY = { name: '', type: 'customer', phone: '', email: '', address: '', notes: '' };
const TYPE_FILTERS = [
  { value: '', label: 'Semua' },
  { value: 'customer', label: 'Pelanggan' },
  { value: 'supplier', label: 'Pemasok' },
];

function ContactDrawer({ open, onClose, contact, onArchive }) {
  const { isOwner } = usePermissions();
  const [form, setForm] = useState(EMPTY);
  useEffect(() => {
    if (open)
      setForm(
        contact
          ? {
              ...EMPTY,
              ...contact,
              phone: contact.phone ?? '',
              email: contact.email ?? '',
              address: contact.address ?? '',
              notes: contact.notes ?? '',
            }
          : EMPTY,
      );
  }, [open, contact]);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const action = useCallback(() => {
    const { name, type, phone, email, address, notes } = form;
    const payload = { name, type, phone, email, address, notes };
    return contact ? api.put(`/contacts/${contact.id}`, payload) : api.post('/contacts', payload);
  }, [form, contact]);
  const { submit, pending, fieldErrors, formError } = useSubmit(action, {
    success: 'Kontak disimpan.',
    onDone: () => {
      notifyChanged();
      onClose();
    },
  });
  const readOnly = contact && !isOwner;
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={contact ? contact.name : 'Tambah kontak'}
      footer={
        !readOnly && (
          <>
            {contact && !contact.is_archived && (
              <button type="button" className="btn-ghost mr-auto" onClick={onArchive}>
                Arsipkan
              </button>
            )}
            <button
              type="button"
              className="btn-primary"
              disabled={pending}
              onClick={() => submit()}
            >
              {pending ? 'Menyimpan...' : 'Simpan kontak'}
            </button>
          </>
        )
      }
    >
      <fieldset disabled={readOnly} className="space-y-4">
        <TextField
          label="Nama"
          value={form.name}
          maxLength={120}
          onChange={set('name')}
          error={fieldErrors.name}
        />
        <SelectField
          label="Jenis"
          value={form.type}
          onChange={set('type')}
          error={fieldErrors.type}
        >
          {Object.entries(CONTACT_TYPES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectField>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Telepon"
            inputMode="tel"
            value={form.phone}
            onChange={set('phone')}
            error={fieldErrors.phone}
          />
          <TextField
            label="Email"
            type="email"
            value={form.email}
            onChange={set('email')}
            error={fieldErrors.email}
          />
        </div>
        <TextAreaField
          label="Alamat"
          rows={2}
          value={form.address}
          onChange={set('address')}
          error={fieldErrors.address}
        />
        <TextAreaField
          label="Catatan"
          rows={2}
          value={form.notes}
          onChange={set('notes')}
          error={fieldErrors.notes}
        />
        <FormError message={formError} />
      </fieldset>
    </Drawer>
  );
}

export default function Contacts() {
  const toast = useToast();
  const { canRecord, isStaff, isOwner } = usePermissions();
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [showArchived, setShowArchived] = useState(false);
  const [drawer, setDrawer] = useState({ open: false, contact: null });
  const [archiving, setArchiving] = useState(null);
  const q = useDebounced(search);
  const state = useFetch(
    `/contacts${query({ q, type, page, include_archived: showArchived ? 'true' : '' })}`,
  );

  return (
    <Page>
      <PageHeader
        title="Kontak"
        description="Pelanggan dan pemasok, dengan sisa tagihannya."
        actions={
          canRecord && (
            <button
              type="button"
              className="btn-primary"
              onClick={() => setDrawer({ open: true, contact: null })}
            >
              Tambah kontak
            </button>
          )
        }
      />
      <div className="space-y-3">
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          placeholder="Cari nama atau telepon"
          label="Cari kontak"
        />
        <div className="flex flex-wrap items-center gap-2">
          <PillTabs
            label="Jenis kontak"
            options={TYPE_FILTERS}
            value={type}
            onChange={(value) => {
              setType(value);
              setPage(1);
            }}
          />
          {isOwner && (
            <button
              type="button"
              className="pill-tab"
              aria-pressed={showArchived}
              onClick={() => setShowArchived(!showArchived)}
            >
              Tampilkan arsip
            </button>
          )}
        </div>
      </div>
      <div className="mt-4">
        <Loaded state={state}>
          {(data) =>
            data.items.length === 0 ? (
              <EmptyState
                title={q || type ? 'Tidak ada kontak yang cocok' : 'Belum ada kontak'}
                body={
                  q || type
                    ? 'Coba ubah pencarian.'
                    : 'Penjualan kredit dan tagihan pemasok membutuhkan kontak.'
                }
                action={
                  canRecord && !q && !type ? (
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => setDrawer({ open: true, contact: null })}
                    >
                      Tambah kontak pertama
                    </button>
                  ) : undefined
                }
              />
            ) : (
              <>
                <RowList>
                  {data.items.map((contact) => (
                    <Row
                      key={contact.id}
                      title={contact.name}
                      subtitle={[CONTACT_TYPES[contact.type], contact.phone]
                        .filter(Boolean)
                        .join(' · ')}
                      badge={contact.is_archived ? <Badge>Arsip</Badge> : undefined}
                      right={
                        contact.receivable_balance > 0
                          ? rupiah(contact.receivable_balance)
                          : undefined
                      }
                      rightSub={
                        contact.receivable_balance > 0
                          ? 'piutang'
                          : !isStaff && contact.payable_balance > 0
                            ? `hutang ${rupiah(contact.payable_balance)}`
                            : undefined
                      }
                      onClick={() => setDrawer({ open: true, contact })}
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
      <ContactDrawer
        open={drawer.open}
        contact={drawer.contact}
        onClose={() => setDrawer({ open: false, contact: null })}
        onArchive={() => {
          setArchiving(drawer.contact);
          setDrawer({ open: false, contact: null });
        }}
      />
      <ConfirmDialog
        open={Boolean(archiving)}
        onClose={() => setArchiving(null)}
        title="Arsipkan kontak ini?"
        body={archiving ? `${archiving.name} hilang dari pilihan. Riwayatnya tetap ada.` : ''}
        confirmLabel="Arsipkan"
        onConfirm={async () => {
          await api.put(`/contacts/${archiving.id}`, { is_archived: true });
          toast.show('Kontak diarsipkan.');
          notifyChanged();
        }}
      />
    </Page>
  );
}

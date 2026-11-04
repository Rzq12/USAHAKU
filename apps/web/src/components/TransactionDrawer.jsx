import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { notifyChanged, useDebounced, useSubmit } from '../lib/hooks.js';
import { compressReceipt } from '../lib/image.js';
import { rupiah, todayJakarta, TRANSACTION_TYPES } from '../lib/format.js';
import { usePermissions } from '../lib/auth.jsx';
import { useToast } from './Toast.jsx';
import { Drawer } from './Drawer.jsx';
import {
  AccountOptions,
  CategoryOptions,
  CheckField,
  FormError,
  MoneyField,
  PillTabs,
  SelectField,
  TextAreaField,
  TextField,
  useAccounts,
  useCategories,
} from './ui.jsx';

const TYPE_OPTIONS = Object.entries(TRANSACTION_TYPES).map(([value, label]) => ({ value, label }));
const PHOTO_FAILED = 'Foto gagal diunggah. Transaksi tetap tersimpan, coba unggah ulang.';

function emptyForm(type) {
  return {
    type,
    amount: null,
    occurred_on: todayJakarta(),
    account_id: '',
    transfer_account_id: '',
    category_id: '',
    note: '',
    tags: '',
    is_excluded: false,
  };
}

function formFromTransaction(transaction) {
  return {
    type: transaction.type,
    amount: transaction.amount,
    occurred_on: transaction.occurred_on,
    account_id: transaction.account_id,
    transfer_account_id: transaction.transfer_account_id ?? '',
    category_id: transaction.category_id ?? '',
    contact_id: transaction.contact_id,
    note: transaction.note ?? '',
    tags: transaction.tags.join(', '),
    is_excluded: transaction.is_excluded,
  };
}

function toPayload(form) {
  const payload = {
    amount: form.amount,
    occurred_on: form.occurred_on,
    account_id: form.account_id,
    transfer_account_id: form.transfer_account_id || null,
    category_id: form.category_id || null,
    contact_id: form.contact_id ?? null,
    note: form.note,
    tags: form.tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
  };
  return payload;
}

/** Add or edit one transaction. Keeps everything entered when the save or the photo fails. */
export function TransactionDrawer({ open, onClose, initialType = 'expense', transaction }) {
  const toast = useToast();
  const { canSeeFinancials } = usePermissions();
  const accounts = useAccounts();
  const categories = useCategories();
  const [form, setForm] = useState(() => emptyForm(initialType));
  const [receipt, setReceipt] = useState(null);
  const [pendingUpload, setPendingUpload] = useState(null);
  const [suggestion, setSuggestion] = useState(null);
  const categoryTouched = useRef(false);
  const isEdit = Boolean(transaction);
  const isSystem = isEdit && transaction.source_type !== 'manual';

  useEffect(() => {
    if (!open) return;
    setForm(transaction ? formFromTransaction(transaction) : emptyForm(initialType));
    setReceipt(null);
    setPendingUpload(null);
    setSuggestion(null);
    categoryTouched.current = Boolean(transaction);
  }, [open, transaction, initialType]);

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  const note = useDebounced(form.note, 350);
  const { type } = form;
  useEffect(() => {
    if (!open || isEdit || type === 'transfer' || note.trim().length < 2) {
      setSuggestion(null);
      return undefined;
    }
    let cancelled = false;
    api
      .post('/category-rules/test', { note, type })
      .then((match) => {
        if (cancelled) return;
        setSuggestion(match.matched_category ? match : null);
        if (match.matched_category && !categoryTouched.current) {
          setForm((current) => ({ ...current, category_id: match.matched_category }));
        }
      })
      .catch(() => setSuggestion(null));
    return () => {
      cancelled = true;
    };
  }, [note, type, open, isEdit]);

  const uploadReceipt = useCallback(
    async (transactionId, file) => {
      try {
        const compressed = await compressReceipt(file);
        const data = new FormData();
        data.append('receipt', compressed);
        await api.upload(`/transactions/${transactionId}/receipt`, data);
        setPendingUpload(null);
        return true;
      } catch {
        setPendingUpload({ transactionId, file });
        toast.show(PHOTO_FAILED, 'warning');
        return false;
      }
    },
    [toast],
  );

  const save = useCallback(async () => {
    const payload = toPayload(form);
    const result = isEdit
      ? await api.put(`/transactions/${transaction.id}`, {
          ...payload,
          is_excluded: form.is_excluded,
        })
      : await api.post('/transactions', { ...payload, type: form.type });
    return result;
  }, [form, isEdit, transaction]);

  const afterSave = useCallback(
    async (result) => {
      notifyChanged();
      if (receipt && !(await uploadReceipt(result.transaction.id, receipt))) return;
      notifyChanged();
      onClose();
    },
    [receipt, uploadReceipt, onClose],
  );

  const successMessage = useCallback(
    (result) =>
      result.account_balance !== undefined && canSeeFinancials
        ? `Transaksi disimpan. Saldo akun ${rupiah(result.account_balance)}.`
        : 'Transaksi disimpan.',
    [canSeeFinancials],
  );

  const { submit, pending, fieldErrors, formError } = useSubmit(save, {
    success: successMessage,
    onDone: afterSave,
  });

  async function retryUpload() {
    if (await uploadReceipt(pendingUpload.transactionId, pendingUpload.file)) {
      toast.show('Foto berhasil diunggah.');
      notifyChanged();
      onClose();
    }
  }

  const title = isEdit
    ? `Ubah ${TRANSACTION_TYPES[transaction.type].toLowerCase()}`
    : `Tambah ${TRANSACTION_TYPES[form.type].toLowerCase()}`;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={title}
      footer={
        pendingUpload ? (
          <>
            <button type="button" className="btn-secondary" onClick={onClose}>
              Lewati foto
            </button>
            <button type="button" className="btn-primary" onClick={retryUpload}>
              Unggah ulang foto
            </button>
          </>
        ) : (
          <button
            type="submit"
            form="transaction-form"
            className="btn-primary w-full sm:w-auto"
            disabled={pending}
          >
            {pending ? 'Menyimpan...' : 'Simpan transaksi'}
          </button>
        )
      }
    >
      <form
        id="transaction-form"
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {!isEdit && (
          <PillTabs
            label="Jenis transaksi"
            options={TYPE_OPTIONS}
            value={form.type}
            onChange={(value) => {
              categoryTouched.current = false;
              setForm((current) => ({
                ...current,
                type: value,
                category_id: '',
                transfer_account_id: '',
              }));
            }}
          />
        )}
        {isSystem && (
          <p className="rounded-md bg-surface px-3 py-2 text-caption text-slate">
            Transaksi ini dibuat otomatis. Nominal, akun, dan tanggalnya diubah dari catatan
            asalnya.
          </p>
        )}
        <MoneyField
          label="Nominal"
          large
          value={form.amount}
          onChange={(amount) => setForm((current) => ({ ...current, amount }))}
          error={fieldErrors.amount}
          disabled={isSystem}
          autoFocus={!isEdit}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Tanggal"
            type="date"
            value={form.occurred_on}
            onChange={set('occurred_on')}
            error={fieldErrors.occurred_on}
            disabled={isSystem}
          />
          <SelectField
            label={form.type === 'transfer' ? 'Dari akun' : 'Akun'}
            value={form.account_id}
            onChange={set('account_id')}
            error={fieldErrors.account_id}
            disabled={isSystem}
          >
            <AccountOptions accounts={accounts.data} />
          </SelectField>
        </div>
        {form.type === 'transfer' ? (
          <SelectField
            label="Ke akun"
            value={form.transfer_account_id}
            onChange={set('transfer_account_id')}
            error={fieldErrors.transfer_account_id}
          >
            <AccountOptions accounts={accounts.data} />
          </SelectField>
        ) : (
          <SelectField
            label="Kategori"
            value={form.category_id}
            onChange={(event) => {
              categoryTouched.current = true;
              set('category_id')(event);
            }}
            error={fieldErrors.category_id}
            hint={suggestion ? `Disarankan dari catatan: ${suggestion.category_name}` : undefined}
          >
            <CategoryOptions categories={categories.data} type={form.type} />
          </SelectField>
        )}
        <TextAreaField
          label="Catatan"
          rows={2}
          value={form.note}
          onChange={set('note')}
          error={fieldErrors.note}
          maxLength={500}
        />
        <TextField
          label="Tag"
          hint="Pisahkan dengan koma, paling banyak 10."
          value={form.tags}
          onChange={set('tags')}
          error={fieldErrors.tags}
        />
        <div>
          <label className="field-label" htmlFor="receipt-input">
            Foto struk
          </label>
          <input
            id="receipt-input"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="block min-h-[44px] w-full text-body-sm text-slate file:mr-3 file:min-h-[44px] file:cursor-pointer file:rounded-md file:border file:border-hairline-strong file:bg-white file:px-4 file:text-body-sm file:font-medium file:text-ink"
            onChange={(event) => setReceipt(event.target.files[0] ?? null)}
          />
          {pendingUpload && <FormError message={PHOTO_FAILED} />}
        </div>
        {isEdit && (
          <CheckField
            label="Kecualikan dari laporan"
            hint="Tetap tampil di daftar dan tetap memengaruhi saldo."
            checked={form.is_excluded}
            onChange={(event) =>
              setForm((current) => ({ ...current, is_excluded: event.target.checked }))
            }
          />
        )}
        <FormError message={formError} />
      </form>
    </Drawer>
  );
}

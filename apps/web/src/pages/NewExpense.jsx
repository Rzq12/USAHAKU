import { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { notifyChanged, useSubmit } from '../lib/hooks.js';
import { compressReceipt } from '../lib/image.js';
import { todayJakarta } from '../lib/format.js';
import {
  defaultAccountId,
  expenseCategories,
  expenseSaveHint,
  saveProblem,
} from '../lib/simpleForm.js';
import { Page } from '../components/Layout.jsx';
import {
  AccountOptions,
  FormError,
  MoneyField,
  PageHeader,
  SelectField,
  TextAreaField,
  TextField,
  useAccounts,
  useCategories,
} from '../components/ui.jsx';

const PHOTO_FAILED = 'Foto gagal diunggah. Pengeluaran tetap tersimpan.';
const OPTION_FIELDS = ['occurred_on', 'account_id', 'note'];

export default function NewExpense() {
  const navigate = useNavigate();
  const accounts = useAccounts();
  const categories = useCategories();
  const [amount, setAmount] = useState(null);
  const [categoryId, setCategoryId] = useState('');
  const [options, setOptions] = useState({
    occurred_on: todayJakarta(),
    account_id: '',
    note: '',
  });
  const [receipt, setReceipt] = useState(null);

  const accountId = options.account_id || defaultAccountId(accounts.data);
  const choices = expenseCategories(categories.data);
  const setOption = (key) => (event) => setOptions({ ...options, [key]: event.target.value });

  const save = useCallback(async () => {
    const result = await api.post('/transactions', {
      type: 'expense',
      amount,
      occurred_on: options.occurred_on,
      account_id: accountId,
      category_id: categoryId,
      contact_id: null,
      transfer_account_id: null,
      note: options.note,
      tags: [],
    });
    if (!receipt) return {};
    try {
      const data = new FormData();
      data.append('receipt', await compressReceipt(receipt));
      await api.upload(`/transactions/${result.transaction.id}/receipt`, data);
      return {};
    } catch {
      return { warning: PHOTO_FAILED };
    }
  }, [amount, options, accountId, categoryId, receipt]);

  const onDone = useCallback(
    ({ warning }) => {
      notifyChanged();
      navigate('/', {
        replace: true,
        state: { saved: { message: 'Pengeluaran tersimpan.', warning } },
      });
    },
    [navigate],
  );

  const { submit, pending, fieldErrors, formError } = useSubmit(save, { onDone });
  const hasOptionError = OPTION_FIELDS.some((field) => fieldErrors[field]);
  const hint = expenseSaveHint({ amount, categoryId });

  return (
    <Page narrow>
      <PageHeader
        title="Catat Pengeluaran"
        actions={
          <Link to="/" className="btn-ghost">
            Batal
          </Link>
        }
      />
      <form
        className="space-y-6"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <MoneyField
          label="Berapa uangnya?"
          large
          autoFocus
          value={amount}
          onChange={setAmount}
          error={fieldErrors.amount}
        />

        <fieldset>
          <legend className="field-label">Untuk apa?</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {choices.map((category) => (
              <button
                key={category.id}
                type="button"
                aria-pressed={categoryId === category.id}
                onClick={() => setCategoryId(category.id)}
                className="min-h-[64px] rounded-md border border-hairline-strong bg-white px-4 py-2 text-left text-body font-medium transition-colors duration-150 hover:border-primary aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-white"
              >
                {category.name}
              </button>
            ))}
          </div>
          {categories.data && choices.length === 0 && (
            <p className="rounded-md bg-surface px-4 py-3 text-body">
              Belum ada kategori pengeluaran. Buat dulu di Menu lain,{' '}
              <Link to="/kategori" className="link">
                Kategori
              </Link>
              .
            </p>
          )}
          {fieldErrors.category_id && <FormError message={fieldErrors.category_id} />}
          {categories.error && <FormError message={categories.error.message} />}
        </fieldset>

        {accounts.data && !accountId && (
          <p className="rounded-md bg-surface px-4 py-3 text-body">
            Belum ada akun kas. Buat dulu di Menu lain,{' '}
            <Link to="/akun" className="link">
              Akun Kas
            </Link>
            .
          </p>
        )}
        {accounts.error && <FormError message={accounts.error.message} />}

        <details open={hasOptionError} className="rounded-md border border-hairline">
          <summary className="flex min-h-[52px] cursor-pointer items-center px-4 text-body font-medium">
            Pilihan lain
          </summary>
          <div className="space-y-4 border-t border-hairline p-4">
            <TextField
              label="Tanggal"
              type="date"
              value={options.occurred_on}
              onChange={setOption('occurred_on')}
              error={fieldErrors.occurred_on}
            />
            <SelectField
              label="Uang keluar dari akun"
              value={accountId}
              onChange={setOption('account_id')}
              error={fieldErrors.account_id}
            >
              <AccountOptions accounts={accounts.data} />
            </SelectField>
            <TextAreaField
              label="Catatan"
              rows={2}
              maxLength={500}
              value={options.note}
              onChange={setOption('note')}
              error={fieldErrors.note}
            />
            <div>
              <label className="field-label" htmlFor="expense-receipt">
                Foto struk
              </label>
              <input
                id="expense-receipt"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="block min-h-[48px] w-full text-body-sm text-slate file:mr-3 file:min-h-[48px] file:cursor-pointer file:rounded-md file:border file:border-hairline-strong file:bg-white file:px-4 file:text-body-sm file:font-medium file:text-ink"
                onChange={(event) => setReceipt(event.target.files[0] ?? null)}
              />
            </div>
          </div>
        </details>

        <FormError message={saveProblem(formError, fieldErrors)} />
        {hint && <p className="text-body-sm text-slate">{hint}</p>}
        <button
          type="submit"
          className="btn-primary w-full"
          disabled={pending || !amount || !categoryId || !accountId}
        >
          {pending ? 'Menyimpan...' : 'Simpan'}
        </button>
      </form>
    </Page>
  );
}

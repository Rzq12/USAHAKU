import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useFetch, useSubmit } from '../lib/hooks.js';
import { Page } from '../components/Layout.jsx';
import {
  FormError,
  ListSkeleton,
  Loaded,
  PageHeader,
  TextAreaField,
  TextField,
} from '../components/ui.jsx';

function toForm(settings) {
  return {
    name: settings.name,
    address: settings.address ?? '',
    phone: settings.phone ?? '',
    period_start_day: settings.period_start_day,
  };
}

function SettingsForm({ settings }) {
  const { refresh } = useAuth();
  const [form, setForm] = useState(() => toForm(settings));
  useEffect(() => setForm(toForm(settings)), [settings]);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  const action = useCallback(
    () =>
      api.put('/business', {
        name: form.name,
        address: form.address,
        phone: form.phone,
        period_start_day: Number(form.period_start_day),
      }),
    [form],
  );
  const { submit, pending, fieldErrors, formError } = useSubmit(action, {
    success: 'Pengaturan disimpan.',
    onDone: refresh,
  });

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <TextField
        label="Nama usaha"
        value={form.name}
        maxLength={100}
        onChange={set('name')}
        error={fieldErrors.name}
      />
      <TextAreaField
        label="Alamat"
        rows={2}
        value={form.address}
        onChange={set('address')}
        error={fieldErrors.address}
      />
      <TextField
        label="Telepon"
        inputMode="tel"
        value={form.phone}
        onChange={set('phone')}
        error={fieldErrors.phone}
      />
      <div className="sm:max-w-xs">
        <TextField
          label="Tanggal awal periode laporan"
          hint="1 sampai 28. Mengubahnya tidak mengubah catatan tersimpan."
          type="number"
          min={1}
          max={28}
          value={form.period_start_day}
          onChange={set('period_start_day')}
          error={fieldErrors.period_start_day}
        />
      </div>
      <FormError message={formError} />
      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? 'Menyimpan...' : 'Simpan pengaturan'}
      </button>
    </form>
  );
}

export default function Settings() {
  const state = useFetch('/business');
  return (
    <Page narrow>
      <PageHeader title="Pengaturan" description="Data usaha dan periode laporan." />
      <Loaded state={state} skeleton={<ListSkeleton rows={4} />}>
        {(settings) => <SettingsForm settings={settings} />}
      </Loaded>
    </Page>
  );
}

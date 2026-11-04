import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth, usePermissions } from '../lib/auth.jsx';
import { useFetch, useSubmit } from '../lib/hooks.js';
import { Page } from '../components/Layout.jsx';
import {
  FormError,
  ListSkeleton,
  Loaded,
  MoneyField,
  PageHeader,
  SelectField,
  TextAreaField,
  TextField,
} from '../components/ui.jsx';

function SettingsForm({ settings }) {
  const { refresh } = useAuth();
  const { isOwner } = usePermissions();
  const [form, setForm] = useState({
    ...settings,
    address: settings.address ?? '',
    phone: settings.phone ?? '',
    npwp: settings.npwp ?? '',
    payment_info: settings.payment_info ?? '',
    taxpayer_type: settings.taxpayer_type ?? '',
    tax_rate: String(settings.tax_rate),
  });
  useEffect(() => {
    setForm((current) => ({
      ...current,
      ...settings,
      address: settings.address ?? '',
      phone: settings.phone ?? '',
      npwp: settings.npwp ?? '',
      payment_info: settings.payment_info ?? '',
      taxpayer_type: settings.taxpayer_type ?? '',
      tax_rate: String(settings.tax_rate),
    }));
  }, [settings]);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  const action = useCallback(
    () =>
      api.put('/business', {
        name: form.name,
        address: form.address,
        phone: form.phone,
        npwp: form.npwp,
        taxpayer_type: form.taxpayer_type || undefined,
        period_start_day: Number(form.period_start_day),
        tax_rate: Number(String(form.tax_rate).replace(',', '.')),
        tax_threshold: form.tax_threshold ?? 0,
        payment_info: form.payment_info,
      }),
    [form],
  );
  const { submit, pending, fieldErrors, formError } = useSubmit(action, {
    success: 'Pengaturan usaha disimpan.',
    onDone: refresh,
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <fieldset disabled={!isOwner} className="space-y-8">
        <section className="space-y-4" aria-labelledby="profile-heading">
          <h2 id="profile-heading" className="text-h5">
            Profil usaha
          </h2>
          <TextField
            label="Nama usaha"
            value={form.name}
            maxLength={100}
            onChange={set('name')}
            error={fieldErrors.name}
          />
          <TextAreaField
            label="Alamat"
            hint="Tercetak di faktur. Wajib untuk membuat faktur."
            rows={2}
            value={form.address}
            onChange={set('address')}
            error={fieldErrors.address}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Telepon"
              inputMode="tel"
              value={form.phone}
              onChange={set('phone')}
              error={fieldErrors.phone}
            />
            <TextField
              label="NPWP (boleh kosong)"
              value={form.npwp}
              onChange={set('npwp')}
              error={fieldErrors.npwp}
            />
          </div>
          <TextAreaField
            label="Info pembayaran di faktur"
            hint="Misalnya nama bank dan nomor rekening."
            rows={2}
            value={form.payment_info}
            onChange={set('payment_info')}
            error={fieldErrors.payment_info}
          />
        </section>

        <section className="space-y-4" aria-labelledby="period-heading">
          <h2 id="period-heading" className="text-h5">
            Periode laporan
          </h2>
          <div className="sm:max-w-xs">
            <TextField
              label="Tanggal awal periode"
              hint="1 sampai 28. Mengubahnya tidak mengubah transaksi tersimpan."
              type="number"
              min={1}
              max={28}
              value={form.period_start_day}
              onChange={set('period_start_day')}
              error={fieldErrors.period_start_day}
            />
          </div>
        </section>

        <section className="space-y-4" aria-labelledby="tax-heading">
          <h2 id="tax-heading" className="text-h5">
            Pajak
          </h2>
          <p className="max-w-[65ch] text-body-sm text-slate">
            Nilai bawaan mengikuti pemahaman atas PP 55/2022. Konfirmasikan tarif dan batas terbaru
            dengan konsultan pajak.
          </p>
          <SelectField
            label="Jenis wajib pajak"
            value={form.taxpayer_type}
            onChange={set('taxpayer_type')}
            error={fieldErrors.taxpayer_type}
          >
            <option value="">Pilih jenis</option>
            <option value="individual">Orang pribadi</option>
            <option value="company">Badan usaha</option>
          </SelectField>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Tarif pajak (persen)"
              inputMode="decimal"
              value={form.tax_rate}
              onChange={set('tax_rate')}
              error={fieldErrors.tax_rate}
            />
            <MoneyField
              label="Omzet tanpa pajak per tahun"
              hint="Berlaku untuk orang pribadi."
              value={form.tax_threshold}
              onChange={(tax_threshold) => setForm({ ...form, tax_threshold })}
              error={fieldErrors.tax_threshold}
            />
          </div>
        </section>
      </fieldset>
      <FormError message={formError} />
      {isOwner && (
        <button type="submit" className="btn-primary mt-6" disabled={pending}>
          {pending ? 'Menyimpan...' : 'Simpan pengaturan'}
        </button>
      )}
    </form>
  );
}

export default function Settings() {
  const { isOwner } = usePermissions();
  const state = useFetch('/business');
  return (
    <Page narrow>
      <PageHeader
        title="Pengaturan Usaha"
        description={
          isOwner
            ? 'Berlaku untuk laporan, anggaran, faktur, dan perkiraan pajak.'
            : 'Hanya pemilik yang dapat mengubah pengaturan.'
        }
      />
      <Loaded state={state} skeleton={<ListSkeleton rows={4} />}>
        {(settings) => <SettingsForm settings={settings} />}
      </Loaded>
    </Page>
  );
}

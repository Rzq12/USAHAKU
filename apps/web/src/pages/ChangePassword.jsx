import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useSubmit } from '../lib/hooks.js';
import { FormError, TextField } from '../components/ui.jsx';

export function ChangePassword({ forced = false }) {
  const { refresh, logout } = useAuth();
  const [form, setForm] = useState({ current_password: '', new_password: '' });
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const action = useCallback(() => api.post('/auth/change-password', form), [form]);
  const { submit, pending, fieldErrors, formError } = useSubmit(action, {
    success: (result) => result.message,
    onDone: refresh,
  });

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <p className="text-h5 tracking-[-0.02em]">usahaku</p>
      <h1 className="mt-6 text-h3">{forced ? 'Buat kata sandi baru' : 'Ganti kata sandi'}</h1>
      <p className="mt-1 text-body-sm text-slate">
        {forced
          ? 'Anda masuk dengan kata sandi sementara. Buat kata sandi sendiri untuk melanjutkan.'
          : 'Sesi Anda di perangkat lain akan berakhir.'}
      </p>
      <form
        className="mt-6 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <TextField
          label={forced ? 'Kata sandi sementara' : 'Kata sandi saat ini'}
          type="password"
          required
          autoComplete="current-password"
          value={form.current_password}
          onChange={set('current_password')}
          error={fieldErrors.current_password}
        />
        <TextField
          label="Kata sandi baru"
          type="password"
          required
          autoComplete="new-password"
          hint="Minimal 8 karakter, tidak sama dengan email."
          value={form.new_password}
          onChange={set('new_password')}
          error={fieldErrors.new_password ?? fieldErrors.password}
        />
        <FormError message={formError} />
        <button type="submit" className="btn-primary w-full" disabled={pending}>
          {pending ? 'Menyimpan...' : 'Simpan kata sandi'}
        </button>
      </form>
      {forced ? (
        <button type="button" className="btn-ghost mt-3" onClick={logout}>
          Keluar
        </button>
      ) : (
        <Link to="/" className="btn-ghost mt-3">
          Kembali ke beranda
        </Link>
      )}
    </div>
  );
}

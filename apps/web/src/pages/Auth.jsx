import { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useSubmit } from '../lib/hooks.js';
import { NavyBand } from '../components/NavyBand.jsx';
import { FormError, TextField } from '../components/ui.jsx';

function AuthShell({ heading, lead, children, footer }) {
  return (
    <div className="flex min-h-dvh flex-col bg-white">
      <NavyBand className="px-4 pb-44 pt-10 text-center sm:pb-52 sm:pt-16">
        <p className="text-h5 tracking-[-0.02em]">usahaku</p>
        <h1 className="mx-auto mt-6 max-w-2xl text-[32px] font-semibold leading-[1.15] tracking-[-0.02em] sm:text-[44px]">
          {heading}
        </h1>
        <p className="mx-auto mt-3 max-w-lg text-body text-ondark-muted">{lead}</p>
      </NavyBand>
      <div className="relative z-10 mx-auto -mt-36 w-full max-w-md flex-1 px-4 pb-10 sm:-mt-44">
        <div className="rounded-lg border border-hairline bg-white p-6 shadow-mockup sm:p-8">
          {children}
        </div>
        <p className="mt-5 text-center text-body-sm text-slate">{footer}</p>
      </div>
    </div>
  );
}

export function Login() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const action = useCallback(() => api.post('/auth/login', form), [form]);
  const onDone = useCallback(async () => {
    await refresh();
    navigate('/');
  }, [refresh, navigate]);
  const { submit, pending, fieldErrors, formError } = useSubmit(action, { onDone });

  return (
    <AuthShell
      heading="Tahu laba usaha Anda hari ini"
      lead="Masuk untuk mencatat penjualan dan pengeluaran, lalu melihat laba sebenarnya."
      footer={
        <>
          Belum punya akun?{' '}
          <Link to="/daftar" className="link">
            Daftarkan usaha Anda
          </Link>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          required
          placeholder="email@contoh.id"
          value={form.email}
          onChange={set('email')}
          error={fieldErrors.email}
        />
        <TextField
          label="Kata sandi"
          type="password"
          autoComplete="current-password"
          required
          value={form.password}
          onChange={set('password')}
          error={fieldErrors.password}
        />
        <FormError message={formError} />
        <button type="submit" className="btn-primary w-full" disabled={pending}>
          {pending ? 'Memeriksa...' : 'Masuk'}
        </button>
      </form>
    </AuthShell>
  );
}

export function Register() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ business_name: '', name: '', email: '', password: '' });
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const action = useCallback(() => api.post('/auth/register', form), [form]);
  const onDone = useCallback(async () => {
    await refresh();
    navigate('/');
  }, [refresh, navigate]);
  const { submit, pending, fieldErrors, formError } = useSubmit(action, {
    success: (result) => result.message,
    onDone,
  });

  return (
    <AuthShell
      heading="Pisahkan uang usaha dari catatan di kepala"
      lead="Daftarkan usaha Anda. Akun Kas, Bank, dan kategori dasar langsung tersedia."
      footer={
        <>
          Sudah punya akun?{' '}
          <Link to="/masuk" className="link">
            Masuk
          </Link>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <TextField
          label="Nama usaha"
          required
          autoComplete="organization"
          placeholder="Nama toko atau usaha Anda"
          value={form.business_name}
          onChange={set('business_name')}
          error={fieldErrors.business_name}
        />
        <TextField
          label="Nama Anda"
          required
          autoComplete="name"
          placeholder="Nama lengkap"
          value={form.name}
          onChange={set('name')}
          error={fieldErrors.name}
        />
        <TextField
          label="Email"
          type="email"
          required
          autoComplete="email"
          placeholder="email@contoh.id"
          value={form.email}
          onChange={set('email')}
          error={fieldErrors.email}
        />
        <TextField
          label="Kata sandi"
          type="password"
          required
          autoComplete="new-password"
          hint="Minimal 8 karakter."
          value={form.password}
          onChange={set('password')}
          error={fieldErrors.password}
        />
        <FormError message={formError} />
        <button type="submit" className="btn-primary w-full" disabled={pending}>
          {pending ? 'Mendaftarkan...' : 'Daftarkan usaha'}
        </button>
      </form>
    </AuthShell>
  );
}

import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useFetch } from '../lib/hooks.js';
import { rupiah } from '../lib/format.js';
import { Icon } from '../components/Icon.jsx';
import { NavyBand } from '../components/NavyBand.jsx';

const BIG_ACTION = 'min-h-[72px] w-full justify-start gap-4 px-6 text-h5';

function SavedNotice({ saved }) {
  return (
    <div role="status" className="mb-6 rounded-lg bg-tint-mint px-5 py-4">
      <p className="text-h5">{saved.message}</p>
      {saved.warning && <p className="mt-1 text-body">{saved.warning}</p>}
    </div>
  );
}

function TodayProfit({ state }) {
  if (state.error) {
    return (
      <div role="alert" className="mt-2">
        <p className="text-body text-white">{state.error.message}</p>
        <button type="button" className="btn-on-dark mt-3" onClick={state.reload}>
          Coba lagi
        </button>
      </div>
    );
  }
  if (!state.data) {
    return <p className="mt-2 text-h4 text-ondark-muted">Memuat...</p>;
  }
  const { today_profit: profit, is_empty: isEmpty } = state.data;
  return (
    <>
      <p className={`num mt-2 break-words text-h1 ${profit < 0 ? 'text-tint-rose' : 'text-white'}`}>
        {rupiah(profit)}
      </p>
      {isEmpty && (
        <p className="mt-3 text-body text-white">
          Belum ada catatan hari ini. Mulai dengan mencatat penjualan pertama.
        </p>
      )}
    </>
  );
}

export default function Home() {
  const location = useLocation();
  const navigate = useNavigate();
  const [saved] = useState(location.state?.saved ?? null);
  const state = useFetch('/dashboard');

  // Keeps the notice on screen but stops it coming back after a reload.
  useEffect(() => {
    if (location.state?.saved) navigate('.', { replace: true, state: null });
  }, [location.state, navigate]);

  return (
    <>
      <NavyBand className="px-4 py-10 text-center">
        <h1 className="text-h5 text-white">Laba hari ini</h1>
        <TodayProfit state={state} />
      </NavyBand>
      <div className="mx-auto max-w-xl px-4 pt-6">
        {saved && <SavedNotice saved={saved} />}
        <div className="space-y-4">
          <Link to="/penjualan/baru" className={`btn-primary ${BIG_ACTION}`}>
            <Icon name="cart" size={28} /> Catat Penjualan
          </Link>
          <Link to="/pengeluaran/baru" className={`btn-secondary ${BIG_ACTION}`}>
            <Icon name="receipt" size={28} /> Catat Pengeluaran
          </Link>
          <Link to="/laporan" className={`btn-secondary ${BIG_ACTION}`}>
            <Icon name="chart" size={28} /> Laporan
          </Link>
        </div>
        <p className="mt-6 text-center">
          <Link to="/lainnya" className="link-tap text-body">
            Menu lain
          </Link>
        </p>
      </div>
    </>
  );
}

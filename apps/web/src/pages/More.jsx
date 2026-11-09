import { Link } from 'react-router-dom';
import { NAV_ITEMS, Page } from '../components/Layout.jsx';
import { Icon } from '../components/Icon.jsx';
import { useAuth } from '../lib/auth.jsx';

const ROW =
  'flex min-h-[60px] w-full items-center gap-3 px-4 text-left text-body hover:bg-surface-soft';

export default function More() {
  const { user, logout } = useAuth();
  return (
    <Page narrow>
      <div className="mb-5">
        <h1 className="text-h4">Menu lain</h1>
        <p className="text-body-sm text-slate">
          {user.name} · {user.email}
        </p>
      </div>
      <nav aria-label="Semua halaman">
        <ul className="card divide-y divide-hairline-soft overflow-hidden">
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <Link to={item.to} className={ROW}>
                <Icon name={item.icon} className="text-slate" />
                <span className="flex-1">{item.label}</span>
                <Icon name="chevron" size={18} className="text-steel" />
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <ul className="card mt-4 divide-y divide-hairline-soft overflow-hidden">
        <li>
          <Link to="/ganti-sandi" className={ROW}>
            <Icon name="settings" className="text-slate" />
            Ganti Kata Sandi
          </Link>
        </li>
        <li>
          <button type="button" className={ROW} onClick={logout}>
            <Icon name="logout" className="text-slate" />
            Keluar
          </button>
        </li>
      </ul>
    </Page>
  );
}

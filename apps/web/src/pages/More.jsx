import { Link } from 'react-router-dom';
import { navLabel, NAV_ITEMS, Page } from '../components/Layout.jsx';
import { Icon } from '../components/Icon.jsx';
import { useAuth, usePermissions } from '../lib/auth.jsx';
import { ROLE_NAMES } from '../lib/format.js';

const ROW =
  'flex min-h-[52px] w-full items-center gap-3 px-4 text-left text-body hover:bg-surface-soft';

export default function More() {
  const { user, logout } = useAuth();
  const { role } = usePermissions();
  const items = NAV_ITEMS.filter((item) => item.roles.includes(role));
  return (
    <Page narrow>
      <div className="mb-5">
        <h1 className="text-h4">{user.name}</h1>
        <p className="text-body-sm text-slate">
          {ROLE_NAMES[user.role]} · {user.email}
        </p>
      </div>
      <nav aria-label="Semua halaman">
        <ul className="card divide-y divide-hairline-soft overflow-hidden">
          {items.map((item) => (
            <li key={item.to}>
              <Link to={item.to} className={ROW}>
                <Icon name={item.icon} className="text-slate" />
                <span className="flex-1">{navLabel(item, role)}</span>
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
            Ganti kata sandi
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

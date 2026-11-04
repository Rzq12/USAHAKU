import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, usePermissions } from '../lib/auth.jsx';
import { ROLE_NAMES } from '../lib/format.js';
import { Icon } from './Icon.jsx';
import { Drawer } from './Drawer.jsx';
import { TransactionDrawer } from './TransactionDrawer.jsx';
import { ErrorBoundary } from './ErrorBoundary.jsx';

const OWNER = 'owner';
const STAFF = 'staff';
const ACCOUNTANT = 'accountant';
const ALL = [OWNER, STAFF, ACCOUNTANT];

export const NAV_ITEMS = [
  { to: '/', label: 'Beranda', icon: 'home', roles: ALL, end: true, primary: true },
  { to: '/transaksi', label: 'Transaksi', icon: 'swap', roles: ALL, primary: true },
  { to: '/penjualan', label: 'Penjualan', icon: 'cart', roles: ALL, primary: true },
  { to: '/produk', label: 'Produk', icon: 'box', roles: ALL, primary: true },
  {
    to: '/tagihan',
    label: 'Hutang dan Piutang',
    short: 'Tagihan',
    staffLabel: 'Piutang',
    icon: 'ledger',
    roles: ALL,
    primary: true,
  },
  { to: '/laporan', label: 'Laporan', icon: 'chart', roles: [OWNER, ACCOUNTANT], primary: true },
  { to: '/kontak', label: 'Kontak', icon: 'people', roles: ALL },
  { to: '/faktur', label: 'Faktur', icon: 'invoice', roles: ALL },
  { to: '/akun', label: 'Akun Kas dan Bank', icon: 'wallet', roles: ALL },
  { to: '/anggaran', label: 'Anggaran', icon: 'target', roles: [OWNER, ACCOUNTANT] },
  { to: '/berulang', label: 'Transaksi Berulang', icon: 'repeat', roles: [OWNER, ACCOUNTANT] },
  { to: '/pajak', label: 'Perkiraan Pajak', icon: 'percent', roles: [OWNER, ACCOUNTANT] },
  { to: '/kategori', label: 'Kategori dan Aturan', icon: 'tag', roles: ALL },
  { to: '/impor', label: 'Impor Data', icon: 'upload', roles: [OWNER] },
  { to: '/ekspor', label: 'Ekspor Data', icon: 'download', roles: [OWNER, ACCOUNTANT] },
  { to: '/audit', label: 'Log Aktivitas', icon: 'history', roles: [OWNER, ACCOUNTANT] },
  { to: '/pengaturan', label: 'Pengaturan Usaha', icon: 'settings', roles: [OWNER, ACCOUNTANT] },
  { to: '/pengguna', label: 'Pengguna', icon: 'people', roles: [OWNER] },
  { to: '/panduan', label: 'Panduan', icon: 'book', roles: ALL },
];

const MOBILE_TABS = {
  [OWNER]: ['/', '/transaksi', '/penjualan', '/tagihan'],
  [STAFF]: ['/', '/penjualan', '/produk', '/tagihan'],
  [ACCOUNTANT]: ['/', '/transaksi', '/laporan', '/tagihan'],
};

const AddContext = createContext(null);

export function useAdd() {
  return useContext(AddContext);
}

export function navLabel(item, role) {
  return role === STAFF && item.staffLabel ? item.staffLabel : item.label;
}

function useCloseOnOutside(onClose) {
  const ref = useRef(null);
  useEffect(() => {
    const onPointer = (event) => {
      if (!ref.current?.contains(event.target)) onClose();
    };
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  return ref;
}

function Popover({ button, children, align = 'right' }) {
  const [open, setOpen] = useState(false);
  const close = useMemo(() => () => setOpen(false), []);
  const ref = useCloseOnOutside(close);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  return (
    <div className="relative" ref={ref}>
      {button({ open, toggle: () => setOpen((value) => !value) })}
      {open && (
        <div
          className={`absolute top-full z-40 mt-2 w-64 rounded-lg border border-hairline bg-white py-1 shadow-modal ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {children(() => {
            ref.current.querySelector('button').focus();
            close();
          })}
        </div>
      )}
    </div>
  );
}

const menuItem =
  'flex min-h-[44px] w-full items-center gap-3 px-4 text-left text-body-sm text-charcoal hover:bg-surface aria-[current=page]:font-semibold aria-[current=page]:text-primary';

function AddMenu({ onPick, onClose }) {
  const options = [
    { key: 'sale', label: 'Penjualan', icon: 'cart' },
    { key: 'expense', label: 'Pengeluaran', icon: 'receipt' },
    { key: 'income', label: 'Pemasukan', icon: 'wallet' },
    { key: 'transfer', label: 'Transfer antar akun', icon: 'swap' },
  ];
  return options.map((option) => (
    <button
      key={option.key}
      type="button"
      className={menuItem}
      onClick={() => {
        onClose?.();
        onPick(option.key);
      }}
    >
      <Icon name={option.icon} />
      {option.label}
    </button>
  ));
}

function DesktopHeader({ onAdd }) {
  const { user, business, logout } = useAuth();
  const { canRecord, role } = usePermissions();
  const items = NAV_ITEMS.filter((item) => item.roles.includes(role));
  const primary = items.filter((item) => item.primary);
  const secondary = items.filter((item) => !item.primary);

  return (
    <header className="sticky top-0 z-30 hidden border-b border-hairline bg-white lg:block">
      <div className="mx-auto flex h-16 max-w-[1280px] items-center gap-6 px-8">
        <Link to="/" className="text-h5 tracking-[-0.02em] text-ink">
          usahaku
        </Link>
        <nav aria-label="Utama" className="flex min-w-0 flex-1 items-center gap-1">
          {primary.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `inline-flex min-h-[44px] items-center whitespace-nowrap rounded-sm px-3 text-body-sm font-medium hover:bg-surface ${
                  isActive ? 'bg-surface text-ink' : 'text-slate'
                }`
              }
            >
              {role === STAFF ? navLabel(item, role) : (item.short ?? item.label)}
            </NavLink>
          ))}
          <Popover
            align="left"
            button={({ open, toggle }) => (
              <button
                type="button"
                aria-expanded={open}
                onClick={toggle}
                className="inline-flex min-h-[44px] items-center gap-1 rounded-sm px-3 text-body-sm font-medium text-slate hover:bg-surface"
              >
                Lainnya <Icon name="down" size={16} />
              </button>
            )}
          >
            {() =>
              secondary.map((item) => (
                <NavLink key={item.to} to={item.to} className={menuItem}>
                  <Icon name={item.icon} />
                  {item.label}
                </NavLink>
              ))
            }
          </Popover>
        </nav>
        {canRecord && (
          <Popover
            button={({ open, toggle }) => (
              <button type="button" className="btn-primary" aria-expanded={open} onClick={toggle}>
                <Icon name="plus" size={18} /> Tambah
              </button>
            )}
          >
            {(close) => <AddMenu onPick={onAdd} onClose={close} />}
          </Popover>
        )}
        <Popover
          button={({ open, toggle }) => (
            <button
              type="button"
              aria-expanded={open}
              onClick={toggle}
              className="flex max-w-[180px] flex-col items-end rounded-sm px-2 py-1 text-right hover:bg-surface"
            >
              <span className="w-full truncate text-body-sm font-medium">{business.name}</span>
              <span className="w-full truncate text-caption text-slate">
                {ROLE_NAMES[user.role]}
              </span>
            </button>
          )}
        >
          {() => (
            <>
              <p className="border-b border-hairline px-4 py-2 text-caption text-slate">
                {user.name}
                <br />
                {user.email}
              </p>
              <Link to="/ganti-sandi" className={menuItem}>
                Ganti kata sandi
              </Link>
              <button type="button" className={menuItem} onClick={logout}>
                <Icon name="logout" /> Keluar
              </button>
            </>
          )}
        </Popover>
      </div>
    </header>
  );
}

function MobileHeader() {
  const { business } = useAuth();
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-hairline bg-white px-4 lg:hidden">
      <Link to="/" className="text-h5 tracking-[-0.02em]">
        usahaku
      </Link>
      <span className="truncate text-caption text-slate">{business.name}</span>
    </header>
  );
}

function BottomNav() {
  const { role } = usePermissions();
  const tabs = MOBILE_TABS[role].map((to) => NAV_ITEMS.find((item) => item.to === to));
  const tabClass = ({ isActive }) =>
    `flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
      isActive ? 'text-primary' : 'text-slate'
    }`;
  return (
    <nav
      aria-label="Utama"
      className="safe-bottom fixed inset-x-0 bottom-0 z-30 flex border-t border-hairline bg-white lg:hidden"
    >
      {tabs.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end} className={tabClass}>
          <Icon name={item.icon} size={22} />
          {role === STAFF ? navLabel(item, role) : (item.short ?? item.label)}
        </NavLink>
      ))}
      <NavLink to="/lainnya" className={tabClass}>
        <Icon name="more" size={22} />
        Lainnya
      </NavLink>
    </nav>
  );
}

export function Layout() {
  const navigate = useNavigate();
  const { canRecord } = usePermissions();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawer, setDrawer] = useState({ open: false, type: 'expense' });

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  const value = useMemo(
    () => ({
      addTransaction: (type) => setDrawer({ open: true, type }),
    }),
    [],
  );

  function pick(key) {
    setMenuOpen(false);
    if (key === 'sale') navigate('/penjualan/baru');
    else setDrawer({ open: true, type: key });
  }

  const onFormPage = location.pathname === '/penjualan/baru';

  return (
    <AddContext.Provider value={value}>
      <a
        href="#konten"
        className="sr-only z-50 rounded-md bg-white px-4 py-2 focus:not-sr-only focus:fixed focus:left-2 focus:top-2"
      >
        Lewati ke konten
      </a>
      <DesktopHeader onAdd={pick} />
      <MobileHeader />
      <main id="konten" className="pb-28 lg:pb-16">
        <ErrorBoundary key={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
      {canRecord && !onFormPage && (
        <button
          type="button"
          aria-label="Tambah catatan"
          onClick={() => setMenuOpen(true)}
          className="fixed bottom-[76px] right-4 z-30 flex h-14 w-14 items-center justify-center rounded-lg bg-primary text-white shadow-card hover:bg-primary-pressed lg:hidden"
          style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
        >
          <Icon name="plus" size={26} />
        </button>
      )}
      {!onFormPage && <BottomNav />}
      <Drawer open={menuOpen} onClose={() => setMenuOpen(false)} title="Tambah catatan">
        <div className="-mx-5 -my-2">
          <AddMenu onPick={pick} />
        </div>
      </Drawer>
      <TransactionDrawer
        open={drawer.open}
        initialType={drawer.type}
        onClose={() => setDrawer((current) => ({ ...current, open: false }))}
      />
    </AddContext.Provider>
  );
}

export function Page({ children, narrow = false }) {
  return (
    <div
      className={`mx-auto w-full px-4 pt-6 sm:px-6 lg:px-8 lg:pt-8 ${narrow ? 'max-w-3xl' : 'max-w-[1280px]'}`}
    >
      {children}
    </div>
  );
}

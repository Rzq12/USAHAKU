import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { Icon } from './Icon.jsx';
import { ErrorBoundary } from './ErrorBoundary.jsx';

const PRIMARY_NAV = [
  { to: '/', label: 'Beranda', end: true },
  { to: '/penjualan/baru', label: 'Penjualan' },
  { to: '/pengeluaran/baru', label: 'Pengeluaran' },
  { to: '/laporan', label: 'Laporan' },
  { to: '/lainnya', label: 'Menu lain' },
];

export const NAV_ITEMS = [
  { to: '/transaksi', label: 'Riwayat Transaksi', icon: 'swap' },
  { to: '/penjualan', label: 'Riwayat Penjualan', icon: 'cart' },
  { to: '/produk', label: 'Produk', icon: 'box' },
  { to: '/akun', label: 'Akun Kas', icon: 'wallet' },
  { to: '/kategori', label: 'Kategori', icon: 'tag' },
  { to: '/ekspor', label: 'Ekspor Data', icon: 'download' },
  { to: '/pengaturan', label: 'Pengaturan', icon: 'settings' },
  { to: '/panduan', label: 'Panduan', icon: 'book' },
];

/**
 * One shared block for the whole link row. It follows the hovered or
 * keyboard-focused link and fades out when neither is left. Coming back after
 * a fade, it appears in place instead of sliding in from the last link.
 */
function useGlideBlock() {
  const rowRef = useRef(null);
  const [block, setBlock] = useState({ x: 0, width: 0, visible: false, glide: false });

  function moveTo(element) {
    const row = rowRef.current.getBoundingClientRect();
    const target = element.getBoundingClientRect();
    setBlock((current) => ({
      x: target.left - row.left,
      width: target.width,
      visible: true,
      glide: current.visible,
    }));
  }

  function hide() {
    setBlock((current) => ({ ...current, visible: false }));
  }

  const handlers = {
    onPointerOver(event) {
      if (event.pointerType === 'touch') return;
      const target = event.target.closest('[data-glide]');
      if (target) moveTo(target);
    },
    onPointerLeave() {
      const focused = rowRef.current?.querySelector('[data-glide]:focus-visible');
      if (focused) moveTo(focused);
      else hide();
    },
    onFocus(event) {
      const target = event.target.closest('[data-glide]');
      if (target?.matches(':focus-visible')) moveTo(target);
    },
    onBlur(event) {
      if (!rowRef.current?.contains(event.relatedTarget) && !rowRef.current?.matches(':hover')) {
        hide();
      }
    },
  };

  return { rowRef, block, handlers };
}

/** Holds the semibold width open so the row does not shift when the current page changes. */
function NavText({ label, current }) {
  return (
    <span className="inline-grid justify-items-center">
      <span className={current ? 'font-semibold' : undefined}>{label}</span>
      <span className="invisible h-0 font-semibold">{label}</span>
    </span>
  );
}

function CurrentDot() {
  return (
    <span
      aria-hidden="true"
      className="absolute bottom-[3px] left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-primary"
    />
  );
}

const glideLink =
  'relative inline-flex min-h-[48px] items-center whitespace-nowrap rounded-md px-3 text-body-sm font-medium transition-colors duration-150 hover:text-ink';

function PrimaryNav() {
  const { rowRef, block, handlers } = useGlideBlock();

  return (
    <nav aria-label="Utama" className="flex min-w-0 justify-center">
      <div ref={rowRef} className="relative flex items-center gap-1" {...handlers}>
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute left-0 top-1/2 h-12 rounded-md bg-tint-gray duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] ${
            block.glide ? 'transition-[opacity,transform,width]' : 'transition-opacity'
          } ${block.visible ? 'opacity-100' : 'opacity-0'}`}
          style={{
            width: block.width,
            transform: `translate(${block.x}px, -50%)`,
          }}
        />
        {PRIMARY_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            data-glide
            className={({ isActive }) => `${glideLink} ${isActive ? 'text-ink' : 'text-slate'}`}
          >
            {({ isActive }) => (
              <>
                <NavText label={item.label} current={isActive} />
                {isActive && <CurrentDot />}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

function DesktopHeader() {
  const { business } = useAuth();

  return (
    <header className="sticky top-0 z-30 hidden border-b border-hairline bg-white lg:block">
      <div className="mx-auto grid h-16 max-w-[1280px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 px-8 xl:grid-cols-[1fr_auto_1fr] xl:gap-6">
        <Link to="/" className="justify-self-start text-h5 tracking-[-0.02em] text-ink">
          usahaku
        </Link>
        <PrimaryNav />
        <p
          title={business.name}
          className="max-w-[180px] justify-self-end truncate text-body-sm font-medium"
        >
          {business.name}
        </p>
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

export function Layout() {
  const location = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <>
      <a
        href="#konten"
        className="sr-only z-50 rounded-md bg-white px-4 py-2 focus:not-sr-only focus:fixed focus:left-2 focus:top-2"
      >
        Lewati ke konten
      </a>
      <DesktopHeader />
      <MobileHeader />
      {location.pathname !== '/' && (
        <Link to="/" className="btn-ghost mx-4 mt-2 sm:mx-6 lg:hidden">
          <Icon name="back" size={20} /> Kembali ke Beranda
        </Link>
      )}
      <main id="konten" className="pb-16">
        <ErrorBoundary key={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
    </>
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

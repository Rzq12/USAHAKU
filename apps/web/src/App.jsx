import { lazy, Suspense } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth.jsx';
import { ToastProvider } from './components/Toast.jsx';
import { Layout, Page } from './components/Layout.jsx';
import { EmptyState, ErrorState, ListSkeleton } from './components/ui.jsx';
import { Login, Register } from './pages/Auth.jsx';
import { ChangePassword } from './pages/ChangePassword.jsx';

const Home = lazy(() => import('./pages/Home.jsx'));
const Transactions = lazy(() => import('./pages/Transactions.jsx'));
const Sales = lazy(() => import('./pages/Sales.jsx'));
const NewSale = lazy(() => import('./pages/NewSale.jsx'));
const SaleDetail = lazy(() => import('./pages/SaleDetail.jsx'));
const NewExpense = lazy(() => import('./pages/NewExpense.jsx'));
const Products = lazy(() => import('./pages/Products.jsx'));
const Accounts = lazy(() => import('./pages/Accounts.jsx'));
const Reports = lazy(() => import('./pages/Reports.jsx'));
const Categories = lazy(() => import('./pages/Categories.jsx'));
const DataExport = lazy(() => import('./pages/DataExport.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const Guide = lazy(() => import('./pages/Guide.jsx'));
const More = lazy(() => import('./pages/More.jsx'));

function NotFound() {
  return (
    <Page narrow>
      <EmptyState
        title="Halaman tidak ditemukan"
        body="Alamat ini tidak ada di usahaku."
        action={
          <Link to="/" className="btn-primary">
            Kembali ke Beranda
          </Link>
        }
      />
    </Page>
  );
}

function SignedInRoutes() {
  return (
    <Suspense
      fallback={
        <Page>
          <ListSkeleton />
        </Page>
      }
    >
      <Routes>
        <Route path="/ganti-sandi" element={<ChangePassword />} />
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="transaksi" element={<Transactions />} />
          <Route path="penjualan" element={<Sales />} />
          <Route path="penjualan/baru" element={<NewSale />} />
          <Route path="penjualan/:id" element={<SaleDetail />} />
          <Route path="pengeluaran/baru" element={<NewExpense />} />
          <Route path="produk" element={<Products />} />
          <Route path="akun" element={<Accounts />} />
          <Route path="kategori" element={<Categories />} />
          <Route path="laporan" element={<Reports />} />
          <Route path="ekspor" element={<DataExport />} />
          <Route path="pengaturan" element={<Settings />} />
          <Route path="panduan" element={<Guide />} />
          <Route path="lainnya" element={<More />} />
          <Route path="masuk" element={<Navigate to="/" replace />} />
          <Route path="daftar" element={<Navigate to="/" replace />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

function Root() {
  const { user, loading, error, refresh } = useAuth();
  if (loading && !user) {
    return (
      <div
        aria-busy="true"
        className="flex min-h-dvh items-center justify-center text-body-sm text-slate"
      >
        Memuat usahaku...
      </div>
    );
  }
  if (error) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <ErrorState error={error} onRetry={refresh} />
      </div>
    );
  }
  if (!user) {
    return (
      <Routes>
        <Route path="/daftar" element={<Register />} />
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }
  return <SignedInRoutes />;
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Root />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

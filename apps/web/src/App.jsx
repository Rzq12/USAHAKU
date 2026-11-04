import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth.jsx';
import { ToastProvider } from './components/Toast.jsx';
import { Layout, Page } from './components/Layout.jsx';
import { EmptyState, ErrorState, ListSkeleton } from './components/ui.jsx';
import { Login, Register } from './pages/Auth.jsx';
import { ChangePassword } from './pages/ChangePassword.jsx';

const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Transactions = lazy(() => import('./pages/Transactions.jsx'));
const Sales = lazy(() => import('./pages/Sales.jsx'));
const NewSale = lazy(() => import('./pages/NewSale.jsx'));
const SaleDetail = lazy(() => import('./pages/SaleDetail.jsx'));
const Products = lazy(() => import('./pages/Products.jsx'));
const Contacts = lazy(() => import('./pages/Contacts.jsx'));
const Debts = lazy(() => import('./pages/Debts.jsx'));
const DebtDetail = lazy(() => import('./pages/DebtDetail.jsx'));
const Invoices = lazy(() => import('./pages/Invoices.jsx'));
const Accounts = lazy(() => import('./pages/Accounts.jsx'));
const Budgets = lazy(() => import('./pages/Budgets.jsx'));
const Recurring = lazy(() => import('./pages/Recurring.jsx'));
const Reports = lazy(() => import('./pages/Reports.jsx'));
const Tax = lazy(() => import('./pages/Tax.jsx'));
const Categories = lazy(() => import('./pages/Categories.jsx'));
const Import = lazy(() => import('./pages/Import.jsx'));
const DataExport = lazy(() => import('./pages/DataExport.jsx'));
const Audit = lazy(() => import('./pages/Audit.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const Users = lazy(() => import('./pages/Users.jsx'));
const Guide = lazy(() => import('./pages/Guide.jsx'));
const More = lazy(() => import('./pages/More.jsx'));

const OWNER = 'owner';
const ACCOUNTANT = 'accountant';

/** Hides pages a role cannot use. The API still refuses them on its own. */
function RoleRoute({ roles, children }) {
  const { user } = useAuth();
  if (roles.includes(user.role)) return children;
  return (
    <Page narrow>
      <EmptyState
        title="Halaman ini bukan untuk peran Anda"
        body="Minta pemilik usaha jika Anda memerlukan aksesnya."
      />
    </Page>
  );
}

function NotFound() {
  return (
    <Page narrow>
      <EmptyState title="Halaman tidak ditemukan" body="Alamat ini tidak ada di usahaku." />
    </Page>
  );
}

function SignedInRoutes() {
  const financial = [OWNER, ACCOUNTANT];
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
          <Route index element={<Dashboard />} />
          <Route path="transaksi" element={<Transactions />} />
          <Route path="penjualan" element={<Sales />} />
          <Route
            path="penjualan/baru"
            element={
              <RoleRoute roles={[OWNER, 'staff']}>
                <NewSale />
              </RoleRoute>
            }
          />
          <Route path="penjualan/:id" element={<SaleDetail />} />
          <Route path="produk" element={<Products />} />
          <Route path="kontak" element={<Contacts />} />
          <Route path="tagihan" element={<Debts />} />
          <Route path="tagihan/:id" element={<DebtDetail />} />
          <Route path="faktur" element={<Invoices />} />
          <Route path="akun" element={<Accounts />} />
          <Route path="kategori" element={<Categories />} />
          <Route
            path="anggaran"
            element={
              <RoleRoute roles={financial}>
                <Budgets />
              </RoleRoute>
            }
          />
          <Route
            path="berulang"
            element={
              <RoleRoute roles={financial}>
                <Recurring />
              </RoleRoute>
            }
          />
          <Route
            path="laporan"
            element={
              <RoleRoute roles={financial}>
                <Reports />
              </RoleRoute>
            }
          />
          <Route
            path="pajak"
            element={
              <RoleRoute roles={financial}>
                <Tax />
              </RoleRoute>
            }
          />
          <Route
            path="impor"
            element={
              <RoleRoute roles={[OWNER]}>
                <Import />
              </RoleRoute>
            }
          />
          <Route
            path="ekspor"
            element={
              <RoleRoute roles={financial}>
                <DataExport />
              </RoleRoute>
            }
          />
          <Route
            path="audit"
            element={
              <RoleRoute roles={financial}>
                <Audit />
              </RoleRoute>
            }
          />
          <Route
            path="pengaturan"
            element={
              <RoleRoute roles={financial}>
                <Settings />
              </RoleRoute>
            }
          />
          <Route
            path="pengguna"
            element={
              <RoleRoute roles={[OWNER]}>
                <Users />
              </RoleRoute>
            }
          />
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
  if (user.must_change_password) return <ChangePassword forced />;
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

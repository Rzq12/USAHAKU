import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAuth, usePermissions } from '../lib/auth.jsx';
import { useFetch } from '../lib/hooks.js';
import { formatDate, formatQty, rupiah, shortDay, TRANSACTION_TYPES } from '../lib/format.js';
import { NavyBand } from '../components/NavyBand.jsx';
import { EmptyState, ErrorState, Row, RowList } from '../components/ui.jsx';
import { useAdd } from '../components/Layout.jsx';

const REVENUE_COLOR = '#5645d4';
const EXPENSE_COLOR = '#dd5b00';

function compactRupiah(value) {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toLocaleString('id-ID')}jt`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toLocaleString('id-ID')}rb`;
  return String(value);
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-hairline bg-white px-3 py-2 text-caption shadow-card">
      <p className="mb-1 font-semibold">{shortDay(label)}</p>
      {payload.map((item) => (
        <p key={item.dataKey} className="num flex items-center gap-2">
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 rounded-[2px]"
            style={{ background: item.color }}
          />
          <span className="text-slate">{item.name}</span>
          <span className="ml-auto pl-3 font-medium">{rupiah(item.value)}</span>
        </p>
      ))}
    </div>
  );
}

function DailyChart({ series }) {
  const hasData = series.some((day) => day.revenue > 0 || day.expense > 0);
  return (
    <div className="rounded-lg border border-hairline bg-white p-4 text-ink shadow-mockup sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h2 className="text-h5">Pendapatan dan pengeluaran per hari</h2>
        <div className="flex gap-4 text-caption text-slate">
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 rounded-[2px]"
              style={{ background: REVENUE_COLOR }}
            />
            Pendapatan
          </span>
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 rounded-[2px]"
              style={{ background: EXPENSE_COLOR }}
            />
            Pengeluaran
          </span>
        </div>
      </div>
      {hasData ? (
        <div
          className="mt-4 h-56 sm:h-64"
          role="img"
          aria-label="Grafik batang pendapatan dan pengeluaran harian. Rincian angka ada di menu Laporan."
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={series} barGap={2} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="#ede9e4" />
              <XAxis
                dataKey="date"
                tickFormatter={shortDay}
                tick={{ fontSize: 12, fill: '#5d5b54' }}
                tickLine={false}
                axisLine={{ stroke: '#e5e3df' }}
                minTickGap={32}
              />
              <YAxis
                tickFormatter={compactRupiah}
                tick={{ fontSize: 12, fill: '#5d5b54' }}
                tickLine={false}
                axisLine={false}
                width={48}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f6f5f4' }} />
              <Bar
                dataKey="revenue"
                name="Pendapatan"
                fill={REVENUE_COLOR}
                radius={[4, 4, 0, 0]}
                maxBarSize={12}
                isAnimationActive={false}
              />
              <Bar
                dataKey="expense"
                name="Pengeluaran"
                fill={EXPENSE_COLOR}
                radius={[4, 4, 0, 0]}
                maxBarSize={12}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="mt-4 rounded-md bg-surface px-4 py-10 text-center text-body-sm text-slate">
          Belum ada pendapatan atau pengeluaran pada periode ini.
        </p>
      )}
    </div>
  );
}

function Tile({ tone, label, value, note, to }) {
  return (
    <Link
      to={to}
      className={`block rounded-lg p-4 transition-shadow duration-150 hover:shadow-card sm:p-5 ${tone}`}
    >
      <p className="text-body-sm text-charcoal">{label}</p>
      <p className="num mt-1 break-words text-[20px] font-semibold leading-tight text-ink sm:text-h4">
        {value}
      </p>
      {note && <p className="mt-1 text-caption text-charcoal">{note}</p>}
    </Link>
  );
}

function TransactionRow({ transaction }) {
  const sign = { income: '+', expense: '-', transfer: '' }[transaction.type];
  return (
    <Row
      title={transaction.note || transaction.category_name || TRANSACTION_TYPES[transaction.type]}
      subtitle={`${formatDate(transaction.occurred_on)} · ${transaction.account_name}`}
      right={`${sign}${rupiah(transaction.amount)}`}
    />
  );
}

function OverdueBanner({ count, amount }) {
  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-lg bg-tint-yellow-bold p-5 text-charcoal sm:p-6">
      <div>
        <h2 className="text-h5">
          {count} piutang terlambat, total <span className="num">{rupiah(amount)}</span>
        </h2>
        <p className="mt-0.5 text-body-sm">Ingatkan pelanggan ini lebih dulu hari ini.</p>
      </div>
      <Link to="/tagihan?status=overdue" className="btn-dark">
        Lihat yang terlambat
      </Link>
    </div>
  );
}

function ExpenseBreakdown({ items, total }) {
  if (items.length === 0) {
    return (
      <EmptyState
        compact
        title="Belum ada pengeluaran"
        body="Pengeluaran periode ini akan muncul di sini."
      />
    );
  }
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.category_id}>
          <div className="flex justify-between gap-3 text-body-sm">
            <span className="min-w-0 truncate">{item.name}</span>
            <span className="num shrink-0 font-medium">{rupiah(item.amount)}</span>
          </div>
          <div className="mt-1 h-2 rounded-[2px] bg-tint-gray">
            <div
              className="h-2 rounded-[2px] bg-navy-mid"
              style={{ width: `${Math.max(2, (item.amount * 100) / total)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function FirstRun({ canRecord }) {
  return (
    <div className="mt-6">
      <EmptyState
        title="Belum ada data. Mulai dengan mencatat penjualan pertama."
        body="Tiga langkah ini cukup untuk melihat laba pertama Anda."
        action={
          canRecord ? (
            <>
              <Link className="btn-primary" to="/penjualan/baru">
                Catat penjualan pertama
              </Link>
              <Link className="btn-secondary" to="/produk">
                Tambah produk
              </Link>
              <Link className="btn-secondary" to="/akun">
                Atur saldo akun
              </Link>
            </>
          ) : (
            <Link className="btn-secondary" to="/panduan">
              Buka panduan
            </Link>
          )
        }
      />
    </div>
  );
}

function FinancialDashboard({ data, period, onPeriod }) {
  const { cards } = data;
  const { canRecord } = usePermissions();
  const { business } = useAuth();
  const breakdownTotal = data.expense_breakdown.reduce((sum, item) => sum + item.amount, 0);
  const profitNegative = cards.estimated_net_profit < 0;
  const overduePayables = cards.overdue_count - cards.overdue_receivable_count;

  return (
    <>
      <NavyBand className="px-4 pb-44 pt-8 sm:px-6 sm:pb-52 lg:px-8 lg:pt-12">
        <div className="mx-auto max-w-[1100px] text-center">
          <p className="text-body-sm text-ondark-muted">{business.name}</p>
          <h1 className="mt-1 text-body text-white">
            Perkiraan laba bersih, {formatDate(data.period.from)} s.d. {formatDate(data.period.to)}
          </h1>
          <p className="num mt-2 break-words text-[44px] font-semibold leading-none tracking-[-0.03em] sm:text-[64px]">
            {rupiah(cards.estimated_net_profit)}
          </p>
          {profitNegative && (
            <p className="mt-2 text-body-sm text-ondark-muted">
              Pengeluaran masih lebih besar dari pendapatan.
            </p>
          )}
          <div role="group" aria-label="Pilih periode" className="mt-5 flex justify-center gap-2">
            {[
              ['current', 'Periode ini'],
              ['previous', 'Periode lalu'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={period === value}
                onClick={() => onPeriod(value)}
                className={`inline-flex min-h-[44px] items-center rounded-full border px-4 text-body-sm font-medium sm:min-h-[36px] ${
                  period === value
                    ? 'border-white bg-white text-ink'
                    : 'border-ondark-muted text-white hover:bg-navy-mid'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </NavyBand>

      <div className="relative z-10 mx-auto -mt-36 max-w-[1100px] px-4 sm:-mt-40 sm:px-6 lg:px-8">
        <DailyChart series={data.series} />
        {data.is_empty && <FirstRun canRecord={canRecord} />}
        {cards.overdue_receivable_count > 0 && (
          <OverdueBanner
            count={cards.overdue_receivable_count}
            amount={cards.overdue_receivables}
          />
        )}

        <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
          <Tile
            to="/penjualan"
            tone="bg-tint-mint"
            label="Penjualan hari ini"
            value={rupiah(cards.today_sales)}
            note={`${cards.today_sale_count} penjualan`}
          />
          <Tile
            to="/akun"
            tone="bg-tint-lavender"
            label="Saldo semua akun"
            value={rupiah(cards.total_balance)}
          />
          <Tile
            to="/laporan"
            tone="bg-tint-sky"
            label="Pendapatan periode"
            value={rupiah(cards.period_revenue)}
          />
          <Tile
            to="/laporan"
            tone="bg-tint-peach"
            label="Pengeluaran periode"
            value={rupiah(cards.period_expenses)}
          />
          <Tile
            to="/tagihan"
            tone="bg-tint-yellow"
            label="Piutang belum masuk"
            value={rupiah(cards.receivables)}
          />
          <Tile
            to="/tagihan?tipe=payable"
            tone="bg-tint-rose"
            label="Hutang belum dibayar"
            value={rupiah(cards.payables)}
            note={overduePayables > 0 ? `${overduePayables} tagihan terlambat` : undefined}
          />
        </div>

        <div className="mt-10 grid gap-x-8 gap-y-10 lg:grid-cols-[1.25fr_1fr]">
          <section aria-labelledby="latest-heading">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 id="latest-heading" className="text-h5">
                Transaksi terbaru
              </h2>
              <Link to="/transaksi" className="link-tap text-body-sm">
                Semua transaksi
              </Link>
            </div>
            {data.latest.length ? (
              <RowList>
                {data.latest.map((transaction) => (
                  <TransactionRow key={transaction.id} transaction={transaction} />
                ))}
              </RowList>
            ) : (
              <EmptyState
                compact
                title="Belum ada transaksi"
                body="Penjualan lunas dan pengeluaran akan muncul di sini."
              />
            )}
          </section>

          <div className="space-y-10">
            <section aria-labelledby="expense-heading">
              <h2 id="expense-heading" className="mb-3 text-h5">
                Pengeluaran per kategori
              </h2>
              <ExpenseBreakdown items={data.expense_breakdown} total={breakdownTotal} />
            </section>
            <section aria-labelledby="top-heading">
              <h2 id="top-heading" className="mb-3 text-h5">
                Produk terlaris
              </h2>
              {data.top_products.length ? (
                <ol className="space-y-2">
                  {data.top_products.map((product, index) => (
                    <li key={product.name} className="flex gap-3 text-body-sm">
                      <span className="num w-4 shrink-0 text-slate">{index + 1}</span>
                      <span className="min-w-0 flex-1 break-words">{product.name}</span>
                      <span className="num shrink-0 font-medium">{rupiah(product.revenue)}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <EmptyState compact title="Belum ada penjualan" />
              )}
            </section>
            {data.low_stock.length > 0 && (
              <section aria-labelledby="stock-heading">
                <h2 id="stock-heading" className="mb-3 text-h5">
                  Stok menipis
                </h2>
                <ul className="space-y-2">
                  {data.low_stock.map((product) => (
                    <li key={product.id} className="flex justify-between gap-3 text-body-sm">
                      <span className="min-w-0 break-words">{product.name}</span>
                      <span className="num shrink-0 font-medium text-brand-orange-deep">
                        {formatQty(product.stock_qty)} {product.unit}
                      </span>
                    </li>
                  ))}
                </ul>
                <Link to="/produk?stok=menipis" className="link-tap mt-1 text-body-sm">
                  Isi ulang stok
                </Link>
              </section>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function StaffDashboard({ data }) {
  const { user } = useAuth();
  const { addTransaction } = useAdd();
  return (
    <>
      <NavyBand className="px-4 pb-14 pt-8 text-center sm:pb-16 sm:pt-12">
        <p className="text-body-sm text-ondark-muted">Halo, {user.name}</p>
        <h1 className="mt-1 text-body">Penjualan hari ini</h1>
        <p className="num mt-2 break-words text-[44px] font-semibold leading-none tracking-[-0.03em] sm:text-[64px]">
          {rupiah(data.cards.today_sales)}
        </p>
        <p className="mt-2 text-body-sm text-ondark-muted">
          {data.cards.today_sale_count} penjualan
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link to="/penjualan/baru" className="btn-primary min-h-[52px] px-8 text-body">
            Catat penjualan
          </Link>
          <button
            type="button"
            className="btn-secondary-on-dark min-h-[52px]"
            onClick={() => addTransaction('expense')}
          >
            Catat pengeluaran
          </button>
        </div>
      </NavyBand>
      <div className="mx-auto mt-8 max-w-3xl px-4 sm:px-6">
        <h2 className="mb-3 text-h5">Catatan terakhir Anda</h2>
        {data.latest.length ? (
          <RowList>
            {data.latest.map((transaction) => (
              <TransactionRow key={transaction.id} transaction={transaction} />
            ))}
          </RowList>
        ) : (
          <EmptyState
            compact
            title="Belum ada catatan"
            body="Penjualan lunas dan pengeluaran yang Anda catat muncul di sini."
          />
        )}
      </div>
    </>
  );
}

function DashboardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Memuat beranda">
      <div className="h-72 bg-navy" />
      <div className="mx-auto -mt-36 max-w-[1100px] px-4">
        <div className="h-72 rounded-lg border border-hairline bg-white p-6 shadow-mockup">
          <div className="skeleton h-5 w-1/3" />
          <div className="skeleton mt-6 h-48 w-full" />
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [period, setPeriod] = useState('current');
  const state = useFetch(`/dashboard?period=${period}`);

  if (state.error) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <ErrorState error={state.error} onRetry={state.reload} />
      </div>
    );
  }
  if (!state.data) return <DashboardSkeleton />;
  if (state.data.role === 'staff') return <StaffDashboard data={state.data} />;
  return <FinancialDashboard data={state.data} period={period} onPeriod={setPeriod} />;
}

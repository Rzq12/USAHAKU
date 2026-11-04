import { useCallback, useEffect, useState } from 'react';
import { api, query } from '../lib/api.js';
import { useAuth, usePermissions } from '../lib/auth.jsx';
import { notifyChanged, useFetch, useSubmit } from '../lib/hooks.js';
import { formatDate, periodFor, rupiah, todayJakarta } from '../lib/format.js';
import { Page } from '../components/Layout.jsx';
import { Drawer } from '../components/Drawer.jsx';
import {
  Badge,
  EmptyState,
  FormError,
  Loaded,
  MoneyField,
  PageHeader,
  useCategories,
} from '../components/ui.jsx';

const STATUS = {
  ok: { bar: 'bg-brand-green', badge: null },
  near: { bar: 'bg-brand-yellow', badge: <Badge tone="orange">Mendekati batas</Badge> },
  over: { bar: 'bg-danger', badge: <Badge tone="red">Melebihi anggaran</Badge> },
};

function BudgetLine({ item }) {
  const status = STATUS[item.status];
  return (
    <li className="px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{item.category_name}</span>
          {status.badge}
        </div>
        <span className="num text-body-sm">
          {rupiah(item.used)} dari {rupiah(item.budget)}
        </span>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-[2px] bg-tint-gray"
        role="progressbar"
        aria-label={`Pemakaian ${item.category_name}`}
        aria-valuenow={Math.min(item.percent, 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={`h-2 ${status.bar}`} style={{ width: `${Math.min(item.percent, 100)}%` }} />
      </div>
      <p className="num mt-1.5 text-caption text-slate">
        {item.percent}% terpakai ·{' '}
        {item.remaining < 0
          ? `lebih ${rupiah(-item.remaining)}`
          : `sisa ${rupiah(item.remaining)}${item.remaining_per_day ? `, ${rupiah(item.remaining_per_day)} per hari` : ''}`}
      </p>
    </li>
  );
}

function BudgetDrawer({ open, onClose, period, items, previousItems }) {
  const categories = useCategories();
  const [amounts, setAmounts] = useState({});
  useEffect(() => {
    if (open)
      setAmounts(Object.fromEntries((items ?? []).map((item) => [item.category_id, item.budget])));
  }, [open, items]);

  const choices = categories.data?.items.filter(
    (category) => category.type === 'expense' && category.pl_group !== 'inventory',
  );
  const action = useCallback(
    () =>
      api.put('/budgets', {
        period: period.from,
        items: Object.entries(amounts)
          .filter(([, amount]) => amount)
          .map(([category_id, amount]) => ({ category_id, amount })),
      }),
    [amounts, period],
  );
  const { submit, pending, fieldErrors, formError } = useSubmit(action, {
    success: 'Anggaran disimpan.',
    onDone: () => {
      notifyChanged();
      onClose();
    },
  });

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Anggaran ${formatDate(period.from)} s.d. ${formatDate(period.to)}`}
      footer={
        <>
          {previousItems?.length > 0 && (
            <button
              type="button"
              className="btn-ghost mr-auto"
              onClick={() =>
                setAmounts(
                  Object.fromEntries(previousItems.map((item) => [item.category_id, item.budget])),
                )
              }
            >
              Salin periode lalu
            </button>
          )}
          <button type="button" className="btn-primary" disabled={pending} onClick={() => submit()}>
            {pending ? 'Menyimpan...' : 'Simpan anggaran'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-caption text-slate">Kosongkan kategori yang tidak perlu dibatasi.</p>
        {choices?.map((category) => (
          <MoneyField
            key={category.id}
            label={category.name}
            value={amounts[category.id] ?? null}
            onChange={(amount) => setAmounts((current) => ({ ...current, [category.id]: amount }))}
          />
        ))}
        <FormError message={formError ?? Object.values(fieldErrors)[0]} />
      </div>
    </Drawer>
  );
}

export default function Budgets() {
  const { business } = useAuth();
  const { isOwner } = usePermissions();
  const [offset, setOffset] = useState(0);
  const period = periodFor(todayJakarta(), business.period_start_day, offset);
  const previous = periodFor(todayJakarta(), business.period_start_day, offset - 1);
  const state = useFetch(`/budgets/summary${query({ period: period.from })}`);
  const previousState = useFetch(
    isOwner ? `/budgets/summary${query({ period: previous.from })}` : null,
  );
  const [editing, setEditing] = useState(false);

  return (
    <Page narrow>
      <PageHeader
        title="Anggaran"
        description="Batas pengeluaran per kategori untuk satu periode."
        actions={
          isOwner && (
            <button type="button" className="btn-primary" onClick={() => setEditing(true)}>
              Atur anggaran
            </button>
          )
        }
      />
      <div className="mb-4 flex items-center justify-between gap-2">
        <button type="button" className="btn-secondary" onClick={() => setOffset(offset - 1)}>
          Sebelumnya
        </button>
        <span className="num text-center text-body-sm font-medium">
          {formatDate(period.from)} s.d. {formatDate(period.to)}
        </span>
        <button
          type="button"
          className="btn-secondary"
          disabled={offset >= 1}
          onClick={() => setOffset(offset + 1)}
        >
          Berikutnya
        </button>
      </div>
      <Loaded state={state}>
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState
              title="Belum ada anggaran pada periode ini"
              body="Tetapkan batas untuk kategori yang paling sering membengkak."
              action={
                isOwner ? (
                  <button type="button" className="btn-primary" onClick={() => setEditing(true)}>
                    Atur anggaran
                  </button>
                ) : undefined
              }
            />
          ) : (
            <>
              <div className="mb-4 rounded-lg bg-surface px-5 py-4">
                <p className="text-body-sm text-slate">Total terpakai</p>
                <p className="num text-h4">
                  {rupiah(data.totals.used)}{' '}
                  <span className="text-body text-slate">dari {rupiah(data.totals.budget)}</span>
                </p>
                <p className="num mt-1 text-caption text-slate">
                  {data.totals.percent}% · {data.days_left} hari tersisa
                </p>
              </div>
              <ul className="card divide-y divide-hairline-soft">
                {data.items.map((item) => (
                  <BudgetLine key={item.category_id} item={item} />
                ))}
              </ul>
            </>
          )
        }
      </Loaded>
      {isOwner && (
        <BudgetDrawer
          open={editing}
          onClose={() => setEditing(false)}
          period={period}
          items={state.data?.items}
          previousItems={previousState.data?.items}
        />
      )}
    </Page>
  );
}

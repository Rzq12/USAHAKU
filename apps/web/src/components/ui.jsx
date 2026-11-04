import { useId } from 'react';
import { groupDigits, parseDigits } from '../lib/format.js';
import { useFetch } from '../lib/hooks.js';
import { Icon } from './Icon.jsx';

export function PageHeader({ title, description, actions }) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-h4 sm:text-h3">{title}</h1>
        {description && <p className="mt-1 max-w-[65ch] text-body-sm text-slate">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Field({ label, error, hint, children, render }) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  const control = {
    id,
    'aria-invalid': error ? 'true' : undefined,
    'aria-describedby': describedBy,
  };
  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      {render ? render(control) : children}
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1 text-caption text-slate">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-caption text-danger-deep">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextField({ label, error, hint, ...props }) {
  return (
    <Field
      label={label}
      error={error}
      hint={hint}
      render={(control) => <input className="field-input" {...control} {...props} />}
    />
  );
}

export function TextAreaField({ label, error, hint, rows = 3, ...props }) {
  return (
    <Field
      label={label}
      error={error}
      hint={hint}
      render={(control) => <textarea rows={rows} className="field-input" {...control} {...props} />}
    />
  );
}

export function SelectField({ label, error, hint, children, ...props }) {
  return (
    <Field
      label={label}
      error={error}
      hint={hint}
      render={(control) => (
        <select className="field-input" {...control} {...props}>
          {children}
        </select>
      )}
    />
  );
}

/** Whole rupiah input with live dot grouping; the value is an integer or null. */
export function MoneyField({
  label,
  error,
  hint,
  value,
  onChange,
  allowNegative = false,
  large = false,
  ...props
}) {
  const negative = allowNegative && value < 0;
  const display = value === null || value === undefined ? '' : groupDigits(Math.abs(value));
  return (
    <Field
      label={label}
      error={error}
      hint={hint}
      render={(control) => (
        <div className="relative">
          <span
            className={`pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate ${
              large ? 'text-h5' : 'text-body'
            }`}
          >
            {negative ? '-Rp' : 'Rp'}
          </span>
          <input
            {...control}
            {...props}
            inputMode="numeric"
            autoComplete="off"
            className={`field-input num ${negative ? 'pl-[3.25rem]' : 'pl-11'} ${
              large ? 'min-h-[56px] pl-12 text-h4' : ''
            }`}
            value={display}
            onChange={(event) => {
              const parsed = parseDigits(event.target.value);
              const typedMinus = allowNegative && event.target.value.trim().startsWith('-');
              onChange(
                parsed === null ? null : (negative || typedMinus) && parsed ? -parsed : parsed,
              );
            }}
            onKeyDown={(event) => {
              if (allowNegative && event.key === '-' && value) {
                event.preventDefault();
                onChange(-value);
              }
            }}
          />
        </div>
      )}
    />
  );
}

export function CheckField({ label, hint, ...props }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input id={id} type="checkbox" className="mt-[3px] h-5 w-5 accent-primary" {...props} />
      <label htmlFor={id} className="text-body-sm text-charcoal">
        {label}
        {hint && <span className="mt-0.5 block text-caption text-slate">{hint}</span>}
      </label>
    </div>
  );
}

const BADGE_TONES = {
  purple: 'bg-tint-lavender text-brand-purple800',
  orange: 'bg-tint-peach text-brand-orange-deep',
  green: 'bg-tint-mint text-brand-green-deep',
  rose: 'bg-tint-rose text-brand-pink-deep',
  red: 'bg-tint-rose text-danger-deep',
  sky: 'bg-tint-sky text-[#0b4f8a]',
  gray: 'bg-tint-gray text-slate',
};

export function Badge({ tone = 'gray', children }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-sm px-2 py-0.5 text-caption font-semibold ${BADGE_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

export function FormError({ message }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="mt-3 rounded-md bg-tint-rose px-3 py-2 text-body-sm text-danger-deep"
    >
      {message}
    </p>
  );
}

export function ListSkeleton({ rows = 5 }) {
  return (
    <div aria-busy="true" aria-label="Memuat data" className="card divide-y divide-hairline-soft">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center justify-between gap-4 px-4 py-4">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="skeleton h-4 w-2/5" />
            <div className="skeleton h-3 w-1/4" />
          </div>
          <div className="skeleton h-4 w-20" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, body, action, compact = false }) {
  return (
    <div className={`rounded-lg bg-surface text-center ${compact ? 'px-4 py-6' : 'px-6 py-12'}`}>
      <h2 className="text-h5">{title}</h2>
      {body && <p className="mx-auto mt-1 max-w-[50ch] text-body-sm text-slate">{body}</p>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <div role="alert" className="rounded-lg bg-tint-rose px-6 py-8 text-center">
      <h2 className="text-h5 text-danger-deep">Data belum bisa dimuat</h2>
      <p className="mx-auto mt-1 max-w-[50ch] text-body-sm text-charcoal">{error.message}</p>
      {onRetry && (
        <button type="button" className="btn-secondary mt-4" onClick={onRetry}>
          Muat ulang
        </button>
      )}
    </div>
  );
}

/** The three data states for a useFetch result, plus the content once data arrived. */
export function Loaded({ state, skeleton, children }) {
  if (state.error) return <ErrorState error={state.error} onRetry={state.reload} />;
  if (!state.data) return skeleton ?? <ListSkeleton />;
  return children(state.data);
}

export function Pagination({ page, limit, total, onPage }) {
  const pages = Math.ceil(total / limit);
  if (pages <= 1) return null;
  return (
    <nav aria-label="Halaman" className="mt-4 flex items-center justify-between gap-3">
      <button
        type="button"
        className="btn-secondary"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        Sebelumnya
      </button>
      <span className="num text-body-sm text-slate">
        Halaman {page} dari {pages}
      </span>
      <button
        type="button"
        className="btn-secondary"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
      >
        Berikutnya
      </button>
    </nav>
  );
}

export function Row({ title, subtitle, right, rightSub, badge, onClick, href, LinkComponent }) {
  const body = (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 break-words font-medium text-ink">{title}</span>
          {badge}
        </div>
        {subtitle && <p className="mt-0.5 break-words text-caption text-slate">{subtitle}</p>}
      </div>
      {(right !== undefined || rightSub) && (
        <div className="shrink-0 text-right">
          {right !== undefined && <div className="num font-medium">{right}</div>}
          {rightSub && <div className="mt-0.5 text-caption text-slate">{rightSub}</div>}
        </div>
      )}
    </>
  );
  const className = 'flex w-full min-h-[56px] items-center gap-4 px-4 py-3 text-left';
  if (href) {
    return (
      <li>
        <LinkComponent to={href} className={`${className} hover:bg-surface-soft`}>
          {body}
        </LinkComponent>
      </li>
    );
  }
  if (onClick) {
    return (
      <li>
        <button type="button" onClick={onClick} className={`${className} hover:bg-surface-soft`}>
          {body}
        </button>
      </li>
    );
  }
  return <li className={className}>{body}</li>;
}

export function RowList({ children }) {
  return <ul className="card divide-y divide-hairline-soft overflow-hidden">{children}</ul>;
}

export function SearchInput({ value, onChange, placeholder, label = 'Cari' }) {
  return (
    <div className="relative">
      <Icon
        name="search"
        size={18}
        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-steel"
      />
      <input
        type="search"
        aria-label={label}
        className="field-input bg-surface pl-10"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export function PillTabs({ label, options, value, onChange }) {
  return (
    <div
      role="group"
      aria-label={label}
      className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 py-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="pill-tab"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function useAccounts() {
  return useFetch('/accounts');
}

export function useCategories() {
  return useFetch('/categories');
}

export function AccountOptions({ accounts }) {
  return (
    <>
      <option value="">Pilih akun</option>
      {accounts?.items.map((account) => (
        <option key={account.id} value={account.id}>
          {account.name}
        </option>
      ))}
    </>
  );
}

export function CategoryOptions({ categories, type, placeholder = 'Pilih kategori' }) {
  const items = categories?.items.filter((category) => !type || category.type === type) ?? [];
  const parents = items.filter((category) => !category.parent_id);
  return (
    <>
      <option value="">{placeholder}</option>
      {parents.map((parent) => {
        const children = items.filter((category) => category.parent_id === parent.id);
        if (children.length === 0) {
          return (
            <option key={parent.id} value={parent.id}>
              {parent.name}
            </option>
          );
        }
        return (
          <optgroup key={parent.id} label={parent.name}>
            <option value={parent.id}>{parent.name}</option>
            {children.map((child) => (
              <option key={child.id} value={child.id}>
                {child.name}
              </option>
            ))}
          </optgroup>
        );
      })}
    </>
  );
}

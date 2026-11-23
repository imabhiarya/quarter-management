import { createContext, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Loader2, X, Inbox, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

/* ------------------------------ Buttons ------------------------------ */

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'outline' | 'ghost' | 'danger';
  icon?: LucideIcon;
  loading?: boolean;
  size?: 'sm' | 'md';
};

export function Button({ variant = 'outline', icon: Icon, loading, size = 'md', className, children, disabled, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx('btn', `btn-${variant}`, size === 'sm' && 'btn-sm', className)}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : Icon ? <Icon className="size-4" /> : null}
      {children}
    </button>
  );
}

export function IconButton({ icon: Icon, label, tone = 'blue', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; tone?: 'blue' | 'red' | 'brand' }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={cx(
        'inline-grid size-8 place-items-center rounded-md transition hover:bg-black/5 disabled:opacity-40',
        tone === 'blue' && 'text-blue-700',
        tone === 'red' && 'text-red-600',
        tone === 'brand' && 'text-brand-700',
      )}
    >
      <Icon className="size-[18px]" />
    </button>
  );
}

/* ------------------------------- Badge ------------------------------- */

const TONES: Record<string, string> = {
  green: 'bg-green-100 text-green-800 ring-green-200',
  blue: 'bg-sky-100 text-sky-800 ring-sky-200',
  amber: 'bg-amber-100 text-amber-900 ring-amber-300',
  violet: 'bg-violet-100 text-violet-800 ring-violet-200',
  red: 'bg-red-100 text-red-800 ring-red-200',
  grey: 'bg-slate-100 text-slate-700 ring-slate-200',
};
const STATUS_TONE: Record<string, keyof typeof TONES> = {
  Occupied: 'green', Active: 'green', Allotted: 'green', Issued: 'green', Approved: 'green', Held: 'green', Eligible: 'green',
  Vacant: 'blue', Scheduled: 'blue', Pending: 'blue', 'Under Consideration': 'blue',
  'Under Repair': 'amber', Scrutiny: 'amber', Draft: 'amber',
  Recommended: 'violet',
  Cancelled: 'red', Rejected: 'red', Inactive: 'red',
  Closed: 'grey', Withdrawn: 'grey', Vacated: 'grey', 'Re-allotted': 'grey', Superseded: 'grey',
  'Awaiting Take-over': 'blue', 'Deferment Granted': 'amber', Overdue: 'red', 'Not Taken Over': 'red',
};

export function Badge({ status, label }: { status?: string; label?: string }) {
  if (!status) return <span className="text-slate-400">—</span>;
  return (
    <span className={cx('inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ring-1 ring-inset', TONES[STATUS_TONE[status] ?? 'grey'])}>
      {label ?? status}
    </span>
  );
}

/* ---------------------------- Page header ---------------------------- */

export function PageHeader({ icon: Icon, title, subtitle, actions }: { icon: LucideIcon; title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <Icon className="size-10 shrink-0 text-brand-700 sm:size-12" strokeWidth={1.75} />
        <div className="min-w-0">
          <h1 className="text-2xl leading-tight font-bold text-brand-700 sm:text-[28px]">{title}</h1>
          {subtitle && <p className="text-[15px] text-slate-700">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ----------------------------- Stat card ----------------------------- */

const STAT_TONES = {
  rose: 'from-rose-50 to-rose-100/60 border-rose-200 [--ic:var(--color-brand-700)]',
  green: 'from-green-50 to-green-100/60 border-green-200 [--ic:#15803d]',
  blue: 'from-sky-50 to-blue-100/60 border-sky-200 [--ic:#1d4ed8]',
  amber: 'from-amber-50 to-orange-100/50 border-amber-200 [--ic:#d97706]',
  violet: 'from-violet-50 to-purple-100/60 border-violet-200 [--ic:#6d28d9]',
};

export function StatCard({ icon: Icon, label, value, tone, loading, small, to, onClick, active }: {
  icon: LucideIcon; label: string; value: ReactNode; tone: keyof typeof STAT_TONES; loading?: boolean; small?: boolean;
  /** Opens this page when clicked. */
  to?: string;
  /** Runs when clicked (e.g. to filter the table on the same page). */
  onClick?: () => void;
  /** Highlights the card as the current selection. */
  active?: boolean;
}) {
  const body = (
    <>
      <Icon className="size-11 shrink-0 text-[var(--ic)]" strokeWidth={1.75} />
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-semibold text-slate-800">{label}</div>
        <div className={cx('font-bold text-slate-900 tabular-nums', small ? 'text-lg leading-7' : 'text-3xl')}>
          {loading ? <span className="inline-block h-7 w-14 animate-pulse rounded bg-black/10 align-middle" /> : value}
        </div>
      </div>
      {(to || onClick) && <ChevronRight className="size-5 shrink-0 text-slate-400 transition group-hover:translate-x-1 group-hover:text-[var(--ic)]" />}
    </>
  );
  const clickable = 'group flex w-full items-center gap-4 rounded-xl border bg-gradient-to-br px-5 py-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:outline-none';
  if (onClick)
    return (
      <button type="button" onClick={onClick} aria-pressed={active} title={`Show ${label}`} className={cx(clickable, STAT_TONES[tone], active && 'ring-2 ring-[var(--ic)] ring-offset-2')}>
        {body}
      </button>
    );
  // A card with `to` opens the page holding that data.
  if (to)
    return (
      <Link
        to={to}
        title={`Open ${label}`}
        className={cx(
          'group flex items-center gap-4 rounded-xl border bg-gradient-to-br px-5 py-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:outline-none',
          STAT_TONES[tone],
        )}
      >
        {body}
      </Link>
    );
  return (
    <div className={cx('flex items-center gap-4 rounded-xl border bg-gradient-to-br px-5 py-4 shadow-sm', STAT_TONES[tone])}>
      <Icon className="size-11 shrink-0 text-[var(--ic)]" strokeWidth={1.75} />
      <div className="min-w-0">
        <div className="text-[15px] font-semibold text-slate-800">{label}</div>
        <div className={cx('font-bold text-slate-900 tabular-nums', small ? 'text-lg leading-7' : 'text-3xl')}>
          {loading ? <span className="inline-block h-7 w-14 animate-pulse rounded bg-black/10 align-middle" /> : value}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- Card ------------------------------- */

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('rounded-xl border border-slate-200 bg-white shadow-sm', className)}>{children}</div>;
}

/* ------------------------------- Modal ------------------------------- */

export function Modal({ title, onClose, children, footer, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input:not([type=hidden]):not([disabled]),select:not([disabled]),textarea,button[data-autofocus]');
    first?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="no-print fixed inset-0 z-50 grid place-items-center bg-slate-900/45 p-3 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" className={cx('flex max-h-[92vh] w-full flex-col overflow-hidden rounded-xl bg-white shadow-2xl', wide ? 'max-w-4xl' : 'max-w-2xl')}>
        <div className="flex items-center justify-between gap-3 bg-gradient-to-r from-brand-800 to-brand-600 px-5 py-3 text-white">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-white/15">
            <X className="size-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/* ------------------------------ Confirm ------------------------------ */

type ConfirmOpts = { title: string; message: ReactNode; confirmLabel?: string; danger?: boolean };
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {state && (
        <Modal
          title={state.title}
          onClose={() => close(false)}
          footer={
            <>
              <Button onClick={() => close(false)}>Cancel</Button>
              <Button data-autofocus variant={state.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
                {state.confirmLabel ?? 'Confirm'}
              </Button>
            </>
          }
        >
          <div className="text-[15px] text-slate-700">{state.message}</div>
        </Modal>
      )}
    </ConfirmCtx.Provider>
  );
}
export const useConfirm = () => useContext(ConfirmCtx);

/* ---------------------------- Pagination ---------------------------- */

export function Pagination({ page, pageSize, total, onPage, noun = 'entries' }: { page: number; pageSize: number; total: number; onPage: (p: number) => void; noun?: string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(page * pageSize, total);
  const nums: (number | '…')[] = [];
  for (let p = 1; p <= pages; p++) {
    if (p <= 5 && page <= 4) nums.push(p);
    else if (p === pages || p === 1 || Math.abs(p - page) <= 1) nums.push(p);
    else if (nums[nums.length - 1] !== '…') nums.push('…');
  }
  const btn = 'inline-grid h-9 min-w-9 place-items-center rounded-md border border-slate-300 bg-white px-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-40';
  return (
    <div className="no-print flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <p className="text-sm text-slate-700">
        Showing <b>{from}</b>–<b>{to}</b> of <b>{total}</b> {noun}
      </p>
      {pages > 1 && (
        <nav className="flex flex-wrap items-center gap-1.5" aria-label="Pagination">
          <button className={btn} disabled={page === 1} onClick={() => onPage(1)} aria-label="First page"><ChevronsLeft className="size-4" /></button>
          <button className={btn} disabled={page === 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft className="size-4" /></button>
          {nums.map((n, i) =>
            n === '…' ? (
              <span key={`e${i}`} className="px-1 text-slate-500">…</span>
            ) : (
              <button key={n} className={cx(btn, n === page && 'border-brand-700 bg-brand-700 text-white hover:bg-brand-700')} aria-current={n === page ? 'page' : undefined} onClick={() => onPage(n)}>
                {n}
              </button>
            ),
          )}
          <button className={btn} disabled={page === pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight className="size-4" /></button>
          <button className={btn} disabled={page === pages} onClick={() => onPage(pages)} aria-label="Last page"><ChevronsRight className="size-4" /></button>
        </nav>
      )}
    </div>
  );
}

/* ----------------------------- Data table ----------------------------- */

export type TableColumn<T> = { key: string; label: ReactNode; render: (r: T, i: number) => ReactNode; className?: string };

export function DataTable<T extends { id: number }>({
  columns, rows, loading, offset = 0, selectedId, onSelect, actions, emptyText = 'No records found.',
}: {
  columns: TableColumn<T>[];
  rows: T[];
  loading?: boolean;
  offset?: number;
  selectedId?: number | null;
  onSelect?: (r: T) => void;
  actions?: (r: T) => ReactNode;
  emptyText?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th className="w-14 text-center">S.No.</th>
            {columns.map((c) => (
              <th key={c.key} className={c.className}>{c.label}</th>
            ))}
            {actions && <th className="no-print w-24 text-center">Action</th>}
          </tr>
        </thead>
        <tbody>
          {loading && !rows.length
            ? Array.from({ length: 5 }, (_, i) => (
                <tr key={i}>
                  <td colSpan={columns.length + 2}><div className="h-5 animate-pulse rounded bg-slate-100" /></td>
                </tr>
              ))
            : rows.map((r, i) => (
                <tr
                  key={r.id}
                  onClick={() => onSelect?.(r)}
                  className={cx(onSelect && 'cursor-pointer', selectedId === r.id && 'selected', loading && 'opacity-60')}
                  aria-selected={selectedId === r.id}
                >
                  <td className="text-center font-medium">{offset + i + 1}</td>
                  {columns.map((c) => (
                    <td key={c.key} className={c.className}>{c.render(r, i)}</td>
                  ))}
                  {actions && (
                    <td className="no-print text-center whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      {actions(r)}
                    </td>
                  )}
                </tr>
              ))}
          {!loading && !rows.length && (
            <tr>
              <td colSpan={columns.length + 2} className="py-10 text-center text-slate-500">
                <Inbox className="mx-auto mb-2 size-8 opacity-50" />
                {emptyText}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------ Inputs ------------------------------ */

export function Label({ children, required, htmlFor }: { children: ReactNode; required?: boolean; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-sm font-semibold text-slate-800">
      {children}
      {required && <span className="ml-0.5 text-red-600">*</span>}
    </label>
  );
}

export function Select({ value, onChange, options, placeholder, id, disabled, invalid }: {
  value: string; onChange: (v: string) => void; options: (string | { value: string; label: string })[]; placeholder?: string; id?: string; disabled?: boolean; invalid?: boolean;
}) {
  return (
    <select id={id} className={cx('input', invalid && 'invalid')} value={value ?? ''} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => {
        const v = typeof o === 'string' ? o : o.value;
        return (
          <option key={v} value={v}>
            {typeof o === 'string' ? o : o.label}
          </option>
        );
      })}
    </select>
  );
}

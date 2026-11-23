import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  Plus, Pencil, Trash2, Printer, FileSpreadsheet, Search, RotateCcw, Eye, Upload, Download,
  Building2, DoorOpen, Wrench, BedDouble, Users, CalendarCheck2, ArrowLeftRight, Hourglass, House, type LucideIcon,
} from 'lucide-react';
import { api, type Page, type Row } from '../lib/api';
import { useAuth, useMasters, useToast } from '../lib/context';
import { fmtDate } from '../lib/format';
import { printTable, printByGroup, type PlainColumn } from '../lib/exporters';
import { exportExcel, readSpreadsheet, downloadTemplate } from '../lib/excel';
import { Badge, Button, Card, DataTable, IconButton, Label, Modal, PageHeader, Pagination, Select, StatCard, cx, useConfirm, type TableColumn } from './ui';
import { FieldInput, FormModal, ViewModal, useOptions, viewItemsFor, type FieldDef } from './Form';

type Values = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export type FilterDef = {
  name: string;
  label: string;
  type?: 'select' | 'text' | 'date' | 'month';
  options?: FieldDef['options'];
  lookup?: FieldDef['lookup'];
  /** Query parameter, e.g. `prefix_vacationDate`; defaults to `name`. */
  param?: string;
  required?: boolean;
  allLabel?: string;
  placeholder?: string;
  default?: () => string;
  /** Load the options from an API path that returns a list of strings, e.g. '/offices'. */
  optionsFrom?: string;
  /** Not applied while this other filter has a value (e.g. the year is ignored during a name search). */
  overriddenBy?: string;
};

export type ColumnDef = {
  key: string;
  label: string;
  text?: (r: Row) => string;
  render?: (r: Row) => ReactNode;
  date?: boolean;
  badge?: boolean | ((r: Row) => string);
  bold?: boolean;
  /** Show the value as a link that opens the record's details. */
  opensRecord?: boolean;
  className?: string;
};

export type Ctx = {
  reload: () => void;
  open: (render: (close: () => void) => ReactNode) => void;
  toast: ReturnType<typeof useToast>;
  confirm: ReturnType<typeof useConfirm>;
  navigate: ReturnType<typeof useNavigate>;
  fetchAll: () => Promise<Row[]>;
  query: Record<string, string>;
  /** Changes whenever the table reloads. */
  version: number;
  /** Current filter values, and a way for panels to set one (e.g. click a location to filter by it). */
  filters: Values;
  setFilter: (name: string, value: string) => void;
};

export type ActionDef = {
  label: string;
  icon: LucideIcon;
  /** Requires a selected row. */
  needsRow?: boolean;
  /** Hidden for read-only users. */
  write?: boolean;
  run: (ctx: Ctx, row: Row | null) => void | Promise<void>;
  tone?: 'blue' | 'red' | 'brand';
  /** Row actions only: show for this row? */
  show?: (row: Row) => boolean;
  /** Row actions only: show as a labelled button instead of an icon. */
  labelled?: boolean;
};

export type ModuleConfig = {
  key: string;
  collection: string;
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  sectionTitle?: string;
  filters?: FilterDef[];
  searchLabel?: string;
  baseQuery?: Record<string, string>;
  sort?: string;
  dir?: 'asc' | 'desc';
  tabs?: { label: string; query: Record<string, string>; defaults?: Values }[];
  stats?: 'quarters' | 'waiting';
  statsFirst?: boolean;
  columns: ColumnDef[];
  fields: FieldDef[];
  viewFields?: FieldDef[];
  defaults?: () => Values;
  noun?: string;
  singular?: string;
  add?: { label: string; to?: string } | false;
  editTo?: (r: Row) => string;
  noEdit?: boolean;
  noDelete?: boolean;
  deleteLabel?: (r: Row) => string;
  headerToolbar?: boolean;
  importable?: { columns: { key: string; label: string }[]; sample: Record<string, string> };
  exportable?: boolean;
  printLabel?: string;
  /** Replaces the standard Print button. */
  onPrint?: (ctx: Ctx) => void;
  /** Print asks for a type: all together, each type on its own page, or one type. */
  printByType?: { field: string; signatures?: string[] };
  toolbar?: ActionDef[];
  rowActions?: ActionDef[];
  rowView?: boolean;
  /** Extra buttons in the details window, e.g. Print. */
  viewFooter?: (ctx: Ctx, row: Row, close: () => void) => ReactNode;
  /** Tabs after `tabs` that show their own content instead of this table. */
  extraTabs?: { label: string; render: () => ReactNode }[];
  /** Extra content shown above the table toolbar. */
  topPanel?: (ctx: Ctx) => ReactNode;
};

/* ----------------------------- Statistics ----------------------------- */

/** Quarter summary cards. Clicking one filters by that status (`onStatus`), or opens the Quarter Register. */
function QuarterStats({ filters, onStatus }: { filters: Values; onStatus?: (status: string) => void }) {
  const navigate = useNavigate();
  const pick = (status: string) => () => {
    if (onStatus) return onStatus(status);
    const p = new URLSearchParams();
    for (const k of ['station', 'subDivision', 'location', 'category']) if (filters[k]) p.set(k, filters[k]);
    if (status) p.set('status', status);
    navigate(`/quarter-register${p.toString() ? `?${p}` : ''}`);
  };
  const on = (status: string) => !!onStatus && (filters.status ?? '') === status;
  const [s, setS] = useState<{ total: number; occupied: number; vacant: number; underRepair: number } | null>(null);
  useEffect(() => {
    api<typeof s>('/stats/quarters', { query: { station: filters.station, subDivision: filters.subDivision, category: filters.category, accnPool: filters.accnPool, location: filters.location } }).then(setS).catch(() => {});
  }, [filters.station, filters.subDivision, filters.category, filters.accnPool, filters.location]);
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
      <StatCard tone="rose" icon={Building2} label="Total Quarters" value={s?.total} loading={!s} onClick={pick('')} active={on('')} />
      <StatCard tone="green" icon={BedDouble} label="Occupied" value={s?.occupied} loading={!s} onClick={pick('Occupied')} active={on('Occupied')} />
      <StatCard tone="blue" icon={DoorOpen} label="Vacant" value={s?.vacant} loading={!s} onClick={pick('Vacant')} active={on('Vacant')} />
      <StatCard tone="amber" icon={Wrench} label="Under Repair" value={s ? String(s.underRepair).padStart(2, '0') : ''} loading={!s} onClick={pick('Under Repair')} active={on('Under Repair')} />
    </div>
  );
}

function WaitingStats({ filters }: { filters: Values }) {
  const [s, setS] = useState<{ total: number; fresh: number; change: number; longestWaiting: number; nextDue: string | null } | null>(null);
  const key = JSON.stringify(filters);
  useEffect(() => {
    api<typeof s>('/stats/waiting', { query: filters }).then(setS).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      <StatCard tone="rose" icon={Users} label="Total Applicants" value={s?.total} loading={!s} />
      <StatCard tone="green" icon={CalendarCheck2} label="Fresh Applications" value={s?.fresh} loading={!s} />
      <StatCard tone="blue" icon={ArrowLeftRight} label="Change of Accn" value={s?.change} loading={!s} />
      <StatCard tone="amber" icon={Hourglass} label="Longest Waiting" value={s ? `${s.longestWaiting} Days` : ''} loading={!s} />
      <StatCard tone="violet" icon={House} label="Next Allotment (Due)" value={s?.nextDue ?? 'No match'} loading={!s} small />
    </div>
  );
}

/* ------------------------------ Filters ------------------------------ */

function FilterField({ f, value, onChange }: { f: FilterDef; value: string; onChange: (v: string) => void }) {
  const fixed = useOptions(f.options);
  const [loaded, setLoaded] = useState<(string | { value: string; label: string })[] | null>(null);
  useEffect(() => {
    if (!f.optionsFrom) return;
    const load = () => api<(string | { value: string; label: string })[]>(f.optionsFrom!).then(setLoaded).catch(() => setLoaded([]));
    load();
    // Lists that depend on the saved allotment priority refresh when it is saved on any page.
    window.addEventListener('awas-priority-rules', load);
    return () => window.removeEventListener('awas-priority-rules', load);
  }, [f.optionsFrom]);
  const options = f.optionsFrom ? (loaded ?? []) : fixed;
  if (f.lookup) return <FieldInput field={{ name: f.name, label: f.label, type: 'lookup', lookup: f.lookup }} value={value} onChange={(v) => onChange(String(v ?? ''))} />;
  if (f.type === 'text' || f.type === 'date' || f.type === 'month')
    return <input id={`f-${f.name}`} className="input" type={f.type} value={value} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />;
  return <Select id={`f-${f.name}`} value={value} onChange={onChange} options={options} placeholder={f.required ? undefined : (f.allLabel ?? `All ${f.label}`)} />;
}

export function FilterBar({ filters, values, onApply, onReset, searchLabel = 'Search' }: { filters: FilterDef[]; values: Values; onApply: (v: Values) => void; onReset: () => void; searchLabel?: string }) {
  const [draft, setDraft] = useState(values);
  useEffect(() => setDraft(values), [values]);
  return (
    <Card className="no-print px-4 py-3">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          onApply(draft);
        }}
      >
        {filters.map((f) => (
          <div key={f.name} className="min-w-[150px] flex-1">
            <Label htmlFor={`f-${f.name}`} required={f.required}>{f.label}</Label>
            <FilterField f={f} value={draft[f.name] ?? ''} onChange={(v) => setDraft((d) => ({ ...d, [f.name]: v }))} />
          </div>
        ))}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" icon={Search}>{searchLabel}</Button>
          <Button type="button" icon={RotateCcw} onClick={onReset}>Reset</Button>
        </div>
      </form>
    </Card>
  );
}

/* ------------------------------- Import ------------------------------- */

function ImportModal({ cfg, onClose, onDone }: { cfg: ModuleConfig; onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();
  const imp = cfg.importable!;

  const exportAll = async () => {
    setExporting(true);
    try {
      const all = (await api<Page>(`/c/${cfg.collection}`, { query: { pageSize: 'all' } })).rows;
      await exportExcel(`${cfg.key}-${new Date().toISOString().slice(0, 10)}`, imp.columns.map((c) => ({ label: c.label, value: (r: Row) => String(r[c.key] ?? '') })), all, cfg.title);
    } catch (e) {
      toast.error(e);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Modal
      title={`Import / Export ${cfg.title}`}
      onClose={onClose}
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon={Upload}
            loading={busy}
            disabled={!rows?.length}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                const r = await api<{ created: number }>(`/c/${cfg.collection}/bulk`, { method: 'POST', body: { create: rows } });
                toast.success(`${r.created} record(s) imported.`);
                onDone();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Import {rows?.length ? `${rows.length} rows` : ''}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 p-4">
          <h3 className="mb-1 flex items-center gap-2 font-bold text-brand-700"><Upload className="size-4" /> Import from Excel</h3>
          <p className="text-sm text-slate-700">Upload an Excel file (.xlsx) or a CSV file. The first row must contain the column headings shown in the template. If any row is invalid, the whole file is rejected, so a file is never only partly imported.</p>
          <button className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 underline" onClick={() => downloadTemplate(`${cfg.key}-template`, imp.columns, imp.sample).catch(toast.error)}>
            <Download className="size-4" /> Download Excel template
          </button>
          <label className="mt-3 flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed border-brand-200 bg-brand-50/50 px-4 py-4 hover:border-brand-400">
            <FileSpreadsheet className="size-8 shrink-0 text-green-700" strokeWidth={1.5} />
            <span className="min-w-0 text-sm">
              <span className="block font-semibold text-slate-800">{fileName || 'Choose an Excel or CSV file'}</span>
              <span className="text-slate-500">.xlsx or .csv</span>
            </span>
            <input
              type="file"
              accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                setFileName(file.name);
                setRows(null);
                try {
                  const { rows: parsed, missing } = await readSpreadsheet(file, imp.columns);
                  setError(missing.length ? `Missing columns: ${missing.join(', ')}` : parsed.length ? '' : 'The file has no data rows.');
                  setRows(missing.length || !parsed.length ? null : parsed);
                } catch {
                  setError('Could not read this file. Save it as .xlsx or .csv and try again.');
                }
              }}
            />
          </label>
        </div>
        <div className="rounded-lg border border-slate-200 p-4">
          <h3 className="mb-1 flex items-center gap-2 font-bold text-brand-700"><Download className="size-4" /> Export to Excel</h3>
          <p className="text-sm text-slate-700">Download the complete {cfg.title.toLowerCase()} as an Excel file, using the same columns as the import template.</p>
          <Button className="mt-3" icon={FileSpreadsheet} loading={exporting} onClick={exportAll}>Export Excel</Button>
        </div>
      </div>

      {rows && rows.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-sm font-medium text-green-800">{rows.length} row(s) ready to import{rows.length > 5 ? ' — the first 5 are shown below' : ''}:</p>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="data-table compact text-sm">
              <thead><tr>{imp.columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
              <tbody>{rows.slice(0, 5).map((r, i) => <tr key={i}>{imp.columns.map((c) => <td key={c.key}>{r[c.key] || '—'}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </div>
      )}
      {error && <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
    </Modal>
  );
}

/* --------------------------- Type-wise print --------------------------- */

export function TypePrintModal({ cfg, fetchAll, subtitle, onClose }: { cfg: ModuleConfig; fetchAll: () => Promise<Row[]>; subtitle: string; onClose: () => void }) {
  const { masters } = useMasters();
  const toast = useToast();
  const [mode, setMode] = useState('*');
  const [busy, setBusy] = useState(false);
  const types = masters.categories ?? [];
  const field = cfg.printByType!.field;
  return (
    <Modal
      title={`Print ${cfg.title}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon={Printer}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                printByGroup({
                  title: cfg.title,
                  subtitle,
                  columns: plainColumns(cfg.columns),
                  rows: await fetchAll(),
                  groupBy: (r) => r[field] || '—',
                  order: types,
                  mode,
                  signatures: cfg.printByType!.signatures,
                });
                onClose();
              } catch (e) {
                toast.error(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            Print
          </Button>
        </>
      }
    >
      <Label htmlFor="print-type">Accn Type</Label>
      <Select
        id="print-type"
        value={mode}
        onChange={setMode}
        options={[{ value: '*', label: 'All types – each type separately (new page per type)' }, { value: '', label: 'All types – one combined list' }, ...types.map((t) => ({ value: t, label: `${t} only` }))]}
      />
      <p className="mt-2 text-sm text-slate-600">The filters applied on the page are also applied to the printout.</p>
    </Modal>
  );
}

/* ------------------------------ The page ------------------------------ */

export const plainColumns = (columns: ColumnDef[]): PlainColumn[] => [
  { label: 'S.No.', value: (_r, i) => String(i + 1) },
  ...columns.map((c) => ({
    label: c.label,
    value: (r: Row) => (c.text ? c.text(r) : c.date ? fmtDate(r[c.key]) : typeof c.badge === 'function' ? c.badge(r) : String(r[c.key] ?? '—')),
  })),
];

const PAGE_SIZE = 10;

export function CrudPage({ cfg, embedded }: { cfg: ModuleConfig; embedded?: boolean }) {
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const { canEdit } = useAuth();

  const [params, setParams] = useSearchParams();
  const initialFilters = useMemo(() => Object.fromEntries((cfg.filters ?? []).map((f) => [f.name, f.default?.() ?? ''])), [cfg]);
  // Filters can be pre-set from the URL, e.g. /proceedings?search=AO/001/2026
  const [filters, setFilters] = useState<Values>(() => {
    const fromUrl = Object.fromEntries((cfg.filters ?? []).filter((f) => params.get(f.name)).map((f) => [f.name, params.get(f.name)!]));
    return Object.keys(fromUrl).length ? { ...Object.fromEntries((cfg.filters ?? []).map((f) => [f.name, f.required ? (f.default?.() ?? '') : ''])), ...fromUrl } : initialFilters;
  });
  const [tab, setTab] = useState(0);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page>({ rows: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Row | null>(null);
  const [modal, setModal] = useState<ReactNode>(null);
  const [version, setVersion] = useState(0);

  const query = useMemo(() => {
    const q: Record<string, string> = { ...cfg.baseQuery, ...cfg.tabs?.[tab]?.query };
    for (const f of cfg.filters ?? []) if (filters[f.name] && !(f.overriddenBy && filters[f.overriddenBy])) q[f.param ?? f.name] = filters[f.name];
    if (cfg.sort) q.sort = cfg.sort;
    if (cfg.dir) q.dir = cfg.dir;
    return q;
  }, [cfg, tab, filters]);

  const extra = cfg.extraTabs?.[tab - (cfg.tabs?.length ?? 0)];

  useEffect(() => {
    if (extra) return;
    let live = true;
    setLoading(true);
    api<Page>(`/c/${cfg.collection}`, { query: { ...query, page, pageSize: PAGE_SIZE } })
      .then((r) => {
        if (!live) return;
        if (!r.rows.length && page > 1) return setPage((p) => p - 1);
        setData(r);
        setSelected((s) => (s ? (r.rows.find((x) => x.id === s.id) ?? null) : null));
      })
      .catch((e) => live && toast.error(e))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [cfg.collection, query, page, version, toast, extra]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const close = useCallback(() => setModal(null), []);
  const fetchAll = useCallback(async () => (await api<Page>(`/c/${cfg.collection}`, { query: { ...query, pageSize: 'all' } })).rows, [cfg.collection, query]);
  const setFilter = useCallback((name: string, value: string) => {
    setFilters((f) => ({ ...f, [name]: value }));
    setPage(1);
    setSelected(null);
  }, []);
  const ctx: Ctx = { reload, open: (render) => setModal(render(close)), toast, confirm, navigate, fetchAll, query, version, filters, setFilter };

  const singular = cfg.singular ?? 'record';
  const subtitleForPrint = [cfg.subtitle, ...(cfg.filters ?? []).filter((f) => filters[f.name]).map((f) => `${f.label}: ${filters[f.name]}`)].filter(Boolean).join(' · ');

  const openForm = (row: Row | null, prefill?: Values) => {
    if (row && cfg.editTo) return navigate(cfg.editTo(row));
    if (!row && cfg.add && cfg.add.to) return navigate(cfg.add.to);
    const initial = row ? { ...row } : { ...cfg.defaults?.(), ...cfg.tabs?.[tab]?.defaults, ...prefill };
    setModal(
      <FormModal
        title={row ? `Edit ${singular}` : (cfg.add ? cfg.add.label : `Add ${singular}`)}
        fields={cfg.fields}
        initial={initial}
        isEdit={!!row}
        onClose={close}
        onSubmit={async (values) => {
          const saved = await api<Row>(row ? `/c/${cfg.collection}/${row.id}` : `/c/${cfg.collection}`, { method: row ? 'PUT' : 'POST', body: values });
          toast.success(row ? 'Changes saved.' : `${singular[0].toUpperCase()}${singular.slice(1)} added.`);
          setSelected(saved);
          close();
          reload();
        }}
      />,
    );
  };

  // ?add=1&field=value… opens the add form pre-filled (used by "Allot" on the Seniority List).
  useEffect(() => {
    if (params.get('add') !== '1') return;
    const prefill = Object.fromEntries(cfg.fields.filter((f) => params.get(f.name)).map((f) => [f.name, params.get(f.name)!]));
    setParams({}, { replace: true });
    if (canEdit) openForm(null, prefill);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remove = async (row: Row) => {
    const ok = await confirm({
      title: `Delete ${singular}`,
      message: <>Delete <b>{cfg.deleteLabel?.(row) ?? `this ${singular}`}</b>? This cannot be undone.</>,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/c/${cfg.collection}/${row.id}`, { method: 'DELETE' });
      toast.success(`${singular[0].toUpperCase()}${singular.slice(1)} deleted.`);
      setSelected(null);
      reload();
    } catch (e) {
      toast.error(e);
    }
  };

  const view = (row: Row) =>
    setModal(
      <ViewModal
        title={cfg.deleteLabel?.(row) ?? `${singular[0].toUpperCase()}${singular.slice(1)} details`}
        items={viewItemsFor(cfg.viewFields ?? cfg.fields, row)}
        onClose={close}
        footer={
          cfg.viewFooter || (canEdit && !cfg.noEdit) ? (
            <>
              {cfg.viewFooter?.(ctx, row, close)}
              {canEdit && !cfg.noEdit && <Button icon={Pencil} onClick={() => (close(), openForm(row))}>Edit</Button>}
              <Button variant="primary" onClick={close}>Close</Button>
            </>
          ) : undefined
        }
      />,
    );

  const requireRow = (fn: (r: Row) => void) => () => (selected ? fn(selected) : toast.error(`Select a ${singular} in the table first.`));

  const exportRows = async () => {
    try {
      await exportExcel(`${cfg.key}-${new Date().toISOString().slice(0, 10)}`, plainColumns(cfg.columns), await fetchAll(), cfg.title);
    } catch (e) {
      toast.error(e);
    }
  };
  const printRows = async () => {
    try {
      printTable(cfg.title, subtitleForPrint, plainColumns(cfg.columns), await fetchAll());
    } catch (e) {
      toast.error(e);
    }
  };

  const toolbar = (
    <>
      {canEdit && cfg.add !== false && (
        <Button variant="primary" icon={Plus} onClick={() => openForm(null)}>{cfg.add ? cfg.add.label : `Add ${singular}`}</Button>
      )}
      {cfg.importable && canEdit && (
        <Button icon={Upload} onClick={() => setModal(<ImportModal cfg={cfg} onClose={close} onDone={() => (close(), reload())} />)}>Import / Export</Button>
      )}
      {canEdit && !cfg.noEdit && !cfg.headerToolbar && <Button icon={Pencil} onClick={requireRow(openForm)}>Edit</Button>}
      {(cfg.toolbar ?? [])
        .filter((a) => canEdit || !a.write)
        .map((a) => (
          <Button key={a.label} icon={a.icon} onClick={a.needsRow ? requireRow((r) => a.run(ctx, r)) : () => a.run(ctx, selected)}>
            {a.label}
          </Button>
        ))}
      {canEdit && !cfg.noDelete && !cfg.headerToolbar && <Button icon={Trash2} onClick={requireRow(remove)}>Delete</Button>}
      {cfg.exportable !== false && !cfg.importable && <Button icon={FileSpreadsheet} onClick={exportRows}>Export Excel</Button>}
      <Button
        icon={Printer}
        onClick={
          cfg.onPrint
            ? () => cfg.onPrint!(ctx)
            : cfg.printByType
              ? () => setModal(<TypePrintModal cfg={cfg} fetchAll={fetchAll} subtitle={subtitleForPrint} onClose={close} />)
              : printRows
        }
      >
        {cfg.printLabel ?? 'Print'}
      </Button>
    </>
  );

  const columns: TableColumn<Row>[] = cfg.columns.map((c) => ({
    key: c.key,
    label: c.label,
    className: cx(c.className, (c.date || c.badge) && 'whitespace-nowrap'),
    render: (r) =>
      c.render ? c.render(r)
      : c.badge ? <Badge status={r[c.key]} label={typeof c.badge === 'function' ? c.badge(r) : undefined} />
      : c.date ? fmtDate(r[c.key])
      : c.opensRecord && r[c.key] ? (
          <button
            type="button"
            title="Open details"
            className="font-semibold whitespace-nowrap text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-900 hover:decoration-blue-700"
            onClick={(e) => (e.stopPropagation(), view(r))}
          >
            {r[c.key]}
          </button>
        )
      : c.bold ? <b>{r[c.key] ?? '—'}</b>
      : c.text ? c.text(r)
      : (r[c.key] ?? '—'),
  }));

  const rowActions = (r: Row) => (
    <div className="inline-flex flex-wrap items-center justify-center gap-0.5">
      {cfg.rowView !== false && <IconButton icon={Eye} label="View" onClick={() => view(r)} />}
      {(cfg.rowActions ?? []).filter((a) => (canEdit || !a.write) && (!a.show || a.show(r))).map((a) => (
        a.labelled ? (
          <Button
            key={a.label}
            size="sm"
            icon={a.icon}
            variant={a.tone === 'brand' ? 'primary' : 'outline'}
            className={cx('mx-0.5', a.tone === 'red' && 'border-red-600 text-red-700 hover:bg-red-50')}
            onClick={() => a.run(ctx, r)}
          >
            {a.label}
          </Button>
        ) : (
          <IconButton key={a.label} icon={a.icon} label={a.label} tone={a.tone ?? 'blue'} onClick={() => a.run(ctx, r)} />
        )
      ))}
      {canEdit && !cfg.noEdit && <IconButton icon={Pencil} label="Edit" onClick={() => openForm(r)} />}
      {canEdit && !cfg.noDelete && <IconButton icon={Trash2} label="Delete" tone="red" onClick={() => remove(r)} />}
    </div>
  );

  // On the Quarter Register the cards filter the table directly; elsewhere they open the Quarter Register.
  const statusFilter = cfg.collection === 'quarters' && cfg.filters?.some((f) => f.name === 'status');
  const stats = cfg.stats === 'quarters' ? (
    <QuarterStats
      filters={filters}
      onStatus={statusFilter ? (status) => (setFilters((f) => ({ ...f, status })), setPage(1), setSelected(null)) : undefined}
    />
  ) : cfg.stats === 'waiting' ? <WaitingStats filters={filters} /> : null;
  const filterBar = cfg.filters?.length ? (
    <FilterBar
      filters={cfg.filters}
      values={filters}
      searchLabel={cfg.searchLabel}
      onApply={(v) => {
        setFilters(v);
        setPage(1);
      }}
      onReset={() => {
        setFilters(initialFilters);
        setPage(1);
      }}
    />
  ) : null;

  return (
    <div className="space-y-4">
      {!embedded && <PageHeader icon={cfg.icon} title={cfg.title} subtitle={cfg.subtitle} actions={cfg.headerToolbar ? toolbar : undefined} />}

      {cfg.tabs && (
        <div className="no-print flex gap-1 border-b-2 border-brand-700/80" role="tablist">
          {[...cfg.tabs, ...(cfg.extraTabs ?? [])].map((t, i) => (
            <button
              key={t.label}
              role="tab"
              aria-selected={tab === i}
              onClick={() => {
                setTab(i);
                setPage(1);
                setSelected(null);
              }}
              className={cx('rounded-t-md px-5 py-2 text-sm font-semibold', tab === i ? 'bg-brand-700 text-white' : 'bg-brand-50 text-slate-800 hover:bg-brand-100')}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {extra ? extra.render() : <>
      {cfg.statsFirst ? <>{stats}{filterBar}</> : <>{filterBar}{stats}</>}

      {cfg.topPanel?.(ctx)}

      {!cfg.headerToolbar && (
        <div className="no-print flex flex-wrap items-center justify-between gap-3">
          {cfg.sectionTitle ? <h2 className="rounded-lg bg-brand-700 px-5 py-2 text-lg font-semibold text-white shadow-sm">{cfg.sectionTitle}</h2> : <span />}
          <div className="flex flex-wrap justify-end gap-2">{toolbar}</div>
        </div>
      )}

      <Card className="overflow-hidden">
        <DataTable
          columns={columns}
          rows={data.rows}
          loading={loading}
          offset={(page - 1) * PAGE_SIZE}
          selectedId={selected?.id}
          onSelect={(r) => setSelected((s) => (s?.id === r.id ? null : r))}
          actions={rowActions}
        />
        <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} noun={cfg.noun} />
      </Card>
      </>}
      {modal}
    </div>
  );
}

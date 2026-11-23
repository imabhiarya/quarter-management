import { useEffect, useState } from 'react';
import { BarChart3, CalendarDays, Building2, DoorOpen, Upload, UserRoundSearch, ListOrdered, FileSpreadsheet, RefreshCcw, ScrollText, FileBarChart2, Printer, X, type LucideIcon } from 'lucide-react';
import { api, type Row } from '../lib/api';
import Downloads from './Downloads';
import { TakeoverImportModal } from '../components/TakeoverImport';
import { useToast } from '../lib/context';
import { currentMonth, currentYear, fmtDate, yearOptions } from '../lib/format';
import { printTable, type PlainColumn } from '../lib/exporters';
import { exportExcel } from '../lib/excel';
import { Button, Card, DataTable, Label, PageHeader, Select, cx } from '../components/ui';

type ReportData = { title: string; subtitle: string; columns: { key: string; label: string; type?: 'date' | 'number' }[]; rows: Row[] };

const REPORTS: { key: string; label: string; icon: LucideIcon; period: 'month' | 'year' | 'none' }[] = [
  { key: 'monthly-vacation', label: 'Monthly Vacation Report', icon: CalendarDays, period: 'month' },
  { key: 'occupancy', label: 'Quarter Occupancy Report', icon: Building2, period: 'none' },
  { key: 'occupation', label: 'Quarter Occupation (Take-over) Report', icon: DoorOpen, period: 'year' },
  { key: 'applicant-summary', label: 'Applicant Summary', icon: UserRoundSearch, period: 'year' },
  { key: 'waiting-list', label: 'Waiting List Report', icon: ListOrdered, period: 'none' },
  { key: 'allotment-statement', label: 'Allotment Statement', icon: FileSpreadsheet, period: 'year' },
  { key: 'retention-extension', label: 'Retention / Extension Report', icon: RefreshCcw, period: 'year' },
  { key: 'proceedings-register', label: 'Proceedings Register', icon: ScrollText, period: 'year' },
  { key: 'annual-return', label: 'Annual Return', icon: FileBarChart2, period: 'year' },
];

export default function Reports() {
  const [section, setSection] = useState<'reports' | 'downloads'>('reports');
  const [active, setActive] = useState<string | null>(null);
  const [month, setMonth] = useState(currentMonth());
  const [year, setYear] = useState(currentYear());
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState(0);
  const [importing, setImporting] = useState(false);
  const toast = useToast();
  const def = REPORTS.find((r) => r.key === active);

  useEffect(() => {
    if (!active) return;
    setLoading(true);
    api<ReportData>(`/reports/${active}`, { query: { month, year } })
      .then(setData)
      .catch(toast.error)
      .finally(() => setLoading(false));
  }, [active, month, year, toast, version]);

  const rows = (data?.rows ?? []).map((r, i) => ({ ...r, id: (r.id as number) ?? i + 1 }));
  const fmt = (c: ReportData['columns'][number], r: Row) => (c.type === 'date' ? fmtDate(r[c.key]) : String(r[c.key] ?? '—'));
  const plain: PlainColumn[] = [{ label: 'S.No.', value: (_r, i) => String(i + 1) }, ...(data?.columns ?? []).map((c) => ({ label: c.label, value: (r: Row) => fmt(c, r) }))];

  return (
    <div className="space-y-5">
      <PageHeader icon={BarChart3} title="Reports & Returns" subtitle="Generate, print and export statutory reports and returns, and download uploaded documents" />

      <div className="flex gap-1 border-b-2 border-brand-700/80" role="tablist">
        {([['reports', 'Reports & Returns'], ['downloads', 'Download Documents']] as const).map(([k, l]) => (
          <button
            key={k}
            role="tab"
            aria-selected={section === k}
            onClick={() => setSection(k)}
            className={cx('rounded-t-md px-5 py-2 text-sm font-semibold', section === k ? 'bg-brand-700 text-white' : 'bg-brand-50 text-slate-800 hover:bg-brand-100')}
          >
            {l}
          </button>
        ))}
      </div>

      {section === 'downloads' ? <Downloads /> : <>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {REPORTS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActive(key)}
            aria-pressed={active === key}
            className={cx(
              'flex flex-col items-center gap-3 rounded-xl border bg-gradient-to-b from-white to-brand-50/70 px-3 py-6 text-center text-[15px] font-semibold text-slate-800 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md',
              active === key ? 'border-brand-600 ring-2 ring-brand-600/30' : 'border-brand-200',
            )}
          >
            <Icon className="size-10 text-brand-700" strokeWidth={1.5} />
            {label}
          </button>
        ))}
      </div>

      {def && (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 bg-brand-50/60 px-5 py-3">
            <div>
              <h2 className="text-xl font-bold text-brand-700">{data?.title ?? def.label}</h2>
              <p className="text-sm text-slate-600">{data?.subtitle}</p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              {def.period === 'month' && (
                <div><Label htmlFor="rep-month">Month</Label><input id="rep-month" type="month" className="input" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
              )}
              {def.period === 'year' && (
                <div className="w-32"><Label htmlFor="rep-year">Year</Label><Select id="rep-year" value={year} onChange={setYear} options={yearOptions()} /></div>
              )}
              {def.key === 'occupation' && (
                <Button variant="primary" icon={Upload} onClick={() => setImporting(true)}>Import BSO Report</Button>
              )}
              <Button icon={FileSpreadsheet} disabled={!data} onClick={() => data && exportExcel(active!, plain, rows, data.title).catch(toast.error)}>Export Excel</Button>
              <Button icon={Printer} disabled={!data} onClick={() => data && printTable(data.title, data.subtitle, plain, rows)}>Print</Button>
              <Button icon={X} aria-label="Close report" onClick={() => (setActive(null), setData(null))} />
            </div>
          </div>
          <DataTable
            loading={loading}
            rows={rows}
            columns={(data?.columns ?? []).map((c) => ({ key: c.key, label: c.label, className: c.type === 'number' ? 'text-center' : undefined, render: (r: Row) => fmt(c, r) }))}
            emptyText="No records for the selected period."
          />
        </Card>
      )}
      </>}
      {importing && <TakeoverImportModal onClose={() => setImporting(false)} onDone={() => (setImporting(false), setVersion((v) => v + 1))} />}
    </div>
  );
}

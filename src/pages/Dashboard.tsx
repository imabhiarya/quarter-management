import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  House, Building2, Users, KeyRound, DoorOpen, FileText, ArrowRight, CalendarDays, BarChart3, Zap, FilePlus2, CalendarPlus, ScrollText, Wrench, FileBarChart2,
} from 'lucide-react';
import { api, type Row } from '../lib/api';
import { useToast } from '../lib/context';
import { currentMonth, fmtDate, recentMonths } from '../lib/format';
import { Badge, Card, PageHeader, StatCard } from '../components/ui';
import { ApplicationLink } from '../components/ApplicationViewer';
import { PENDING_STAGE } from '../modules';

type Dash = {
  totalQuarters: number;
  vacantQuarters: number;
  pendingApplications: number;
  allottedQuarters: number;
  recentApplications: Row[];
  recentProceedings: Row[];
  takeover: { awaiting: number; overdue: number };
  funnel: { received: number; eligible: number; recommended: number; allotted: number };
};

function Panel({ icon: Icon, title, action, children }: { icon: typeof House; title: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-brand-100 bg-gradient-to-r from-brand-50 to-white px-5 py-3">
        <h2 className="flex items-center gap-2.5 text-lg font-bold text-brand-700"><Icon className="size-6" strokeWidth={1.8} />{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

const QUICK = [
  { to: '/new-application', label: 'New Application', icon: FilePlus2 },
  { to: '/vacation-report', label: 'Vacation Report', icon: CalendarPlus },
  { to: '/proceedings', label: 'Proceedings', icon: ScrollText },
  { to: '/quarter-allotment', label: 'Quarter Allotment', icon: Wrench },
  { to: '/allotment-orders', label: 'Allotment Orders', icon: FileText },
  { to: '/reports', label: 'Reports & Returns', icon: FileBarChart2 },
];

export default function Dashboard() {
  const [month, setMonth] = useState(currentMonth());
  const [d, setD] = useState<Dash | null>(null);
  const toast = useToast();

  useEffect(() => {
    api<Dash>('/stats/dashboard', { query: { month } }).then(setD).catch(toast.error);
  }, [month, toast]);

  const max = Math.max(1, d?.funnel.received ?? 0);
  const bars = d
    ? [
        { label: 'Applications Received', value: d.funnel.received, cls: 'bg-brand-700' },
        { label: 'Eligible for Consideration', value: d.funnel.eligible, cls: 'bg-brand-600' },
        { label: 'Recommended by Committee', value: d.funnel.recommended, cls: 'bg-brand-500' },
        { label: 'Approved & Allotted', value: d.funnel.allotted, cls: 'bg-brand-400' },
      ]
    : [];

  return (
    <div className="space-y-5">
      <PageHeader
        icon={House}
        title="Dashboard"
        subtitle="Overview of Government Married Accommodation (AWAS)"
        actions={
          <label className="flex items-center gap-3 text-[15px] font-medium text-slate-700">
            Month
            <span className="relative">
              <CalendarDays className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-500" />
              <select className="input min-w-52 pl-9" value={month} onChange={(e) => setMonth(e.target.value)}>
                {recentMonths(24).map((o) => (
                  <option key={o.value} value={o.value}>{o.label.replace(' - ', ' ')}</option>
                ))}
              </select>
            </span>
          </label>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatCard tone="rose" icon={Building2} label="Total Quarters" value={d?.totalQuarters} loading={!d} to="/quarter-register" />
        <StatCard tone="green" icon={House} label="Vacant Quarters" value={d?.vacantQuarters} loading={!d} to="/quarter-register?status=Vacant" />
        <StatCard tone="blue" icon={Users} label="Pending Applications" value={d?.pendingApplications} loading={!d} to={`/applicant-register?stage=${encodeURIComponent(PENDING_STAGE)}`} />
        <StatCard tone="amber" icon={KeyRound} label="Allotted Quarters" value={d?.allottedQuarters} loading={!d} to="/quarter-register?status=Occupied" />
      </div>

      {d && (d.takeover.overdue > 0 || d.takeover.awaiting > 0) && (
        <Link
          to="/quarter-occupation"
          className={`flex flex-wrap items-center gap-3 rounded-xl border px-5 py-3 text-[15px] shadow-sm ${d.takeover.overdue ? 'border-red-300 bg-red-50 text-red-900' : 'border-sky-200 bg-sky-50 text-sky-900'}`}
        >
          <DoorOpen className="size-6 shrink-0" />
          <span className="flex-1">
            {d.takeover.overdue > 0 && <b>{d.takeover.overdue} allotted quarter(s) not taken over – action due as per Rule 7 (1) of SRO 308. </b>}
            {d.takeover.awaiting > 0 && <span>{d.takeover.awaiting} allotment(s) awaiting take-over from the BSO office.</span>}
          </span>
          <span className="flex items-center gap-1 font-semibold underline underline-offset-2">Quarter Occupation <ArrowRight className="size-4" /></span>
        </Link>
      )}

      <div className="grid gap-5 xl:grid-cols-[1.45fr_1fr]">
        <Panel
          icon={FileText}
          title="Recent Applications"
          action={<Link to="/applicant-register" className="flex items-center gap-1 text-sm font-semibold text-brand-700 underline underline-offset-2">View All <ArrowRight className="size-4" /></Link>}
        >
          <div className="overflow-x-auto">
            <table className="data-table compact">
              <thead>
                <tr><th>S.No.</th><th>Application No.</th><th>Employee Name</th><th>Entitlement</th><th>App. Date</th><th>Status</th></tr>
              </thead>
              <tbody>
                {d?.recentApplications.map((a, i) => (
                  <tr key={a.id}>
                    <td className="text-center">{i + 1}</td>
                    <td className="whitespace-nowrap"><ApplicationLink no={a.applicationNo} /></td>
                    <td>{a.name}</td>
                    <td>{a.entitlement}</td>
                    <td className="whitespace-nowrap">{fmtDate(a.applicationDate)}</td>
                    <td><Badge status={a.status} /></td>
                  </tr>
                ))}
                {d && !d.recentApplications.length && <tr><td colSpan={6} className="py-6 text-center text-slate-500">No applications yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel
          icon={ScrollText}
          title="Recent Proceedings"
          action={<Link to="/proceedings" className="flex items-center gap-1 text-sm font-semibold text-brand-700 underline underline-offset-2">View All <ArrowRight className="size-4" /></Link>}
        >
          <div className="overflow-x-auto">
            <table className="data-table compact">
              <thead>
                <tr><th>Proceedings No.</th><th>Date</th><th>Presiding Officer</th><th className="text-center">Allotments</th></tr>
              </thead>
              <tbody>
                {d?.recentProceedings.map((p) => (
                  <tr key={p.id}>
                    <td className="whitespace-nowrap"><Link to={`/proceedings?search=${encodeURIComponent(p.proceedingsNo)}`} className="font-semibold text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-900">{p.proceedingsNo}</Link></td>
                    <td className="whitespace-nowrap">{fmtDate(p.proceedingsDate)}</td>
                    <td>{p.presidingOfficer || '—'}</td>
                    <td className="text-center">{p.allotments}</td>
                  </tr>
                ))}
                {d && !d.recentProceedings.length && <tr><td colSpan={4} className="py-6 text-center text-slate-500">No proceedings recorded yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel icon={BarChart3} title={<>Allotment Status <span className="font-medium text-slate-700">(Selected Month)</span></>}>
          <ul className="divide-y divide-slate-100 px-5 py-2">
            {bars.map((b) => (
              <li key={b.label} className="grid grid-cols-[1fr_2.5rem_minmax(100px,1.2fr)] items-center gap-3 py-3 text-[15px]">
                <span>{b.label}</span>
                <span className="text-right font-bold tabular-nums">{String(b.value).padStart(2, '0')}</span>
                <span className="h-3.5 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${b.value}`}>
                  <span className={`block h-full rounded-full ${b.cls}`} style={{ width: `${(b.value / max) * 100}%` }} />
                </span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel icon={Zap} title="Quick Actions">
          <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3">
            {QUICK.map(({ to, label, icon: Icon }) => (
              <Link key={to} to={to} className="flex flex-col items-center gap-2 rounded-xl border border-slate-200 bg-gradient-to-b from-white to-brand-50/60 px-2 py-4 text-center text-[15px] font-semibold text-slate-800 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md">
                <Icon className="size-9 text-brand-700" strokeWidth={1.5} />
                {label}
              </Link>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

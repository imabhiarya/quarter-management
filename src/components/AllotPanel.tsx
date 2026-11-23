import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { KeyRound, UserCheck, Save, Paperclip, Inbox, CheckCircle2 } from 'lucide-react';
import { api, type Page, type Row } from '../lib/api';
import { useAuth, useMasters, useToast } from '../lib/context';
import { fmtDate, isoDate } from '../lib/format';
import { Badge, Button, Card, Label, Modal, Select, cx } from './ui';
import { DocumentsModal } from './Workflow';
import { ApplicationLink } from './ApplicationViewer';
import { PriorityChip, PriorityControls, usePriorityRules } from './PriorityControls';

const ACCEPTED = ['Eligible', 'Recommended'];
const entitledType = (a: Row) => a.entitlement || a.categoryRequested || '';
const rankName = (r: Row) => `${r.rank && r.rank !== 'Civilian' ? `${r.rank} ` : ''}${r.name}`;

/** Allot one accepted applicant a vacant quarter of the type they are entitled to. */
function AllotModal({ app, vacant, onClose, onDone }: { app: Row; vacant: Row[]; onClose: () => void; onDone: () => void }) {
  const type = entitledType(app);
  // Quarters at the applicant's chosen location come first, then their pool, then their station.
  const options = useMemo(
    () =>
      vacant
        .filter((q) => q.category === type)
        .map((q) => ({
          q,
          score: (app.locationRequested && q.location === app.locationRequested ? 4 : 0) + (q.accnPool && q.accnPool === app.accnPool ? 2 : 0) + (app.station && q.station === app.station ? 1 : 0),
        }))
        .sort((a, b) => b.score - a.score || a.q.quarterNo.localeCompare(b.q.quarterNo, 'en-GB', { numeric: true })),
    [vacant, type, app],
  );
  const [quarterNo, setQuarterNo] = useState('');
  const [allotmentDate, setAllotmentDate] = useState(isoDate());
  const [fromDate, setFromDate] = useState(isoDate());
  const [toDate, setToDate] = useState('');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();

  const submit = async () => {
    if (!quarterNo) return setError('Select a vacant quarter.');
    setBusy(true);
    setError('');
    try {
      const r = await api<Row>('/c/allotments', { method: 'POST', body: { applicationNo: app.applicationNo, quarterNo, allotmentDate, fromDate, toDate, remarks } });
      toast.success(`${r.quarterNo} allotted to ${rankName(app)}. Order ${r.orderNo} generated.`);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Allot Quarter"
      wide
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Save} loading={busy} disabled={!options.length} onClick={submit}>Allot Quarter</Button>
        </>
      }
    >
      <div className="mb-4 grid gap-x-6 gap-y-1 rounded-lg bg-slate-50 px-4 py-3 text-sm sm:grid-cols-2">
        <div className="sm:col-span-2 text-base font-semibold text-slate-900">{rankName(app)} <span className="font-normal text-slate-600">({app.serviceNo})</span></div>
        <div>Application: <b>{app.applicationNo}</b></div>
        <div>Pay Level: <b>{app.payLevel}</b></div>
        <div>Entitlement: <b className="text-brand-700">{type || '—'}</b></div>
        <div>Requested: <b>{app.categoryRequested}</b></div>
        <div>Pool / Location: <b>{app.accnPool || '—'} / {app.locationRequested || '—'}</b></div>
        <div>Ground: <b>{app.applicationGround || 'Regular'}</b> · {app.applicationType}</div>
      </div>

      <Label required>Vacant {type} quarters</Label>
      {options.length === 0 ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          No {type} quarter is vacant at present. Record a vacation, or mark a repaired quarter vacant, to allot one.
        </p>
      ) : (
        <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200" role="radiogroup">
          {options.map(({ q, score }) => (
            <label key={q.id} className={cx('flex cursor-pointer items-center gap-3 border-b border-slate-100 px-3 py-2 text-sm last:border-0 hover:bg-brand-50', quarterNo === q.quarterNo && 'bg-brand-100/70')}>
              <input type="radio" name="quarter" className="size-4 accent-brand-700" checked={quarterNo === q.quarterNo} onChange={() => (setQuarterNo(q.quarterNo), setError(''))} />
              <span className="w-24 font-bold">{q.quarterNo}</span>
              <span className="flex-1 text-slate-700">{q.station} / {q.subDivision}{q.location ? ` · ${q.location}` : ''}{q.block ? ` · ${q.block}` : ''} · {q.accnPool || 'no pool'}</span>
              {score >= 4 && <span className="flex items-center gap-1 text-xs font-semibold text-green-700"><CheckCircle2 className="size-3.5" /> Chosen location</span>}
              {score % 4 >= 2 && <span className="flex items-center gap-1 text-xs font-semibold text-green-700"><CheckCircle2 className="size-3.5" /> Requested pool</span>}
            </label>
          ))}
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div><Label htmlFor="al-date" required>Allotment Date</Label><input id="al-date" type="date" className="input" value={allotmentDate} onChange={(e) => setAllotmentDate(e.target.value)} /></div>
        <div><Label htmlFor="al-from" required>From Date</Label><input id="al-from" type="date" className="input" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></div>
        <div>
          <Label htmlFor="al-to">To Date / Retention Upto</Label>
          <input id="al-to" type="date" className="input" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          <p className="mt-1 text-xs text-slate-500">Blank = standard tenure</p>
        </div>
        <div className="sm:col-span-3"><Label htmlFor="al-rem">Remarks</Label><textarea id="al-rem" rows={2} className="input" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div>
      </div>
      {error && <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
    </Modal>
  );
}

/** Applicants accepted in scrutiny and waiting for a quarter, in seniority order. */
export function AllotPanel({ onAllotted, version }: { onAllotted: () => void; version: number }) {
  const [apps, setApps] = useState<Row[] | null>(null);
  const [vacant, setVacant] = useState<Row[]>([]);
  const [type, setType] = useState('');
  const [prioFilter, setPrioFilter] = useState('');
  const [locFilter, setLocFilter] = useState('');
  const [prioOptions, setPrioOptions] = useState<{ value: string; label: string }[]>([]);
  const [modal, setModal] = useState<React.ReactNode>(null);
  const [refresh, setRefresh] = useState(0);
  const [params, setParams] = useSearchParams();
  const { masters } = useMasters();
  const { canEdit } = useAuth();
  const toast = useToast();
  const prio = usePriorityRules();
  const showPrio = !!prio.rules?.length;

  useEffect(() => {
    Promise.all([api<Row[]>('/seniority'), api<Page>('/c/quarters', { query: { status: 'Vacant', pageSize: 'all' } })])
      .then(([s, q]) => {
        setApps(s.filter((a) => ACCEPTED.includes(a.status)));
        setVacant(q.rows);
      })
      .catch(toast.error);
  }, [version, refresh, toast, prio.version]);
  useEffect(() => {
    api<{ value: string; label: string }[]>('/priority-options')
      .then((o) => {
        setPrioOptions(o);
        setPrioFilter((f) => (o.some((x) => x.value === f) ? f : ''));
      })
      .catch(() => setPrioOptions([]));
  }, [prio.version]);

  const vacantByType = useMemo(() => {
    const m = new Map<string, number>();
    for (const q of vacant) m.set(q.category, (m.get(q.category) ?? 0) + 1);
    return m;
  }, [vacant]);

  const close = () => setModal(null);
  const openAllot = (a: Row) =>
    setModal(<AllotModal app={a} vacant={vacant} onClose={close} onDone={() => (close(), setRefresh((n) => n + 1), onAllotted())} />);

  // Opened from Seniority List / Application Scrutiny with ?allot=<application no.>
  useEffect(() => {
    const no = params.get('allot');
    if (!no || !apps) return;
    setParams({}, { replace: true });
    const a = apps.find((x) => x.applicationNo === no);
    if (!a) return toast.error(`${no} is not an accepted application awaiting allotment.`);
    if (canEdit) openAllot(a);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apps]);

  const types = masters.categories ?? [];
  const inPrio = (a: Row) => (!prioFilter || String(a.priorityGroup) === prioFilter) && (!locFilter || (a.locationRequested || '') === locFilter);
  /** Vacant quarters of the applicant's type at the location they applied for. */
  const vacantAtLocation = (a: Row) => (a.locationRequested ? vacant.filter((q) => q.category === entitledType(a) && q.location === a.locationRequested).length : 0);
  const list = (apps ?? []).filter((a) => (!type || entitledType(a) === type) && inPrio(a));

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-brand-100 bg-gradient-to-r from-brand-50 to-white px-4 py-3">
        <h2 className="flex items-center gap-2 text-lg font-bold text-brand-700">
          <UserCheck className="size-5" /> Accepted Applicants – Awaiting Allotment
          {apps && <span className="rounded-full bg-brand-700 px-2.5 text-sm text-white">{apps.length}</span>}
        </h2>
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {['', ...types].map((t) => {
            const n = (apps ?? []).filter((a) => (!t || entitledType(a) === t) && inPrio(a)).length;
            return (
              <button
                key={t || 'all'}
                role="tab"
                aria-selected={type === t}
                onClick={() => setType(t)}
                className={cx('rounded-full border px-3 py-1 text-sm font-semibold', type === t ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-brand-50')}
              >
                {t || 'All'} <span className="opacity-75">({n}{t ? ` · ${vacantByType.get(t) ?? 0} vacant` : ''})</span>
              </button>
            );
          })}
        </div>
        <div className="w-full sm:w-56">
          <Select id="allot-loc" value={locFilter} onChange={setLocFilter} options={masters.locations ?? []} placeholder="All Locations (applied for)" />
        </div>
        {prioOptions.length > 0 && (
          <div className="w-full sm:w-72">
            <Select id="allot-prio" value={prioFilter} onChange={setPrioFilter} options={prioOptions} placeholder="All Priorities" />
          </div>
        )}
      </div>
      <PriorityControls rules={prio.rules} onSave={prio.save} className="m-3" />
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th className="w-20 text-center">Seniority</th>
              {showPrio && <th>Priority</th>}
              <th>Application No.</th>
              <th>Application Date</th>
              <th>Rank &amp; Name</th>
              <th>Office Name</th>
              <th>Service No.</th>
              <th>Pay Level</th>
              <th>Entitlement</th>
              <th>Pool / Location</th>
              <th>Ground</th>
              <th>Accepted On</th>
              <th>Status</th>
              <th className="text-center">Vacant of Type</th>
              <th className="no-print text-center">Action</th>
            </tr>
          </thead>
          <tbody>
            {apps === null && (
              <tr><td colSpan={showPrio ? 15 : 14}><div className="h-5 animate-pulse rounded bg-slate-100" /></td></tr>
            )}
            {apps && list.length === 0 && (
              <tr>
                <td colSpan={showPrio ? 15 : 14} className="py-8 text-center text-slate-500">
                  <Inbox className="mx-auto mb-2 size-7 opacity-50" />
                  No accepted applicants waiting{type ? ` for ${type}` : ''}{locFilter ? ` at ${locFilter}` : ''}{prioFilter ? ' in this priority' : ''}. Accept applications in Application Scrutiny first.
                </td>
              </tr>
            )}
            {list.map((a) => {
              const free = vacantByType.get(entitledType(a)) ?? 0;
              return (
                <tr key={a.id}>
                  <td className="text-center text-lg font-bold text-brand-700">{a.seniorityNo}</td>
                  {showPrio && <td><PriorityChip row={a} /></td>}
                  <td className="whitespace-nowrap"><ApplicationLink no={a.applicationNo} /></td>
                  <td className="whitespace-nowrap">{fmtDate(a.applicationDate)}</td>
                  <td className="font-medium">{rankName(a)}</td>
                  <td>{a.officeName || '—'}</td>
                  <td>{a.serviceNo}</td>
                  <td>{a.payLevel}</td>
                  <td className="font-semibold">{entitledType(a)}</td>
                  <td>{a.accnPool || '—'} / {a.locationRequested || '—'}</td>
                  <td>{a.applicationGround || 'Regular'}</td>
                  <td className="whitespace-nowrap">{fmtDate(a.scrutinyDate)}</td>
                  <td><Badge status={a.status} /></td>
                  <td className="text-center">
                    <span className={cx('rounded-md px-2 py-0.5 text-sm font-bold', free ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-500')}>{free}</span>
                    {a.locationRequested && (
                      <span className={cx('mt-0.5 block text-[11px] whitespace-nowrap', vacantAtLocation(a) ? 'font-semibold text-green-700' : 'text-slate-500')}>
                        {vacantAtLocation(a)} at {a.locationRequested}
                      </span>
                    )}
                  </td>
                  <td className="no-print text-center whitespace-nowrap">
                    <Button size="sm" icon={Paperclip} className="mx-0.5" onClick={() => setModal(<DocumentsModal row={a} onClose={close} />)}>Documents</Button>
                    {canEdit && (
                      <Button size="sm" variant="primary" icon={KeyRound} className="mx-0.5" disabled={!free} title={free ? undefined : `No vacant ${entitledType(a)} quarter`} onClick={() => openAllot(a)}>
                        Allot
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {modal}
    </Card>
  );
}

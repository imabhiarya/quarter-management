import { useEffect, useMemo, useState } from 'react';
import { MapPin, MapPinned, Save, X } from 'lucide-react';
import { api, type Page, type Row } from '../lib/api';
import { useAuth, useMasters, useToast } from '../lib/context';
import { Button, Card, Label, Modal, Select, cx } from './ui';
import type { Ctx } from './CrudPage';

type LocRow = { location: string; total: number; occupied: number; vacant: number; underRepair: number; vacantByType: Record<string, number> };
type Summary = { categories: string[]; rows: LocRow[]; notSet: LocRow | null };

/** Quarter Register: quarters location-wise. Click a location to filter the register by it. */
export function LocationSummary({ ctx }: { ctx: Ctx }) {
  const [s, setS] = useState<Summary | null>(null);
  const { canEdit } = useAuth();
  const { station = '', subDivision = '', category = '', accnPool = '' } = ctx.query;
  const active = ctx.filters.location ?? '';

  useEffect(() => {
    api<Summary>('/stats/quarters-by-location', { query: { station, subDivision, category, accnPool } }).then(setS).catch(ctx.toast.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [station, subDivision, category, accnPool, ctx.version]);

  const rows = s ? [...s.rows, ...(s.notSet ? [s.notSet] : [])] : [];
  const pick = (loc: string) => ctx.setFilter('location', loc === active ? '' : loc);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-teal-100 bg-gradient-to-r from-teal-50 via-white to-sky-50 px-4 py-2.5">
        <h2 className="flex items-center gap-2 font-bold text-teal-800">
          <MapPin className="size-5" /> Location-wise Quarters
          {active && (
            <button type="button" onClick={() => ctx.setFilter('location', '')} className="ml-1 flex items-center gap-1 rounded-full bg-teal-700 px-2.5 py-0.5 text-xs font-semibold text-white">
              Showing: {active} <X className="size-3" />
            </button>
          )}
        </h2>
        {canEdit && (
          <Button size="sm" icon={MapPinned} onClick={() => ctx.open((close) => <SetLocationModal onClose={close} onDone={() => (close(), ctx.reload())} />)}>
            Set Location for Quarters
          </Button>
        )}
      </div>
      {!s ? (
        <div className="m-4 h-14 animate-pulse rounded bg-slate-100" />
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Location</th>
                <th className="text-center">Total</th>
                <th className="text-center">Occupied</th>
                <th className="text-center">Vacant</th>
                <th className="text-center">Under Repair</th>
                <th>Vacant by Type</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const key = r.location || 'Not set';
                const on = active === r.location && !!r.location;
                return (
                  <tr key={key} className={cx(on && 'bg-teal-50')}>
                    <td>
                      {r.location ? (
                        <button type="button" disabled={!r.total} onClick={() => pick(r.location)} className={cx('font-semibold', r.total ? 'text-teal-800 hover:underline' : 'text-slate-400')}>
                          {r.location}
                        </button>
                      ) : (
                        <span className="font-semibold text-amber-700 italic">Location not set</span>
                      )}
                    </td>
                    <td className="text-center font-bold">{r.total}</td>
                    <td className="text-center text-green-700">{r.occupied}</td>
                    <td className="text-center">
                      <span className={cx('rounded-md px-2 py-0.5 font-bold', r.vacant ? 'bg-emerald-100 text-emerald-800' : 'text-slate-400')}>{r.vacant}</span>
                    </td>
                    <td className="text-center text-amber-700">{r.underRepair}</td>
                    <td className="text-sm">
                      {s.categories.filter((c) => r.vacantByType[c]).map((c) => `${c}: ${r.vacantByType[c]}`).join(' · ') || <span className="text-slate-400">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
        Click a location to show only its quarters below (click again to clear). Station, sub-division, category and pool filters also apply here.
        {s?.notSet && canEdit && <> <b>{s.notSet.total} quarter(s) have no location</b> — use <b>Set Location for Quarters</b> to fill them in quickly.</>}
      </p>
    </Card>
  );
}

/** Set the location of many quarters at once, picked by station / sub-division / block / number. */
function SetLocationModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { masters } = useMasters();
  const toast = useToast();
  const [all, setAll] = useState<Row[] | null>(null);
  const [station, setStation] = useState('');
  const [subDivision, setSubDivision] = useState('');
  const [block, setBlock] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [location, setLocation] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Page>('/c/quarters', { query: { pageSize: 'all', sort: 'quarterNo' } }).then((r) => setAll(r.rows)).catch(toast.error);
  }, [toast]);

  const blocks = useMemo(() => [...new Set((all ?? []).map((q) => String(q.block ?? '')).filter(Boolean))].sort(), [all]);
  const list = useMemo(
    () => (all ?? []).filter((q) => (!station || q.station === station) && (!subDivision || q.subDivision === subDivision) && (!block || q.block === block) && (!onlyMissing || !q.location)),
    [all, station, subDivision, block, onlyMissing],
  );
  useEffect(() => setPicked(new Set(list.map((q) => q.id))), [list]);

  const save = async () => {
    if (!location) return toast.error('Choose the location to set.');
    const ids = list.filter((q) => picked.has(q.id)).map((q) => q.id);
    if (!ids.length) return toast.error('Tick at least one quarter.');
    setBusy(true);
    try {
      await api('/c/quarters/bulk', { method: 'POST', body: { patch: ids.map((id) => ({ id, data: { location } })) } });
      toast.success(`Location "${location}" set for ${ids.length} quarter(s).`);
      onDone();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Set Location for Quarters"
      wide
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Save} loading={busy} onClick={save}>Set Location ({picked.size})</Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <div><Label htmlFor="sl-st">Station</Label><Select id="sl-st" value={station} onChange={setStation} options={masters.stations ?? []} placeholder="All Stations" /></div>
        <div><Label htmlFor="sl-sd">Sub-Division</Label><Select id="sl-sd" value={subDivision} onChange={setSubDivision} options={masters.subDivisions ?? []} placeholder="All Sub-Divisions" /></div>
        <div><Label htmlFor="sl-bl">Block</Label><Select id="sl-bl" value={block} onChange={setBlock} options={blocks} placeholder="All Blocks" /></div>
        <div>
          <Label htmlFor="sl-loc" required>Set Location to</Label>
          <Select id="sl-loc" value={location} onChange={setLocation} options={masters.locations ?? []} placeholder="Choose location" invalid={!location} />
        </div>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4 accent-brand-700" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
        Only quarters with no location yet
      </label>
      <div className="mt-3 flex items-center justify-between bg-brand-50 px-3 py-1.5 text-sm">
        <b className="text-brand-800">{picked.size} of {list.length} quarter(s) ticked</b>
        <span className="flex gap-3">
          <button type="button" className="font-semibold text-brand-700 hover:underline" onClick={() => setPicked(new Set(list.map((q) => q.id)))}>Tick all</button>
          <button type="button" className="font-semibold text-brand-700 hover:underline" onClick={() => setPicked(new Set())}>Clear</button>
        </span>
      </div>
      {all === null ? (
        <p className="py-4 text-sm text-slate-500">Loading…</p>
      ) : !list.length ? (
        <p className="py-4 text-center text-sm text-slate-500">No quarters match.</p>
      ) : (
        <ul className="grid max-h-72 gap-1 overflow-y-auto py-2 sm:grid-cols-3">
          {list.map((q) => (
            <li key={q.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50">
                <input
                  type="checkbox"
                  className="size-4 accent-brand-700"
                  checked={picked.has(q.id)}
                  onChange={() => setPicked((s) => { const n = new Set(s); if (n.has(q.id)) n.delete(q.id); else n.add(q.id); return n; })}
                />
                <b>{q.quarterNo}</b>
                <span className="truncate text-slate-500">{q.category} · {q.station}/{q.subDivision}{q.block ? ` · ${q.block}` : ''}{q.location ? ` · ${q.location}` : ''}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

type AppCell = { total: number; pending: number };
type AppLocRow = { location: string; total: number; pending: number; allotted: number; byType: Record<string, AppCell> };
type AppSummary = { categories: string[]; rows: AppLocRow[]; notSet: AppLocRow | null; total: number };

/** Applicant Register: applications by the location chosen in the application and the type of quarter requested. */
export function ApplicationLocationSummary({ ctx }: { ctx: Ctx }) {
  const [s, setS] = useState<AppSummary | null>(null);
  const { station = '', subDivision = '', status = '', in_status = '', q = '' } = ctx.query;
  const activeLoc = ctx.filters.locationRequested ?? '';
  const activeType = ctx.filters.categoryRequested ?? '';

  useEffect(() => {
    api<AppSummary>('/stats/applications-by-location', { query: { station, subDivision, status, in_status, q } }).then(setS).catch(ctx.toast.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [station, subDivision, status, in_status, q, ctx.version]);

  const rows = s ? [...s.rows, ...(s.notSet ? [s.notSet] : [])] : [];
  const pick = (loc: string, type: string) => {
    const same = loc === activeLoc && type === activeType;
    ctx.setFilter('locationRequested', same ? '' : loc);
    ctx.setFilter('categoryRequested', same ? '' : type);
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-violet-100 bg-gradient-to-r from-violet-50 via-white to-sky-50 px-4 py-2.5">
        <h2 className="flex items-center gap-2 font-bold text-violet-800">
          <MapPin className="size-5" /> Applications – Location &amp; Type wise
          {s && <span className="text-sm font-medium text-slate-600">({s.total} application(s))</span>}
        </h2>
        {(activeLoc || activeType) && (
          <button type="button" onClick={() => pick(activeLoc, activeType)} className="flex items-center gap-1 rounded-full bg-violet-700 px-2.5 py-0.5 text-xs font-semibold text-white">
            Showing: {[activeLoc, activeType].filter(Boolean).join(' · ')} <X className="size-3" />
          </button>
        )}
      </div>
      {!s ? (
        <div className="m-4 h-14 animate-pulse rounded bg-slate-100" />
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Location (chosen by applicant)</th>
                {s.categories.map((c) => <th key={c} className="text-center">{c}</th>)}
                <th className="text-center">Total</th>
                <th className="text-center">Pending</th>
                <th className="text-center">Allotted</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.location || 'not-set'} className={cx(activeLoc && activeLoc === r.location && 'bg-violet-50')}>
                  <td>
                    {r.location ? (
                      <button type="button" disabled={!r.total} onClick={() => pick(r.location, '')} className={cx('font-semibold', r.total ? 'text-violet-800 hover:underline' : 'text-slate-400')}>
                        {r.location}
                      </button>
                    ) : (
                      <span className="font-semibold text-amber-700 italic">Location not given</span>
                    )}
                  </td>
                  {s.categories.map((c) => {
                    const cell = r.byType[c];
                    const on = activeLoc === r.location && activeType === c;
                    return (
                      <td key={c} className="text-center">
                        {cell.total && r.location ? (
                          <button
                            type="button"
                            onClick={() => pick(r.location, c)}
                            title={`Show ${r.location} · ${c} applications`}
                            className={cx('inline-flex min-w-14 flex-col items-center rounded-lg px-2 py-0.5', on ? 'bg-violet-700 text-white' : 'bg-violet-50 text-violet-900 hover:bg-violet-100')}
                          >
                            <span className="font-bold">{cell.total}</span>
                            <span className={cx('text-[11px]', on ? 'text-white/85' : 'text-slate-500')}>{cell.pending} pending</span>
                          </button>
                        ) : (
                          <span className={cx(cell.total ? 'font-bold' : 'text-slate-400')}>{cell.total}</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="text-center font-bold">{r.total}</td>
                  <td className="text-center text-sky-700">{r.pending}</td>
                  <td className="text-center text-green-700">{r.allotted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
        Counts by the location the applicant chose and the type of quarter requested. Click a location, or a number, to show those applications below; click again to clear.
        “Pending” = not yet allotted (awaiting scrutiny or accepted).
      </p>
    </Card>
  );
}

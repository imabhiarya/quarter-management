import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { DoorOpen, KeyRound, MapPin, Users } from 'lucide-react';
import { api, type Row } from '../lib/api';
import { useAuth, useToast } from '../lib/context';
import { fmtDate } from '../lib/format';
import { Button, Card, Modal, cx } from './ui';
import { PriorityChip } from './PriorityControls';

type VacantQ = { quarterNo: string; station: string; subDivision: string; location: string; accnPool: string; block: string };
type Cell = { vacant: VacantQ[]; waiting: number };
type Matrix = { groupBy: 'location' | 'station'; categories: string[]; rows: { group: string; cells: Record<string, Cell>; vacant: number; waiting: number }[]; totalVacant: number; totalWaiting: number };

const entitled = (a: Row) => a.entitlement || a.categoryRequested || '';
const rankName = (r: Row) => `${r.rank && r.rank !== 'Civilian' ? `${r.rank} ` : ''}${r.name}`;

/** Vacant quarters and waiting applicants, location (or station) × type — for allotting at the applicant's chosen location. */
export function VacancyMatrix({ query }: { query: Record<string, string> }) {
  const [by, setBy] = useState<'location' | 'station'>('location');
  const [m, setM] = useState<Matrix | null>(null);
  const [open, setOpen] = useState<{ group: string; category: string; cell: Cell } | null>(null);
  const toast = useToast();
  const { station = '', subDivision = '', category = '', location = '' } = query;

  useEffect(() => {
    setM(null);
    api<Matrix>('/stats/vacancy-matrix', { query: { groupBy: by, station, subDivision, category, location } })
      .then(setM)
      .catch(toast.error);
  }, [by, station, subDivision, category, location, toast]);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-teal-100 bg-gradient-to-r from-teal-50 via-white to-sky-50 px-4 py-2.5">
        <h2 className="flex items-center gap-2 font-bold text-teal-800">
          <MapPin className="size-5" /> Vacant Quarters – {by === 'location' ? 'Location' : 'Station'} &amp; Type wise
          {m && <span className="text-sm font-medium text-slate-600">({m.totalVacant} vacant · {m.totalWaiting} applicants waiting)</span>}
        </h2>
        <div className="flex gap-1.5" role="tablist">
          {(['location', 'station'] as const).map((g) => (
            <button
              key={g}
              role="tab"
              aria-selected={by === g}
              onClick={() => setBy(g)}
              className={cx('rounded-full border px-3 py-1 text-xs font-semibold', by === g ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-teal-50')}
            >
              By {g === 'location' ? 'Location' : 'Station'}
            </button>
          ))}
        </div>
      </div>
      {!m ? (
        <div className="m-4 h-16 animate-pulse rounded bg-slate-100" />
      ) : !m.rows.length ? (
        <p className="px-4 py-6 text-center text-sm text-slate-500">No vacant quarters or waiting applicants for these filters.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>{by === 'location' ? 'Location' : 'Station'}</th>
                {m.categories.map((c) => <th key={c} className="text-center">{c}</th>)}
                <th className="text-center">Total</th>
              </tr>
            </thead>
            <tbody>
              {m.rows.map((r) => (
                <tr key={r.group}>
                  <td className={cx('font-semibold', r.group === 'Not specified' && 'text-slate-500 italic')}>{r.group}</td>
                  {m.categories.map((c) => {
                    const cell = r.cells[c];
                    const v = cell.vacant.length;
                    return (
                      <td key={c} className="text-center">
                        <button
                          type="button"
                          disabled={!v && !cell.waiting}
                          onClick={() => setOpen({ group: r.group, category: c, cell })}
                          title={v || cell.waiting ? 'Show vacant quarters and waiting applicants' : undefined}
                          className={cx('inline-flex min-w-20 flex-col items-center rounded-lg px-2 py-1', v ? 'bg-emerald-100 text-emerald-900 hover:bg-emerald-200' : cell.waiting ? 'bg-slate-50 hover:bg-slate-100' : 'cursor-default')}
                        >
                          <span className={cx('text-lg leading-tight font-bold', !v && 'text-slate-400')}>{v}</span>
                          <span className={cx('text-[11px]', cell.waiting ? (v ? 'text-emerald-800' : 'font-semibold text-amber-700') : 'text-slate-400')}>{cell.waiting} waiting</span>
                        </button>
                      </td>
                    );
                  })}
                  <td className="text-center font-bold">{r.vacant}<span className="block text-[11px] font-normal text-slate-500">{r.waiting} waiting</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
        Green = vacant quarters available. Click a number to see the quarters and the applicants who chose that {by} and type, and allot directly.
        {by === 'location' && m?.rows.some((r) => r.group === 'Not specified') && <> <b>Not specified</b>: quarters or applications with no location set — set it in Quarter Register / the application.</>}
      </p>
      {open && <CellModal by={by} {...open} onClose={() => setOpen(null)} />}
    </Card>
  );
}

function CellModal({ by, group, category, cell, onClose }: { by: 'location' | 'station'; group: string; category: string; cell: Cell; onClose: () => void }) {
  const [apps, setApps] = useState<Row[] | null>(null);
  const { canEdit } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  useEffect(() => {
    // Seniority order (with the saved allotment priority), applicants who chose this location / station and are entitled to this type.
    api<Row[]>('/seniority')
      .then((rows) =>
        setApps(
          rows.filter((a) => {
            const g = String((by === 'location' ? a.locationRequested : a.station) || '').trim() || 'Not specified';
            return g === group && entitled(a) === category;
          }),
        ),
      )
      .catch((e) => (toast.error(e), setApps([])));
  }, [by, group, category, toast]);

  return (
    <Modal title={`${category} · ${group}`} wide onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
      <h3 className="mb-2 flex items-center gap-2 font-bold text-emerald-800"><DoorOpen className="size-4" /> Vacant Quarters ({cell.vacant.length})</h3>
      {cell.vacant.length ? (
        <div className="mb-5 flex flex-wrap gap-2">
          {cell.vacant.map((q) => (
            <span key={q.quarterNo} className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm">
              <b>{q.quarterNo}</b> <span className="text-slate-600">· {q.station} / {q.subDivision}{q.location ? ` · ${q.location}` : ''}{q.block ? ` · ${q.block}` : ''}{q.accnPool ? ` · ${q.accnPool}` : ''}</span>
            </span>
          ))}
        </div>
      ) : (
        <p className="mb-5 text-sm text-amber-700">No {category} quarter is vacant at this {by} now.</p>
      )}

      <h3 className="mb-2 flex items-center gap-2 font-bold text-brand-700"><Users className="size-4" /> Applicants waiting for this {by} &amp; type</h3>
      {apps === null ? (
        <div className="h-10 animate-pulse rounded bg-slate-100" />
      ) : !apps.length ? (
        <p className="text-sm text-slate-500">No accepted applicant has chosen this {by} for {category}.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th className="text-center">Seniority</th>
                <th>Priority</th>
                <th>Rank &amp; Name</th>
                <th>Service No.</th>
                <th>Office</th>
                <th>Type</th>
                <th>Enrolment</th>
                {canEdit && <th className="text-center">Action</th>}
              </tr>
            </thead>
            <tbody>
              {apps.map((a) => (
                <tr key={a.id}>
                  <td className="text-center font-bold text-brand-700">{a.seniorityNo}</td>
                  <td>{a.priorityLabel ? <PriorityChip row={a} /> : '—'}</td>
                  <td className="font-medium">{rankName(a)}</td>
                  <td>{a.serviceNo}</td>
                  <td>{a.officeName || '—'}</td>
                  <td>{a.applicationType === 'Change of Accn' ? 'Change' : 'Fresh'}</td>
                  <td className="whitespace-nowrap">{fmtDate(a.dateOfEnrolment)}</td>
                  {canEdit && (
                    <td className="text-center">
                      <Button size="sm" variant="primary" icon={KeyRound} disabled={!cell.vacant.length} title={cell.vacant.length ? undefined : 'No vacant quarter here'} onClick={() => navigate(`/quarter-allotment?${new URLSearchParams({ allot: a.applicationNo })}`)}>
                        Allot
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-slate-500">Allot opens Quarter Allotment for that applicant, with quarters at their chosen location listed first.</p>
    </Modal>
  );
}

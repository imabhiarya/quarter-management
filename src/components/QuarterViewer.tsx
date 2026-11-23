import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Printer, Building2, User, History, MapPin } from 'lucide-react';
import { api, type Row } from '../lib/api';
import { useToast } from '../lib/context';
import { fmtDate } from '../lib/format';
import { esc, printHtml } from '../lib/exporters';
import { Badge, Button, Modal } from './ui';

type Details = { quarter: Row; current: Row | null; allotments: Row[]; vacations: Row[]; retentions: Row[] };

const Ctx = createContext<(quarterNo: string) => void>(() => {});

const v = (x: unknown) => (x === undefined || x === null || x === '' ? '—' : String(x));
const takeoverText = (a: Row) =>
  a.occState === 'Occupied' ? `Occupied${a.occupiedOn ? ` on ${fmtDate(a.occupiedOn)}` : ''}`
  : a.occState === 'Deferment Granted' ? `Deferred up to ${fmtDate(a.occDeadline)}`
  : a.occState === 'Awaiting Take-over' ? `Awaiting take-over (due ${fmtDate(a.occDeadline)})`
  : v(a.occState);

/** Plain-text rows used by both the window and the printout. */
function sections(d: Details) {
  const q = d.quarter;
  const c = d.current;
  return {
    quarter: [
      ['Quarter No.', q.quarterNo], ['Type / Category', q.category], ['Accn Pool', q.accnPool], ['Station', q.station],
      ['Sub-Division', q.subDivision], ['Location', q.location], ['Block / Address', q.block], ['Plinth Area (sq m)', q.plinthArea], ['Status', q.status],
      ['Remarks', q.remarks],
    ] as [string, unknown][],
    occupant: c
      ? ([
          ['Name', `${c.rank && c.rank !== 'Civilian' ? `${c.rank} ` : ''}${c.allotteeName}`], ['Service No.', c.serviceNo], ['Trade', c.trade],
          ['Office', c.officeName], ['Mobile', c.mobile], ['Allotment Order', `${c.orderNo} dated ${fmtDate(c.allotmentDate)}`],
          ['Proceedings', c.proceedingsNo], ['Period', `${fmtDate(c.fromDate)} to ${fmtDate(c.toDate)}`], ['Take-over', takeoverText(c)],
          ['Vacation Due', fmtDate(q.vacationDue)], ['Action as per SRO 308', c.occAction],
        ] as [string, unknown][])
      : null,
    allotments: d.allotments.map((a) => [a.orderNo, fmtDate(a.allotmentDate), `${a.allotteeName} (${a.serviceNo})`, `${fmtDate(a.fromDate)} – ${fmtDate(a.toDate)}`, a.status === 'Allotted' ? takeoverText(a) : a.status]),
    vacations: d.vacations.map((x) => [fmtDate(x.vacationDate), `${v(x.prevOccupant)} (${v(x.serviceNo)})`, v(x.reason)]),
    retentions: d.retentions.map((r) => [r.caseType, `${r.name} (${r.serviceNo})`, `${fmtDate(r.fromDate)} – ${fmtDate(r.toDate)}`, v(r.reason), r.status]),
  };
}

function printDetails(d: Details) {
  const s = sections(d);
  const kv = (rows: [string, unknown][]) => `<table>${rows.map(([k, val]) => `<tr><th style="width:34%">${esc(k)}</th><td>${esc(v(val))}</td></tr>`).join('')}</table>`;
  const list = (head: string[], rows: unknown[][], empty: string) =>
    rows.length
      ? `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((x) => `<td>${esc(v(x))}</td>`).join('')}</tr>`).join('')}</tbody></table>`
      : `<p style="color:#666">${esc(empty)}</p>`;
  printHtml(
    `Quarter ${d.quarter.quarterNo}`,
    `<header><div><h1>Quarter Details – ${esc(d.quarter.quarterNo)}</h1><h2>${esc(d.quarter.category ?? '')} · ${esc(d.quarter.station ?? '')} / ${esc(d.quarter.subDivision ?? '')}${d.quarter.location ? ` · ${esc(d.quarter.location)}` : ''} · ${esc(d.quarter.status ?? '')}</h2></div><div class="meta">AWAS<br>Printed ${esc(new Date().toLocaleString('en-GB'))}</div></header>
     <h3 style="margin:10px 0 4px">Quarter</h3>${kv(s.quarter)}
     <h3 style="margin:14px 0 4px">Present Occupant</h3>${s.occupant ? kv(s.occupant) : '<p style="color:#666">No current allotment.</p>'}
     <h3 style="margin:14px 0 4px">Allotment History</h3>${list(['Order No.', 'Date', 'Allottee', 'Period', 'Status / Take-over'], s.allotments, 'No allotments recorded.')}
     <h3 style="margin:14px 0 4px">Vacations</h3>${list(['Vacated On', 'Previous Occupant', 'Reason'], s.vacations, 'No vacations recorded.')}
     <h3 style="margin:14px 0 4px">Retention / Extension</h3>${list(['Case', 'Name', 'Period', 'Grounds', 'Status'], s.retentions, 'No retention or extension cases.')}`,
  );
}

function Section({ icon: Icon, title, children }: { icon: typeof Building2; title: string; children: ReactNode }) {
  return (
    <section className="mb-4">
      <h3 className="mb-2 flex items-center gap-2 border-b border-brand-100 pb-1 text-sm font-bold tracking-wide text-brand-800 uppercase">
        <Icon className="size-4" /> {title}
      </h3>
      {children}
    </section>
  );
}

function Pairs({ rows }: { rows: [string, unknown][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-3">
      {rows.map(([k, val]) => (
        <div key={k} className={k.startsWith('Action') || k === 'Remarks' ? 'sm:col-span-3' : undefined}>
          <dt className="text-xs font-semibold text-slate-500 uppercase">{k}</dt>
          <dd className={`text-[15px] ${k.startsWith('Action') && val ? 'font-semibold text-red-700' : 'text-slate-900'}`}>{k === 'Status' ? <Badge status={String(val)} /> : v(val)}</dd>
        </div>
      ))}
    </dl>
  );
}

function List({ head, rows, empty }: { head: string[]; rows: unknown[][]; empty: string }) {
  if (!rows.length) return <p className="text-sm text-slate-500">{empty}</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="data-table compact text-sm">
        <thead>
          <tr>{head.map((h) => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((x, j) => <td key={j}>{v(x)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Lets any Quarter No. on any page open that quarter's details. */
/** Quarter no. → location from the Quarter Register, shared by every QuarterLink. */
const LocCtx = createContext<Record<string, string>>({});

export function QuarterViewerProvider({ children }: { children: ReactNode }) {
  const [d, setD] = useState<Details | null>(null);
  const [locations, setLocations] = useState<Record<string, string>>({});
  const toast = useToast();
  useEffect(() => {
    const load = () => api<Record<string, string>>('/quarter-locations').then(setLocations).catch(() => {});
    load();
    window.addEventListener('awas-quarters-changed', load);
    window.addEventListener('focus', load);
    return () => (window.removeEventListener('awas-quarters-changed', load), window.removeEventListener('focus', load));
  }, []);
  const open = useCallback(
    (quarterNo: string) => {
      api<Details>('/quarter-details', { query: { quarterNo } }).then(setD).catch(toast.error);
    },
    [toast],
  );
  const s = d ? sections(d) : null;
  return (
    <LocCtx.Provider value={locations}>
    <Ctx.Provider value={open}>
      {children}
      {d && s && (
        <Modal
          title={`Quarter ${d.quarter.quarterNo}`}
          wide
          onClose={() => setD(null)}
          footer={
            <>
              <Button icon={Printer} onClick={() => printDetails(d)}>Print</Button>
              <Button variant="primary" onClick={() => setD(null)}>Close</Button>
            </>
          }
        >
          <Section icon={Building2} title="Quarter">
            <Pairs rows={s.quarter} />
          </Section>
          <Section icon={User} title="Present Occupant">
            {s.occupant ? <Pairs rows={s.occupant} /> : <p className="text-sm text-slate-500">No current allotment – the quarter is {String(d.quarter.status).toLowerCase()}.</p>}
          </Section>
          <Section icon={History} title="Allotment History">
            <List head={['Order No.', 'Date', 'Allottee', 'Period', 'Status / Take-over']} rows={s.allotments} empty="No allotments recorded." />
          </Section>
          <Section icon={History} title="Vacations">
            <List head={['Vacated On', 'Previous Occupant', 'Reason']} rows={s.vacations} empty="No vacations recorded." />
          </Section>
          <Section icon={History} title="Retention / Extension">
            <List head={['Case', 'Name', 'Period', 'Grounds', 'Status']} rows={s.retentions} empty="No retention or extension cases." />
          </Section>
        </Modal>
      )}
    </Ctx.Provider>
    </LocCtx.Provider>
  );
}

/** A Quarter No. that opens the quarter's details when clicked. */
/** Location of a quarter, from the Quarter Register ('' if not set). */
export const useQuarterLocation = (no?: string) => useContext(LocCtx)[no ?? ''] ?? '';

export function QuarterLink({ no, suffix, hideLocation }: { no?: string; suffix?: string; hideLocation?: boolean }) {
  const open = useContext(Ctx);
  const location = useContext(LocCtx)[no ?? ''];
  if (!no) return <span className="text-slate-400">—</span>;
  return (
    <span className="inline-block whitespace-nowrap">
      <button
        type="button"
        title="Open quarter details"
        className="font-semibold text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-900 hover:decoration-blue-700"
        onClick={(e) => {
          e.stopPropagation();
          open(no);
        }}
      >
        {no}
      </button>
      {suffix && <span className="text-slate-600"> {suffix}</span>}
      {!hideLocation && location && (
        <span className="flex items-center gap-0.5 text-[11px] leading-tight font-medium text-teal-700" title="Location (Quarter Register)">
          <MapPin className="size-3 shrink-0" />
          {location}
        </span>
      )}
    </span>
  );
}

/** A quarter number in running text (bold), with its location in small text when set. */
export function QuarterText({ no }: { no?: string }) {
  const location = useQuarterLocation(no);
  if (!no) return null;
  return (
    <>
      <b>{no}</b>
      {location && <span className="ml-1 text-[11px] font-medium text-teal-700">({location})</span>}
    </>
  );
}

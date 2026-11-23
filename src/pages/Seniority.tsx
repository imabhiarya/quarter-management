import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Award, Eye, FileSpreadsheet, KeyRound, Printer, Inbox } from 'lucide-react';
import { api, type Row } from '../lib/api';
import { useAuth, useMasters, useToast } from '../lib/context';
import { fmtDate } from '../lib/format';
import { esc, printHtml, PAGE_BREAK, type PlainColumn } from '../lib/exporters';
import { exportExcel } from '../lib/excel';
import { Badge, Button, Card, IconButton, Label, Modal, PageHeader, Select } from '../components/ui';
import { FilterBar, type FilterDef } from '../components/CrudPage';
import { ViewModal, viewItemsFor } from '../components/Form';
import { applicantRegister, allotUrl } from '../modules';
import { ApplicationLink } from '../components/ApplicationViewer';
import { PriorityChip, PriorityControls, priorityText, usePriorityRules } from '../components/PriorityControls';

const FILTERS: FilterDef[] = [
  { name: 'category', label: 'Accn Type', options: 'categories', allLabel: 'All Types' },
  { name: 'accnPool', label: 'Accn Pool', options: 'accnPools', allLabel: 'All Pools' },
  { name: 'locationRequested', label: 'Location', options: 'locations', allLabel: 'All Locations' },
  { name: 'station', label: 'Station', options: 'stations', allLabel: 'All Stations' },
  { name: 'priorityGroup', label: 'Priority', optionsFrom: '/priority-options', allLabel: 'All Priorities' },
  { name: 'search', label: 'Search', type: 'text', placeholder: 'Name, service no. or application no.' },
];
const EMPTY = Object.fromEntries(FILTERS.map((f) => [f.name, '']));
const ALLOTTABLE = ['Eligible', 'Recommended'];

const rankName = (r: Row) => `${r.rank && r.rank !== 'Civilian' ? `${r.rank} ` : ''}${r.name}`;

const COLUMNS: PlainColumn[] = [
  { label: 'Seniority No.', value: (r) => String(r.seniorityNo) },
  { label: 'Priority', value: (r) => r.priorityLabel ?? '' },
  { label: 'Accn Type', value: (r) => r.categoryRequested ?? '' },
  { label: 'Application No.', value: (r) => r.applicationNo ?? '' },
  { label: 'Application Date', value: (r) => fmtDate(r.applicationDate) },
  { label: 'Service No.', value: (r) => r.serviceNo ?? '' },
  { label: 'Rank & Name', value: rankName },
  { label: 'Office Name', value: (r) => r.officeName ?? '' },
  { label: 'Pay Level', value: (r) => r.payLevel ?? '' },
  { label: 'Accn Pool', value: (r) => r.accnPool ?? '' },
  { label: 'Location', value: (r) => r.locationRequested ?? '' },
  { label: 'Ground', value: (r) => r.applicationGround ?? '' },
  { label: 'Type', value: (r) => (r.applicationType === 'Change of Accn' ? `Change${r.changeReason ? ` (${r.changeReason})` : ''}` : r.applicationType ?? '') },
  { label: 'Date of Enrolment', value: (r) => fmtDate(r.dateOfEnrolment) },
  { label: 'Waiting Days', value: (r) => String(r.waitingDays ?? '') },
  { label: 'Status', value: (r) => r.status ?? '' },
];

export default function Seniority() {
  const [filters, setFilters] = useState<Record<string, string>>(EMPTY);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [view, setView] = useState<Row | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [printMode, setPrintMode] = useState('*');
  const { masters } = useMasters();
  const toast = useToast();
  const navigate = useNavigate();
  const { canEdit } = useAuth();
  const prio = usePriorityRules();

  useEffect(() => {
    setRows(null);
    api<Row[]>('/seniority', { query: filters }).then(setRows).catch((e) => (toast.error(e), setRows([])));
  }, [filters, prio.version, toast]);
  const showPrio = !!prio.rules?.length;

  const groups = useMemo(() => {
    const m = new Map<string, Row[]>();
    // One list per accn type + accn pool, matching how seniority is numbered.
    for (const r of rows ?? []) {
      const key = `${r.categoryRequested || '—'} · ${r.accnPool || 'No pool'}`;
      m.set(key, [...(m.get(key) ?? []), r]);
    }
    return [...m.entries()];
  }, [rows]);

  const subtitle = [filters.accnPool, filters.locationRequested, filters.station].filter(Boolean).join(' · ');

  const allot = (r: Row) => navigate(allotUrl(r));

  /** mode: '*' each type on its own page, '' all types together, or one type. */
  const print = (mode: string) => {
    const shown = COLUMNS.filter((c) => c.label !== 'Accn Type' && c.label !== 'Accn Pool' && (showPrio || c.label !== 'Priority'));
    const head = shown.map((c) => `<th>${esc(c.label)}</th>`).join('');
    const typeOf = (key: string) => key.split(' · ')[0];
    const tables = (list: [string, Row[]][]) =>
      list
        .map(
          ([cat, rowsIn]) =>
            `<h3 style="margin:14px 0 4px;color:#7a1030">${esc(cat)} — ${rowsIn.length} applicant(s)</h3>
             <table><thead><tr>${head}</tr></thead><tbody>${rowsIn
               .map((r, i) => `<tr>${shown.map((c) => `<td>${esc(c.value(r, i))}</td>`).join('')}</tr>`)
               .join('')}</tbody></table>`,
        )
        .join('');
    const page = (title: string, list: [string, Row[]][]) => `<section>
       <header><div><h1>Seniority List for Allotment of Married Accommodation${title ? ` — ${esc(title)}` : ''}</h1><h2>${esc(subtitle || 'All pools and locations')} · as on ${esc(fmtDate(new Date().toISOString().slice(0, 10)))}</h2></div><div class="meta">AWAS</div></header>
       ${tables(list) || '<p>No applicants on the seniority list.</p>'}
       <p style="margin-top:14px;font-size:11px">Only applicants accepted in Application Scrutiny. Seniority is numbered separately for each accn type and pool. Priority order: ${esc(priorityText(prio.rules))}; within each priority group by date of enrolment (earliest first), then date of application.</p>
       <div style="display:flex;justify-content:space-between;margin-top:56px;font-size:12px">
         <div style="border-top:1px solid #333;padding-top:2px;min-width:180px;text-align:center">Prepared by (Dealing Clerk)</div>
         <div style="border-top:1px solid #333;padding-top:2px;min-width:180px;text-align:center">Checked by (BSO Accom)</div>
         <div style="border-top:1px solid #333;padding-top:2px;min-width:180px;text-align:center">Presiding Officer</div>
       </div></section>`;
    let html: string;
    if (mode === '*') {
      const types = [...new Set(groups.map(([k]) => typeOf(k)))];
      html = types.map((t) => page(t, groups.filter(([k]) => typeOf(k) === t))).join(PAGE_BREAK);
    } else if (mode) html = page(mode, groups.filter(([k]) => typeOf(k) === mode));
    else html = page('', groups);
    printHtml('Seniority List', `<style>@page{size:A4 landscape}</style>${html}`);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Award}
        title="Seniority List"
        subtitle="Accepted applicants in order of seniority, accn type and pool-wise, for allotment proceedings"
        actions={
          <>
            <Button icon={FileSpreadsheet} disabled={!rows?.length} onClick={() => exportExcel(`seniority-list-${new Date().toISOString().slice(0, 10)}`, COLUMNS, rows ?? [], 'Seniority List').catch(toast.error)}>
              Export Excel
            </Button>
            <Button icon={Printer} disabled={!rows?.length} onClick={() => setPrintOpen(true)}>Print Seniority List</Button>
          </>
        }
      />

      <FilterBar filters={FILTERS} values={filters} onApply={setFilters} onReset={() => setFilters(EMPTY)} />
      <PriorityControls rules={prio.rules} onSave={prio.save} />

      <p className="text-sm text-slate-600">
        Applications appear here automatically once accepted in Application Scrutiny, and leave when allotted. Seniority is numbered separately for each <b>accn type and pool</b>, by <b>date of enrolment</b> (earliest first), then date of application.
      </p>

      {rows === null && <Card className="p-8 text-center text-slate-500">Loading…</Card>}
      {rows && !rows.length && (
        <Card className="p-10 text-center text-slate-500">
          <Inbox className="mx-auto mb-2 size-8 opacity-50" />
          No applicants match these filters.
        </Card>
      )}

      {groups.map(([cat, list]) => (
        <Card key={cat} className="overflow-hidden">
          <div className="flex items-center justify-between bg-gradient-to-r from-brand-700 to-brand-600 px-4 py-2 text-white">
            <h2 className="text-lg font-semibold">{cat}</h2>
            <span className="rounded-full bg-white/20 px-3 py-0.5 text-sm font-semibold">{list.length} applicant(s)</span>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="w-20 text-center">Seniority No.</th>
                  {showPrio && <th>Priority</th>}
                  <th>Application No.</th>
                  <th>Application Date</th>
                  <th>Service No.</th>
                  <th>Rank &amp; Name</th>
                  <th>Office Name</th>
                  <th>Pay Level</th>
                  <th>Location</th>
                  <th>Ground</th>
                  <th>Type</th>
                  <th>Date of Enrolment</th>
                  <th className="text-center">Waiting Days</th>
                  <th>Status</th>
                  <th className="no-print w-24 text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id}>
                    <td className="text-center text-lg font-bold text-brand-700">{r.seniorityNo}</td>
                    {showPrio && <td><PriorityChip row={r} /></td>}
                    <td className="whitespace-nowrap"><ApplicationLink no={r.applicationNo} /></td>
                    <td className="whitespace-nowrap">{fmtDate(r.applicationDate)}</td>
                    <td>{r.serviceNo}</td>
                    <td className="font-medium">{rankName(r)}</td>
                    <td>{r.officeName || '—'}</td>
                    <td>{r.payLevel}</td>
                    <td>{r.locationRequested || '—'}</td>
                    <td>{r.applicationGround || '—'}</td>
                    <td>{r.applicationType === 'Change of Accn' ? 'Change' : r.applicationType}</td>
                    <td className="whitespace-nowrap font-semibold">{fmtDate(r.dateOfEnrolment)}</td>
                    <td className="text-center">{r.waitingDays}</td>
                    <td><Badge status={r.status} /></td>
                    <td className="no-print text-center whitespace-nowrap">
                      <IconButton icon={Eye} label="View" onClick={() => setView(r)} />
                      {canEdit && (
                        <IconButton
                          icon={KeyRound}
                          tone="brand"
                          label={ALLOTTABLE.includes(r.status) ? 'Allot Quarter' : `Cannot allot: status is ${r.status}`}
                          disabled={!ALLOTTABLE.includes(r.status)}
                          onClick={() => allot(r)}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}

      {printOpen && (
        <Modal
          title="Print Seniority List"
          onClose={() => setPrintOpen(false)}
          footer={
            <>
              <Button onClick={() => setPrintOpen(false)}>Cancel</Button>
              <Button variant="primary" icon={Printer} onClick={() => (print(printMode), setPrintOpen(false))}>Print</Button>
            </>
          }
        >
          <Label htmlFor="sen-print">Accn Type</Label>
          <Select
            id="sen-print"
            value={printMode}
            onChange={setPrintMode}
            options={[
              { value: '*', label: 'All types – each type separately (new page per type)' },
              { value: '', label: 'All types – one combined list' },
              ...(masters.categories ?? []).map((t) => ({ value: t, label: `${t} only` })),
            ]}
          />
          <p className="mt-2 text-sm text-slate-600">Within each type, every accn pool has its own table. The filters on the page are also applied.</p>
        </Modal>
      )}
      {view && <ViewModal title={`${view.applicationNo}`} items={viewItemsFor(applicantRegister.viewFields!, view)} onClose={() => setView(null)} />}
    </div>
  );
}

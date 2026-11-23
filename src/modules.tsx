import {
  House, CalendarDays, Users, ListOrdered, KeyRound, ScrollText, FileText, RefreshCcw,
  Ban, Printer, Download, Files, DoorOpen, CalendarClock, AlertTriangle, Upload, ArrowUpDown, BadgeCheck, ClipboardCheck, CheckCircle2, XCircle, RotateCcw, Paperclip, History,
} from 'lucide-react';
import { PastBoardModal } from './components/PastBoard';
import { VacancyMatrix } from './components/VacancyMatrix';
import { ApplicationLocationSummary, LocationSummary } from './components/LocationSummary';
import { PriorityChip, PriorityPanel } from './components/PriorityControls';
import { api, downloadUpload, type Row } from './lib/api';
import { currentMonth, currentYear, fmtDateTime, isoDate, MONTH_OPTIONS, yearOptions } from './lib/format';
import { CrudPage, type ModuleConfig, type FilterDef, type ActionDef, type ColumnDef } from './components/CrudPage';
import { FileLink, type FieldDef } from './components/Form';
import { Badge, Button } from './components/ui';
import { AllotPanel } from './components/AllotPanel';
import { TakeoverImportModal } from './components/TakeoverImport';
import { printApplication } from './lib/printApplication';
import { applicationView } from './applicationFields';
import { signatoryFields } from './signatoryFields';
import { ApplicationLink } from './components/ApplicationViewer';
import { QuarterLink, QuarterText } from './components/QuarterViewer';
import { getScrutinyMode } from './lib/scrutinyMode';
import { StatusModal, ReorderModal, ScrutinyModal, ScrutinyModeBar, DocumentsModal, BulkOrderModal, PrintOrderModal, OccupationModal, PrintProceedingsModal } from './components/Workflow';

const WAITING = 'Eligible,Recommended';
export const APP_STATUSES = ['Pending', 'Scrutiny', 'Eligible', 'Recommended', 'Allotted', 'Rejected', 'Withdrawn'];

/* Shared filters */
const station: FilterDef = { name: 'station', label: 'Station', options: 'stations', allLabel: 'All Stations' };
const subDivision: FilterDef = { name: 'subDivision', label: 'Sub-Division', options: 'subDivisions', allLabel: 'All Sub-Divisions' };
const location: FilterDef = { name: 'location', label: 'Location', options: 'locations', allLabel: 'All Locations' };
const appliedLocation: FilterDef = { name: 'locationRequested', label: 'Location Applied For', options: 'locations', allLabel: 'All Locations' };
/** Allotment rows: location of the allotted quarter, with the location applied for shown when it differs. */
const allottedLocationColumn: ColumnDef = {
  key: 'location',
  label: 'Location',
  text: (r) => r.location || '—',
  render: (r) => (
    <span>
      {r.location || <span className="text-slate-400">—</span>}
      {r.appliedLocation && r.appliedLocation !== r.location && <span className="block text-xs text-amber-700">Applied: {r.appliedLocation}</span>}
    </span>
  ),
};
const category: FilterDef = { name: 'category', label: 'Category', options: 'categories', allLabel: 'All Categories' };
const yearFilter = (field: string, required = true): FilterDef => ({
  name: 'year', label: 'Year', param: `prefix_${field}`, options: yearOptions(), required, default: required ? currentYear : undefined, allLabel: 'All Years',
});

const withService = (name: string, no: string) => (r: Row) => (r[name] ? `${r[name]}${r[no] ? ` (${r[no]})` : ''}` : '—');
const rankName = (r: Row) => `${r.rank && r.rank !== 'Civilian' ? `${r.rank} ` : ''}${r.name}`;

/* Shared lookups */
const quarterLookup = (status: string, fill: (r: Row) => Record<string, unknown>): FieldDef['lookup'] => ({
  collection: 'quarters',
  query: { status },
  value: 'quarterNo',
  label: (r) => `${r.quarterNo} · ${r.category} · ${r.station}${r.location ? ` · ${r.location}` : ''}${r.occupant ? ` · ${r.occupant}` : ''}`,
  fill,
});
const occupantName = (r: Row) => String(r.occupant ?? '').replace(/\s*\([^)]*\)\s*$/, '');

/* ------------------------------------------------------------------ */

/* ----------------------------- Take-over / occupation ----------------------------- */

const d = (s?: string) => (s ? s.split('-').reverse().join('-').replace(/^(\d\d)-(\d\d)-(\d{4})$/, (_m, dd, mm, yy) => `${dd}-${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(mm) - 1]}-${yy}`) : '');

/** One-line take-over position, e.g. "Overdue by 3 days". */
export function takeoverNote(r: Row): string {
  switch (r.occState) {
    case 'Awaiting Take-over':
      return `due by ${d(r.occDeadline)} (${r.occDays} day${r.occDays === 1 ? '' : 's'} left)`;
    case 'Deferment Granted':
      return `deferred up to ${d(r.occDeadline)}`;
    case 'Overdue':
      return `overdue by ${-r.occDays} day${r.occDays === -1 ? '' : 's'} – action under Rule 7 (1) SRO 308`;
    case 'Not Taken Over':
      return 'action under Rule 7 (1) SRO 308';
    case 'Occupied':
      return r.occupiedOn ? `on ${d(r.occupiedOn)}` : '';
    default:
      return '';
  }
}

const takeoverColumn: ColumnDef = {
  key: 'occState',
  label: 'Take-over',
  text: (r) => [r.occState, takeoverNote(r)].filter(Boolean).join(' – '),
  render: (r) =>
    r.occState ? (
      <span className="block min-w-36">
        <Badge status={r.occState} />
        {takeoverNote(r) && <span className={`mt-0.5 block text-xs ${r.occState === 'Overdue' || r.occState === 'Not Taken Over' ? 'font-semibold text-red-700' : 'text-slate-600'}`}>{takeoverNote(r)}</span>}
      </span>
    ) : (
      <span className="text-slate-400">—</span>
    ),
};

const occupationAction = (mode: 'occupied' | 'defer' | 'notTaken'): ActionDef['run'] => (ctx, r) =>
  ctx.open((close) => <OccupationModal row={r!} mode={mode} onClose={close} onDone={() => (close(), ctx.reload())} />);

export const quarterRegister: ModuleConfig = {
  key: 'quarter-register',
  collection: 'quarters',
  title: 'Quarter Register',
  subtitle: 'Master Register of Government Married Accommodation',
  icon: House,
  singular: 'quarter',
  noun: 'Quarters',
  stats: 'quarters',
  statsFirst: true,
  headerToolbar: true,
  topPanel: (ctx) => <LocationSummary ctx={ctx} />,
  add: { label: 'Add Quarter' },
  printLabel: 'Print Register',
  importable: {
    columns: [
      { key: 'quarterNo', label: 'Quarter No.' }, { key: 'category', label: 'Category' }, { key: 'accnPool', label: 'Accn Pool' }, { key: 'station', label: 'Station' },
      { key: 'subDivision', label: 'Sub-Division' }, { key: 'location', label: 'Location' }, { key: 'status', label: 'Status' }, { key: 'block', label: 'Block / Address' },
      { key: 'plinthArea', label: 'Plinth Area (sq m)' },
    ],
    sample: { quarterNo: 'QTR-501', category: 'Type II', accnPool: 'Defence Pool', station: 'Station A', subDivision: 'SD-I', location: 'Station Colony', status: 'Vacant', block: 'Block A', plinthArea: '60' },
  },
  filters: [
    station,
    subDivision,
    location,
    { ...category, label: 'Quarter Category' },
    { name: 'accnPool', label: 'Accn Pool', options: 'accnPools', allLabel: 'All Pools' },
    { name: 'status', label: 'Status', options: ['Occupied', 'Vacant', 'Under Repair'], allLabel: 'All Status' },
  ],
  columns: [
    { key: 'quarterNo', label: 'Quarter No.', render: (r) => <QuarterLink no={r.quarterNo} /> },
    { key: 'category', label: 'Category' },
    { key: 'accnPool', label: 'Accn Pool', text: (r) => r.accnPool || '—' },
    { key: 'station', label: 'Station / Sub-Division', text: (r) => `${r.station} / ${r.subDivision}` },
    { key: 'location', label: 'Location', text: (r) => r.location || '—' },
    { key: 'occupant', label: 'Present Occupant', text: (r) => r.occupant || '—' },
    { key: 'allotmentDate', label: 'Allotment Date', date: true },
    { key: 'vacationDue', label: 'Vacation Due', date: true },
    {
      key: 'status', label: 'Status',
      text: (r) => (r.takeover && r.takeover !== 'Occupied' ? `${r.status} – ${r.takeover}` : r.status),
      render: (r) => (
        <span className="block">
          <Badge status={r.status} />
          {r.takeover && r.takeover !== 'Occupied' && (
            <span className={`mt-0.5 block text-xs font-semibold ${r.takeover === 'Overdue' || r.takeover === 'Not Taken Over' ? 'text-red-700' : 'text-sky-700'}`}>
              {r.takeover === 'Awaiting Take-over' ? 'Allotted – awaiting take-over' : r.takeover === 'Deferment Granted' ? 'Allotted – take-over deferred' : `${r.takeover} (Rule 7 (1) SRO 308)`}
            </span>
          )}
        </span>
      ),
    },
  ],
  fields: [
    { name: 'quarterNo', label: 'Quarter No.', required: true, uppercase: true, placeholder: 'e.g. QTR-501' },
    { name: 'category', label: 'Category', type: 'select', options: 'categories', required: true },
    { name: 'accnPool', label: 'Accn Pool', type: 'select', options: 'accnPools', required: true },
    { name: 'station', label: 'Station / Location', type: 'select', options: 'stations', required: true },
    { name: 'subDivision', label: 'Sub-Division', type: 'select', options: 'subDivisions', required: true },
    { name: 'location', label: 'Location', type: 'select', options: 'locations', hint: 'Matches the location applicants choose (Settings → Master Data → Accommodation Locations).' },
    { name: 'block', label: 'Block / Address' },
    { name: 'plinthArea', label: 'Plinth Area (sq m)', type: 'number' },
    { name: 'status', label: 'Status', type: 'select', options: ['Vacant', 'Under Repair', 'Occupied'], required: true, hint: 'Occupied is set by Quarter Allotment and cleared by Vacation Report; it cannot be changed here.' },
    { name: 'remarks', label: 'Remarks', type: 'textarea', span: 2 },
  ],
  viewFields: [
    { name: 'quarterNo', label: 'Quarter No.' }, { name: 'category', label: 'Category' }, { name: 'accnPool', label: 'Accn Pool' }, { name: 'station', label: 'Station' },
    { name: 'subDivision', label: 'Sub-Division' }, { name: 'location', label: 'Location' }, { name: 'block', label: 'Block / Address' }, { name: 'plinthArea', label: 'Plinth Area (sq m)' },
    { name: 'status', label: 'Status' }, { name: 'occupant', label: 'Present Occupant' }, { name: 'occupantServiceNo', label: 'Service No.' },
    { name: 'allotmentDate', label: 'Allotment Date', type: 'date' }, { name: 'vacationDue', label: 'Vacation Due', type: 'date' },
    { name: 'remarks', label: 'Remarks', type: 'textarea' },
  ],
  defaults: () => ({ status: 'Vacant' }),
  deleteLabel: (r) => r.quarterNo,
};

export const vacationReport: ModuleConfig = {
  key: 'vacation-report',
  collection: 'vacations',
  title: 'Monthly Vacation Report',
  icon: CalendarDays,
  singular: 'vacation entry',
  sectionTitle: 'Vacation (Vacant Quarter) Detail',
  searchLabel: 'Generate Report',
  stats: 'quarters',
  add: { label: 'Add Entry' },
  filters: [
    { name: 'month', label: 'Month / Year', type: 'month', param: 'prefix_vacationDate', required: true, default: currentMonth },
    station,
    subDivision,
    location,
    category,
  ],
  topPanel: (ctx) => <VacancyMatrix query={ctx.query} />,
  columns: [
    { key: 'subDivision', label: 'Sub-Division' },
    { key: 'quarterNo', label: 'Quarter No.', render: (r) => <QuarterLink no={r.quarterNo} /> },
    { key: 'location', label: 'Location', text: (r) => r.location || '—' },
    { key: 'category', label: 'Category' },
    { key: 'prevOccupant', label: 'Previous Occupant (Name & Service No.)', text: withService('prevOccupant', 'serviceNo') },
    { key: 'vacationDate', label: 'Vacation Date', date: true },
    { key: 'reason', label: 'Reason' },
    { key: 'status', label: 'Status', badge: true },
  ],
  fields: [
    {
      name: 'quarterNo', label: 'Quarter No.', type: 'lookup', required: true, lockedOnEdit: true, span: 2,
      lookup: quarterLookup('Occupied', (q) => ({ prevOccupant: occupantName(q), serviceNo: q.occupantServiceNo, category: q.category, station: q.station, subDivision: q.subDivision })),
      hint: 'Only occupied quarters are listed. Saving marks the quarter vacant.',
    },
    { name: 'prevOccupant', label: 'Previous Occupant', required: true },
    { name: 'serviceNo', label: 'Service No.' },
    { name: 'vacationDate', label: 'Vacation Date', type: 'date', required: true },
    { name: 'reason', label: 'Reason', type: 'select', options: 'vacationReasons', required: true },
    { name: 'remarks', label: 'Remarks', type: 'textarea', span: 2 },
  ],
  viewFields: [
    { name: 'quarterNo', label: 'Quarter No.' }, { name: 'category', label: 'Category' }, { name: 'station', label: 'Station' },
    { name: 'subDivision', label: 'Sub-Division' }, { name: 'prevOccupant', label: 'Previous Occupant' }, { name: 'serviceNo', label: 'Service No.' },
    { name: 'vacationDate', label: 'Vacation Date', type: 'date' }, { name: 'reason', label: 'Reason' }, { name: 'status', label: 'Status' },
    { name: 'remarks', label: 'Remarks', type: 'textarea' },
  ],
  defaults: () => ({ vacationDate: isoDate() }),
  deleteLabel: (r) => `vacation entry for ${r.quarterNo}`,
};


const updateStatus = (collection: string, options: string[]) => ({
  label: 'Update Status',
  icon: BadgeCheck,
  needsRow: true,
  write: true,
  run: (ctx: Parameters<NonNullable<ModuleConfig['toolbar']>[number]['run']>[0], row: Row | null) =>
    ctx.open((close) => <StatusModal title="Update Status" collection={collection} row={row!} options={options} onClose={close} onDone={() => (close(), ctx.reload())} />),
});

/** Every application not yet allotted (what the Dashboard counts as "Pending Applications"). */
export const PENDING_STAGE = 'Pending,Scrutiny,Eligible,Recommended';

export const applicantRegister: ModuleConfig = {
  key: 'applicant-register',
  collection: 'applications',
  title: 'Applicant Register',
  subtitle: 'Every application entered through New Application, with its current status',
  icon: Users,
  singular: 'application',
  add: { label: 'New Application', to: '/new-application' },
  editTo: (r) => `/new-application?id=${r.id}`,
  topPanel: (ctx) => <ApplicationLocationSummary ctx={ctx} />,
  filters: [
    station,
    subDivision,
    { name: 'locationRequested', label: 'Location', options: 'locations', allLabel: 'All Locations' },
    { name: 'categoryRequested', label: 'Category', options: 'categories', allLabel: 'All Categories' },
    { name: 'status', label: 'Status', options: APP_STATUSES, allLabel: 'All Status' },
    {
      name: 'stage', label: 'Stage', param: 'in_status', allLabel: 'All Stages',
      options: [
        { value: PENDING_STAGE, label: 'All pending (not yet allotted)' },
        { value: 'Pending,Scrutiny', label: 'Awaiting scrutiny' },
        { value: 'Eligible,Recommended', label: 'Accepted – awaiting allotment' },
      ],
    },
    { name: 'q', label: 'Search', type: 'text', placeholder: 'Name / Service No.' },
  ],
  columns: [
    { key: 'applicationNo', label: 'Application No.', className: 'whitespace-nowrap', render: (r) => <ApplicationLink no={r.applicationNo} /> },
    { key: 'applicationDate', label: 'Application Date', date: true },
    { key: 'serviceNo', label: 'Service No.' },
    { key: 'rank', label: 'Rank' },
    { key: 'name', label: 'Name' },
    { key: 'officeName', label: 'Office Name', text: (r) => r.officeName || '—' },
    { key: 'payLevel', label: 'Pay Level' },
    { key: 'categoryRequested', label: 'Category Requested' },
    { key: 'locationRequested', label: 'Location', text: (r) => r.locationRequested || '—' },
    { key: 'applicationType', label: 'Type' },
    { key: 'mobile', label: 'Mobile' },
    { key: 'status', label: 'Status', badge: true },
  ],
  fields: [],
  viewFields: applicationView,
  printLabel: 'Print Register',
  printByType: { field: 'categoryRequested' },
  rowActions: [
    {
      label: 'Print Application', icon: Printer, tone: 'brand',
      run: (ctx, r) => printApplication(r!, Array.isArray(r!.documents) ? r!.documents : [], r!.applicationNo, r!.applicationDate).catch(ctx.toast.error),
    },
    { label: 'Documents', icon: Paperclip, run: (ctx, r) => ctx.open((close) => <DocumentsModal row={r!} onClose={close} />) },
  ],
  toolbar: [
    { label: 'Print Application', icon: Printer, needsRow: true, run: (ctx, r) => printApplication(r!, Array.isArray(r!.documents) ? r!.documents : [], r!.applicationNo, r!.applicationDate).catch(ctx.toast.error) },
    updateStatus('applications', ['Pending', 'Scrutiny', 'Withdrawn'])],
  deleteLabel: (r) => r.applicationNo,
};

/** Link that opens the allotment dialog on the Quarter Allotment page for this applicant. */
export function allotUrl(r: Row) {
  return `/quarter-allotment?${new URLSearchParams({ allot: r.applicationNo })}`;
}

const docStatus = (r: Row) => {
  const docs: { mandatory: string; fileId?: string }[] = Array.isArray(r.documents) ? r.documents : [];
  const missing = docs.filter((d) => d.mandatory === 'Yes' && !d.fileId).length;
  return { uploaded: docs.filter((d) => d.fileId).length, missing };
};

/** e.g. "Accepted under Para 4(a) of SRO 308 (…)" */
export function decisionBasis(r: Row): string {
  if (!r.scrutinyRule) return r.rejectionReason ?? '';
  const verb = r.status === 'Rejected' ? `Rejected${r.rejectionReason ? ` (${r.rejectionReason})` : ''} against` : 'Accepted under';
  return `${verb} ${r.scrutinyRule}${r.scrutinyPolicy ? ` — ${r.scrutinyPolicy}` : ''}`;
}

export const policies: ModuleConfig = {
  key: 'policies',
  collection: 'policies',
  title: 'Authority / Policy Documents',
  icon: ScrollText,
  singular: 'policy',
  noun: 'policies',
  add: { label: 'Upload Policy' },
  filters: [
    { name: 'status', label: 'Status', options: ['Active', 'Superseded'], allLabel: 'All Status' },
    { name: 'search', label: 'Search', type: 'text', param: 'search_title,rules', placeholder: 'Policy name or rule text' },
  ],
  columns: [
    { key: 'title', label: 'Policy Name', bold: true },
    { key: 'document', label: 'Document', text: (r) => r.document?.fileName ?? '—', render: (r) => <FileLink file={r.document} /> },
    { key: 'rules', label: 'Rules Read from PDF', className: 'text-center', text: (r) => String(Array.isArray(r.rules) ? r.rules.length : 0) },
    { key: 'createdAt', label: 'Uploaded On', text: (r) => fmtDateTime(r.createdAt?.replace(' ', 'T') + 'Z') },
    { key: 'status', label: 'Status', badge: true },
  ],
  fields: [
    { name: 'title', label: 'Policy Name', required: true, span: 2, placeholder: 'e.g. Station Married Accommodation Allotment Rules 2026' },
    {
      name: 'document', label: 'Policy Document (PDF)', type: 'file', span: 2, required: true,
      hint: 'The rules are read from the PDF automatically when you save. Use a text PDF (e.g. saved from Word); scanned images cannot be read.',
    },
  ],
  viewFields: [
    { name: 'title', label: 'Policy Name' },
    { name: 'document', label: 'Document', type: 'file' },
    { name: 'status', label: 'Status' },
    { name: 'rules', label: 'Rules / Paras read from the PDF', type: 'list' },
  ],
  defaults: () => ({ status: 'Active' }),
  rowActions: [
    {
      label: 'Download', icon: Download, tone: 'brand',
      show: (r) => !!r.document?.fileId,
      run: (ctx, r) => downloadUpload(r!.document.fileId, r!.document.fileName).catch(ctx.toast.error),
    },
    {
      label: 'Mark Superseded', icon: Ban, write: true,
      show: (r) => r.status === 'Active',
      run: async (ctx, r) => {
        try {
          await api(`/c/policies/${r!.id}`, { method: 'PUT', body: { status: 'Superseded' } });
          ctx.toast.success(`${r!.title} marked superseded. It will no longer be used in scrutiny.`);
          ctx.reload();
        } catch (e) {
          ctx.toast.error(e);
        }
      },
    },
    {
      label: 'Make Active', icon: CheckCircle2, tone: 'brand', write: true,
      show: (r) => r.status !== 'Active',
      run: async (ctx, r) => {
        try {
          await api(`/c/policies/${r!.id}`, { method: 'PUT', body: { status: 'Active' } });
          ctx.toast.success(`${r!.title} is active.`);
          ctx.reload();
        } catch (e) {
          ctx.toast.error(e);
        }
      },
    },
  ],
  deleteLabel: (r) => r.title,
};

export const signatories: ModuleConfig = {
  key: 'signatories',
  collection: 'signatories',
  title: 'Signatories',
  icon: FileText,
  singular: 'signing officer',
  noun: 'signing officers',
  add: { label: 'Add Signing Officer' },
  exportable: false,
  columns: [
    { key: 'name', label: 'Name', bold: true },
    { key: 'designation', label: 'Designation' },
    { key: 'forLine', label: 'Signs For', text: (r) => r.forLine || '—' },
    { key: 'signature', label: 'Signature Image', text: (r) => r.signature?.fileName ?? '—', render: (r) => <FileLink file={r.signature} /> },
    { key: 'status', label: 'Status', badge: true },
  ],
  fields: signatoryFields,
  defaults: () => ({ status: 'Active' }),
  deleteLabel: (r) => r.name,
};

export const applicationScrutiny: ModuleConfig = {
  key: 'application-scrutiny',
  collection: 'applications',
  title: 'Application Scrutiny',
  subtitle: 'Applications are accepted or rejected with reference to a rule of the policy uploaded under Authority.',
  icon: ClipboardCheck,
  singular: 'application',
  add: false,
  noDelete: true,
  editTo: (r) => `/new-application?id=${r.id}`,
  printByType: { field: 'categoryRequested', signatures: ['Scrutinised by (Dealing Clerk)', 'Checked by (BSO Accom)'] },
  sort: 'applicationDate',
  dir: 'asc',
  topPanel: (ctx) => <ScrutinyModeBar onChange={ctx.reload} />,
  extraTabs: [{ label: 'Authority', render: () => <CrudPage cfg={policies} embedded /> }],
  tabs: [
    { label: 'Pending Scrutiny', query: { in_status: 'Pending,Scrutiny' } },
    { label: 'Eligible', query: { in_status: 'Eligible,Recommended' } },
    { label: 'Rejected', query: { status: 'Rejected' } },
  ],
  filters: [
    station,
    appliedLocation,
    { name: 'categoryRequested', label: 'Accn Type', options: 'categories', allLabel: 'All Types' },
    { name: 'accnPool', label: 'Accn Pool', options: 'accnPools', allLabel: 'All Pools' },
    { name: 'search', label: 'Search', type: 'text', param: 'search_serviceNo,name,applicationNo', placeholder: 'Name, service no. or application no.' },
  ],
  columns: [
    { key: 'applicationNo', label: 'Application No.', className: 'whitespace-nowrap', render: (r) => <ApplicationLink no={r.applicationNo} /> },
    { key: 'applicationDate', label: 'Application Date', date: true },
    { key: 'serviceNo', label: 'Service No.' },
    { key: 'name', label: 'Rank & Name', text: rankName },
    { key: 'officeName', label: 'Office Name', text: (r) => r.officeName || '—' },
    { key: 'payLevel', label: 'Pay Level' },
    { key: 'locationRequested', label: 'Location Applied For', text: (r) => r.locationRequested || '—' },
    {
      key: 'categoryRequested',
      label: 'Requested / Entitled',
      text: (r) => `${r.categoryRequested ?? '—'} / ${r.entitlement ?? '—'}`,
      render: (r) => (
        <span className={r.entitlement && r.entitlement !== r.categoryRequested ? 'font-semibold text-amber-700' : ''} title={r.entitlement && r.entitlement !== r.categoryRequested ? 'Requested accn differs from entitlement' : undefined}>
          {r.categoryRequested ?? '—'} / {r.entitlement ?? '—'}
        </span>
      ),
    },
    { key: 'applicationGround', label: 'Ground', text: (r) => r.applicationGround || '—' },
    {
      key: 'documents',
      label: 'Documents',
      text: (r) => { const d = docStatus(r); return d.missing ? `${d.missing} mandatory missing` : `${d.uploaded} uploaded`; },
      render: (r) => { const d = docStatus(r); return d.missing ? <span className="font-semibold text-red-700">{d.missing} mandatory missing</span> : <span>{d.uploaded} uploaded</span>; },
    },
    {
      key: 'scrutinyRule',
      label: 'Decision Basis',
      text: (r) => (r.autoCheck && getScrutinyMode() === 'auto' ? `Auto check: ${r.autoCheck.decision === 'Eligible' ? 'Accept' : `Reject – ${r.autoCheck.reason}`}${r.autoCheck.rule ? ` (${r.autoCheck.rule})` : ''}` : decisionBasis(r) || '—'),
      render: (r) => {
        if (r.autoCheck && getScrutinyMode() === 'auto')
          return (
            <span className="block max-w-80 text-sm">
              <span className={r.autoCheck.decision === 'Eligible' ? 'font-semibold text-green-800' : 'font-semibold text-red-700'}>
                Auto check: {r.autoCheck.decision === 'Eligible' ? 'Accept' : `Reject – ${r.autoCheck.reason}`}
              </span>
              {r.autoCheck.rule ? <span className="block text-xs text-slate-600">{r.autoCheck.decision === 'Eligible' ? 'Under' : 'Against'} {r.autoCheck.rule.slice(0, 90)}{r.autoCheck.rule.length > 90 ? '…' : ''}</span> : !r.autoCheck.policy && <span className="block text-xs text-amber-700">No policy uploaded</span>}
            </span>
          );
        if (!r.scrutinyRule && !r.rejectionReason)
          return <span className="text-sm text-slate-400">{['Pending', 'Scrutiny'].includes(r.status) ? 'Awaiting decision' : '—'}</span>;
        return (
          <span className="block max-w-80 text-sm">
            {r.status === 'Rejected' && r.rejectionReason && <span className="block font-semibold text-red-700">{r.rejectionReason}</span>}
            {r.scrutinyRule && (
              <span className="block">
                <span className={r.status === 'Rejected' ? 'text-red-700' : 'text-green-800'}>{r.status === 'Rejected' ? 'Against' : 'Under'}</span> {r.scrutinyRule}
              </span>
            )}
            {r.scrutinyPolicy && <span className="block text-xs text-slate-500">{r.scrutinyPolicy}{r.scrutinyMode ? ` · ${r.scrutinyMode}` : ''}</span>}
          </span>
        );
      },
    },
    { key: 'status', label: 'Status', badge: true },
  ],
  fields: [],
  viewFields: [...applicationView, { name: 'scrutinyRemarks', label: 'Scrutiny Remarks', type: 'textarea' }],
  rowActions: [
    {
      label: 'Documents', icon: Paperclip, labelled: true,
      run: (ctx, r) => ctx.open((close) => <DocumentsModal row={r!} onClose={close} />),
    },
    {
      label: 'Accept', icon: CheckCircle2, tone: 'brand', write: true, labelled: true,
      show: (r) => ['Pending', 'Scrutiny', 'Rejected'].includes(r.status),
      run: (ctx, r) => ctx.open((close) => <ScrutinyModal row={r!} mode="eligible" onClose={close} onDone={() => (close(), ctx.reload())} />),
    },
    {
      label: 'Reject', icon: XCircle, tone: 'red', write: true, labelled: true,
      show: (r) => ['Pending', 'Scrutiny', 'Eligible', 'Recommended'].includes(r.status),
      run: (ctx, r) => ctx.open((close) => <ScrutinyModal row={r!} mode="reject" onClose={close} onDone={() => (close(), ctx.reload())} />),
    },
    {
      label: 'Allot Quarter', icon: KeyRound, tone: 'brand', write: true, labelled: true,
      show: (r) => ['Eligible', 'Recommended'].includes(r.status),
      run: (ctx, r) => ctx.navigate(allotUrl(r!)),
    },
    {
      label: 'Back to Scrutiny', icon: RotateCcw, write: true, labelled: true,
      show: (r) => r.status === 'Rejected',
      run: async (ctx, r) => {
        try {
          await api(`/c/applications/${r!.id}`, { method: 'PUT', body: { status: 'Scrutiny', rejectionReason: '' } });
          ctx.toast.success(`${r!.applicationNo} returned to scrutiny.`);
          ctx.reload();
        } catch (e) {
          ctx.toast.error(e);
        }
      },
    },
  ],
  deleteLabel: (r) => r.applicationNo,
};

export const waitingList: ModuleConfig = {
  key: 'waiting-list',
  collection: 'applications',
  title: 'Waiting List',
  subtitle: 'Applicants accepted in scrutiny and not yet allotted a quarter',
  icon: ListOrdered,
  singular: 'applicant',
  baseQuery: { in_status: WAITING, priorityFirst: '1' },
  sort: 'waitingOrder',
  dir: 'asc',
  stats: 'waiting',
  topPanel: (ctx) => <PriorityPanel onChanged={ctx.reload} />,
  add: false,
  noDelete: true,
  printByType: { field: 'categoryRequested', signatures: ['Prepared by (Dealing Clerk)', 'Checked by (BSO Accom)'] },
  editTo: (r) => `/new-application?id=${r.id}`,
  filters: [
    station,
    { ...subDivision, label: 'Sub Division', allLabel: 'All Sub Divisions' },
    { name: 'categoryRequested', label: 'Category', options: 'categories', allLabel: 'All Categories' },
    { name: 'payLevel', label: 'Pay Level', options: 'payLevels', allLabel: 'All Levels' },
    { name: 'locationRequested', label: 'Location', options: 'locations', allLabel: 'All Locations' },
    { name: 'accnPool', label: 'Accn Pool', options: 'accnPools', allLabel: 'All Pools' },
    { name: 'applicationGround', label: 'Ground', options: 'applicationGrounds', allLabel: 'All Grounds' },
    { name: 'applicationType', label: 'Application Type', options: ['Fresh', 'Change of Accn'], allLabel: 'All Types' },
    { name: 'priorityGroup', label: 'Priority', optionsFrom: '/priority-options', allLabel: 'All Priorities' },
  ],
  columns: [
    { key: 'applicationNo', label: 'Application No.', className: 'whitespace-nowrap', render: (r) => <ApplicationLink no={r.applicationNo} /> },
    { key: 'applicationDate', label: 'Application Date', date: true },
    { key: 'serviceNo', label: 'Service No.' },
    { key: 'rank', label: 'Rank' },
    { key: 'name', label: 'Name' },
    { key: 'officeName', label: 'Office Name', text: (r) => r.officeName || '—' },
    { key: 'trade', label: 'Trade' },
    { key: 'payLevel', label: 'Pay Level' },
    { key: 'categoryRequested', label: 'Category Requested' },
    { key: 'applicationType', label: 'Application Type', text: (r) => (r.applicationType === 'Fresh' ? 'Fresh' : 'Change') },
    { key: 'waitingDays', label: 'Waiting Days', className: 'text-center' },
    { key: 'priorityLabel', label: 'Allotment Priority', text: (r) => r.priorityLabel || '—', render: (r) => (r.priorityLabel ? <PriorityChip row={r} /> : <span className="text-slate-400">—</span>) },
    { key: 'priority', label: 'Priority (SRO 308)', className: 'text-center' },
    { key: 'status', label: 'Status', badge: true },
  ],
  fields: [],
  viewFields: applicationView,
  toolbar: [
    { label: 'Reorder', icon: ArrowUpDown, write: true, run: (ctx) => ctx.open((close) => <ReorderModal onClose={close} onDone={() => (close(), ctx.reload())} />) },
  ],
  deleteLabel: (r) => r.applicationNo,
};

const allotmentFields: FieldDef[] = [
  {
    name: 'applicationNo', label: 'Applicant (Waiting List)', type: 'lookup', span: 2, lockedOnEdit: true,
    lookup: {
      collection: 'applications',
      query: { in_status: 'Eligible,Recommended', sort: 'waitingOrder', dir: 'asc', priorityFirst: '1' },
      value: 'applicationNo',
      label: (r) => `${r.applicationNo} · ${rankName(r)} (${r.serviceNo}) · ${r.categoryRequested}`,
      fill: (r) => ({ allotteeName: r.name, serviceNo: r.serviceNo, rank: r.rank, payLevel: r.payLevel, allotmentType: r.applicationType === 'Fresh' ? 'Fresh' : 'Change' }),
    },
    hint: 'Eligible and recommended applicants, in allotment priority then waiting-list order. Leave blank for a manual allotment.',
  },
  {
    name: 'quarterNo', label: 'Quarter No.', type: 'lookup', required: true, span: 2, lockedOnEdit: true,
    lookup: quarterLookup('Vacant', (q) => ({ category: q.category })),
    hint: 'Only vacant quarters are listed.',
  },
  { name: 'allotteeName', label: 'Allottee Name', required: true, uppercase: true },
  { name: 'serviceNo', label: 'Service No.', required: true },
  { name: 'rank', label: 'Rank', type: 'select', options: 'ranks' },
  { name: 'payLevel', label: 'Pay Level', type: 'select', options: 'payLevels' },
  { name: 'allotmentType', label: 'Allotment Type', type: 'select', options: ['Fresh', 'Change'], required: true },
  { name: 'allotmentDate', label: 'Allotment Date', type: 'date', required: true },
  { name: 'fromDate', label: 'From Date', type: 'date', required: true },
  { name: 'toDate', label: 'To Date / Retention Upto', type: 'date', hint: 'Leave blank to apply the standard tenure.' },
  { name: 'remarks', label: 'Remarks', type: 'textarea', span: 2 },
];
const allotmentView: FieldDef[] = [
  { name: 'orderNo', label: 'Allotment Order No.' }, { name: 'allotmentDate', label: 'Allotment Date', type: 'date' }, { name: 'status', label: 'Status' },
  { name: 'quarterNo', label: 'Quarter No.' }, { name: 'category', label: 'Category' }, { name: 'station', label: 'Station' },
  { name: 'allotteeName', label: 'Allottee' }, { name: 'rank', label: 'Rank' }, { name: 'serviceNo', label: 'Service No.' },
  { name: 'payLevel', label: 'Pay Level' }, { name: 'applicationNo', label: 'Application No.' }, { name: 'allotmentType', label: 'Allotment Type' },
  { name: 'fromDate', label: 'From Date', type: 'date' }, { name: 'toDate', label: 'To Date', type: 'date' }, { name: 'vacatedOn', label: 'Vacated On', type: 'date' },
  { name: 'remarks', label: 'Remarks', type: 'textarea' },
];
const bulkOrder = { label: 'Bulk Order (Office-wise)', icon: Files, run: (ctx: { open: (r: (close: () => void) => React.ReactNode) => void }) => ctx.open((close) => <BulkOrderModal onClose={close} />) };
const printOrder: ActionDef = { label: 'Print Order', icon: Printer, needsRow: true, run: (ctx, r) => ctx.open((close) => <PrintOrderModal row={r!} onClose={close} />) };

export const quarterAllotment: ModuleConfig = {
  key: 'quarter-allotment',
  collection: 'allotments',
  title: 'Quarter Allotment',
  subtitle: 'Allotment of Government Married Accommodation',
  icon: KeyRound,
  singular: 'allotment',
  stats: 'quarters',
  add: false,
  topPanel: (ctx) => <AllotPanel onAllotted={ctx.reload} version={ctx.version} />,
  noDelete: true,
  filters: [
    station,
    { ...subDivision, label: 'Sub Division', allLabel: 'All Sub Divisions' },
    location,
    category,
    { name: 'quarterNo', label: 'Quarter No.', type: 'text', param: 'like_quarterNo', placeholder: 'Enter Quarter No.' },
    { name: 'person', label: 'Service No. / Name', type: 'text', param: 'search_serviceNo,allotteeName', placeholder: 'Enter Service No. or Name' },
    { name: 'from', label: 'Allotment From (Date)', type: 'date', param: 'from_allotmentDate' },
    { name: 'to', label: 'To (Date)', type: 'date', param: 'to_allotmentDate' },
  ],
  columns: [
    { key: 'orderNo', label: 'Allotment Order No.', className: 'whitespace-nowrap', opensRecord: true },
    { key: 'allotmentDate', label: 'Allotment Date', date: true },
    { key: 'quarterNo', label: 'Quarter No.', render: (r) => <QuarterLink no={r.quarterNo} /> },
    { key: 'category', label: 'Category' },
    allottedLocationColumn,
    { key: 'allotteeName', label: 'Allotted To (Name & Service No.)', text: withService('allotteeName', 'serviceNo') },
    { key: 'payLevel', label: 'Pay Level' },
    { key: 'allotmentType', label: 'Allotment Type' },
    { key: 'fromDate', label: 'From Date', date: true },
    { key: 'toDate', label: 'To Date / Retention Upto', date: true },
    takeoverColumn,
    { key: 'status', label: 'Status', badge: true },
  ],
  fields: allotmentFields,
  viewFields: allotmentView,
  defaults: () => ({ allotmentDate: isoDate(), fromDate: isoDate(), allotmentType: 'Fresh' }),
  toolbar: [
    {
      label: 'Cancel',
      icon: Ban,
      needsRow: true,
      write: true,
      run: async (ctx, r) => {
        if (r!.status !== 'Allotted') return ctx.toast.error(`This allotment is already ${r!.status.toLowerCase()}.`);
        const ok = await ctx.confirm({
          title: 'Cancel allotment',
          message: <>Cancel allotment <b>{r!.orderNo}</b> of {r!.quarterNo} to {r!.allotteeName}? The quarter will be marked vacant and the applicant returned to the waiting list.</>,
          confirmLabel: 'Cancel Allotment',
          danger: true,
        });
        if (!ok) return;
        try {
          await api(`/c/allotments/${r!.id}`, { method: 'PUT', body: { status: 'Cancelled' } });
          ctx.toast.success('Allotment cancelled.');
          ctx.reload();
        } catch (e) {
          ctx.toast.error(e);
        }
      },
    },
    printOrder,
    bulkOrder,
  ],
  viewFooter: (ctx, r, close) => (
    <Button icon={Printer} onClick={() => (close(), ctx.open((c2) => <PrintOrderModal row={r} onClose={c2} />))}>Print Order</Button>
  ),
  rowActions: [
    { label: 'Print Order', icon: Printer, run: (ctx, r) => ctx.open((close) => <PrintOrderModal row={r!} onClose={close} />) },
    { label: 'View Proceedings', icon: ScrollText, tone: 'brand', run: (ctx, r) => ctx.navigate(`/proceedings?search=${encodeURIComponent(r!.orderNo)}`) },
  ],
  deleteLabel: (r) => r.orderNo,
};

export const quarterOccupation: ModuleConfig = {
  key: 'quarter-occupation',
  collection: 'allotments',
  title: 'Quarter Occupation',
  subtitle: 'Take-over of allotted accommodation from the BSO office, and action as per SRO 308 where not taken over',
  icon: DoorOpen,
  singular: 'allotment',
  add: false,
  noEdit: true,
  noDelete: true,
  baseQuery: { status: 'Allotted' },
  sort: 'occDeadline',
  dir: 'asc',
  tabs: [
    { label: 'Awaiting Take-over', query: { in_occState: 'Awaiting Take-over,Deferment Granted' } },
    { label: 'Overdue / Not Taken Over', query: { in_occState: 'Overdue,Not Taken Over' } },
    { label: 'Occupied', query: { occState: 'Occupied' } },
    { label: 'All', query: {} },
  ],
  filters: [
    { name: 'officeName', label: 'Office', optionsFrom: '/offices', allLabel: 'All Offices' },
    location,
    category,
    { name: 'search', label: 'Search', type: 'text', param: 'search_serviceNo,allotteeName,quarterNo,orderNo', placeholder: 'Name, service no., quarter or order no.' },
  ],
  columns: [
    { key: 'orderNo', label: 'Order No.', className: 'whitespace-nowrap', opensRecord: true },
    { key: 'allotmentDate', label: 'Allotted On', date: true },
    { key: 'allotteeName', label: 'Allottee (Name & Service No.)', text: withService('allotteeName', 'serviceNo') },
    { key: 'officeName', label: 'Office Name', text: (r) => r.officeName || '—' },
    { key: 'quarterNo', label: 'Quarter', text: (r) => `${r.quarterNo} (${r.category})`, render: (r) => <QuarterLink no={r.quarterNo} suffix={`(${r.category})`} /> },
    allottedLocationColumn,
    { key: 'occDeadline', label: 'Take-over Due By', date: true },
    takeoverColumn,
    {
      key: 'occAction',
      label: 'Action as per SRO 308',
      text: (r) => r.occAction || '—',
      render: (r) => (r.occAction ? <span className="block max-w-72 text-sm font-medium text-red-800">{r.occAction}</span> : <span className="text-slate-400">—</span>),
    },
  ],
  fields: [],
  viewFields: [
    { name: 'orderNo', label: 'Allotment Order No.' }, { name: 'allotmentDate', label: 'Allotment Date', type: 'date' },
    { name: 'allotteeName', label: 'Allottee' }, { name: 'serviceNo', label: 'Service No.' }, { name: 'quarterNo', label: 'Quarter No.' },
    { name: 'category', label: 'Category' }, { name: 'occState', label: 'Take-over Status' }, { name: 'occDeadline', label: 'Take-over Due By', type: 'date' },
    { name: 'occupiedOn', label: 'Taken Over On', type: 'date' }, { name: 'deferredUpto', label: 'Deferred Up To', type: 'date' },
    { name: 'deferReason', label: 'Reason for Deferment' }, { name: 'notTakenOverOn', label: 'Recorded Not Taken Over On', type: 'date' },
    { name: 'occAction', label: 'Action as per SRO 308', type: 'textarea' }, { name: 'occupationRemarks', label: 'Remarks', type: 'textarea' },
  ],
  toolbar: [
    { label: 'Import BSO Report', icon: Upload, write: true, run: (ctx) => ctx.open((close) => <TakeoverImportModal onClose={close} onDone={() => (close(), ctx.reload())} />) },
  ],
  rowActions: [
    { label: 'Mark Occupied', icon: CheckCircle2, tone: 'brand', write: true, labelled: true, show: (r) => r.occState !== 'Occupied', run: occupationAction('occupied') },
    { label: 'Grant Deferment', icon: CalendarClock, write: true, labelled: true, show: (r) => ['Awaiting Take-over', 'Overdue', 'Deferment Granted'].includes(r.occState), run: occupationAction('defer') },
    { label: 'Not Taken Over', icon: AlertTriangle, tone: 'red', write: true, labelled: true, show: (r) => r.occState === 'Overdue', run: occupationAction('notTaken') },
    {
      label: 'Cancel Allotment (Rule 7 (1))', icon: Ban, tone: 'red', write: true, labelled: true,
      show: (r) => r.occState === 'Overdue' || r.occState === 'Not Taken Over',
      run: async (ctx, r) => {
        const ok = await ctx.confirm({
          title: 'Cancel allotment – Rule 7 (1) of SRO 308',
          message: <>Cancel allotment <b>{r!.orderNo}</b> of <b>{r!.quarterNo}</b> to {r!.allotteeName} for not taking over the accommodation? The quarter will be marked vacant.</>,
          confirmLabel: 'Cancel Allotment',
          danger: true,
        });
        if (!ok) return;
        try {
          await api(`/c/allotments/${r!.id}`, { method: 'PUT', body: { status: 'Cancelled', cancelReason: 'Cancelled for not taking over the accommodation – Rule 7 (1) of SRO 308' } });
          ctx.toast.success(`Allotment ${r!.orderNo} cancelled under Rule 7 (1) of SRO 308.`);
          ctx.reload();
        } catch (e) {
          ctx.toast.error(e);
        }
      },
    },
  ],
};

export const allotmentOrders: ModuleConfig = {
  key: 'allotment-orders',
  collection: 'allotments',
  title: 'Allotment Orders',
  subtitle: 'Orders issued for allotment of married accommodation',
  icon: FileText,
  singular: 'allotment order',
  add: { label: 'Generate Order', to: '/quarter-allotment' },
  noEdit: true,
  noDelete: true,
  filters: [
    { ...yearFilter('allotmentDate'), overriddenBy: 'proceedingsNo' },
    { name: 'proceedingsNo', label: 'Proceedings No.', optionsFrom: '/proceedings-list', param: 'has_proceedingsNo', allLabel: 'All Proceedings' },
    { name: 'officeName', label: 'Office', optionsFrom: '/offices', allLabel: 'All Offices' },
    station,
    category,
  ],
  columns: [
    { key: 'orderNo', label: 'Order No.', className: 'whitespace-nowrap', opensRecord: true },
    { key: 'allotmentDate', label: 'Order Date', date: true },
    { key: 'proceedingsNo', label: 'Proceedings No.', className: 'whitespace-nowrap', text: (r) => r.proceedingsNo || '—' },
    { key: 'allotteeName', label: 'Allottee (Name & Service No.)', text: withService('allotteeName', 'serviceNo') },
    { key: 'officeName', label: 'Office Name', text: (r) => r.officeName || '—' },
    { key: 'quarterNo', label: 'Quarter No.', render: (r) => <QuarterLink no={r.quarterNo} /> },
    { key: 'category', label: 'Category' },
    takeoverColumn,
    { key: 'status', label: 'Status', badge: (r) => (r.status === 'Allotted' ? 'Issued' : r.status) },
  ],
  fields: allotmentFields,
  viewFields: allotmentView,
  defaults: () => ({ allotmentDate: isoDate(), fromDate: isoDate(), allotmentType: 'Fresh' }),
  toolbar: [printOrder, bulkOrder],
  viewFooter: (ctx, r, close) => (
    <Button icon={Printer} onClick={() => (close(), ctx.open((c2) => <PrintOrderModal row={r} onClose={c2} />))}>Print Order</Button>
  ),
  rowActions: [{ label: 'Print Order', icon: Printer, run: (ctx, r) => ctx.open((close) => <PrintOrderModal row={r!} onClose={close} />) }],
};

const allotmentLabel = (r: Row) => `${r.orderNo} · ${r.quarterNo} (${r.category}${r.location ? `, ${r.location}` : ''}) · ${r.rank && r.rank !== 'Civilian' ? `${r.rank} ` : ''}${r.allotteeName} (${r.serviceNo})`;

export const proceedings: ModuleConfig = {
  key: 'proceedings',
  collection: 'proceedings',
  title: 'Proceedings',
  subtitle: 'Proceedings of the Accommodation Allotment Committee',
  icon: ScrollText,
  singular: 'proceedings',
  add: { label: 'Add Proceedings' },
  filters: [
    { ...yearFilter('proceedingsDate', false) },
    { name: 'month', label: 'Month', param: 'month_proceedingsDate', options: MONTH_OPTIONS, allLabel: 'All Months' },
    {
      name: 'search',
      label: 'Search',
      type: 'text',
      param: 'search_proceedingsNo,authority,presidingOfficer,members,allotments',
      placeholder: 'Proceedings no., officer, member, allottee, service no., quarter or order no.',
    },
  ],
  columns: [
    { key: 'proceedingsNo', label: 'Proceedings No.', className: 'whitespace-nowrap', opensRecord: true },
    { key: 'proceedingsDate', label: 'Proceedings Date', date: true },
    { key: 'authority', label: 'Authority for Proceedings' },
    { key: 'presidingOfficer', label: 'Presiding Officer' },
    { key: 'document', label: 'Signed PDF', text: (r) => r.document?.fileName ?? '—', render: (r) => <FileLink file={r.document} /> },
    { key: 'members', label: 'Members', text: (r) => (Array.isArray(r.members) ? r.members.join(', ') : '—') || '—' },
    {
      key: 'allotments',
      label: 'Allotments',
      text: (r) => (Array.isArray(r.allotments) && r.allotments.length ? r.allotments.map((a: Row) => `${a.quarterNo} – ${a.allotteeName}`).join('; ') : '—'),
      render: (r) => {
        const list: Row[] = Array.isArray(r.allotments) ? r.allotments : [];
        if (!list.length) return <span className="text-slate-400">—</span>;
        return (
          <span title={list.map(allotmentLabel).join('\n')}>
            {list.slice(0, 2).map((a, i) => (
              <span key={a.orderNo ?? i}>
                {i > 0 && ', '}
                <QuarterText no={a.quarterNo} /> – {a.allotteeName}
              </span>
            ))}
            {list.length > 2 && <span className="ml-1 rounded bg-brand-100 px-1.5 text-xs font-semibold text-brand-800">+{list.length - 2} more</span>}
          </span>
        );
      },
    },
  ],
  fields: [
    { name: 'proceedingsNo', label: 'Proceedings No.', placeholder: 'Auto-generated if blank' },
    { name: 'proceedingsDate', label: 'Proceedings Date', type: 'date', required: true },
    { name: 'authority', label: 'Authority for Proceedings', required: true, span: 2, placeholder: 'e.g. Station HQ letter No. 1234/Q dated 01-Mar-2026' },
    { name: 'presidingOfficer', label: 'Presiding Officer', required: true, span: 2, placeholder: 'Rank and name, e.g. Col A. Mehta' },
    { name: 'members', label: 'Members', type: 'list', span: 2, required: true, addLabel: 'Add Member', placeholder: 'Rank and name of member' },
    {
      name: 'allotments',
      label: 'Allotments Considered',
      type: 'picker',
      span: 2,
      placeholder: 'Search by order no., quarter, name or service no. and select',
      lookup: {
        collection: 'allotments',
        query: { sort: 'allotmentDate', dir: 'desc' },
        value: 'orderNo',
        label: allotmentLabel,
        snapshot: (r) => ({ orderNo: r.orderNo, allotmentDate: r.allotmentDate, quarterNo: r.quarterNo, category: r.category, rank: r.rank, allotteeName: r.allotteeName, serviceNo: r.serviceNo }),
        itemNote: { key: 'boardRemarks', placeholder: 'Remarks by the Board for this allotment' },
      },
    },
    { name: 'document', label: 'Signed Board Proceedings (PDF / scan)', type: 'file', span: 2, hint: 'Upload the signed copy after the board, to keep it on record (up to 20 MB).' },
    { name: 'remarks', label: 'Remarks / Decisions', type: 'textarea', span: 2 },
  ],
  defaults: () => ({ proceedingsDate: isoDate(), members: [''] }),
  viewFooter: (ctx, r, close) => (
    <>
      <Button icon={Printer} onClick={() => (close(), ctx.open((c2) => <PrintProceedingsModal row={r} onClose={c2} />))}>Print with Appendices</Button>
      <Button icon={Files} onClick={() => (close(), ctx.open((c2) => <BulkOrderModal initialProceedings={r.proceedingsNo} onClose={c2} />))}>Print Allotment Order</Button>
    </>
  ),
  rowActions: [{ label: 'Print with Appendices', icon: Printer, tone: 'brand', run: (ctx, r) => ctx.open((close) => <PrintProceedingsModal row={r!} onClose={close} />) }],
  toolbar: [
    { label: 'Record Past Board', icon: History, write: true, run: (ctx) => ctx.open((close) => <PastBoardModal onClose={close} onDone={ctx.reload} />) },
    { label: 'Print with Appendices', icon: Printer, needsRow: true, run: (ctx, r) => ctx.open((close) => <PrintProceedingsModal row={r!} onClose={close} />) },
  ],
  deleteLabel: (r) => r.proceedingsNo,
};

const RETENTION_STATUSES = ['Under Consideration', 'Approved', 'Rejected'];
export const retention: ModuleConfig = {
  key: 'retention-extension',
  collection: 'retentions',
  title: 'Retention & Extension',
  subtitle: 'Retention and extension of allotted accommodation',
  icon: RefreshCcw,
  singular: 'case',
  add: { label: 'Add Case' },
  tabs: [
    { label: 'Retention Cases', query: { caseType: 'Retention' }, defaults: { caseType: 'Retention' } },
    { label: 'Extension Cases', query: { caseType: 'Extension' }, defaults: { caseType: 'Extension' } },
  ],
  filters: [
    { ...yearFilter('fromDate'), overriddenBy: 'search' },
    station,
    {
      name: 'search', label: 'Service No. / Name', type: 'text', param: 'search_serviceNo,name',
      placeholder: 'Enter service no. or name (searches all years)',
    },
  ],
  columns: [
    { key: 'name', label: 'Name & Service No.', text: withService('name', 'serviceNo') },
    { key: 'quarterNo', label: 'Quarter No.', render: (r) => <QuarterLink no={r.quarterNo} /> },
    { key: 'caseType', label: 'Case Type' },
    { key: 'reason', label: 'Grounds', text: (r) => r.reason || '—' },
    {
      key: 'documents', label: 'Documents', className: 'text-center',
      text: (r) => String(Array.isArray(r.documents) ? r.documents.length : 0),
      render: (r) => (Array.isArray(r.documents) && r.documents.length ? <span className="inline-flex items-center gap-1"><Paperclip className="size-4" />{r.documents.length}</span> : <span className="text-slate-400">—</span>),
    },
    { key: 'fromDate', label: 'From Date', date: true },
    { key: 'toDate', label: 'To Date', date: true },
    { key: 'status', label: 'Status', badge: true },
  ],
  fields: [
    {
      name: 'quarterNo', label: 'Quarter No.', type: 'lookup', required: true, span: 2,
      lookup: quarterLookup('Occupied', (q) => ({ name: occupantName(q), serviceNo: q.occupantServiceNo, station: q.station })),
    },
    { name: 'name', label: 'Name', required: true, uppercase: true },
    { name: 'serviceNo', label: 'Service No.', required: true },
    { name: 'caseType', label: 'Case Type', type: 'select', options: ['Retention', 'Extension'], required: true },
    { name: 'status', label: 'Status', type: 'select', options: RETENTION_STATUSES, required: true, hint: 'Approval extends the quarter’s vacation due date.' },
    { name: 'fromDate', label: 'From Date', type: 'date', required: true },
    { name: 'toDate', label: 'To Date', type: 'date', required: true },
    { name: 'reason', label: 'Grounds', type: 'select', options: 'retentionGrounds', required: true, span: 2 },
    { name: 'remarks', label: 'Remarks', type: 'textarea', span: 2, maxWords: 10000, rows: 10, placeholder: 'Detailed remarks / justification (up to 10,000 words)' },
    { name: 'documents', label: 'Supporting Documents', type: 'documents', span: 2, addLabel: 'Add Document' },
  ],
  defaults: () => ({ status: 'Under Consideration', fromDate: isoDate() }),
  toolbar: [
    updateStatus('retentions', RETENTION_STATUSES),
    { label: 'Print Order', icon: Printer, needsRow: true, run: (ctx, r) => ctx.open((close) => <PrintOrderModal kind="retention" row={r!} onClose={close} />) },
    {
      label: 'Bulk Order (Office-wise)', icon: Files,
      run: (ctx) => ctx.open((close) => <BulkOrderModal kind="retention" caseType={ctx.query.caseType ?? 'Retention'} onClose={close} />),
    },
  ],
  rowActions: [
    {
      label: 'Documents', icon: Paperclip, show: (r) => Array.isArray(r.documents) && r.documents.length > 0,
      run: (ctx, r) => ctx.open((close) => <DocumentsModal row={{ ...r!, applicationNo: `${r!.caseType} – ${r!.name}` }} onClose={close} />),
    },
    { label: 'Print Order', icon: Printer, tone: 'brand', show: (r) => r.status === 'Approved', run: (ctx, r) => ctx.open((close) => <PrintOrderModal kind="retention" row={r!} onClose={close} />) },
  ],
  deleteLabel: (r) => `${r.caseType} case of ${r.name}`,
};

export const MODULES = [
  quarterRegister, vacationReport, applicantRegister, applicationScrutiny, waitingList, quarterAllotment, quarterOccupation,
  proceedings, allotmentOrders, retention,
];

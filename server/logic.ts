import { HTTPException } from 'hono/http-exception';
import { db, all, get, update, findOne, isoDate, addDays, addYears, daysBetween, type Rec } from './db.ts';
import { assess } from './scrutiny.ts';

export const COLLECTIONS = [
  'quarters',
  'applications',
  'allotments',
  'vacations',
  'committees',
  'meetings',
  'agendas',
  'proceedings',
  'retentions',
  'policies',
  'signatories',
] as const;
export type Collection = (typeof COLLECTIONS)[number];

export const WAITING_STATUSES = ['Pending', 'Scrutiny', 'Eligible', 'Recommended'];
/** Accepted in scrutiny and not yet allotted: these make up the waiting list. */
export const ACCEPTED_STATUSES = ['Eligible', 'Recommended'];

const bad = (message: string): never => {
  throw new HTTPException(400, { message });
};

/* ------------------------------------------------------------------ */
/* Config                                                             */
/* ------------------------------------------------------------------ */

export type PriorityRule = { office: string; type: string };
export const PRIORITY_TYPES = ['', 'Change of Accn', 'Fresh'];

/** Which priority rule (1-based) an applicant falls under; applicants matching no rule come after all rules. */
export function priorityOf(a: Rec, rules: PriorityRule[]): { group: number; label: string } {
  if (!rules.length) return { group: 1, label: '' };
  const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();
  const i = rules.findIndex((r) => (!r.office || norm(r.office) === norm(a.officeName)) && (!r.type || r.type === a.applicationType));
  if (i < 0) return { group: rules.length + 1, label: `P${rules.length + 1} · Others` };
  const r = rules[i];
  return { group: i + 1, label: `P${i + 1} · ${r.office || 'Any office'} · ${r.type || 'Any type'}` };
}

export const DEFAULT_CONFIG = {
  /** Allotment priority, highest first: applicants matching rule 1, then rule 2, …, then everyone else. Empty = seniority only. */
  priorityRules: [] as PriorityRule[],
  organisation: 'CWE Shillong',
  office: 'Office of the Barrack Stores Officer (Accommodation)',
  address: 'SE Falls 793011',
  allotmentTenureYears: 3,
  vacationNoticeDays: 30,
  ordersSignatory: 'Barrack Stores Officer (Accn)',
  allotmentNotes: [
    'Handing / Taking is to be completed with BSO GE Shillong in r/o the above allotted accn in eight (08) days after receiving of the allotment letter.',
    'If the indl fails to take over the accommodation within the stipulated time, necessary action shall be taken as per Rule 7 (1) of SRO 308.',
    'If the indls are unable to occupy the accommodation due to genuine reasons, they may apply for deferment as per the applicable Govt decision under SRO 308 before expiry of the prescribed period.',
    'Licence Fee, electricity, water and other recoverable charges shall be payable as per Govt Rules.',
    'The accommodation shall not be sublet, shared or used for any purpose other than residential use except as permitted under SRO 308.',
    'Any violation of SRO 308, including unauthorised occupation, subletting, misuse of accommodation, keeping domestic animals or furnishing incorrect information, is strictly prohibited and may result in cancellation of allotment, recovery of enhanced / damage licence fee and debarment from future allotment.',
  ].join('\n'),
  printMarginTop: 15,
  printMarginRight: 12,
  printMarginBottom: 15,
  printMarginLeft: 20,
  takeoverDays: 8,
  letterheadAlign: 'left',
  signatureAlign: 'left',
  takeoverAction:
    'Accommodation not taken over within the stipulated period. Action to be taken as per Rule 7 (1) of SRO 308 (allotment liable to be cancelled).',
  retentionNotes: [
    'The retention / extension is sanctioned for the period mentioned above only. No further retention / extension shall be granted except as permitted under SRO 308.',
    'The individual shall vacate the accommodation on or before expiry of the sanctioned period, failing which damage / penal licence fee shall be recovered as per Govt Rules.',
    'Licence Fee, electricity, water and other recoverable charges shall continue to be payable as per Govt Rules during the period of retention / extension.',
    'The accommodation shall not be sublet, shared or used for any purpose other than residential use except as permitted under SRO 308.',
    'The sanction is liable to be cancelled if any information furnished is found to be incorrect.',
  ].join('\n'),
};
export type Config = typeof DEFAULT_CONFIG;

export function getConfig(): Config & { id?: number } {
  const c = all('config')[0];
  return { ...DEFAULT_CONFIG, ...(c ?? {}) };
}

/* ------------------------------------------------------------------ */
/* Reference numbering                                                */
/* ------------------------------------------------------------------ */

const pad = (n: number, w: number) => String(n).padStart(w, '0');

const NUMBERING: Partial<
  Record<Collection, { field: string; dateField: string; fmt: (y: number, n: number) => string; re: (y: number) => RegExp }>
> = {
  applications: {
    field: 'applicationNo',
    dateField: 'applicationDate',
    fmt: (y, n) => `GMAA/APP/${y}/${pad(n, 4)}`,
    re: (y) => new RegExp(`^GMAA/APP/${y}/(\\d+)$`),
  },
  allotments: {
    field: 'orderNo',
    dateField: 'allotmentDate',
    fmt: (y, n) => `AO/${pad(n, 3)}/${y}`,
    re: (y) => new RegExp(`^AO/(\\d+)/${y}$`),
  },
  committees: {
    field: 'orderNo',
    dateField: 'orderDate',
    fmt: (y, n) => `AC/${y}/${pad(n, 2)}`,
    re: (y) => new RegExp(`^AC/${y}/(\\d+)$`),
  },
  meetings: {
    field: 'meetingNo',
    dateField: 'meetingDate',
    fmt: (y, n) => `ACM/${pad(n, 2)}/${y}`,
    re: (y) => new RegExp(`^ACM/(\\d+)/${y}$`),
  },
  proceedings: {
    field: 'proceedingsNo',
    dateField: 'proceedingsDate',
    fmt: (y, n) => `PROC/${pad(n, 2)}/${y}`,
    re: (y) => new RegExp(`^PROC/(\\d+)/${y}$`),
  },
};

export function nextNumber(col: string, dateIso?: string): string | null {
  const f = NUMBERING[col as Collection];
  if (!f) return null;
  const y = Number((dateIso || isoDate()).slice(0, 4));
  const re = f.re(y);
  let max = 0;
  for (const r of all(col)) {
    const m = String(r[f.field] ?? '').match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return f.fmt(y, max + 1);
}

/* ------------------------------------------------------------------ */
/* Validation                                                         */
/* ------------------------------------------------------------------ */

const REQUIRED: Record<Collection, [string, string][]> = {
  quarters: [['quarterNo', 'Quarter No.'], ['category', 'Category'], ['station', 'Station'], ['subDivision', 'Sub-Division'], ['status', 'Status']],
  applications: [
    ['serviceNo', 'Service No.'], ['rank', 'Rank'], ['trade', 'Trade'], ['name', 'Name'],
    ['officeName', 'Office Name'], ['subDivision', 'Sub Division'], ['dateOfJoiningStation', 'Date of Joining in Station'],
    ['dateOfEnrolment', 'Date of Enrolment'], ['payLevel', 'Pay Level'], ['payCell', 'Pay Cell'], ['basicPay', 'Basic Pay'],
    ['entitlement', 'Type of Accn Entitlement'], ['categoryRequested', 'Type of Accn Requested'], ['applicationType', 'Application Type'],
    ['mobile', 'Mobile Number'], ['email', 'Email ID'],
  ],
  allotments: [['quarterNo', 'Quarter No.'], ['allotteeName', 'Allottee name'], ['serviceNo', 'Service No.'], ['allotmentDate', 'Allotment Date'], ['fromDate', 'From Date']],
  vacations: [['quarterNo', 'Quarter No.'], ['vacationDate', 'Vacation Date'], ['reason', 'Reason']],
  committees: [['orderDate', 'Order Date'], ['validUpto', 'Valid Upto'], ['chairman', 'Chairman']],
  meetings: [['meetingDate', 'Meeting Date'], ['time', 'Time'], ['venue', 'Venue'], ['purpose', 'Purpose']],
  agendas: [['meetingNo', 'Meeting No.'], ['item', 'Agenda Item']],
  proceedings: [['proceedingsDate', 'Proceedings Date'], ['authority', 'Authority for Proceedings'], ['presidingOfficer', 'Presiding Officer']],
  policies: [['title', 'Policy Name']],
  signatories: [['name', 'Name'], ['designation', 'Designation']],
  retentions: [['quarterNo', 'Quarter No.'], ['name', 'Name'], ['serviceNo', 'Service No.'], ['caseType', 'Case Type'], ['fromDate', 'From Date'], ['toDate', 'To Date'], ['reason', 'Grounds']],
};

function clean(body: Record<string, unknown>, col: string): Rec {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body ?? {})) {
    if (['id', 'createdAt', 'updatedAt', 'waitingDays', 'passwordHash', 'autoCheck'].includes(k)) continue;
    if (col === 'quarters' && k === 'takeover') continue;
    // Shown on allotments for convenience, but it belongs to the application.
    if (col === 'allotments' && ['officeName', 'proceedingsNo', 'occState', 'occDeadline', 'occDays', 'occAction', 'location', 'appliedLocation'].includes(k)) continue;
    out[k] = typeof v === 'string' ? v.trim() : v;
  }
  return out as Rec;
}

function validate(col: Collection, r: Rec) {
  const missing = REQUIRED[col].filter(([k]) => r[k] === undefined || r[k] === null || r[k] === '').map(([, l]) => l);
  if (missing.length) bad(`Required: ${missing.join(', ')}`);

  if (col === 'applications') {
    if (!/^\d{10}$/.test(String(r.mobile))) bad('Mobile number must be 10 digits.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(r.email))) bad('Enter a valid email address.');
    if (Number.isNaN(Number(r.basicPay)) || Number(r.basicPay) <= 0) bad('Basic pay must be a positive number.');
    // Seniority is by date of enrolment in service, so it must be a real past date.
    if (r.dateOfEnrolment && String(r.dateOfEnrolment) > isoDate()) bad('Date of Enrolment in Service cannot be in the future.');
    if (r.dateOfEnrolment && r.applicationDate && String(r.dateOfEnrolment) > String(r.applicationDate)) bad('Date of Enrolment in Service cannot be after the application date.');
  }
  if (col === 'proceedings' && !(Array.isArray(r.members) && r.members.length)) bad('Add at least one member.');
  if (col === 'signatories' && r.signature?.fileId) {
    const m = db.prepare('SELECT mime FROM uploads WHERE id = ?').get(r.signature.fileId) as { mime: string } | undefined;
    if (!m || !m.mime.startsWith('image/')) bad('The signature must be a JPG or PNG image.');
  }
  if (col === 'retentions' && String(r.remarks ?? '').trim().split(/\s+/).filter(Boolean).length > 10000) bad('Remarks can be at most 10,000 words.');
  const dateOrder: [string, string, string][] = [
    ['fromDate', 'toDate', 'To Date must be after From Date.'],
    ['orderDate', 'validUpto', 'Valid Upto must be after Order Date.'],
  ];
  for (const [a, b, msg] of dateOrder) if (r[a] && r[b] && r[b] < r[a]) bad(msg);
}

const memberCount = (members: unknown) =>
  String(members ?? '')
    .split(/[\n;,]+/)
    .map((s) => s.trim())
    .filter(Boolean).length;

/* ------------------------------------------------------------------ */
/* Create / update preparation                                        */
/* ------------------------------------------------------------------ */

export function prepareCreate(col: Collection, body: Record<string, unknown>): Rec {
  const r = clean(body, col);
  const today = isoDate();
  const num = NUMBERING[col];

  switch (col) {
    case 'quarters':
      r.status ||= 'Vacant';
      r.quarterNo = String(r.quarterNo ?? '').toUpperCase();
      if (findOne('quarters', (q) => q.quarterNo === r.quarterNo)) bad(`Quarter ${r.quarterNo} already exists.`);
      break;
    case 'applications': {
      r.applicationDate ||= today;
      r.status ||= 'Pending';
      r.name = String(r.name ?? '').toUpperCase();
      r.priority ||= priorityFor(r.categoryRequested);
      const orders = all('applications').map((a) => Number(a.waitingOrder) || 0);
      r.waitingOrder = Math.max(0, ...orders) + 1;
      if (findOne('applications', (a) => a.serviceNo === r.serviceNo && WAITING_STATUSES.includes(a.status)))
        bad(`An application for service no. ${r.serviceNo} is already on the waiting list.`);
      break;
    }
    case 'allotments': {
      r.status ||= 'Allotted';
      r.allotmentDate ||= today;
      r.fromDate ||= r.allotmentDate;
      // Only applicants accepted in Application Scrutiny, and only a vacant quarter of their entitled type.
      if (!r.applicationNo) bad('Select an applicant accepted in Application Scrutiny.');
      const app = findOne('applications', (a) => a.applicationNo === r.applicationNo);
      if (!app) bad(`Application ${r.applicationNo} not found.`);
      if (!['Eligible', 'Recommended'].includes(app!.status))
        bad(`Application ${r.applicationNo} is ${app!.status}. Only applicants accepted in Application Scrutiny can be allotted a quarter.`);
      const q = findOne('quarters', (x) => x.quarterNo === r.quarterNo);
      if (!q) bad(`Quarter ${r.quarterNo} not found in the register.`);
      if (q!.status !== 'Vacant') bad(`Quarter ${r.quarterNo} is ${q!.status.toLowerCase()} and cannot be allotted.`);
      const active = findOne('allotments', (a) => a.quarterNo === r.quarterNo && a.status === 'Allotted');
      if (active) bad(`Quarter ${r.quarterNo} still has an active allotment (${active.orderNo}, ${active.allotteeName}). Record its vacation or cancel that allotment first.`);
      if (findOne('allotments', (a) => a.applicationNo === r.applicationNo && a.status === 'Allotted')) bad(`Application ${r.applicationNo} already has an active allotment.`);
      const entitled = app!.entitlement || app!.categoryRequested;
      if (entitled && q!.category !== entitled)
        bad(`Quarter ${q!.quarterNo} is ${q!.category}, but ${app!.name} is entitled to ${entitled}.`);
      Object.assign(r, {
        allotteeName: app!.name,
        serviceNo: app!.serviceNo,
        rank: app!.rank,
        payLevel: app!.payLevel,
        allotmentType: app!.applicationType === 'Fresh' ? 'Fresh' : 'Change',
      });
      Object.assign(r, { category: q!.category, station: q!.station, subDivision: q!.subDivision });
      r.toDate ||= addYears(String(r.fromDate), Number(getConfig().allotmentTenureYears) || 3);
      r.allotmentType ||= 'Fresh';
      // Take-over (handing / taking) with BSO is due within the configured period.
      r.occupationStatus = 'Awaiting';
      r.takeoverBy = addDays(String(r.allotmentDate), Number(getConfig().takeoverDays) || 8);
      break;
    }
    case 'vacations': {
      const q = findOne('quarters', (x) => x.quarterNo === r.quarterNo);
      if (!q) bad(`Quarter ${r.quarterNo} not found in the register.`);
      if (q!.status !== 'Occupied') bad(`Quarter ${r.quarterNo} is not occupied.`);
      r.prevOccupant ||= String(q!.occupant ?? '').replace(/\s*\([^)]*\)\s*$/, '');
      r.serviceNo ||= q!.occupantServiceNo;
      Object.assign(r, { category: q!.category, station: q!.station, subDivision: q!.subDivision, location: q!.location ?? '' });
      r.status ||= 'Vacant';
      break;
    }
    case 'committees':
      r.status ||= 'Active';
      break;
    case 'meetings':
      r.status ||= 'Scheduled';
      break;
    case 'agendas': {
      const items = all('agendas').filter((a) => a.meetingNo === r.meetingNo);
      r.sequence ||= items.length + 1;
      const m = findOne('meetings', (x) => x.meetingNo === r.meetingNo);
      if (m) r.meetingDate = m.meetingDate;
      break;
    }
    case 'proceedings':
      r.members = Array.isArray(r.members) ? r.members.map((m: unknown) => String(m).trim()).filter(Boolean) : [];
      r.allotments = Array.isArray(r.allotments) ? r.allotments : [];
      break;
    case 'signatories':
      r.status ||= 'Active';
      break;
    case 'policies':
      r.status ||= 'Active';
      r.rules = Array.isArray(r.rules) ? r.rules.map((m: unknown) => String(m).trim()).filter(Boolean) : [];
      break;
    case 'retentions':
      r.status ||= 'Under Consideration';
      break;
  }

  if (col === 'committees') r.memberCount = memberCount(r.members);
  validate(col, r);
  if (num && !r[num.field]) r[num.field] = nextNumber(col, String(r[num.dateField] || today));
  if (num) ensureUnique(col, num.field, r);
  return r;
}

export function prepareUpdate(col: Collection, prev: Rec, body: Record<string, unknown>): Rec {
  const r = { ...prev, ...clean(body, col) } as Rec;
  if (col === 'quarters') {
    r.quarterNo = String(r.quarterNo).toUpperCase();
    if (r.quarterNo !== prev.quarterNo && findOne('quarters', (q) => q.quarterNo === r.quarterNo && q.id !== prev.id))
      bad(`Quarter ${r.quarterNo} already exists.`);
    // Other records refer to the quarter by its number, so it cannot be renumbered once it has history.
    if (r.quarterNo !== prev.quarterNo && ['allotments', 'vacations', 'retentions'].some((c) => findOne(c, (x) => x.quarterNo === prev.quarterNo)))
      bad(`Quarter ${prev.quarterNo} already has allotment / vacation / retention records and cannot be renumbered.`);
    // Occupancy only changes through Quarter Allotment / Vacation Report, so the register and the allotments always agree.
    if (prev.status === 'Occupied' && r.status !== 'Occupied')
      bad(`${prev.quarterNo} is occupied by ${prev.occupant || 'an allottee'}. To free it, record its vacation in Vacation Report (or cancel the allotment) instead of editing its status.`);
    if (prev.status !== 'Occupied' && r.status === 'Occupied') bad('A quarter becomes Occupied only when it is allotted in Quarter Allotment.');
    if (r.status !== 'Occupied') Object.assign(r, { occupant: '', occupantServiceNo: '', allotmentDate: '', vacationDue: '' });
  }
  if (col === 'applications') {
    r.name = String(r.name).toUpperCase();
    // A scrutiny decision must cite the policy and the rule it is made under.
    if (['Eligible', 'Rejected'].includes(r.status) && r.status !== prev.status) {
      const policy = r.scrutinyPolicyId ? get('policies', Number(r.scrutinyPolicyId)) : undefined;
      if (!policy) bad('Select the policy / authority this decision is made under (Application Scrutiny → Authority).');
      if (Array.isArray(r.scrutinyRules) && r.scrutinyRules.length) {
        const known = new Set<string>(Array.isArray(policy!.rules) ? policy!.rules : []);
        if (r.scrutinyRules.some((x: unknown) => !known.has(String(x)))) bad('One of the selected rules is not in the chosen policy. Select the rules again.');
        r.scrutinyRule = r.scrutinyRules.join('; ');
      }
      if (!String(r.scrutinyRule ?? '').trim()) bad('Select the rule / para of the policy this decision is made under.');
      if (r.status === 'Rejected' && !String(r.rejectionReason ?? '').trim()) bad('Select a reason for rejection.');
      r.scrutinyPolicy = policy!.authorityRef ? `${policy!.title} (${policy!.authorityRef})` : policy!.title;
    }
  }
  if (col === 'policies') r.rules = Array.isArray(r.rules) ? r.rules.map((m: unknown) => String(m).trim()).filter(Boolean) : [];
  if (col === 'allotments' && r.quarterNo !== prev.quarterNo) bad('Quarter cannot be changed on an existing allotment. Cancel it and allot afresh.');
  if (col === 'allotments') {
    if (r.occupationStatus === 'Occupied' && !r.occupiedOn) bad('Enter the date the accommodation was taken over.');
    if (r.occupiedOn && r.occupiedOn < r.allotmentDate) bad('The take-over date cannot be before the allotment date.');
    if (r.occupationStatus === 'Deferment' && (!r.deferredUpto || r.deferredUpto <= isoDate())) bad('Deferment must be up to a future date.');
  }
  if (col === 'committees') r.memberCount = memberCount(r.members);
  if (col === 'proceedings') {
    r.members = Array.isArray(r.members) ? r.members.map((m: unknown) => String(m).trim()).filter(Boolean) : [];
    r.allotments = Array.isArray(r.allotments) ? r.allotments : [];
  }
  if (col === 'agendas') {
    const m = findOne('meetings', (x) => x.meetingNo === r.meetingNo);
    if (m) r.meetingDate = m.meetingDate;
  }
  validate(col, r);
  const num = NUMBERING[col];
  if (num) ensureUnique(col, num.field, r);
  return r;
}

function ensureUnique(col: string, field: string, r: Rec) {
  if (findOne(col, (x) => x[field] === r[field] && x.id !== r.id)) bad(`${r[field]} already exists.`);
}

export function priorityFor(category: unknown): string {
  return ({ 'Type I': 'IV', 'Type II': 'III', 'Type III': 'II', 'Type IV': 'I' } as Record<string, string>)[String(category)] ?? 'IV';
}

/* ------------------------------------------------------------------ */
/* Side effects that keep the register consistent                     */
/* ------------------------------------------------------------------ */

const quarterByNo = (no: string) => findOne('quarters', (q) => q.quarterNo === no);
const appByNo = (no: string) => (no ? findOne('applications', (a) => a.applicationNo === no) : undefined);

function vacateQuarter(no: string, serviceNo?: string) {
  const q = quarterByNo(no);
  if (!q || q.status !== 'Occupied') return;
  if (serviceNo && q.occupantServiceNo && q.occupantServiceNo !== serviceNo) return;
  update('quarters', q.id, { status: 'Vacant', occupant: '', occupantServiceNo: '', allotmentDate: '', vacationDue: '' });
}

export function afterWrite(col: Collection, rec: Rec, prev: Rec | null) {
  // Corrections to an applicant's details flow to their current allotment and the quarter register.
  if (col === 'applications' && prev) {
    const changed = ['name', 'serviceNo', 'rank', 'payLevel'].some((k) => rec[k] !== prev[k]);
    if (changed)
      for (const a of all('allotments'))
        if (a.applicationNo === rec.applicationNo && a.status === 'Allotted') {
          update('allotments', a.id, { allotteeName: rec.name, serviceNo: rec.serviceNo, rank: rec.rank, payLevel: rec.payLevel });
          const q = quarterByNo(a.quarterNo);
          if (q && q.status === 'Occupied' && q.occupantServiceNo === prev.serviceNo)
            update('quarters', q.id, { occupant: rec.rank ? `${rec.name} (${rec.rank})` : rec.name, occupantServiceNo: rec.serviceNo });
        }
  }
  // Corrections to a quarter's type / station flow to its current allotment.
  if (col === 'quarters' && prev && ['category', 'station', 'subDivision'].some((k) => rec[k] !== prev[k])) {
    for (const a of all('allotments'))
      if (a.quarterNo === rec.quarterNo && a.status === 'Allotted') update('allotments', a.id, { category: rec.category, station: rec.station, subDivision: rec.subDivision });
  }
  if (col === 'allotments') {
    const app = appByNo(rec.applicationNo);
    if (rec.status === 'Allotted' && (!prev || prev.status !== 'Allotted')) {
      const q = quarterByNo(rec.quarterNo);
      if (q)
        update('quarters', q.id, {
          status: 'Occupied',
          occupant: rec.rank ? `${rec.allotteeName} (${rec.rank})` : rec.allotteeName,
          occupantServiceNo: rec.serviceNo,
          allotmentDate: rec.allotmentDate,
          vacationDue: rec.toDate,
        });
      if (app) update('applications', app.id, { status: 'Allotted', allottedQuarter: rec.quarterNo });
    } else if (rec.status === 'Allotted' && prev) {
      const q = quarterByNo(rec.quarterNo);
      if (q && q.occupantServiceNo === rec.serviceNo) update('quarters', q.id, { vacationDue: rec.toDate, allotmentDate: rec.allotmentDate });
    }
    if (rec.status === 'Cancelled' && prev?.status === 'Allotted') {
      vacateQuarter(rec.quarterNo, rec.serviceNo);
      if (app) update('applications', app.id, { status: 'Eligible', allottedQuarter: '' });
    }
  }

  if (col === 'vacations' && !prev) {
    vacateQuarter(rec.quarterNo);
    for (const a of all('allotments'))
      if (a.quarterNo === rec.quarterNo && a.status === 'Allotted') update('allotments', a.id, { status: 'Vacated', vacatedOn: rec.vacationDate });
  }

  if (col === 'retentions' && rec.status === 'Approved' && prev?.status !== 'Approved') {
    const q = quarterByNo(rec.quarterNo);
    if (q && q.status === 'Occupied' && (!q.occupantServiceNo || q.occupantServiceNo === rec.serviceNo))
      update('quarters', q.id, { vacationDue: rec.toDate });
  }

  if (col === 'committees' && rec.status === 'Active' && prev?.status !== 'Active') {
    for (const c of all('committees'))
      if (c.id !== rec.id && c.status === 'Active' && (c.station ?? '') === (rec.station ?? '')) update('committees', c.id, { status: 'Closed' });
  }
}

export function beforeDelete(col: Collection, rec: Rec) {
  if (col === 'quarters' && rec.status === 'Occupied') bad('An occupied quarter cannot be deleted. Record its vacation first.');
  if (col === 'applications' && rec.status === 'Allotted') bad('An application that has been allotted a quarter cannot be deleted.');
  if (col === 'allotments' && rec.status === 'Allotted') {
    vacateQuarter(rec.quarterNo, rec.serviceNo);
    const app = appByNo(rec.applicationNo);
    if (app) update('applications', app.id, { status: 'Eligible', allottedQuarter: '' });
  }
  if (col === 'policies' && findOne('applications', (a) => Number(a.scrutinyPolicyId) === rec.id))
    bad('This policy has been cited in scrutiny decisions and cannot be deleted. Mark it Superseded instead.');
  if (col === 'meetings') {
    for (const a of all('agendas')) if (a.meetingNo === rec.meetingNo) bad('Delete the agenda items for this meeting first.');
  }
}

/* ------------------------------------------------------------------ */
/* Listing                                                            */
/* ------------------------------------------------------------------ */

/**
 * Take-over position of an allotment:
 * Awaiting Take-over → Occupied, or (past the deadline) Overdue → Not Taken Over, with Deferment in between.
 */
export function occupation(a: Rec, cfg = getConfig()) {
  const today = isoDate();
  if (a.status !== 'Allotted') return { occState: a.status === 'Vacated' ? 'Vacated' : a.status, occDeadline: '', occDays: null, occAction: a.cancelReason ?? '' };
  const deadline = a.occupationStatus === 'Deferment' && a.deferredUpto ? a.deferredUpto : a.takeoverBy || addDays(a.allotmentDate, Number(cfg.takeoverDays) || 8);
  const days = daysBetween(today, deadline);
  if (a.occupationStatus === 'Occupied') return { occState: 'Occupied', occDeadline: deadline, occDays: null, occAction: '' };
  if (a.occupationStatus === 'Not Taken Over') return { occState: 'Not Taken Over', occDeadline: deadline, occDays: days, occAction: a.sroAction || cfg.takeoverAction };
  if (days < 0) return { occState: 'Overdue', occDeadline: deadline, occDays: days, occAction: cfg.takeoverAction };
  return { occState: a.occupationStatus === 'Deferment' ? 'Deferment Granted' : 'Awaiting Take-over', occDeadline: deadline, occDays: days, occAction: '' };
}

/** Allotment order no. → the proceedings it was considered in (comma-separated if more than one). */
export function proceedingsByOrder(): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of all('proceedings').sort((a, b) => String(a.proceedingsDate).localeCompare(String(b.proceedingsDate))))
    for (const a of Array.isArray(p.allotments) ? p.allotments : []) {
      if (!a?.orderNo || !p.proceedingsNo) continue;
      m.set(a.orderNo, m.has(a.orderNo) ? `${m.get(a.orderNo)}, ${p.proceedingsNo}` : p.proceedingsNo);
    }
  return m;
}

/** Application No. → office name, for showing and filtering allotments by the allottee's office. */
export function officeByApplication(): Map<string, string> {
  return new Map(all('applications').map((a) => [a.applicationNo, a.officeName ?? '']));
}

/**
 * Present status of each vacation entry, worked out from the quarter register rather than the value saved
 * when the vacation was recorded: once the quarter is allotted again (or vacated again later) it is no longer vacant.
 */
export function vacationStatuses(): Map<number, string> {
  const quarterStatus = new Map(all('quarters').map((q) => [q.quarterNo, String(q.status)]));
  const latest = new Map<string, Rec>();
  for (const v of all('vacations')) {
    const cur = latest.get(v.quarterNo);
    if (!cur || String(v.vacationDate) > String(cur.vacationDate) || (v.vacationDate === cur.vacationDate && v.id > cur.id)) latest.set(v.quarterNo, v);
  }
  const out = new Map<number, string>();
  for (const v of all('vacations')) {
    const qs = quarterStatus.get(v.quarterNo);
    out.set(v.id, latest.get(v.quarterNo)?.id !== v.id || qs === 'Occupied' ? 'Re-allotted' : qs || v.status || 'Vacant');
  }
  return out;
}

export function decorate(col: string, r: Rec, offices?: Map<string, string>, procs?: Map<string, string>, vacStatus?: Map<number, string>): Rec {
  if (col === 'vacations') {
    // Single record: look up the quarter's location here (lists add it in one pass in listQuery).
    const location = vacStatus ? r.location ?? '' : findOne('quarters', (x) => x.quarterNo === r.quarterNo)?.location || r.location || '';
    return { ...r, location, status: (vacStatus ?? vacationStatuses()).get(r.id) ?? r.status };
  }
  if (col === 'allotments')
    return { ...r, officeName: (r.applicationNo && (offices ?? officeByApplication()).get(r.applicationNo)) || '', proceedingsNo: (procs ?? proceedingsByOrder()).get(r.orderNo) ?? '', ...occupation(r) };
  if (col === 'applications') {
    const end = r.status === 'Allotted' || r.status === 'Rejected' || r.status === 'Withdrawn' ? null : isoDate();
    const out: Rec = { ...r, waitingDays: end && r.applicationDate ? Math.max(0, daysBetween(r.applicationDate, end)) : null };
    // Suggested scrutiny decision for applications still awaiting a decision.
    if (r.status === 'Pending' || r.status === 'Scrutiny') {
      const a = assess(r);
      out.autoCheck = { decision: a.decision, reason: a.reason, rule: a.rule, policy: a.policy?.title ?? null, failed: a.checks.filter((c) => !c.ok).map((c) => c.label) };
    }
    return out;
  }
  if (col === 'proceedings' && Array.isArray(r.allotments)) {
    // Always show the allotments as they stand now in Quarter Allotment, not as they were when saved.
    const byNo = new Map(all('allotments').map((a) => [a.orderNo, a]));
    return {
      ...r,
      allotments: r.allotments.map((s: Rec) => {
        const a = byNo.get(s.orderNo);
        return a
          ? { orderNo: a.orderNo, allotmentDate: a.allotmentDate, quarterNo: a.quarterNo, category: a.category, rank: a.rank, allotteeName: a.allotteeName, serviceNo: a.serviceNo, applicationNo: a.applicationNo, status: a.status, boardRemarks: s.boardRemarks ?? '' }
          : { ...s, status: 'Deleted' };
      }),
    };
  }
  return r;
}

const DEFAULT_SORT: Record<Collection, [string, 'asc' | 'desc']> = {
  quarters: ['quarterNo', 'asc'],
  applications: ['applicationDate', 'desc'],
  allotments: ['allotmentDate', 'desc'],
  vacations: ['vacationDate', 'asc'],
  committees: ['orderDate', 'desc'],
  meetings: ['meetingDate', 'asc'],
  agendas: ['sequence', 'asc'],
  proceedings: ['proceedingsDate', 'desc'],
  retentions: ['fromDate', 'desc'],
  policies: ['issueDate', 'desc'],
  signatories: ['name', 'asc'],
};

const RESERVED = new Set(['page', 'pageSize', 'sort', 'dir', 'q', 'priorityFirst']);
const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));
/** Text of a value for searching, including values nested in arrays and objects. */
const flat = (v: unknown): string =>
  Array.isArray(v) ? v.map(flat).join(' ') : v && typeof v === 'object' ? Object.values(v).map(flat).join(' ') : str(v);

export function filterRows(rows: Rec[], q: Record<string, string>): Rec[] {
  let out = rows;
  for (const [key, value] of Object.entries(q)) {
    if (!value || value === 'all' || RESERVED.has(key)) continue;
    const [op, field] = key.includes('_') ? [key.slice(0, key.indexOf('_')), key.slice(key.indexOf('_') + 1)] : ['eq', key];
    switch (op) {
      case 'from':
        out = out.filter((r) => str(r[field]) !== '' && str(r[field]) >= value);
        break;
      case 'to':
        out = out.filter((r) => str(r[field]) !== '' && str(r[field]) <= value);
        break;
      case 'prefix':
        out = out.filter((r) => str(r[field]).startsWith(value));
        break;
      case 'month':
        out = out.filter((r) => str(r[field]).slice(5, 7) === value);
        break;
      case 'like':
        out = out.filter((r) => str(r[field]).toLowerCase().includes(value.toLowerCase()));
        break;
      case 'search': {
        // search_a,b → value appears in any of the listed fields
        const fields = field.split(',');
        const needle = value.toLowerCase();
        out = out.filter((r) => fields.some((f) => flat(r[f]).toLowerCase().includes(needle)));
        break;
      }
      case 'has': {
        // has_field=X → X is one of the comma-separated values in field (exact match).
        out = out.filter((r) => str(r[field]).split(',').map((v) => v.trim()).includes(value));
        break;
      }
      case 'in': {
        const set = new Set(value.split(','));
        out = out.filter((r) => set.has(str(r[field])));
        break;
      }
      default:
        out = out.filter((r) => str(r[key]) === value);
    }
  }
  if (q.q) {
    const needle = q.q.toLowerCase();
    out = out.filter((r) => Object.values(r).some((v) => typeof v === 'string' && v.toLowerCase().includes(needle)));
  }
  return out;
}

const collator = new Intl.Collator('en-GB', { numeric: true, sensitivity: 'base' });

export function listQuery(col: Collection, q: Record<string, string>) {
  const offices = col === 'allotments' ? officeByApplication() : undefined;
  const procs = col === 'allotments' ? proceedingsByOrder() : undefined;
  const vacStatus = col === 'vacations' ? vacationStatuses() : undefined;
  let source = all(col).map((r) => decorate(col, r, offices, procs, vacStatus));
  if (col === 'allotments') {
    // Location of the allotted quarter (Quarter Register) and the location the applicant applied for.
    const loc = new Map(all('quarters').map((x) => [x.quarterNo, String(x.location ?? '')]));
    const applied = new Map(all('applications').map((a) => [a.applicationNo, String(a.locationRequested ?? '')]));
    source = source.map((a) => ({ ...a, location: loc.get(a.quarterNo) ?? '', appliedLocation: applied.get(a.applicationNo) ?? '' }));
  }
  if (col === 'vacations') {
    // The quarter's current location, also for entries recorded before quarters had a location.
    const loc = new Map(all('quarters').map((x) => [x.quarterNo, String(x.location ?? '')]));
    source = source.map((v) => ({ ...v, location: loc.get(v.quarterNo) || v.location || '' }));
  }
  if (col === 'quarters') {
    const cfg = getConfig();
    const current = new Map(all('allotments').filter((a) => a.status === 'Allotted').map((a) => [a.quarterNo, occupation(a, cfg).occState]));
    source = source.map((qr) => ({ ...qr, takeover: qr.status === 'Occupied' ? (current.get(qr.quarterNo) ?? '') : '' }));
  }
  // Allotment priority (saved on the Seniority List): label every applicant; with priorityFirst=1 it also leads the sort.
  const rules = col === 'applications' ? (getConfig().priorityRules ?? []) : [];
  if (col === 'applications') source = source.map((r) => (({ group, label }) => ({ ...r, priorityGroup: group, priorityLabel: label }))(priorityOf(r, rules)));
  const byPriority = col === 'applications' && q.priorityFirst === '1' && rules.length > 0;
  let rows = filterRows(source, q);
  const [defSort, defDir] = DEFAULT_SORT[col];
  const sort = q.sort || defSort;
  const dir = (q.dir || defDir) === 'desc' ? -1 : 1;
  rows = rows.sort((a, b) => {
    if (byPriority && a.priorityGroup !== b.priorityGroup) return a.priorityGroup - b.priorityGroup;
    const x = a[sort];
    const y = b[sort];
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
    return collator.compare(str(x), str(y)) * dir || (a.id - b.id) * dir;
  });
  const total = rows.length;
  if (q.pageSize !== 'all') {
    const size = Math.min(Math.max(Number(q.pageSize) || 10, 1), 500);
    const page = Math.max(Number(q.page) || 1, 1);
    rows = rows.slice((page - 1) * size, page * size);
  }
  return { rows, total };
}

export function getRecord(col: Collection, id: number) {
  const r = get(col, id);
  if (!r) throw new HTTPException(404, { message: 'Record not found.' });
  return r;
}

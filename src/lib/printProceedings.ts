import { api, type Row } from './api';
import { esc, printHtml, PAGE_BREAK } from './exporters';
import { fmtDate, isoDate } from './format';

type Appendix = {
  proceeding: Row;
  appendixA: { allotment: Row; quarter: Row | null; application: Row | null; boardRemarks: string }[];
  appendixB: Row[];
  config: { organisation: string; office: string; address: string; letterheadAlign?: string };
  categories: string[];
};

export type ProceedingsParts = { proceedings: boolean; appendixA: boolean; appendixB: boolean };

/* Appendix pages are A4 landscape (named page), the proceedings themselves portrait. */
const CSS = `
  @page{size:A4 portrait}
  @page appendix{size:A4 landscape}
  .appendix{page:appendix;font-size:9px;line-height:1.3}
  .appendix h2{font-size:13px;margin:0 0 2px;color:#7a1030;text-align:center;text-decoration:underline}
  .appendix .sub{text-align:center;font-size:10px;color:#444;margin-bottom:6px}
  .appendix h4{break-after:avoid;margin:8px 0 3px;font-size:10.5px;background:#f3e1e6;padding:2px 6px;border-left:3px solid #7a1030}
  .appendix table{width:100%;border-collapse:collapse;table-layout:auto}
  .appendix th,.appendix td{border:1px solid #999;padding:2px 4px;vertical-align:top;text-align:left}
  .appendix th{background:#f3e1e6;font-size:9px}
  .appendix tr{break-inside:avoid}
  .muted{color:#666}
  .sigs{display:flex;justify-content:space-between;gap:24px;margin-top:40px;font-size:10.5px}
  .sigs div{text-align:center;min-width:150px;border-top:1px solid #333;padding-top:2px}`;

const v = (x: unknown) => (x === undefined || x === null || x === '' ? '—' : esc(String(x)));
const d = (x: unknown) => (x ? fmtDate(String(x)) : '—');
const rankName = (r: Row) => `${r.rank && r.rank !== 'Civilian' ? `${esc(r.rank)} ` : ''}${esc(r.name ?? r.allotteeName ?? '')}`;

const join = (...xs: unknown[]) => xs.filter((x) => x !== undefined && x !== null && x !== '').map((x) => esc(String(x))).join(' · ');

/** Cells holding everything entered on the individual application, in a fixed column order. */
const cells = {
  applicant: (a: Row) => `<td><b>${rankName(a)}</b><br>${join(a.serviceNo, a.trade)}${a.mobile ? `<br>${v(a.mobile)}` : ''}${a.email ? `<br>${v(a.email)}` : ''}</td>`,
  office: (a: Row) => `<td><b>${v(a.officeName)}</b><br>${join(a.station, a.subDivision) || '—'}</td>`,
  enrolment: (a: Row) => `<td><b>${d(a.dateOfEnrolment)}</b><br><span class="muted">Stn: ${d(a.dateOfJoiningStation)}${a.dateOfRetirement ? `<br>Retd: ${d(a.dateOfRetirement)}` : ''}</span></td>`,
  pay: (a: Row) => `<td>${join(a.payLevel, a.payCell && `Cell ${a.payCell}`)}<br>₹${v(a.basicPay)}</td>`,
  accn: (a: Row) => {
    const change = a.applicationType === 'Change of Accn' ? `Change${a.changeReason ? ` (${esc(a.changeReason)})` : ''}` : 'Fresh';
    const where = join(a.accnPool, a.locationRequested);
    return `<td>Entitled: <b>${v(a.entitlement)}</b><br>Req: ${v(a.categoryRequested)}${where ? `<br>${where}` : ''}<br>${join(a.applicationGround || 'Regular')} · ${change}</td>`;
  },
  application: (a: Row) =>
    `<td>${v(a.applicationNo)}<br>${d(a.applicationDate)}${a.indApplicationNo ? `<br>Indl: ${v(a.indApplicationNo)} (${d(a.indApplicationDate)})` : ''}${a.forwardingLetterNo ? `<br>Ltr: ${v(a.forwardingLetterNo)} (${d(a.forwardingLetterDate)})` : ''}${a.forwardedBy ? `<br>Fwd: ${v(a.forwardedBy)}` : ''}</td>`,
  other: (a: Row) => {
    const ex =
      a.exServiceman === 'Yes'
        ? ['Ex-SM: Yes', join(a.exRank, a.exServiceNo), a.exFrom || a.exTo ? `${d(a.exFrom)} – ${d(a.exTo)}` : '', join(a.exPayLevel && `Last ${a.exPayLevel}`, a.exBasicPay && `₹${a.exBasicPay}`)].filter(Boolean).join('<br>')
        : 'Ex-SM: No';
    const prev = a.prevQuarterNo ? `<br>Prev: ${v(a.prevQuarterNo)} (${v(a.prevCategory)}) ${v(a.prevStation)}<br>${d(a.prevFrom)} – ${d(a.prevTo)}${a.prevReason ? ` · ${v(a.prevReason)}` : ''}${a.prevLocation ? `<br>Residing at: ${v(a.prevLocation)}` : ''}` : '';
    return `<td>${ex}${prev}</td>`;
  },
};
const APPLICANT_HEAD = '<th>Rank, Name &amp; Service No.</th><th>Office Name</th><th>Date of Enrolment</th><th>Pay</th><th>Accommodation Requested</th><th>Application</th>';
const applicantCells = (a: Row) => cells.applicant(a) + cells.office(a) + cells.enrolment(a) + cells.pay(a) + cells.accn(a) + cells.application(a);

function appendixA(data: Appendix): string {
  const rows = data.appendixA
    .map(({ allotment: al, quarter: q, application: a, boardRemarks }, i) => {
      // Applications removed since: fall back to what the allotment itself records.
      const app: Row = a ?? { id: 0, name: al.allotteeName, rank: al.rank, serviceNo: al.serviceNo, payLevel: al.payLevel, applicationNo: al.applicationNo };
      const allotted = `<td><b>${v(al.quarterNo)}</b> (${v(al.category)})<br>${join(q?.station ?? al.station, q?.subDivision ?? al.subDivision)}${q?.accnPool ? `<br>${v(q.accnPool)}` : ''}<br>Order ${v(al.orderNo)}<br>${d(al.allotmentDate)}<br>${d(al.fromDate)} – ${d(al.toDate)}${al.status && al.status !== 'Allotted' ? `<br><b>${v(al.status)}</b>` : al.occState === 'Occupied' ? `<br>Occupied${al.occupiedOn ? ` on ${d(al.occupiedOn)}` : ''}` : al.occState === 'Overdue' || al.occState === 'Not Taken Over' ? '<br><b>Not Taken Over (Rule 7 (1) SRO 308)</b>' : al.occState ? `<br>${v(al.occState)}` : ''}</td>`;
      return `<tr><td>${i + 1}</td>${applicantCells(app)}${allotted}<td>${boardRemarks ? esc(boardRemarks) : '&nbsp;'}</td>${cells.other(app)}</tr>`;
    })
    .join('');
  const remarks = data.proceeding.remarks ? `<p style="margin-top:6px"><b>Remarks by the Board:</b> <span style="white-space:pre-line">${esc(data.proceeding.remarks)}</span></p>` : '';
  return `<section class="appendix">
    <h2>APPENDIX 'A' — QUARTER ALLOTMENT</h2>
    <div class="sub">To proceedings No. ${v(data.proceeding.proceedingsNo)} dated ${d(data.proceeding.proceedingsDate)} · details as in Quarter Allotment on ${fmtDate(isoDate())}</div>
    <table><thead><tr><th>Sl.</th>${APPLICANT_HEAD}<th>Quarter Allotted</th><th style="min-width:110px">Remarks by the Board</th><th>Ex-SM / Previous Accn</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="10" style="text-align:center;padding:8px">No allotments have been added to these proceedings. Edit the proceedings and select the allotments under “Allotments Considered”.</td></tr>`}</tbody></table>
    ${remarks}
    ${signatures(data)}
  </section>`;
}

function appendixB(data: Appendix): string {
  const groups = new Map<string, Row[]>();
  for (const a of data.appendixB) groups.set(a.categoryRequested || '—', [...(groups.get(a.categoryRequested || '—') ?? []), a]);
  const pos = (t: string) => (data.categories.indexOf(t) + 1 || 99);
  const body = [...groups.entries()]
    .sort(([x], [y]) => pos(x) - pos(y) || x.localeCompare(y))
    .map(
      ([type, list]) => `<h4>${esc(type)} — ${list.length} applicant(s)</h4>
      <table><thead><tr><th>Sl.</th>${APPLICANT_HEAD}<th>Waiting</th><th>Ex-SM / Previous Accn</th></tr></thead><tbody>${list
        .map((a, i) => `<tr><td>${i + 1}</td>${applicantCells(a)}<td>${v(a.waitingDays)} days<br>${v(a.status)}</td>${cells.other(a)}</tr>`)
        .join('')}</tbody></table>`,
    )
    .join('');
  return `<section class="appendix">
    <h2>APPENDIX 'B' — WAITING LIST</h2>
    <div class="sub">To proceedings No. ${v(data.proceeding.proceedingsNo)} dated ${d(data.proceeding.proceedingsDate)} · applicants accepted in scrutiny and awaiting allotment, in waiting-list order, as on ${fmtDate(isoDate())}</div>
    ${body || '<p style="text-align:center">No applicants on the waiting list.</p>'}
    ${signatures(data)}
  </section>`;
}

function signatures(data: Appendix): string {
  const members: string[] = Array.isArray(data.proceeding.members) ? data.proceeding.members : [];
  return `<div class="sigs">${members.map((m) => `<div>${esc(m)}<br>(Member)</div>`).join('')}<div>${data.proceeding.presidingOfficer ? esc(data.proceeding.presidingOfficer) : '&nbsp;'}<br>(Presiding Officer)</div></div>`;
}

function mainProceedings(data: Appendix, parts: ProceedingsParts): string {
  const p = data.proceeding;
  const c = data.config;
  const members: string[] = Array.isArray(p.members) ? p.members : [];
  const allotments: Row[] = Array.isArray(p.allotments) ? p.allotments : [];
  const refs = [parts.appendixA && "Appendix 'A' (Quarter Allotment)", parts.appendixB && "Appendix 'B' (Waiting List)"].filter(Boolean).join(' and ');
  return `<div class="letter">
    <div style="text-align:${c.letterheadAlign === 'centre' ? 'center' : 'left'}"><b style="font-size:16px">${esc(c.organisation)}</b><br>${esc(c.office)}<br>${esc(c.address)}</div><hr>
    <p style="display:flex;justify-content:space-between"><span>No. <b>${v(p.proceedingsNo)}</b></span><span>Dated: <b>${d(p.proceedingsDate)}</b></span></p>
    <h3 class="center" style="text-decoration:underline">PROCEEDINGS OF THE ACCOMMODATION ALLOTMENT COMMITTEE</h3>
    <p><b>Authority:</b> ${v(p.authority)}</p>
    <table>
      <tr><th style="width:160px">Presiding Officer</th><td>${v(p.presidingOfficer)}</td></tr>
      <tr><th>Members</th><td>${members.length ? members.map((m, i) => `${i + 1}. ${esc(m)}`).join('<br>') : '—'}</td></tr>
    </table>
    <p>1. The committee considered the allotment of Government Married Accommodation and recommends the following allotment(s)${parts.appendixA ? ", details of which are at Appendix 'A'" : ''}:</p>
    ${allotments.length ? `<table><tr><th style="width:36px">Sl.</th><th>Order No.</th><th>Quarter</th><th>Allottee</th><th>Service No.</th><th>Remarks by the Board</th></tr>${allotments
      .map((a, i) => `<tr><td>${i + 1}</td><td>${v(a.orderNo)}</td><td>${v(a.quarterNo)} (${v(a.category)})</td><td>${rankName(a)}</td><td>${v(a.serviceNo)}</td><td>${a.boardRemarks ? esc(a.boardRemarks) : ''}${a.status && a.status !== 'Allotted' ? ` <b>(${esc(a.status)})</b>` : ''}</td></tr>`)
      .join('')}</table>` : '<p>No allotments recorded.</p>'}
    ${parts.appendixB ? `<p>2. The waiting list of applicants accepted in scrutiny and awaiting allotment is at Appendix 'B'.</p>` : ''}
    ${p.remarks ? `<p><b>Remarks by the Board</b></p><p style="white-space:pre-line">${esc(p.remarks)}</p>` : ''}
    ${refs ? `<p class="muted" style="font-size:11px">Enclosures: ${refs}.</p>` : ''}
    <div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:24px;margin-top:56px">
      ${members.map((m) => `<div class="center" style="min-width:150px;border-top:1px solid #333;padding-top:2px">${esc(m)}<br>(Member)</div>`).join('')}
      <div class="center" style="min-width:150px;border-top:1px solid #333;padding-top:2px">${v(p.presidingOfficer)}<br>(Presiding Officer)</div>
    </div>
  </div>`;
}

/** Fetches live data and prints the selected parts of a proceeding. */
export async function printProceedingsDoc(id: number, parts: ProceedingsParts) {
  const data = await api<Appendix>(`/proceedings/${id}/appendix`);
  // Proceedings and each appendix are separate pages (PAGE_BREAK splits them in the preview and in print).
  const html = [parts.proceedings && mainProceedings(data, parts), parts.appendixA && appendixA(data), parts.appendixB && appendixB(data)].filter(Boolean).join(PAGE_BREAK);
  printHtml(`Proceedings ${data.proceeding.proceedingsNo}`, `<style>${CSS}</style>${html}`);
}

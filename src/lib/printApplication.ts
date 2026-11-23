import { api } from './api';
import { esc, printHtml } from './exporters';
import { fmtDate } from './format';

type Values = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Doc = { description: string; mandatory: string; fileName?: string };
type Config = { organisation: string; office: string; address: string; letterheadAlign?: string };

/** Compact styles that keep the whole application on one A4 page. */
const CSS = `
  @page{size:A4}
  body{font-size:10.5px;line-height:1.35}
  .head{text-align:center;border-bottom:2px solid #7a1030;padding-bottom:4px;margin-bottom:6px}
  .head b{font-size:13px} .head div{font-size:10px;color:#444}
  h1{font-size:13px;text-align:center;margin:4px 0;text-decoration:underline;color:#000}
  .ref{display:flex;justify-content:space-between;margin:2px 0 6px;font-size:11px}
  h3{margin:6px 0 2px;font-size:11px;background:#f3e1e6;padding:2px 6px;border-left:3px solid #7a1030}
  table{width:100%;border-collapse:collapse;margin:0}
  td,th{border:1px solid #999;padding:2px 5px;vertical-align:top}
  td.l{width:17%;background:#fafafa;font-weight:600;color:#333}
  td.v{width:16%}
  th{background:#f3e1e6;text-align:left}
  .decl{margin-top:6px;font-size:10px}
  .sign{display:flex;justify-content:space-between;margin-top:28px;font-size:10.5px}
  .sign div{text-align:center;min-width:170px;border-top:1px solid #333;padding-top:2px}
  .office{margin-top:10px;border:1px dashed #999;padding:4px 6px;font-size:10px}
  .office .sign{margin-top:20px}`;

const v = (x: unknown, date = false) => {
  if (x === undefined || x === null || x === '') return '&nbsp;';
  return esc(date ? fmtDate(String(x)) : String(x));
};

/** Builds a table of label/value pairs, three pairs per row. */
function grid(pairs: [string, unknown, boolean?][]): string {
  const rows: string[] = [];
  for (let i = 0; i < pairs.length; i += 3) {
    const cells = pairs.slice(i, i + 3).map(([l, val, d]) => `<td class="l">${esc(l)}</td><td class="v">${v(val, d)}</td>`);
    while (cells.length < 3) cells.push('<td class="l"></td><td class="v"></td>');
    rows.push(`<tr>${cells.join('')}</tr>`);
  }
  return `<table>${rows.join('')}</table>`;
}

export async function printApplication(values: Values, docs: Doc[], appNo: string, appDate: string) {
  const c = await api<Config>('/config').catch((): Config => ({ organisation: '', office: '', address: '' }));
  const ex = values.exServiceman === 'Yes';
  const docRows = docs.filter((d) => d.description?.trim());

  const html = `<style>${CSS}</style>
  <div class="head" style="text-align:${c.letterheadAlign === 'centre' ? 'center' : 'left'}"><b>${esc(c.organisation)}</b><div>${esc(c.office)}${c.address ? ` · ${esc(c.address)}` : ''}</div></div>
  <h1>APPLICATION FOR GOVERNMENT MARRIED ACCOMMODATION</h1>
  <div class="ref"><span>Application No.: <b>${v(appNo)}</b></span><span>Application Type: <b>${v(values.applicationType)}${values.applicationType === 'Change of Accn' && values.changeReason ? ` (${esc(values.changeReason)})` : ''}</b></span><span>Date: <b>${v(appDate, true)}</b></span></div>

  <h3>Application Received Through</h3>
  ${grid([["Individual's Appl. No.", values.indApplicationNo], ["Individual's Appl. Date", values.indApplicationDate, true], ['Date of Receipt', values.receivedDate, true], ['Letter No.', values.forwardingLetterNo], ['Letter Date', values.forwardingLetterDate, true], ['Forwarded By', values.forwardedBy]])}

  <h3>1. Service &amp; Personal Details</h3>
  ${grid([['Service No.', values.serviceNo], ['Rank', values.rank], ['Trade', values.trade], ['Name', values.name], ['Mobile No.', values.mobile], ['Email ID', values.email]])}

  <h3>2. Posting &amp; Service Details</h3>
  ${grid([['Office Name', values.officeName], ['Station', values.station], ['Sub Division', values.subDivision], ['Joined Station', values.dateOfJoiningStation, true], ['Date of Enrolment', values.dateOfEnrolment, true], ['Date of Retirement', values.dateOfRetirement, true]])}

  <h3>3. Pay Details &amp; Accommodation Requested</h3>
  ${grid([['Pay Level', values.payLevel], ['Pay Cell', values.payCell], ['Basic Pay (₹)', values.basicPay], ['Entitlement', values.entitlement], ['Accn Requested', values.categoryRequested], ['Location', values.locationRequested], ['Accn Pool', values.accnPool], ['Application Ground', values.applicationGround]])}

  <h3>4. Previous Accommodation (if any)</h3>
  ${grid([['Quarter No.', values.prevQuarterNo], ['Category', values.prevCategory], ['Station', values.prevStation], ['From', values.prevFrom, true], ['To', values.prevTo, true], ['Reason for Vacation', values.prevReason]])}
  <table><tr><td class="l">Present Location / Address</td><td>${v(values.prevLocation)}</td></tr></table>

  <h3>5. Ex-Service Man Details — ${ex ? 'Yes' : 'No'}</h3>
  ${ex ? grid([['Service No. (Prev.)', values.exServiceNo], ['Rank (Prev.)', values.exRank], ['Service From', values.exFrom, true], ['Service To', values.exTo, true], ['Last Pay Level', values.exPayLevel], ['Last Basic Pay (₹)', values.exBasicPay]]) : ''}

  <h3>6. Remarks</h3>
  <table><tr><td style="height:22px">${v(values.remarks)}</td></tr></table>

  <h3>7. Documents Enclosed</h3>
  <table><tr><th style="width:30px">Sl.</th><th>Document</th><th style="width:70px">Mandatory</th><th style="width:70px">Enclosed</th></tr>
  ${docRows.map((d, i) => `<tr><td>${i + 1}</td><td>${esc(d.description)}</td><td>${esc(d.mandatory)}</td><td>${d.fileName ? 'Yes' : 'No'}</td></tr>`).join('')}</table>

  <p class="decl">I hereby declare that the particulars given above are true and correct to the best of my knowledge and belief. I undertake to abide by the rules governing the allotment of Government Married Accommodation.</p>
  <div class="sign"><div>Date &amp; Place</div><div>Signature of Applicant</div></div>
  <div class="sign" style="margin-top:50px"><div>Place / Station</div><div>Signature of Officer Commanding<br><span style="font-size:9px;color:#555">(with office seal)</span></div></div>

  <div class="office"><b>For Office Use</b> — ${
    values.scrutinyRule
      ? `<b>${values.status === 'Rejected' ? `Rejected${values.rejectionReason ? ` (${esc(values.rejectionReason)})` : ''} against` : 'Accepted under'}</b> ${esc(values.scrutinyRule)}${values.scrutinyPolicy ? ` — ${esc(values.scrutinyPolicy)}` : ''}${values.scrutinyDate ? ` on ${fmtDate(values.scrutinyDate)}` : ''}${values.scrutinisedBy ? ` by ${esc(values.scrutinisedBy)}` : ''}`
      : 'Received on: ____________ &nbsp; Eligibility: Eligible / Not Eligible &nbsp; Waiting List Sl. No.: ________'
  }
    <div class="sign"><div>Dealing Clerk</div><div>Officer In-Charge</div></div></div>`;

  printHtml(`Application ${appNo}`, html);
}

/* ------------------------------------------------------------------ */
/* Blank form — printed and handed to an individual to fill in by hand */
/* ------------------------------------------------------------------ */

const BLANK_CSS = `
  td.v{height:22px}
  .box{display:inline-block;width:10px;height:10px;border:1px solid #333;margin:0 3px -1px 8px}
  .box:first-child{margin-left:0}
  .opts td{height:auto;padding:3px 5px}
  .note{font-size:9.5px;color:#444;margin:2px 0 4px}
  table.fill td{border:none;padding:9px 6px 0 0;width:33.33%}
  .f{display:flex;align-items:flex-end;gap:4px;white-space:nowrap;font-weight:600;color:#333}
  .f i{flex:1;border-bottom:1px solid #555;height:13px;min-width:30px}`;

const boxes = (options: string[]) => options.map((o) => `<span class="box"></span>${esc(o)}`).join(' ');

/** Fill-in lines: each label is followed straight away by a line to write on, three per row. */
const fillLine = (label: string, span = 1) => `<td colspan="${span}"><span class="f">${esc(label)}:<i></i></span></td>`;
function blankGrid(labels: string[]): string {
  const rows: string[] = [];
  for (let i = 0; i < labels.length; i += 3) {
    const cells = labels.slice(i, i + 3).map((l) => fillLine(l));
    while (cells.length < 3) cells.push('<td></td>');
    rows.push(`<tr>${cells.join('')}</tr>`);
  }
  return `<table class="fill">${rows.join('')}</table>`;
}

export async function printBlankApplication(masters: Record<string, string[]>) {
  const c = await api<Config>('/config').catch((): Config => ({ organisation: '', office: '', address: '' }));
  const m = (k: string, fallback: string[]) => (masters[k]?.length ? masters[k] : fallback);
  const mandatory = new Set(['Application Approved by Competent Authority']);
  const docs = m('documentTypes', ['Application Approved by Competent Authority', 'Salary Slip', 'Other Documents']);

  const html = `<style>${CSS}${BLANK_CSS}</style>
  <div class="head" style="text-align:${c.letterheadAlign === 'centre' ? 'center' : 'left'}"><b>${esc(c.organisation)}</b><div>${esc(c.office)}${c.address ? ` · ${esc(c.address)}` : ''}</div></div>
  <h1>APPLICATION FOR GOVERNMENT MARRIED ACCOMMODATION</h1>
  <p class="note">Fill in BLOCK LETTERS. Tick (✓) the applicable boxes. Enclose self-attested copies of the documents listed in Part 7 and submit through proper channel.</p>
  <table class="opts"><tr><td class="l">Application Type</td><td>${boxes(['Fresh', 'Change of Accn'])} &nbsp;&nbsp; <i>If change, reason:</i> ${boxes(m('changeReasons', ['Promotion', 'Accn Under Repair', 'Other']))}</td></tr></table>

  <h3>1. Service &amp; Personal Details</h3>
  ${blankGrid(['Service No.', 'Rank', 'Trade', 'Name', 'Mobile No.', 'Email ID'])}

  <h3>2. Posting &amp; Service Details</h3>
  ${blankGrid(['Office Name', 'Station', 'Sub Division', 'Joined Station', 'Date of Enrolment', 'Date of Retirement'])}

  <h3>3. Pay Details &amp; Accommodation Requested</h3>
  ${blankGrid(['Pay Level', 'Pay Cell', 'Basic Pay (₹)', 'Entitlement', 'Location Requested'])}
  <table class="opts">
    <tr><td class="l">Accn Requested</td><td>${boxes(m('categories', ['Type I', 'Type II', 'Type III', 'Type IV']))}</td></tr>
    <tr><td class="l">Accn Pool</td><td>${boxes(m('accnPools', ['Defence Pool', 'General Pool', 'Station Pool']))}</td></tr>
    <tr><td class="l">Application Ground</td><td>${boxes(m('applicationGrounds', ['Regular', 'Medical', 'Special Sanction']))}</td></tr>
  </table>

  <h3>4. Previous Accommodation (if any)</h3>
  ${blankGrid(['Quarter No.', 'Category', 'Station', 'From', 'To', 'Reason for Vacation'])}
  <table class="fill"><tr>${fillLine('Present Location / Address', 3)}</tr><tr><td colspan="3"><span class="f"><i></i></span></td></tr></table>

  <h3>5. Ex-Service Man Details — ${boxes(['Yes', 'No'])}</h3>
  <p class="note">Fill only if Yes.</p>
  ${blankGrid(['Service No. (Prev.)', 'Rank (Prev.)', 'Service From', 'Service To', 'Last Pay Level', 'Last Basic Pay (₹)'])}

  <h3>6. Remarks</h3>
  <table class="fill"><tr><td colspan="3"><span class="f"><i></i></span></td></tr><tr><td colspan="3"><span class="f"><i></i></span></td></tr></table>

  <h3>7. Documents Enclosed</h3>
  <table><tr><th style="width:30px">Sl.</th><th>Document</th><th style="width:70px">Mandatory</th><th style="width:90px">Enclosed (✓)</th></tr>
  ${docs.map((d, i) => `<tr><td>${i + 1}</td><td>${esc(d)}</td><td>${mandatory.has(d) ? 'Yes' : 'No'}</td><td><span class="box"></span></td></tr>`).join('')}</table>

  <p class="decl">I hereby declare that the particulars given above are true and correct to the best of my knowledge and belief. I undertake to abide by the rules governing the allotment of Government Married Accommodation.</p>
  <div class="sign"><div>Date &amp; Place</div><div>Signature of Applicant</div></div>
  <div class="sign" style="margin-top:50px"><div>Place / Station</div><div>Signature of Officer Commanding<br><span style="font-size:9px;color:#555">(with office seal)</span></div></div>

  <div class="office"><b>For Office Use</b> — Application No.: ____________ &nbsp; Received on: ____________ &nbsp; Eligibility: Eligible / Not Eligible &nbsp; Waiting List Sl. No.: ________
    <div class="sign"><div>Dealing Clerk</div><div>Officer In-Charge</div></div></div>`;

  printHtml('Application Form (Blank)', html);
}

/* ------------------------------------------------------------------ */
/* Undertaking — to vacate on demand (above-entitlement / other office) */
/* ------------------------------------------------------------------ */

const UNDERTAKING_CSS = `
  body{font-size:11.5px;line-height:1.55}
  h1{font-size:14px;letter-spacing:.04em}
  .sub{text-align:center;font-size:10.5px;margin:-2px 0 10px;color:#333}
  p{margin:6px 0;text-align:justify}
  ol{margin:4px 0 6px 0;padding-left:20px} ol li{margin:5px 0;text-align:justify}
  .clause{display:flex;gap:8px;align-items:flex-start}
  .clause .box{margin:3px 0 0 0;flex-shrink:0}
  .w{display:grid;grid-template-columns:1fr 1fr;gap:26px;margin-top:10px}
  .w > div{border:1px solid #999;padding:6px 8px}
  .w h4{margin:0 0 2px;font-size:11px;background:#f3e1e6;padding:2px 6px;border-left:3px solid #7a1030}
  .cs{margin-top:16px;border:1.5px solid #7a1030;padding:8px 10px}
  .cs h4{margin:0 0 4px;font-size:11.5px;color:#7a1030;text-decoration:underline}
  .rt{display:flex;justify-content:flex-end;margin-top:34px}
  .rt div{text-align:center;min-width:230px;border-top:1px solid #333;padding-top:2px}`;

export async function printUndertaking() {
  const c = await api<Config>('/config').catch((): Config => ({ organisation: '', office: '', address: '' }));
  const office = c.office || c.organisation || 'this office';
  const line = (label: string, span = 1) => fillLine(label, span);

  const html = `<style>${CSS}${BLANK_CSS}${UNDERTAKING_CSS}</style>
  <div class="head" style="text-align:${c.letterheadAlign === 'centre' ? 'center' : 'left'}"><b>${esc(c.organisation)}</b><div>${esc(c.office)}${c.address ? ` · ${esc(c.address)}` : ''}</div></div>
  <h1>UNDERTAKING CERTIFICATE</h1>
  <div class="sub">(To be furnished by the allottee before taking over Government Married Accommodation)</div>

  <table class="fill">
    <tr>${line('Service No.')}${line('Rank')}${line('Name')}</tr>
    <tr>${line('Trade')}${line('Office / Unit', 2)}</tr>
    <tr>${line('Entitled Type of Accn')}${line('Quarter No. Allotted')}${line('Type of Quarter')}</tr>
    <tr>${line('Location / Block', 2)}${line('Allotment Order No. & Date')}</tr>
  </table>

  <p style="margin-top:12px">I, the above-named, do hereby solemnly undertake as follows <i>(tick ✓ whichever is applicable)</i>:</p>
  <ol>
    <li><div class="clause"><span class="box"></span><span><b>Allotment above entitlement:</b> That the above quarter has been allotted to me <b>above my entitlement</b> purely as a temporary measure, as no quarter of my entitled type was available. I shall <b>vacate the said quarter as and when asked to do so</b> by the allotting authority, within the period stated in the notice, and shall accept the quarter of my entitled type when offered.</span></div></li>
    <li><div class="clause"><span class="box"></span><span><b>Allottee from another office:</b> That I am serving in an office other than <b>${esc(office)}</b> and the above quarter has been allotted to me from its pool as a special case. <b>Even though I may be entitled to this type of quarter</b>, I shall <b>vacate it as and when asked to do so</b> whenever an application from a member of ${esc(office)} is received and no vacant quarter of that type is available for him / her.</span></div></li>
  </ol>
  <p>I further undertake that:</p>
  <ol start="3">
    <li>I shall hand over vacant and peaceful possession of the quarter, with all fittings and fixtures in good condition, on or before the date fixed in the notice to vacate.</li>
    <li>I shall not claim any right of retention, change or alternative accommodation on the ground of this allotment, and shall not dispute the notice to vacate.</li>
    <li>In case I fail to vacate within the stipulated period, I shall be liable to pay penal / damage rent as per the rules in force, and to eviction and disciplinary action as deemed fit by the competent authority, which may be recovered from my pay and allowances.</li>
  </ol>
  <p>I have read and understood the above conditions and sign this undertaking of my own free will.</p>

  <div class="sign" style="margin-top:34px"><div>Date &amp; Place</div><div>Signature of Allottee</div></div>

  <div class="w">
    ${[1, 2].map((n) => `<div><h4>Witness No. ${n}</h4>
      <table class="fill"><tr>${line('Signature', 3)}</tr><tr>${line('Name', 3)}</tr><tr>${line('Service No. & Rank', 3)}</tr><tr>${line('Office / Unit', 3)}</tr></table></div>`).join('')}
  </div>

  <div class="cs"><h4>COUNTERSIGNED</h4>
    Certified that the above undertaking has been signed by the allottee in my presence, and by the witnesses named above.
    <div class="rt"><div>Signature of Officer Commanding<br><span style="font-size:9.5px;color:#555">Name, Rank &amp; Office Seal</span></div></div>
    <table class="fill"><tr>${line('Date')}${line('Place / Station')}<td></td></tr></table>
  </div>`;

  printHtml('Undertaking Certificate', html);
}

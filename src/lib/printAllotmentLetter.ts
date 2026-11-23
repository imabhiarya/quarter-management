import { api, getToken, type Row } from './api';
import { esc, printHtml } from './exporters';
import { fmtDate } from './format';

export type Signatory = Row & { name: string; designation: string; forLine?: string; signature?: { fileId: string; fileName: string } | null };

export type LetterOptions = {
  orderNo: string;
  date: string;
  reference: string;
  title: string;
  appendix: string;
  signatory: Signatory;
  /** Optional "To" block, one line per row. */
  addressee?: string;
  /** Printed below the signature, on the left: enclosures and copy-to addresses, one per line. */
  enclosure?: string;
  copyTo?: string;
  /** Notes for this printout (one per line); the standard notes from Settings when not given. */
  notes?: string;
  /** Optional second signing officer, printed on the left. */
  signatory2?: Signatory | null;
};

type Config = { organisation: string; office: string; address: string; allotmentNotes?: string; retentionNotes?: string; letterheadAlign?: string; signatureAlign?: string };

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];
const typeNo = (t: string) => ROMAN.indexOf(String(t).replace(/^Type\s*-?\s*/i, '').trim());

/** e.g. "ALLOTMENT ORDER : TYPE I TO TYPE III MD ACCN" from the types being allotted. */
export function defaultLetterTitle(rows: Row[]): string {
  const nums = rows.map((r) => typeNo(r.category)).filter((n) => n >= 0);
  if (!nums.length) return 'ALLOTMENT ORDER : MD ACCN';
  const lo = ROMAN[Math.min(...nums)];
  const hi = ROMAN[Math.max(...nums)];
  return `ALLOTMENT ORDER : TYPE ${lo}${hi !== lo ? ` TO TYPE ${hi}` : ''} MD ACCN`;
}

/** Signature images are protected uploads; embed them in the printout as data URLs. */
async function signatureDataUrl(fileId: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/uploads/${fileId}`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || 'image/png';
    const bytes = new Uint8Array(await res.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:${type};base64,${btoa(bin)}`;
  } catch {
    return null;
  }
}

const CSS = `
  .al{font-size:12px;line-height:1.4}
  .al .top{display:flex;justify-content:space-between;align-items:flex-start;margin:6px 0 4px}
  .al .appx{text-align:right;font-weight:700}
  .al .ref{text-align:right}
  .al .to{margin:8px 0 2px}
  .al .to div{margin-left:28px;font-weight:600}
  .al h3{text-align:center;text-decoration:underline;font-size:13px;margin:10px 0 6px}
  .al table{width:100%;border-collapse:collapse;font-size:11.5px}
  .al th,.al td{border:1px solid #333;padding:4px 5px;vertical-align:top;text-align:left;background:none !important}
  .al th{font-weight:700;color:#000}
  .al .notes{margin-top:12px;display:grid;grid-template-columns:auto 1fr;column-gap:8px;font-size:11.5px}
  .al .notes ol{margin:0;padding:0;list-style:none;counter-reset:n}
  .al .notes li{margin-bottom:3px;padding-left:26px;text-indent:-26px;counter-increment:n}
  .al .notes li::before{content:'(' counter(n, lower-alpha) ')';display:inline-block;width:26px;text-indent:0}
  .al .sigs{display:flex;justify-content:space-between;align-items:flex-end;margin-top:18px;break-inside:avoid}
  .al .sig{width:max-content;min-width:200px}
  .al .sig img{display:block;max-height:60px;max-width:200px;margin:0 0 2px}
  .al .sig .blank{height:48px}
  .al .post{margin-top:2.8em;break-inside:avoid}
  .al .post .blk{display:grid;grid-template-columns:5.5em 1fr;column-gap:8px;margin-bottom:10px}`;

export type LetterKind = 'allotment' | 'retention';

const rankTrade = (r: Row) => [r.rank && r.rank !== 'Civilian' ? r.rank : '', r.trade].filter(Boolean).join(' / ') || '—';
const typeLabel = (t: string) => (t ? `Type -${String(t).replace(/^Type\s*/i, '')}` : '');
const qtrCell = (r: Row) => `<td><b>${esc(r.quarterNo)}</b>${r.category || r.location ? `<br><b>(${esc(typeLabel(r.category))}${r.location ? ` at ${esc(r.location)}` : ''})</b>` : ''}</td>`;

const lines = (s?: string) => String(s ?? '').split('\n').map((l) => l.trim()).filter(Boolean);

/** Enclosure and Copy to, two lines below the signature block, on the left. */
function afterSignature(opts: LetterOptions): string {
  const encl = lines(opts.enclosure);
  const copy = lines(opts.copyTo);
  if (!encl.length && !copy.length) return '';
  return `<div class="post">
    ${encl.length ? `<div class="blk"><b>Encl :-</b><div>${encl.length === 1 ? esc(encl[0]) : encl.map((l, i) => `${i + 1}. ${esc(l)}`).join('<br>')}</div></div>` : ''}
    ${copy.length ? `<div class="blk"><b>Copy to :-</b><div>${copy.map((l) => esc(l)).join('<br>')}</div></div>` : ''}
  </div>`;
}

/** Remarks column: take-over position, as reported back by the BSO. */
function letterRemarks(r: Row): string {
  if (r.status && r.status !== 'Allotted') return r.status;
  if (r.occState === 'Occupied') return r.occupiedOn ? `Occupied on ${fmtDate(r.occupiedOn)}` : 'Occupied';
  if (r.occState === 'Overdue' || r.occState === 'Not Taken Over') return 'Not Taken Over';
  if (r.occState === 'Deferment Granted') return `Take-over deferred up to ${fmtDate(r.occDeadline)}`;
  return '';
}

/** Table columns for each kind of order. */
const TABLES: Record<LetterKind, { endpoint: string; notesKey: keyof Config; head: string; row: (r: Row, i: number) => string }> = {
  allotment: {
    endpoint: '/allotments/letter',
    notesKey: 'allotmentNotes',
    head: '<th style="width:34px">S.No</th><th>MES / Service No.</th><th>Rank / Trade</th><th>Name</th><th>Unit</th><th>Qtr No, Type &amp; Location</th><th style="width:90px">Remarks</th>',
    row: (r, i) => `<td>${i + 1}</td><td>${esc(r.serviceNo ?? '—')}</td><td>${esc(rankTrade(r))}</td><td>${esc(r.allotteeName)}</td><td>${esc(r.officeName || '—')}</td>${qtrCell(r)}<td>${esc(letterRemarks(r))}</td>`,
  },
  retention: {
    endpoint: '/retentions/letter',
    notesKey: 'retentionNotes',
    head: '<th style="width:34px">S.No</th><th>MES / Service No.</th><th>Rank / Trade</th><th>Name</th><th>Unit</th><th>Qtr No, Type &amp; Location</th><th>Case</th><th>Period Sanctioned</th><th>Grounds</th>',
    row: (r, i) =>
      `<td>${i + 1}</td><td>${esc(r.serviceNo ?? '—')}</td><td>${esc(rankTrade(r))}</td><td>${esc(r.name)}</td><td>${esc(r.officeName || '—')}</td>${qtrCell(r)}<td>${esc(r.caseType)}${r.status && r.status !== 'Approved' ? `<br><b>(${esc(r.status)})</b>` : ''}</td><td style="white-space:nowrap">${fmtDate(r.fromDate)}<br>to ${fmtDate(r.toDate)}</td><td>${esc(r.reason ?? '')}</td>`,
  },
};

/** Prints an allotment or retention / extension order in the standard letter format. */
export async function printOrderLetter(kind: LetterKind, ids: number[], opts: LetterOptions) {
  const t = TABLES[kind];
  const [cfg, rows] = await Promise.all([api<Config>('/config'), api<Row[]>(`${t.endpoint}?ids=${ids.join(',')}`)]);
  rows.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  const block = async (sig: Signatory) => {
    const img = sig.signature?.fileId ? await signatureDataUrl(sig.signature.fileId) : null;
    return `<div class="sig">${img ? `<img src="${img}" alt="">` : '<div class="blank"></div>'}(${esc(sig.name)})<br>${esc(sig.designation)}${sig.forLine ? `<br>${esc(sig.forLine)}` : ''}</div>`;
  };
  const [main, other] = await Promise.all([block(opts.signatory), opts.signatory2 ? block(opts.signatory2) : Promise.resolve('')]);
  const notes = String(opts.notes ?? cfg[t.notesKey] ?? '')
    .split('\n')
    .map((n) => n.trim())
    .filter(Boolean);

  printHtml(
    `${kind === 'allotment' ? 'Allotment' : 'Retention / Extension'} Order ${opts.orderNo}`,
    `<style>${CSS}</style><div class="al">
      <div style="text-align:${cfg.letterheadAlign === 'centre' ? 'center' : 'left'}"><b style="font-size:15px">${esc(cfg.organisation)}</b><br>${esc(cfg.office)}<br>${esc(cfg.address)}</div><hr>
      <div class="top">
        <div>No. <b>${esc(opts.orderNo)}</b><br>Dated: <b>${fmtDate(opts.date)}</b></div>
        <div>${opts.appendix ? `<div class="appx">${esc(opts.appendix)}</div>` : ''}${opts.reference ? `<div class="ref">Ref :- ${esc(opts.reference)}</div>` : ''}</div>
      </div>
      ${opts.addressee ? `<div class="to">To<div>${opts.addressee.split('\n').map((l) => esc(l.trim())).filter(Boolean).join('<br>')}</div></div>` : ''}
      <h3>${esc(opts.title)}</h3>
      <table>
        <thead><tr>${t.head}</tr></thead>
        <tbody>${rows.map((r, i) => `<tr>${t.row(r, i)}</tr>`).join('')}</tbody>
      </table>
      ${notes.length ? `<div class="notes"><b>Notes:-</b><ol>${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ol></div>` : ''}
      <div class="sigs">${cfg.signatureAlign === 'right' ? `${other || '<div></div>'}${main}` : `${main}${other || '<div></div>'}`}</div>
      ${afterSignature(opts)}
    </div>`,
  );
}

export const printAllotmentLetter = (ids: number[], opts: LetterOptions) => printOrderLetter('allotment', ids, opts);

/** e.g. "RETENTION OF GOVT MD ACCN : TYPE II TO TYPE III" */
export function defaultRetentionTitle(caseType: string, rows: Row[]): string {
  const base = `${(caseType || 'RETENTION').toUpperCase()} OF GOVT MD ACCN`;
  const nums = rows.map((r) => typeNo(r.category)).filter((n) => n >= 0);
  if (!nums.length) return base;
  const lo = ROMAN[Math.min(...nums)];
  const hi = ROMAN[Math.max(...nums)];
  return `${base} : TYPE ${lo}${hi !== lo ? ` TO TYPE ${hi}` : ''}`;
}

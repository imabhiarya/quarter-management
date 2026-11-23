import type { Row } from './api';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => (y > 1900 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : '');
const year4 = (y: number) => (y < 100 ? 2000 + y : y);

/** Finds a date in text such as "Occupied on 11 Aug 2026", "11-Aug-26", "11/08/2026" or "2026-08-11". */
export function findDate(text: string): string {
  const s = String(text ?? '');
  let m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /(\d{1,2})(?:st|nd|rd|th)?[\s\-./,]*([A-Za-z]{3,9})[\s\-./,]*(\d{2,4})/.exec(s);
  if (m) {
    const mon = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    if (mon >= 0) return iso(year4(+m[3]), mon + 1, +m[1]);
  }
  m = /(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/.exec(s); // Indian style: day / month / year
  if (m) return iso(year4(+m[3]), +m[2], +m[1]);
  return '';
}

export type Interpretation = { status: 'Occupied' | 'Not Taken Over' | 'Deferment' | null; date: string; note: string };

/** Reads the BSO's remark ("Occupied on 11 Aug 2026", "Not Taken Over", "Deferred till 15 Dec 2026"). */
export function interpret(remarks: string, dateCell: string, fallbackDate: string): Interpretation {
  const r = String(remarks ?? '').trim();
  const dated = findDate(dateCell) || findDate(r);
  if (/not\s*(yet\s*)?taken\s*over|not\s*occupied|not\s*taken/i.test(r)) return { status: 'Not Taken Over', date: '', note: r };
  if (/defer/i.test(r)) return { status: 'Deferment', date: dated, note: r };
  if (/occupied|taken\s*over|handed\s*over|t\/o|take\s*over\s*done/i.test(r) || (!r && findDate(dateCell)))
    return { status: 'Occupied', date: dated || fallbackDate, note: dated ? r : `${r}${r ? ' ' : ''}(date not given – report date used)` };
  return { status: null, date: '', note: r };
}

const norm = (s: string) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Column positions, recognising both the system's sheet and BSO headings such as "MES No" or "Qtr No & Location". */
export function mapColumns(header: string[]) {
  const h = header.map(norm);
  const find = (...keys: string[]) => {
    for (const k of keys) {
      const i = h.findIndex((x) => x === k);
      if (i >= 0) return i;
    }
    for (const k of keys) {
      const i = h.findIndex((x) => x.includes(k));
      if (i >= 0) return i;
    }
    return -1;
  };
  return {
    orderNo: find('orderno', 'allotmentorderno', 'aono'),
    serviceNo: find('messerviceno', 'mesno', 'serviceno', 'servicenumber', 'svcno', 'personalno', 'pno'),
    quarterNo: find('qtrno', 'quarterno', 'qtr', 'quarter'),
    remarks: find('remarks', 'remark', 'takeoverstatus', 'status'),
    takeoverDate: find('takeoverdate', 'occupiedon', 'dateofoccupation', 'dateoftakeover', 'date'),
    name: find('name'),
  };
}

const key = (s: string) => String(s ?? '').toUpperCase().replace(/\s+/g, '');

export type ImportLine = {
  line: number;
  serviceNo: string;
  quarter: string;
  name: string;
  remarks: string;
  allotment: Row | null;
  result: Interpretation;
  problem: string;
};

/** Matches each report line to a current allotment: by order no., else service no. (and quarter), else quarter. */
export function matchLines(header: string[], rows: string[][], allotments: Row[], fallbackDate: string): ImportLine[] {
  const c = mapColumns(header);
  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
  return rows
    .map((r, idx) => {
      const orderNo = get(r, c.orderNo);
      const serviceNo = get(r, c.serviceNo);
      const quarter = get(r, c.quarterNo);
      const remarks = get(r, c.remarks);
      const dateCell = get(r, c.takeoverDate);
      let allotment: Row | null = null;
      if (orderNo) allotment = allotments.find((a) => key(a.orderNo) === key(orderNo)) ?? null;
      if (!allotment && serviceNo) {
        const bySvc = allotments.filter((a) => key(a.serviceNo) === key(serviceNo));
        allotment = bySvc.length === 1 ? bySvc[0] : (bySvc.find((a) => quarter && key(quarter).includes(key(a.quarterNo))) ?? null);
      }
      if (!allotment && quarter && !serviceNo) allotment = allotments.find((a) => key(quarter).includes(key(a.quarterNo))) ?? null;
      const result = interpret(remarks, dateCell, fallbackDate);
      let problem = '';
      if (!allotment) problem = 'No current allotment found for this service no. / quarter';
      else if (!result.status) problem = remarks ? `Remark not understood: "${remarks}"` : 'No remark';
      else if (result.status === 'Deferment' && !result.date) problem = 'Deferment date not given';
      else if (result.status === 'Occupied' && allotment.allotmentDate && result.date < allotment.allotmentDate) problem = 'Take-over date is before the allotment date';
      return { line: idx + 1, serviceNo, quarter, name: get(r, c.name), remarks, allotment, result, problem };
    })
    .filter((l) => l.serviceNo || l.quarter || l.remarks);
}

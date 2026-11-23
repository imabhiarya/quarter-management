import type { Row } from './api';
import { parseCsv, type PlainColumn } from './exporters';
import { isoDate } from './format';

/** Downloads rows as a real Excel workbook (.xlsx). The library is loaded only when needed. */
export async function exportExcel(filename: string, columns: PlainColumn[], rows: Row[], sheet = 'Sheet1') {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const body = rows.map((r, i) => columns.map((c) => c.value(r, i)));
  const header = columns.map((c) => ({ value: c.label, fontWeight: 'bold' as const, backgroundColor: '#F3E1E6' }));
  const widths = columns.map((c, ci) => ({
    width: Math.min(45, Math.max(8, c.label.length + 2, ...body.slice(0, 500).map((r) => String(r[ci] ?? '').length + 2))),
  }));
  const data = [header, ...body.map((r) => r.map((v) => ({ value: v === '—' ? '' : v })))];
  await writeXlsxFile(data, { columns: widths, sheet: sheet.slice(0, 31) }).toFile(filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Reads the first sheet of an .xlsx (or a .csv) file into objects keyed by field name.
 * Header cells may be either the field key (quarterNo) or its label (Quarter No.).
 */
export async function readSpreadsheet(file: File, columns: { key: string; label: string }[]): Promise<{ rows: Record<string, string>[]; missing: string[] }> {
  let table: unknown[][];
  if (/\.csv$/i.test(file.name)) {
    const objs = parseCsv(await file.text());
    const keys = objs.length ? Object.keys(objs[0]) : [];
    table = [keys, ...objs.map((o) => keys.map((k) => o[k]))];
  } else {
    const { readSheet } = await import('read-excel-file/browser');
    table = (await readSheet(file)) as unknown[][];
  }
  const [header = [], ...data] = table.filter((r) => r.some((c) => c !== null && c !== undefined && String(c).trim() !== ''));
  const index = new Map(header.map((h, i) => [norm(String(h ?? '')), i]));
  const map = columns.map((c) => ({ key: c.key, label: c.label, i: index.get(norm(c.key)) ?? index.get(norm(c.label)) }));
  const missing = map.filter((m) => m.i === undefined).map((m) => m.label);
  const cell = (v: unknown) => (v instanceof Date ? isoDate(v) : v === null || v === undefined ? '' : String(v).trim());
  const rows = data.map((r) => Object.fromEntries(map.filter((m) => m.i !== undefined).map((m) => [m.key, cell(r[m.i!])])));
  return { rows, missing };
}

/** Downloads a blank import template with a header row and one example row. */
export async function downloadTemplate(filename: string, columns: { key: string; label: string }[], sample: Record<string, string>) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const data = [
    columns.map((c) => ({ value: c.label, fontWeight: 'bold' as const, backgroundColor: '#F3E1E6' })),
    columns.map((c) => ({ value: sample[c.key] ?? '' })),
  ];
  await writeXlsxFile(data, { columns: columns.map((c) => ({ width: Math.max(14, c.label.length + 4) })), sheet: 'Import' }).toFile(`${filename}.xlsx`);
}

/** Reads the first sheet of an .xlsx or .csv file as a header row plus data rows (all cells as text). */
export async function readTable(file: File): Promise<{ header: string[]; rows: string[][] }> {
  let table: unknown[][];
  if (/\.csv$/i.test(file.name)) {
    const objs = parseCsv(await file.text());
    const keys = objs.length ? Object.keys(objs[0]) : [];
    table = [keys, ...objs.map((o) => keys.map((k) => o[k]))];
  } else {
    const { readSheet } = await import('read-excel-file/browser');
    table = (await readSheet(file)) as unknown[][];
  }
  const cell = (v: unknown) => (v instanceof Date ? isoDate(v) : v === null || v === undefined ? '' : String(v).trim());
  const nonEmpty = table.map((r) => r.map(cell)).filter((r) => r.some((c) => c));
  // The header is the first row that looks like one (BSO letters often have title rows above the table).
  const at = nonEmpty.findIndex((r) => r.filter((c) => /[a-z]/i.test(c)).length >= 2 && r.some((c) => /no|name|remark|qtr|quarter/i.test(c)));
  const h = at < 0 ? 0 : at;
  return { header: nonEmpty[h] ?? [], rows: nonEmpty.slice(h + 1) };
}

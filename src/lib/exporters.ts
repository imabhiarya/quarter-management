import type { Row } from './api';
import { marginCss, getMargins } from './printSettings';

export type PlainColumn = { label: string; value: (r: Row, i: number) => string };

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** Downloads rows as a UTF-8 CSV that opens directly in Excel. */
export function exportCsv(filename: string, columns: PlainColumn[], rows: Row[]) {
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [columns.map((c) => cell(c.label)).join(','), ...rows.map((r, i) => columns.map((c) => cell(c.value(r, i))).join(','))];
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

const PRINT_CSS = `
  *{box-sizing:border-box} body{font-family:'Noto Sans',system-ui,sans-serif;color:#1f1f1f;margin:0;font-size:12px}
  header{border-bottom:3px solid #7a1030;padding-bottom:8px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:flex-end}
  h1{margin:0;font-size:18px;color:#7a1030} h2{margin:2px 0 0;font-size:12px;font-weight:500;color:#555}
  .meta{font-size:11px;color:#555;text-align:right}
  table{border-collapse:collapse;width:100%} th,td{border:1px solid #bbb;padding:5px 7px;text-align:left;vertical-align:top}
  th{background:#f6e3e8;color:#5a0c24} tr:nth-child(even) td{background:#fbf7f8}
  footer{margin-top:16px;font-size:10px;color:#777} .letter{max-width:720px;margin:auto;font-size:13px;line-height:1.6}
  .letter table{margin:12px 0} .sign{margin-top:56px;text-align:right} .center{text-align:center}`;

type Orientation = 'default' | 'portrait' | 'landscape';

/** Put between parts of a document that must start on a new page (e.g. proceedings and each appendix). */
export const PAGE_BREAK = '<!--page-break-->';

/** Black-and-white print: no coloured fills or text, black rules. */
const PLAIN_CSS = `.sheet *{color:#000 !important;background:transparent !important;box-shadow:none !important}
  .sheet th,.sheet td{border-color:#000 !important} .sheet hr{border-color:#000 !important}
  .sheet header{border-bottom-color:#000 !important} .sheet h4{border-left-color:#000 !important}
  .sheet th{font-weight:700 !important}`;

/**
 * Opens a print preview window with a bar to choose Portrait / Landscape, then Print.
 * The document's own page size is the starting choice; documents that mix both
 * (proceedings with landscape appendices) also offer "As designed".
 */
export function printHtml(title: string, bodyHtml: string) {
  const w = window.open('', '_blank', 'width=1200,height=860');
  if (!w) {
    alert('Please allow pop-ups to print.');
    return;
  }
  const landscape = /size:\s*A4\s+landscape/i.test(bodyHtml);
  const mixed = landscape && /@page\s+appendix/i.test(bodyHtml);
  const initial: Orientation = mixed ? 'default' : landscape ? 'landscape' : 'portrait';
  const m = getMargins();
  const choices: [Orientation, string][] = [...(mixed ? [['default', 'As designed'] as [Orientation, string]] : []), ['portrait', 'Portrait'], ['landscape', 'Landscape']];
  // One preview sheet per page part; appendices are landscape when printing "as designed".
  const parts = bodyHtml.split(PAGE_BREAK);
  const head = parts[0].match(/^(\s*<style>[\s\S]*?<\/style>)+/)?.[0] ?? '';
  const sheets = parts
    .map((p, i) => (i === 0 ? p.slice(head.length) : p))
    .map((p) => `<div class="sheet"${/class="appendix"/.test(p) ? ' data-land="1"' : ''}>${p}</div>`)
    .join('');

  const bar = `<div class="pbar">
      <b>Print preview</b>
      <span class="grp">Orientation:
        ${choices.map(([v, l]) => `<button type="button" data-o="${v}">${l}</button>`).join('')}
      </span>
      <span class="grp">Style:
        <button type="button" data-t="plain">Plain (B&amp;W)</button><button type="button" data-t="colour">Colour</button>
      </span>
      <span class="sp"></span>
      ${parts.length > 1 ? `<span>${parts.length} pages</span>` : ''}
      <button type="button" class="go" id="doprint">&#128424; Print</button>
      <button type="button" id="doclose">Close</button>
    </div>`;
  const css = `
    @media screen{
      html{background:#d9dce1}
      .pbar{position:fixed;top:0;left:0;right:0;z-index:10;display:flex;align-items:center;gap:14px;padding:10px 16px;background:#6f0f2f;color:#fff;font:14px system-ui,sans-serif;box-shadow:0 2px 6px rgba(0,0,0,.25)}
      .pbar .grp{display:flex;align-items:center;gap:6px}
      .pbar .sp{flex:1}
      .pbar button{font:600 13px system-ui,sans-serif;padding:6px 14px;border-radius:6px;border:1px solid rgba(255,255,255,.6);background:transparent;color:#fff;cursor:pointer}
      .pbar button.on{background:#fff;color:#6f0f2f}
      .pbar button.go{background:#fff;color:#6f0f2f;border-color:#fff}
      .sheet{background:#fff;margin:72px auto 24px;box-shadow:0 2px 14px rgba(0,0,0,.25);box-sizing:border-box;padding:${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm;min-height:200mm}
      .sheet + .sheet{margin-top:20px}
    }
    @media print{.pbar{display:none !important}.sheet{width:auto !important;padding:0 !important;margin:0 !important;box-shadow:none !important;min-height:0 !important}.sheet + .sheet{break-before:page}}`;
  const script = `
    (function(){
      var css={default:'',portrait:'@page{size:A4 portrait} @page appendix{size:A4 portrait}',landscape:'@page{size:A4 landscape} @page appendix{size:A4 landscape}'};
      var each=function(sel,fn){Array.prototype.forEach.call(document.querySelectorAll(sel),fn);};
      function set(o){
        document.getElementById('orient').textContent=css[o];
        each('.sheet',function(s){s.style.width=(o==='landscape'||(o==='default'&&s.getAttribute('data-land')))?'297mm':'210mm';});
        each('[data-o]',function(b){b.className=b.getAttribute('data-o')===o?'on':'';});
      }
      function tone(t){
        document.getElementById('tone').textContent=t==='plain'?${JSON.stringify(PLAIN_CSS)}:'';
        each('[data-t]',function(b){b.className=b.getAttribute('data-t')===t?'on':'';});
        try{localStorage.setItem('awas.printTone',t);}catch(e){}
      }
      each('[data-o]',function(b){b.onclick=function(){set(b.getAttribute('data-o'));};});
      each('[data-t]',function(b){b.onclick=function(){tone(b.getAttribute('data-t'));};});
      var saved='plain';try{saved=localStorage.getItem('awas.printTone')||'plain';}catch(e){}
      tone(saved);
      document.getElementById('doprint').onclick=function(){window.print();};
      document.getElementById('doclose').onclick=function(){window.close();};
      set('${initial}');
    })();`;
  // Margin and orientation rules come last so they override page rules inside the document.
  w.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PRINT_CSS}</style><style>${css}</style></head>` +
      `<body>${bar}${head}${sheets}<style>${marginCss()}</style><style id="orient"></style><style id="tone"></style><script>${script}<\/script></body></html>`,
  );
  w.document.close();
  w.focus();
}

export function printTable(title: string, subtitle: string, columns: PlainColumn[], rows: Row[]) {
  const head = columns.map((c) => `<th>${esc(c.label)}</th>`).join('');
  const body = rows.length
    ? rows.map((r, i) => `<tr>${columns.map((c) => `<td>${esc(c.value(r, i))}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${columns.length}" style="text-align:center">No records</td></tr>`;
  printHtml(
    title,
    `<style>@page{size:A4 ${columns.length > 7 ? 'landscape' : 'portrait'}}</style><header><div><h1>${esc(title)}</h1><h2>${esc(subtitle)}</h2></div><div class="meta">AWAS<br>Printed ${esc(new Date().toLocaleString('en-GB'))}</div></header>
     <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
     <footer>Total records: ${rows.length}</footer>`,
  );
}

export { esc };

/** Minimal RFC-4180 CSV parser. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') row.push(cur), (cur = '');
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur), rows.push(row), (row = []), (cur = '');
    } else cur += ch;
  }
  if (cur || row.length) row.push(cur), rows.push(row);
  const [header, ...data] = rows.filter((r) => r.some((c) => c.trim()));
  if (!header) return [];
  const keys = header.map((h) => h.replace(/^﻿/, '').trim());
  return data.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

/**
 * Prints rows grouped by a field (e.g. accn type).
 * mode: '' = one combined table, '*' = each group on its own page, anything else = only that group.
 */
export function printByGroup(opts: {
  title: string;
  subtitle: string;
  columns: PlainColumn[];
  rows: Row[];
  groupBy: (r: Row) => string;
  order: string[];
  mode: string;
  signatures?: string[];
}) {
  const { title, subtitle, columns, rows, groupBy, order, mode } = opts;
  const head = `<thead><tr>${columns.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr></thead>`;
  const table = (list: Row[]) =>
    `<table>${head}<tbody>${
      list.length
        ? list.map((r, i) => `<tr>${columns.map((c) => `<td>${esc(c.value(r, i))}</td>`).join('')}</tr>`).join('')
        : `<tr><td colspan="${columns.length}" style="text-align:center">No records</td></tr>`
    }</tbody></table>`;
  const sigs = opts.signatures?.length
    ? `<div style="display:flex;justify-content:space-between;gap:24px;margin-top:48px;font-size:12px">${opts.signatures
        .map((s) => `<div style="border-top:1px solid #333;padding-top:2px;min-width:170px;text-align:center">${esc(s)}</div>`)
        .join('')}</div>`
    : '';
  const header = (sub: string) =>
    `<header><div><h1>${esc(title)}</h1><h2>${esc(sub)}</h2></div><div class="meta">AWAS<br>Printed ${esc(new Date().toLocaleString('en-GB'))}</div></header>`;

  const pos = (g: string) => (order.indexOf(g) + 1 || 99);
  const groups = [...new Set(rows.map(groupBy))].sort((a, b) => pos(a) - pos(b) || a.localeCompare(b));
  let body: string;
  if (!mode) {
    body = `${header(subtitle)}${table(rows)}<footer>Total records: ${rows.length}</footer>${sigs}`;
  } else if (mode === '*') {
    body = (groups.length ? groups : ['—'])
      .map(
        (g) => `<section>${header(`${subtitle ? `${subtitle} · ` : ''}${g}`)}
          ${table(rows.filter((r) => groupBy(r) === g))}<footer>${esc(g)}: ${rows.filter((r) => groupBy(r) === g).length} record(s)</footer>${sigs}</section>`,
      )
      .join(PAGE_BREAK);
  } else {
    const list = rows.filter((r) => groupBy(r) === mode);
    body = `${header(`${subtitle ? `${subtitle} · ` : ''}${mode}`)}${table(list)}<footer>${esc(mode)}: ${list.length} record(s)</footer>${sigs}`;
  }
  // Lists have many columns: print them in landscape.
  printHtml(title, `<style>@page{size:A4 landscape}</style>${body}`);
}

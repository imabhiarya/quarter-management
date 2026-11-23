import { useState } from 'react';
import { Download, FileSpreadsheet, Upload, CheckCircle2, AlertTriangle } from 'lucide-react';
import { QuarterText } from './QuarterViewer';
import { api, type Page } from '../lib/api';
import { useToast } from '../lib/context';
import { fmtDate, isoDate } from '../lib/format';
import { exportExcel, readTable } from '../lib/excel';
import { matchLines, type ImportLine } from '../lib/takeoverImport';
import { Button, Label, Modal, cx } from './ui';

/** Current allotments (status Allotted) with take-over state, office and trade. */
const loadAllotments = async () => (await api<Page>('/c/allotments', { query: { status: 'Allotted', pageSize: 'all' } })).rows;

/**
 * Import the take-over report sent back by the BSO (Excel or CSV) and update each allotment's
 * occupation: "Occupied on …", "Not Taken Over" or "Deferred till …".
 */
export function TakeoverImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reportDate, setReportDate] = useState(isoDate());
  const [fileName, setFileName] = useState('');
  const [lines, setLines] = useState<ImportLine[] | null>(null);
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [table, setTable] = useState<{ header: string[]; rows: string[][] } | null>(null);

  const reMatch = async (t: { header: string[]; rows: string[][] }, date: string) => {
    const result = matchLines(t.header, t.rows, await loadAllotments(), date);
    setLines(result);
    setSkip(new Set());
    if (!result.length) setError('No data rows were found in this file.');
  };

  /** A sheet for the BSO: every allotment awaiting take-over, with blank Remarks / Take-over Date. */
  const downloadSheet = async () => {
    try {
      const rows = (await loadAllotments()).filter((a) => a.occState !== 'Occupied');
      if (!rows.length) return toast.error('No allotments are awaiting take-over.');
      await exportExcel(
        `take-over-sheet-for-BSO-${isoDate()}`,
        [
          { label: 'Ser No', value: (_r, i) => String(i + 1) },
          { label: 'Order No.', value: (r) => r.orderNo },
          { label: 'MES / Service No.', value: (r) => r.serviceNo },
          { label: 'Name', value: (r) => `${r.rank && r.rank !== 'Civilian' ? `${r.rank} ` : ''}${r.allotteeName}` },
          { label: 'Unit', value: (r) => r.officeName || '' },
          { label: 'Qtr No', value: (r) => r.quarterNo },
          { label: 'Type of Qtr', value: (r) => r.category },
          { label: 'Allotted On', value: (r) => fmtDate(r.allotmentDate) },
          { label: 'Take-over Due By', value: (r) => fmtDate(r.occDeadline) },
          { label: 'Take-over Date', value: () => '' },
          { label: 'Remarks', value: () => '' },
        ],
        rows,
        'Take-over',
      );
    } catch (e) {
      toast.error(e);
    }
  };

  const usable = (lines ?? []).filter((l) => !l.problem && l.allotment && !skip.has(l.line));

  const apply = async () => {
    setBusy(true);
    setError('');
    try {
      const patch = usable.map((l) => ({
        id: l.allotment!.id,
        data:
          l.result.status === 'Occupied'
            ? { occupationStatus: 'Occupied', occupiedOn: l.result.date, occupationRemarks: `BSO report${fileName ? ` (${fileName})` : ''}: ${l.result.note}` }
            : l.result.status === 'Deferment'
              ? { occupationStatus: 'Deferment', deferredUpto: l.result.date, deferReason: `BSO report: ${l.result.note}` }
              : { occupationStatus: 'Not Taken Over', notTakenOverOn: reportDate, occupationRemarks: `BSO report${fileName ? ` (${fileName})` : ''}: ${l.result.note}` },
      }));
      await api('/c/allotments/bulk', { method: 'POST', body: { patch } });
      toast.success(`${patch.length} allotment(s) updated from the BSO report.`);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const tone = (l: ImportLine) =>
    l.problem ? 'text-amber-800' : l.result.status === 'Occupied' ? 'text-green-800' : l.result.status === 'Deferment' ? 'text-amber-700' : 'text-red-700';

  return (
    <Modal
      title="Import BSO Take-over Report"
      wide
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Upload} loading={busy} disabled={!usable.length} onClick={apply}>
            Apply {usable.length} update(s)
          </Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-slate-200 p-4">
          <h3 className="mb-1 flex items-center gap-2 font-bold text-brand-700"><Download className="size-4" /> 1. Sheet for the BSO (optional)</h3>
          <p className="text-sm text-slate-700">Download all allotments awaiting take-over as Excel. The BSO fills in <b>Take-over Date</b> and <b>Remarks</b> and sends it back.</p>
          <Button className="mt-3" icon={FileSpreadsheet} onClick={downloadSheet}>Download Sheet for BSO</Button>
        </div>
        <div className="rounded-lg border border-slate-200 p-4">
          <h3 className="mb-1 flex items-center gap-2 font-bold text-brand-700"><Upload className="size-4" /> 2. Import the BSO's report</h3>
          <p className="text-sm text-slate-700">
            Excel (.xlsx) or CSV with <b>MES / Service No.</b> (or Order No.), <b>Qtr No</b> and <b>Remarks</b> such as "Occupied on 11 Aug 2026", "Not Taken Over" or "Deferred till 15 Dec 2026".
          </p>
          <label className="mt-3 flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed border-brand-200 bg-brand-50/50 px-4 py-3 hover:border-brand-400">
            <FileSpreadsheet className="size-7 shrink-0 text-green-700" strokeWidth={1.5} />
            <span className="text-sm font-semibold text-slate-800">{fileName || 'Choose the BSO report (.xlsx / .csv)'}</span>
            <input
              type="file"
              accept=".xlsx,.csv"
              className="sr-only"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                setFileName(f.name);
                setError('');
                setLines(null);
                try {
                  const t = await readTable(f);
                  setTable(t);
                  await reMatch(t, reportDate);
                } catch {
                  setError('Could not read this file. Save it as .xlsx or .csv and try again.');
                }
              }}
            />
          </label>
          <div className="mt-3">
            <Label htmlFor="rep-date">Date of BSO report</Label>
            <input
              id="rep-date"
              type="date"
              className="input"
              value={reportDate}
              onChange={(e) => {
                setReportDate(e.target.value);
                if (table) reMatch(table, e.target.value);
              }}
            />
            <p className="mt-1 text-xs text-slate-500">Used as the take-over date where a row says "Occupied" without a date.</p>
          </div>
        </div>
      </div>

      {lines && lines.length > 0 && (
        <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-2 bg-brand-50 px-3 py-2 text-sm">
            <span className="font-bold text-brand-800">
              {usable.length} of {lines.length} row(s) will be applied
              {lines.some((l) => l.problem) && <span className="ml-2 font-normal text-amber-800">· {lines.filter((l) => l.problem).length} need attention and will be skipped</span>}
            </span>
          </div>
          <div className="max-h-80 overflow-auto">
            <table className="data-table compact text-sm">
              <thead>
                <tr><th className="w-10">Apply</th><th>Row</th><th>Service No.</th><th>Qtr (report)</th><th>Matched Allotment</th><th>Remark (report)</th><th>Will record</th></tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.line} className={cx(l.problem && 'bg-amber-50/60')}>
                    <td className="text-center">
                      <input
                        type="checkbox"
                        className="size-4 accent-brand-700"
                        disabled={!!l.problem}
                        checked={!l.problem && !skip.has(l.line)}
                        onChange={() => setSkip((s) => { const n = new Set(s); if (n.has(l.line)) n.delete(l.line); else n.add(l.line); return n; })}
                      />
                    </td>
                    <td>{l.line}</td>
                    <td>{l.serviceNo || '—'}</td>
                    <td>{l.quarter || '—'}</td>
                    <td>{l.allotment ? <><b>{l.allotment.orderNo}</b> · {l.allotment.allotteeName} · <QuarterText no={l.allotment.quarterNo} /></> : <span className="text-slate-400">—</span>}</td>
                    <td className="max-w-56">{l.remarks || '—'}</td>
                    <td className={tone(l)}>
                      {l.problem ? (
                        <span className="flex items-start gap-1"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{l.problem}</span>
                      ) : (
                        <span className="flex items-start gap-1 font-semibold">
                          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                          {l.result.status === 'Occupied' ? `Occupied on ${fmtDate(l.result.date)}` : l.result.status === 'Deferment' ? `Deferred up to ${fmtDate(l.result.date)}` : 'Not Taken Over (Rule 7 (1) SRO 308)'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
    </Modal>
  );
}

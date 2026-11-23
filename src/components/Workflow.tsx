import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Save, CheckCircle2, XCircle, AlertTriangle, Eye, Download, FileText, Printer, X } from 'lucide-react';
import { QuarterText } from './QuarterViewer';
import { PriorityChip } from './PriorityControls';
import { api, openUpload, downloadUpload, type Page, type Row } from '../lib/api';
import { useAuth, useMasters, useToast } from '../lib/context';
import { printProceedingsDoc, type ProceedingsParts } from '../lib/printProceedings';
import { getScrutinyMode, setScrutinyMode, type ScrutinyMode } from '../lib/scrutinyMode';
import { fmtDate } from '../lib/format';
import { printOrderLetter, defaultLetterTitle, defaultRetentionTitle, type LetterKind, type Signatory } from '../lib/printAllotmentLetter';
import { Badge, Button, IconButton, Label, Modal, Select, useConfirm } from './ui';
import { FileLink, FormModal } from './Form';
import { signatoryFields } from '../signatoryFields';

/** Change the workflow status of a record, with optional remarks. */
export function StatusModal({ collection, row, options, title, onClose, onDone }: { collection: string; row: Row; options: string[]; title: string; onClose: () => void; onDone: () => void }) {
  const [status, setStatus] = useState<string>(row.status);
  const [remarks, setRemarks] = useState<string>(row.statusRemarks ?? '');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon={Save}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api(`/c/${collection}/${row.id}`, { method: 'PUT', body: { status, statusRemarks: remarks } });
                toast.success(`Status updated to ${status}.`);
                onDone();
              } catch (e) {
                toast.error(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            Update
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-slate-700">
        Current status: <Badge status={row.status} />
      </p>
      <Label htmlFor="new-status" required>New status</Label>
      <Select id="new-status" value={status} onChange={setStatus} options={options} />
      <div className="mt-3">
        <Label htmlFor="status-remarks">Remarks</Label>
        <textarea id="status-remarks" className="input" rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </div>
    </Modal>
  );
}

/** Re-sequence the waiting list. */
export function ReorderModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => {
    api<Page>('/c/applications', { query: { in_status: 'Eligible,Recommended', sort: 'waitingOrder', dir: 'asc', pageSize: 'all', priorityFirst: '1' } })
      .then((r) => setRows(r.rows))
      .catch(toast.error);
  }, [toast]);
  const move = (i: number, d: number) =>
    setRows((rs) => {
      if (!rs) return rs;
      const j = i + d;
      if (j < 0 || j >= rs.length) return rs;
      if (rs[i].priorityGroup !== rs[j].priorityGroup) return rs; // stay within the allotment priority
      const next = [...rs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  return (
    <Modal
      title="Reorder Waiting List"
      wide
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon={Save}
            loading={busy}
            disabled={!rows}
            onClick={async () => {
              setBusy(true);
              try {
                const patch = rows!.map((r, i) => ({ id: r.id, data: { waitingOrder: i + 1 } })).filter((p, i) => rows![i].waitingOrder !== p.data.waitingOrder);
                if (patch.length) await api('/c/applications/bulk', { method: 'POST', body: { patch } });
                toast.success('Waiting list order saved.');
                onDone();
              } catch (e) {
                toast.error(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            Save Order
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-slate-600">
        Move applicants up or down to set their order on the waiting list. When an allotment priority is saved, applicants move only within their own priority group.
      </p>
      {!rows ? (
        <p className="text-slate-500">Loading…</p>
      ) : (
        <ol className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {rows.map((r, i) => (
            <li key={r.id} className="flex items-center gap-3 px-3 py-2">
              <span className="w-7 text-right font-semibold text-brand-700">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium">{r.rank} {r.name} <span className="text-slate-500">({r.serviceNo})</span></span>
                  <PriorityChip row={r} />
                </div>
                <div className="text-xs text-slate-500">{r.applicationNo} · {r.categoryRequested} · applied {fmtDate(r.applicationDate)}</div>
              </div>
              <Button size="sm" icon={ArrowUp} aria-label="Move up" disabled={i === 0 || rows[i - 1].priorityGroup !== r.priorityGroup} onClick={() => move(i, -1)} />
              <Button size="sm" icon={ArrowDown} aria-label="Move down" disabled={i === rows.length - 1 || rows[i + 1].priorityGroup !== r.priorityGroup} onClick={() => move(i, 1)} />
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}



/** Choose which parts of a proceeding to print; appendices are read live from Quarter Allotment and Waiting List. */
export function PrintProceedingsModal({ row, onClose }: { row: Row; onClose: () => void }) {
  const [parts, setParts] = useState<ProceedingsParts>({ proceedings: true, appendixA: true, appendixB: true });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const opts: [keyof ProceedingsParts, string, string][] = [
    ['proceedings', 'Proceedings', 'Authority, presiding officer, members and decisions'],
    ['appendixA', "Appendix 'A' – Quarter Allotment", 'Allotments in these proceedings, with every detail from each individual application'],
    ['appendixB', "Appendix 'B' – Waiting List", 'Current waiting list by accn type, with full application details'],
  ];
  return (
    <Modal
      title={`Print ${row.proceedingsNo}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon={Printer}
            loading={busy}
            disabled={!Object.values(parts).some(Boolean)}
            onClick={async () => {
              setBusy(true);
              try {
                await printProceedingsDoc(row.id, parts);
                onClose();
              } catch (e) {
                toast.error(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            Print
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        {opts.map(([k, label, hint]) => (
          <label key={k} className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 px-3 py-2.5 hover:bg-brand-50">
            <input type="checkbox" className="mt-1 size-4 accent-brand-700" checked={parts[k]} onChange={(e) => setParts((p) => ({ ...p, [k]: e.target.checked }))} />
            <span>
              <span className="block font-semibold text-slate-900">{label}</span>
              <span className="text-sm text-slate-600">{hint}</span>
            </span>
          </label>
        ))}
      </div>
      <p className="mt-3 text-sm text-slate-600">Appendices are taken from Quarter Allotment and the Waiting List at the time of printing, so they always reflect the latest changes. They print in landscape.</p>
    </Modal>
  );
}

type Check = { key: string; label: string; ok: boolean; detail: string; reason: string; rule: string | null };
type Assessment = { policy: { id: number; title: string } | null; checks: Check[]; decision: 'Eligible' | 'Rejected'; reason: string; rule: string | null };

/**
 * Scrutiny decision, in one of two modes:
 * - Auto check: the application is checked against the rules read from the active policy PDF and the
 *   matching rule, decision and reason are pre-filled for staff to confirm.
 * - Manual: staff choose the authority (policy / SRO) and tick the rules that apply.
 */
export function ScrutinyModal({ row, mode, onClose, onDone }: { row: Row; mode: 'eligible' | 'reject'; onClose: () => void; onDone: () => void }) {
  const { masters } = useMasters();
  const { user } = useAuth();
  const toast = useToast();
  const [method, setMethod] = useState<ScrutinyMode>(getScrutinyMode());
  const [reason, setReason] = useState('');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [policies, setPolicies] = useState<Row[] | null>(null);
  const [policyId, setPolicyId] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [check, setCheck] = useState<Assessment | null>(null);

  useEffect(() => {
    api<Page>('/c/policies', { query: { status: 'Active', pageSize: 'all' } })
      .then((p) => {
        setPolicies(p.rows);
        if (p.rows.length === 1) setPolicyId(String(p.rows[0].id));
      })
      .catch((e) => (toast.error(e), setPolicies([])));
  }, [toast]);

  // Auto check: run only in auto mode, and pre-fill policy, rule and reason from it.
  useEffect(() => {
    if (method !== 'auto') return;
    api<Assessment>(`/scrutiny/${row.id}`)
      .then((a) => {
        setCheck(a);
        if (a.policy) setPolicyId(String(a.policy.id));
        const failed = a.checks.find((c) => !c.ok);
        if (mode === 'reject' && failed) {
          setReason(failed.reason);
          setChosen(failed.rule ? [failed.rule] : []);
        } else if (mode === 'eligible' && a.decision === 'Eligible') setChosen(a.rule ? [a.rule] : []);
      })
      .catch(toast.error);
  }, [method, row.id, mode, toast]);

  const switchMethod = (m: ScrutinyMode) => {
    setMethod(m);
    setScrutinyMode(m);
    setChosen([]);
    setError('');
    if (m === 'manual') setCheck(null);
  };

  const policy = policies?.find((p) => String(p.id) === policyId);
  const rules: string[] = Array.isArray(policy?.rules) ? policy!.rules : [];
  const docs: { description: string; mandatory: string; fileId?: string }[] = Array.isArray(row.documents) ? row.documents : [];
  const disagrees = method === 'auto' && check && ((mode === 'eligible' && check.decision === 'Rejected') || (mode === 'reject' && check.decision === 'Eligible'));
  const reasons = masters.rejectionReasons ?? [];
  const toggle = (r: string) => (setChosen((c) => (c.includes(r) ? c.filter((x) => x !== r) : [...c, r])), setError(''));

  const submit = async () => {
    if (!policy) return setError('Select the authority (policy / SRO) this decision is made under.');
    if (!chosen.length) return setError(`Tick at least one rule ${mode === 'eligible' ? 'under which the application is accepted' : 'against which it is rejected'}.`);
    if (mode === 'reject' && !reason) return setError('Select a reason for rejection.');
    setBusy(true);
    setError('');
    try {
      const ordered = rules.filter((r) => chosen.includes(r));
      await api(`/c/applications/${row.id}`, {
        method: 'PUT',
        body: {
          status: mode === 'eligible' ? 'Eligible' : 'Rejected',
          rejectionReason: mode === 'reject' ? reason : '',
          scrutinyRemarks: remarks,
          scrutinyPolicyId: policy.id,
          scrutinyRules: ordered,
          scrutinyRule: ordered.join('; '),
          scrutinyMode: method === 'auto' ? 'Auto check' : 'Manual',
          scrutinyDate: new Date().toISOString().slice(0, 10),
          scrutinisedBy: user?.fullName ?? '',
          autoCheckDecision: method === 'auto' ? (check?.decision ?? '') : '',
        },
      });
      toast.success(mode === 'eligible' ? `${row.applicationNo} accepted. It is now available in Quarter Allotment.` : `${row.applicationNo} rejected.`);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={mode === 'eligible' ? 'Accept Application' : 'Reject Application'}
      wide
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={mode === 'eligible' ? 'primary' : 'danger'} icon={mode === 'eligible' ? CheckCircle2 : XCircle} loading={busy} disabled={policies?.length === 0} onClick={submit}>
            {mode === 'eligible' ? 'Accept' : 'Reject'}
          </Button>
        </>
      }
    >
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm">
          <div className="font-semibold text-slate-900">{row.rank && row.rank !== 'Civilian' ? `${row.rank} ` : ''}{row.name} <span className="font-normal text-slate-600">({row.serviceNo})</span></div>
          <div className="text-slate-600">{row.applicationNo} · {row.officeName || '—'} · {row.payLevel} · {row.categoryRequested} · {row.applicationGround || 'Regular'}</div>
        </div>
        <div className="w-60">
          <Label htmlFor="scr-method">Scrutiny Mode</Label>
          <Select id="scr-method" value={method} onChange={(v) => switchMethod(v as ScrutinyMode)} options={[{ value: 'auto', label: 'Auto check' }, { value: 'manual', label: 'Manual – select rules' }]} />
        </div>
      </div>

      {policies && policies.length === 0 && (
        <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          No active policy has been uploaded. Open the <b>Authority</b> tab on this page and upload the policy PDF first.
        </p>
      )}

      {method === 'auto' && policies && policies.length > 0 && (
        <div className="mb-4 overflow-hidden rounded-lg border border-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-2 bg-brand-50 px-3 py-2">
            <span className="text-sm font-bold text-brand-800">Automatic check against {check?.policy?.title ?? 'the policy'}</span>
            {check && (
              <span className={`rounded-md px-2 py-0.5 text-sm font-bold ${check.decision === 'Eligible' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                Recommendation: {check.decision === 'Eligible' ? 'Accept' : `Reject – ${check.reason}`}
              </span>
            )}
          </div>
          {!check ? (
            <p className="px-3 py-3 text-sm text-slate-500">Checking…</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {check.checks.map((c) => (
                  <tr key={c.key} className="border-t border-slate-100 align-top">
                    <td className="w-8 px-3 py-2">{c.ok ? <CheckCircle2 className="size-4 text-green-700" /> : <XCircle className="size-4 text-red-600" />}</td>
                    <td className="py-2 pr-3">
                      <div className={c.ok ? 'font-medium text-slate-900' : 'font-semibold text-red-700'}>{c.label}</div>
                      <div className="text-xs text-slate-600">{c.detail}</div>
                    </td>
                    <td className="py-2 pr-3 text-xs text-slate-600">{c.rule ? c.rule : <span className="text-amber-700">No matching rule found in the policy</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {disagrees && (
        <p className="mb-4 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          The automatic check recommends <b>{check!.decision === 'Eligible' ? 'Accept' : 'Reject'}</b>. You can still {mode === 'eligible' ? 'accept' : 'reject'}, but tick the rules it is based on and record your reason in the remarks.
        </p>
      )}

      {policies && policies.length > 0 && (
        <div className="mb-3 grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="rounded-lg border border-slate-200 p-3">
            <Label htmlFor="scr-policy" required>Authority (Policy / SRO)</Label>
            <Select
              id="scr-policy"
              value={policyId}
              onChange={(v) => (setPolicyId(v), setChosen([]), setError(''))}
              options={policies.map((p) => ({ value: String(p.id), label: p.title }))}
              placeholder="Select Authority"
              invalid={!!error && !policy}
            />
            {policy?.document?.fileId && <div className="mt-2 text-sm"><FileLink file={policy.document} /></div>}
            {policy && <p className="mt-2 text-xs text-slate-500">{rules.length} rule(s) read from this document.</p>}
            {mode === 'reject' && (
              <div className="mt-3">
                <Label htmlFor="rej-reason" required>Reason for rejection</Label>
                <Select id="rej-reason" value={reason} onChange={(v) => (setReason(v), setError(''))} options={reason && !reasons.includes(reason) ? [reason, ...reasons] : reasons} placeholder="Select Reason" invalid={!!error && !reason} />
              </div>
            )}
          </div>
          <div className={`rounded-lg border p-3 ${error && policy && !chosen.length ? 'border-red-400' : 'border-slate-200'}`}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-slate-800">
                {mode === 'eligible' ? 'Rules under which accepted' : 'Rules against which rejected'} <span className="text-red-600">*</span>
              </span>
              {chosen.length > 0 && <span className="rounded-full bg-brand-700 px-2 text-xs font-semibold text-white">{chosen.length} selected</span>}
            </div>
            {!policy ? (
              <p className="text-sm text-slate-500">Select an authority to see its rules.</p>
            ) : (
              <ul className="max-h-64 space-y-1 overflow-y-auto pr-1">
                {rules.map((r) => (
                  <li key={r}>
                    <label className={`flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-brand-50 ${chosen.includes(r) ? 'bg-brand-50' : ''}`}>
                      <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-brand-700" checked={chosen.includes(r)} onChange={() => toggle(r)} />
                      <span>{r}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <div className="mb-3"><DocumentList docs={docs} /></div>
      <Label htmlFor="scr-remarks">{mode === 'reject' ? 'Details / remarks' : 'Scrutiny remarks'}</Label>
      <textarea id="scr-remarks" className="input" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      {error && <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
    </Modal>
  );
}

type Doc = { description: string; mandatory: string; fileId?: string; fileName?: string };

/** Documents uploaded with an application, each with View and Download. */
export function DocumentList({ docs }: { docs: Doc[] }) {
  const toast = useToast();
  if (!docs.length) return <p className="rounded-lg border border-dashed border-slate-300 px-3 py-3 text-sm text-slate-500">No documents were uploaded with this application.</p>;
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <div className="bg-brand-50 px-3 py-1.5 text-sm font-bold text-brand-800">Uploaded Documents</div>
      <ul className="divide-y divide-slate-100">
        {docs.map((d, i) => (
          <li key={i} className="flex items-center gap-3 px-3 py-2 text-sm">
            <FileText className="size-4 shrink-0 text-slate-500" />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-slate-900">
                {d.description || 'Document'} {d.mandatory === 'Yes' && <span className="text-red-600">*</span>}
              </div>
              <div className="truncate text-xs text-slate-500">{d.fileName ?? (d.mandatory === 'Yes' ? 'Not uploaded (mandatory)' : 'Not uploaded')}</div>
            </div>
            {d.fileId ? (
              <>
                <IconButton icon={Eye} label="View" onClick={() => openUpload(d.fileId!).catch(toast.error)} />
                <IconButton icon={Download} label="Download" tone="brand" onClick={() => downloadUpload(d.fileId!, d.fileName ?? d.description).catch(toast.error)} />
              </>
            ) : (
              <span className={d.mandatory === 'Yes' ? 'text-xs font-semibold text-red-700' : 'text-xs text-slate-400'}>Missing</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DocumentsModal({ row, onClose }: { row: Row; onClose: () => void }) {
  const docs: Doc[] = Array.isArray(row.documents) ? row.documents : [];
  const uploaded = docs.filter((d) => d.fileId);
  const toast = useToast();
  return (
    <Modal
      title={`Documents – ${row.applicationNo}`}
      onClose={onClose}
      footer={
        <>
          {uploaded.length > 1 && (
            <Button icon={Download} onClick={async () => { try { for (const d of uploaded) await downloadUpload(d.fileId!, d.fileName ?? d.description); } catch (e) { toast.error(e); } }}>
              Download All ({uploaded.length})
            </Button>
          )}
          <Button variant="primary" onClick={onClose}>Close</Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-slate-700">{row.rank && row.rank !== 'Civilian' ? `${row.rank} ` : ''}{row.name} ({row.serviceNo})</p>
      <DocumentList docs={docs} />
    </Modal>
  );
}


/** Page-level choice of scrutiny mode, shown above the scrutiny table. */
export function ScrutinyModeBar({ onChange }: { onChange: () => void }) {
  const [method, setMethod] = useState<ScrutinyMode>(getScrutinyMode());
  return (
    <div className="no-print flex flex-wrap items-center gap-3 rounded-xl border border-brand-200 bg-brand-50/60 px-4 py-3">
      <label htmlFor="page-scr-mode" className="text-sm font-bold text-brand-800">Scrutiny Mode</label>
      <select
        id="page-scr-mode"
        className="input w-60"
        value={method}
        onChange={(e) => {
          const m = e.target.value as ScrutinyMode;
          setMethod(m);
          setScrutinyMode(m);
          onChange();
        }}
      >
        <option value="auto">Auto check</option>
        <option value="manual">Manual – select rules</option>
      </select>
      <span className="text-sm text-slate-600">
        {method === 'auto'
          ? 'Each application is checked automatically against the active policy; the suggested decision and rule are shown and pre-filled.'
          : 'No automatic check. On Accept / Reject, choose the authority (policy / SRO) and tick the rules that apply.'}
      </span>
    </div>
  );
}

/** Choose an office (and dates), tick the people, and print one combined order (allotment or retention / extension). */
export function BulkOrderModal({ onClose, kind = 'allotment', caseType = '', initialProceedings = '' }: { onClose: () => void; kind?: LetterKind; caseType?: string; initialProceedings?: string }) {
  const isAllot = kind === 'allotment';
  const dateKey = isAllot ? 'allotmentDate' : 'fromDate';
  const noun = isAllot ? 'allottees' : `${(caseType || 'retention').toLowerCase()} cases`;
  const toast = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [office, setOffice] = useState('');
  const [proc, setProc] = useState(initialProceedings);
  const [procList, setProcList] = useState<string[]>([]);
  useEffect(() => {
    if (isAllot) api<string[]>('/proceedings-list').then(setProcList).catch(() => {});
  }, [isAllot]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [orderNo, setOrderNo] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [letter, setLetter] = useState<LetterValue>(emptyLetter());

  useEffect(() => {
    api<Row[]>(isAllot ? '/allotments/office-wise' : '/retentions/office-wise', { query: isAllot ? undefined : { caseType } })
      .then(setRows)
      .catch((e) => (toast.error(e), setRows([])));
  }, [toast, isAllot, caseType]);

  const offices = useMemo(() => [...new Set((rows ?? []).map((r) => r.officeName).filter(Boolean))].sort(), [rows]);
  const list = useMemo(
    () =>
      (rows ?? []).filter(
        (r) =>
          (!proc || String(r.proceedingsNo ?? '').split(', ').includes(proc)) &&
          (!office || r.officeName === office) &&
          (!from || r[dateKey] >= from) &&
          (!to || r[dateKey] <= to),
      ),
    [rows, office, from, to, dateKey, proc],
  );
  // Selecting a new office or date range ticks everyone in it.
  useEffect(() => setPicked(new Set(list.map((r) => r.id))), [list]);
  useEffect(() => {
    const slug = (proc || office).replace(/[^A-Za-z0-9]+/g, '').slice(0, 12).toUpperCase();
    const prefix = isAllot ? 'AO' : caseType === 'Extension' ? 'EXT' : 'RET';
    setOrderNo(`${prefix}/BULK${slug ? `/${slug}` : ''}/${date.slice(0, 4)}`);
  }, [office, date, isAllot, caseType, proc]);

  const chosen = list.filter((r) => picked.has(r.id));
  const [titleEdited, setTitleEdited] = useState(false);
  const [toEdited, setToEdited] = useState(false);
  const [refEdited, setRefEdited] = useState(false);
  useEffect(() => {
    if (!refEdited && isAllot) setLetter((l) => ({ ...l, reference: proc ? `Proceedings No. ${proc}` : '' }));
  }, [proc, refEdited, isAllot]);
  useEffect(() => {
    if (!toEdited) setLetter((l) => ({ ...l, addressee: office }));
  }, [office, toEdited]);
  useEffect(() => {
    if (!titleEdited) setLetter((l) => ({ ...l, title: isAllot ? defaultLetterTitle(chosen) : defaultRetentionTitle(caseType, chosen) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen.length, titleEdited]);
  const toggle = (id: number) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <Modal
      title={isAllot ? 'Bulk Allotment Order' : `Bulk ${caseType || 'Retention'} Order`}
      wide
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon={Printer}
            loading={busy}
            disabled={!chosen.length || !orderNo.trim() || !letter.signatoryId || !letter.title.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await printWith(kind, chosen.map((r) => r.id), letter, orderNo.trim(), date);
                onClose();
              } catch (e) {
                toast.error(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            Print Combined Order ({chosen.length})
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        {isAllot && (
          <div className="sm:col-span-3">
            <Label htmlFor="bulk-proc">Proceedings No.</Label>
            <Select id="bulk-proc" value={proc} onChange={setProc} options={procList} placeholder="Any (not limited to a proceeding)" />
            {proc && <p className="mt-1 text-xs text-slate-500">Only allotments considered in {proc} are listed.</p>}
          </div>
        )}
        <div className="sm:col-span-3">
          <Label htmlFor="bulk-office">Office</Label>
          <Select id="bulk-office" value={office} onChange={setOffice} options={offices} placeholder="All offices" />
        </div>
        <div><Label htmlFor="bulk-from">{isAllot ? 'Allotment Date From' : 'Period Starting From'}</Label><input id="bulk-from" type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><Label htmlFor="bulk-to">To</Label><input id="bulk-to" type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div><Label htmlFor="bulk-date" required>Order Date</Label><input id="bulk-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="sm:col-span-3">
          <Label htmlFor="bulk-no" required>Combined Order No.</Label>
          <input id="bulk-no" className="input" value={orderNo} onChange={(e) => setOrderNo(e.target.value)} />
          {isAllot && <p className="mt-1 text-xs text-slate-500">Each allottee's own order no. is also listed in the combined order for reference.</p>}
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-slate-200 p-3">
        <LetterFields
          kind={kind}
          value={letter}
          onChange={(v) => (v.title !== undefined && setTitleEdited(true), v.addressee !== undefined && setToEdited(true), v.reference !== undefined && setRefEdited(true), setLetter((l) => ({ ...l, ...v })))}
        />
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
        <div className="flex items-center justify-between bg-brand-50 px-3 py-2 text-sm">
          <span className="font-bold text-brand-800 capitalize">{noun} ({chosen.length} of {list.length} selected)</span>
          <span className="flex gap-3">
            <button type="button" className="font-semibold text-brand-700 hover:underline" onClick={() => setPicked(new Set(list.map((r) => r.id)))}>Select all</button>
            <button type="button" className="font-semibold text-brand-700 hover:underline" onClick={() => setPicked(new Set())}>Clear</button>
          </span>
        </div>
        <div className="max-h-72 overflow-y-auto">
          {rows === null && <p className="px-3 py-4 text-sm text-slate-500">Loading…</p>}
          {rows && !list.length && (
            <p className="px-3 py-4 text-sm text-slate-500">{isAllot ? 'No current allotments match these choices.' : `No approved ${noun} match this office and date range.`}</p>
          )}
          {list.map((r) => (
            <label key={r.id} className="flex cursor-pointer items-center gap-3 border-t border-slate-100 px-3 py-2 text-sm hover:bg-brand-50">
              <input type="checkbox" className="size-4 accent-brand-700" checked={picked.has(r.id)} onChange={() => toggle(r.id)} />
              {isAllot ? (
                <>
                  <span className="w-28 font-semibold">{r.orderNo}</span>
                  <span className="w-24">{fmtDate(r.allotmentDate)}</span>
                  <span className="hidden w-28 text-slate-500 lg:block">{r.proceedingsNo || '—'}</span>
                </>
              ) : (
                <span className="w-52">{fmtDate(r.fromDate)} – {fmtDate(r.toDate)}</span>
              )}
              <span className="flex-1">{r.rank && r.rank !== 'Civilian' ? `${r.rank} ` : ''}{isAllot ? r.allotteeName : r.name} <span className="text-slate-500">({r.serviceNo})</span></span>
              <span className="w-40"><QuarterText no={r.quarterNo} /> <span className="text-slate-500">{r.category}</span></span>
              <span className="hidden w-36 truncate text-slate-600 md:block" title={r.officeName}>{r.officeName || '—'}</span>
            </label>
          ))}
        </div>
      </div>
    </Modal>
  );
}

const SIG_KEY = 'awas.lastSignatory';

/** notes: null until loaded from the standard notes in Settings. */
type LetterValue = { signatoryId: string; signatory2Id: string; reference: string; appendix: string; title: string; addressee: string; enclosure: string; copyTo: string; notes: string | null };
const COPY_KEY = 'awas.lastCopyTo';
const lastCopyTo = () => {
  try {
    return localStorage.getItem(COPY_KEY) ?? '';
  } catch {
    return '';
  }
};
export const emptyLetter = (title = ''): LetterValue => ({ signatoryId: '', signatory2Id: '', reference: '', appendix: '', title, addressee: '', enclosure: '', copyTo: lastCopyTo(), notes: null });

/** Preview of how a signature block will print. */
function SigPreview({ s }: { s: Signatory }) {
  return (
    <div className="mt-2 inline-block rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
      <span className="text-xs text-slate-500">Prints as:</span>
      <div>({s.name})<br />{s.designation}{s.forLine && <><br />{s.forLine}</>}</div>
      <div className="mt-1 text-xs text-slate-500">{s.signature?.fileId ? 'with signature image' : 'without signature image (space left for signing)'}</div>
    </div>
  );
}

/** Fields chosen at print time: signing officer(s), reference, appendix label and heading. */
function LetterFields({ value, onChange, kind = 'allotment' }: { value: LetterValue; onChange: (v: Partial<LetterValue>) => void; kind?: LetterKind }) {
  const notesKey = kind === 'allotment' ? 'allotmentNotes' : 'retentionNotes';
  const [standardNotes, setStandardNotes] = useState('');
  useEffect(() => {
    api<Record<string, string>>('/config')
      .then((c) => {
        setStandardNotes(c[notesKey] ?? '');
        if (value.notes === null) onChange({ notes: c[notesKey] ?? '' });
      })
      .catch(() => value.notes === null && onChange({ notes: '' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesKey]);
  const [list, setList] = useState<Signatory[] | null>(null);
  const [form, setForm] = useState<{ row: Signatory | null; target: 'signatoryId' | 'signatory2Id' } | null>(null);
  const toast = useToast();
  const confirm = useConfirm();
  // Signing officers are part of Settings: only an Administrator may add, edit or remove them.
  const { isAdmin } = useAuth();
  const canEdit = isAdmin;

  const removeImage = async (s: Signatory) => {
    const ok = await confirm({ title: 'Remove signature image', message: <>Remove the signature image of <b>{s.name}</b>? The officer stays in the list; letters will leave space for signing by hand.</>, confirmLabel: 'Remove Image', danger: true });
    if (!ok) return;
    try {
      await api(`/c/signatories/${s.id}`, { method: 'PUT', body: { signature: null } });
      toast.success(`Signature image of ${s.name} removed.`);
      await load({ id: s.id, target: String(s.id) === value.signatoryId ? 'signatoryId' : 'signatory2Id' });
    } catch (e) {
      toast.error(e);
    }
  };

  const removeOfficer = async (s: Signatory, target: 'signatoryId' | 'signatory2Id') => {
    const ok = await confirm({ title: 'Remove signing officer', message: <>Remove <b>{s.name}</b> ({s.designation}) from the list of signing officers? This cannot be undone.</>, confirmLabel: 'Remove Officer', danger: true });
    if (!ok) return;
    try {
      await api(`/c/signatories/${s.id}`, { method: 'DELETE' });
      toast.success(`${s.name} removed.`);
      onChange({ [target]: '' });
      await load();
    } catch (e) {
      toast.error(e);
    }
  };

  const load = async (select?: { id: number; target: 'signatoryId' | 'signatory2Id' }) => {
    try {
      const r = await api<Page<Signatory>>('/c/signatories', { query: { status: 'Active', pageSize: 'all' } });
      setList(r.rows);
      if (select) return onChange({ [select.target]: String(select.id) });
      if (!value.signatoryId || !r.rows.some((x) => String(x.id) === value.signatoryId)) {
        let last = '';
        try {
          last = localStorage.getItem(SIG_KEY) ?? '';
        } catch {
          /* ignore */
        }
        const pick = r.rows.find((x) => String(x.id) === last) ?? r.rows[0];
        if (pick) onChange({ signatoryId: String(pick.id) });
      }
    } catch (e) {
      toast.error(e);
      setList([]);
    }
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const opts = (list ?? []).map((x) => ({ value: String(x.id), label: `${x.name} — ${x.designation}${x.forLine ? `, ${x.forLine}` : ''}` }));
  const first = list?.find((x) => String(x.id) === value.signatoryId);
  const second = list?.find((x) => String(x.id) === value.signatory2Id);
  const link = 'text-sm font-semibold text-brand-700 hover:underline';
  const danger = 'text-sm font-semibold text-red-700 hover:underline';

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <Label htmlFor="sig" required>Signature Block (Signing Officer)</Label>
          {canEdit && (
            <span className="flex flex-wrap justify-end gap-x-3 gap-y-1">
              {first && <button type="button" className={link} onClick={() => setForm({ row: first, target: 'signatoryId' })}>Edit / add signature image</button>}
              {first?.signature?.fileId && <button type="button" className={danger} onClick={() => removeImage(first)}>Remove signature image</button>}
              {first && <button type="button" className={danger} onClick={() => removeOfficer(first, 'signatoryId')}>Remove officer</button>}
              <button type="button" className={link} onClick={() => setForm({ row: null, target: 'signatoryId' })}>+ Add Signing Officer</button>
            </span>
          )}
        </div>
        {list && list.length === 0 ? (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">No signing officer yet. {canEdit ? <>Click <b>+ Add Signing Officer</b>.</> : 'Ask an Administrator to add one in Settings → Signatories.'}</p>
        ) : (
          <Select id="sig" value={value.signatoryId} onChange={(v) => onChange({ signatoryId: v })} options={opts} placeholder={list ? 'Select signing officer' : 'Loading…'} />
        )}
        {first && <SigPreview s={first} />}
      </div>

      <div className="sm:col-span-2">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <Label htmlFor="sig2">Second Signature (optional, printed on the left)</Label>
          {canEdit && (
            <span className="flex flex-wrap justify-end gap-x-3 gap-y-1">
              {second && <button type="button" className={link} onClick={() => setForm({ row: second, target: 'signatory2Id' })}>Edit / add signature image</button>}
              {second?.signature?.fileId && <button type="button" className={danger} onClick={() => removeImage(second)}>Remove signature image</button>}
              {second && <button type="button" className={danger} onClick={() => removeOfficer(second, 'signatory2Id')}>Remove officer</button>}
              <button type="button" className={link} onClick={() => setForm({ row: null, target: 'signatory2Id' })}>+ Add Signing Officer</button>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Select id="sig2" value={value.signatory2Id} onChange={(v) => onChange({ signatory2Id: v })} options={opts.filter((o) => o.value !== value.signatoryId)} placeholder="None" />
          {second && <Button size="sm" icon={X} onClick={() => onChange({ signatory2Id: '' })}>Clear</Button>}
        </div>
        {second && <SigPreview s={second} />}
      </div>

      <div className="sm:col-span-2">
        <Label htmlFor="to">To (Addressee, optional)</Label>
        <textarea
          id="to"
          rows={3}
          className="input"
          placeholder={'One line per row, e.g.\nGarrison Engineer\nShillong Division\nShillong-793002'}
          value={value.addressee}
          onChange={(e) => onChange({ addressee: e.target.value })}
        />
      </div>
      <div>
        <Label htmlFor="ref">Reference (optional)</Label>
        <input id="ref" className="input" placeholder="e.g. In lieu of IAFD-931 dt 31 Jul 2026" value={value.reference} onChange={(e) => onChange({ reference: e.target.value })} />
      </div>
      <div>
        <Label htmlFor="appx">Appendix label (optional)</Label>
        <input id="appx" className="input" placeholder="e.g. Appx 'A'" value={value.appendix} onChange={(e) => onChange({ appendix: e.target.value })} />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="title" required>Heading</Label>
        <input id="title" className="input" value={value.title} onChange={(e) => onChange({ title: e.target.value })} />
      </div>
      <div className="sm:col-span-2">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <Label htmlFor="notes">Notes (one note per line – lettered (a), (b)… automatically)</Label>
          <span className="flex flex-wrap gap-x-3 gap-y-1">
            {value.notes !== null && value.notes !== standardNotes && (
              <button type="button" className={link} onClick={() => onChange({ notes: standardNotes })}>Reset to standard notes</button>
            )}
            {isAdmin && value.notes !== null && value.notes !== standardNotes && (
              <button
                type="button"
                className={link}
                onClick={async () => {
                  const ok = await confirm({ title: 'Save as standard notes', message: <>Use these notes on all future {kind === 'allotment' ? 'allotment' : 'retention / extension'} orders?</>, confirmLabel: 'Save' });
                  if (!ok) return;
                  try {
                    await api('/config', { method: 'PUT', body: { [notesKey]: value.notes } });
                    setStandardNotes(value.notes ?? '');
                    toast.success('Standard notes updated.');
                  } catch (e) {
                    toast.error(e);
                  }
                }}
              >
                Save as standard notes
              </button>
            )}
          </span>
        </div>
        <textarea
          id="notes"
          rows={7}
          className="input text-sm"
          placeholder={value.notes === null ? 'Loading…' : 'Leave empty to print without notes'}
          value={value.notes ?? ''}
          disabled={value.notes === null}
          onChange={(e) => onChange({ notes: e.target.value })}
        />
        <p className="mt-1 text-xs text-slate-500">Changes here apply to this printout only{isAdmin ? ' unless you save them as the standard notes' : ''}.</p>
      </div>
      <div>
        <Label htmlFor="encl">Enclosure (optional, one per line)</Label>
        <textarea id="encl" rows={3} className="input" placeholder={"e.g.\nAppx 'A' (01 sheet)"} value={value.enclosure} onChange={(e) => onChange({ enclosure: e.target.value })} />
      </div>
      <div>
        <Label htmlFor="copyto">Copy to (optional, one address per line)</Label>
        <textarea id="copyto" rows={3} className="input" placeholder={'e.g.\nGE Shillong – for info and necessary action\nBSO GE Shillong'} value={value.copyTo} onChange={(e) => onChange({ copyTo: e.target.value })} />
        <p className="mt-1 text-xs text-slate-500">Remembered for the next print.</p>
      </div>

      {form && (
        <FormModal
          title={form.row ? `Edit ${form.row.name}` : 'Add Signing Officer'}
          fields={signatoryFields}
          initial={form.row ?? { status: 'Active' }}
          isEdit={!!form.row}
          onClose={() => setForm(null)}
          onSubmit={async (v) => {
            const saved = await api<Signatory>(form.row ? `/c/signatories/${form.row.id}` : '/c/signatories', { method: form.row ? 'PUT' : 'POST', body: v });
            toast.success(form.row ? 'Signing officer updated.' : `${saved.name} added.`);
            const target = form.target;
            setForm(null);
            await load({ id: saved.id, target });
          }}
        />
      )}
    </div>
  );
}

/** Loads the chosen signatories and prints the allotment letter. */
async function printWith(kind: LetterKind, ids: number[], f: LetterValue, orderNo: string, date: string) {
  const [sig, sig2] = await Promise.all([
    api<Signatory>(`/c/signatories/${f.signatoryId}`),
    f.signatory2Id ? api<Signatory>(`/c/signatories/${f.signatory2Id}`) : Promise.resolve(null),
  ]);
  try {
    localStorage.setItem(SIG_KEY, f.signatoryId);
  } catch {
    /* ignore */
  }
  try {
    localStorage.setItem(COPY_KEY, f.copyTo);
  } catch {
    /* ignore */
  }
  await printOrderLetter(kind, ids, {
    orderNo, date, reference: f.reference.trim(), appendix: f.appendix.trim(), title: f.title.trim(), addressee: f.addressee.trim(),
    enclosure: f.enclosure.trim(), copyTo: f.copyTo.trim(), notes: f.notes ?? undefined, signatory: sig, signatory2: sig2,
  });
}

/** Print one order (allotment or retention / extension) in the standard letter format. */
export function PrintOrderModal({ row, onClose, kind = 'allotment' }: { row: Row; onClose: () => void; kind?: LetterKind }) {
  const toast = useToast();
  const isAllot = kind === 'allotment';
  const today = new Date().toISOString().slice(0, 10);
  const [busy, setBusy] = useState(false);
  const [orderNo, setOrderNo] = useState<string>(
    isAllot ? row.orderNo : `${row.caseType === 'Extension' ? 'EXT' : 'RET'}/${String(row.id).padStart(3, '0')}/${today.slice(0, 4)}`,
  );
  const [date, setDate] = useState<string>(isAllot ? row.allotmentDate : today);
  const [f, setF] = useState<LetterValue>(emptyLetter(isAllot ? defaultLetterTitle([row]) : defaultRetentionTitle(row.caseType, [])));
  return (
    <Modal
      title={isAllot ? `Print Allotment Order ${row.orderNo}` : `Print ${row.caseType} Order`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon={Printer}
            loading={busy}
            disabled={!f.signatoryId || !f.title.trim() || !orderNo.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await printWith(kind, [row.id], f, orderNo.trim(), date);
                onClose();
              } catch (e) {
                toast.error(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            Print
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-slate-700">
        {isAllot ? (
          <>{row.rank && row.rank !== 'Civilian' ? `${row.rank} ` : ''}{row.allotteeName} ({row.serviceNo}) — <QuarterText no={row.quarterNo} /> ({row.category})</>
        ) : (
          <>{row.name} ({row.serviceNo}) — <QuarterText no={row.quarterNo} /> · {row.caseType} {fmtDate(row.fromDate)} to {fmtDate(row.toDate)}{row.status !== 'Approved' && <b className="text-amber-700"> · {row.status}</b>}</>
        )}
      </p>
      {!isAllot && (
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <div><Label htmlFor="o-no" required>Order No.</Label><input id="o-no" className="input" value={orderNo} onChange={(e) => setOrderNo(e.target.value)} /></div>
          <div><Label htmlFor="o-date" required>Order Date</Label><input id="o-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
      )}
      <LetterFields kind={kind} value={f} onChange={(v) => setF((x) => ({ ...x, ...v }))} />
    </Modal>
  );
}

/** Record the take-over position of an allotment: occupied, deferment granted, or not taken over. */
export function OccupationModal({ row, mode, onClose, onDone }: { row: Row; mode: 'occupied' | 'defer' | 'notTaken'; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(mode === 'occupied' ? today : '');
  const [remarks, setRemarks] = useState('');
  const [action, setAction] = useState<string>(row.occAction || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (mode === 'notTaken' && !action) api<{ takeoverAction: string }>('/config').then((c) => setAction(c.takeoverAction)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const title = mode === 'occupied' ? 'Mark Taken Over / Occupied' : mode === 'defer' ? 'Grant Deferment of Take-over' : 'Record: Not Taken Over';
  const submit = async () => {
    if (mode !== 'notTaken' && !date) return setError(mode === 'occupied' ? 'Enter the take-over date.' : 'Enter the date up to which take-over is deferred.');
    if (mode === 'defer' && !remarks.trim()) return setError('Enter the reason for deferment.');
    if (mode === 'notTaken' && !action.trim()) return setError('Enter the action to be taken.');
    setBusy(true);
    setError('');
    try {
      const body =
        mode === 'occupied'
          ? { occupationStatus: 'Occupied', occupiedOn: date, occupationRemarks: remarks }
          : mode === 'defer'
            ? { occupationStatus: 'Deferment', deferredUpto: date, deferReason: remarks }
            : { occupationStatus: 'Not Taken Over', notTakenOverOn: today, sroAction: action.trim(), occupationRemarks: remarks };
      await api(`/c/allotments/${row.id}`, { method: 'PUT', body });
      toast.success(mode === 'occupied' ? `${row.quarterNo} marked as taken over.` : mode === 'defer' ? `Take-over deferred up to ${fmtDate(date)}.` : `${row.quarterNo} recorded as not taken over.`);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={mode === 'notTaken' ? 'danger' : 'primary'} icon={Save} loading={busy} onClick={submit}>Save</Button>
        </>
      }
    >
      <div className="mb-4 rounded-lg bg-slate-50 px-4 py-3 text-sm">
        <div className="font-semibold text-slate-900">{row.rank && row.rank !== 'Civilian' ? `${row.rank} ` : ''}{row.allotteeName} ({row.serviceNo})</div>
        <div className="text-slate-600">
          {row.orderNo} · <QuarterText no={row.quarterNo} /> ({row.category}) · allotted {fmtDate(row.allotmentDate)} · take-over due by <b>{fmtDate(row.occDeadline)}</b>
        </div>
      </div>
      {mode === 'occupied' && (
        <div className="mb-3">
          <Label htmlFor="occ-date" required>Taken over (occupied) on</Label>
          <input id="occ-date" type="date" className="input" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </div>
      )}
      {mode === 'defer' && (
        <>
          <p className="mb-3 text-sm text-slate-600">Deferment applied for by the individual on genuine grounds, as per the applicable Govt decision under SRO 308.</p>
          <div className="mb-3">
            <Label htmlFor="occ-defer" required>Take-over deferred up to</Label>
            <input id="occ-defer" type="date" className="input" value={date} min={today} onChange={(e) => setDate(e.target.value)} />
          </div>
        </>
      )}
      {mode === 'notTaken' && (
        <div className="mb-3">
          <Label htmlFor="occ-action" required>Action as per SRO 308</Label>
          <textarea id="occ-action" rows={3} className="input" value={action} onChange={(e) => setAction(e.target.value)} />
          <p className="mt-1 text-xs text-slate-500">To cancel the allotment, use <b>Cancel Allotment (Rule 7 (1))</b> after recording this.</p>
        </div>
      )}
      <Label htmlFor="occ-remarks" required={mode === 'defer'}>{mode === 'defer' ? 'Reason for deferment' : 'Remarks'}</Label>
      <textarea id="occ-remarks" rows={2} className="input" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      {error && <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
    </Modal>
  );
}

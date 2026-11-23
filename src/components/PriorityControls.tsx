import { useCallback, useEffect, useState } from 'react';
import { ListOrdered, Plus, Save, Trash2, Undo2 } from 'lucide-react';
import { api, type Row } from '../lib/api';
import { useAuth, useToast } from '../lib/context';
import { Button, Select, cx } from './ui';

/** One priority: applicants of this office (blank = any office) and this type (blank = any type). */
export type PriorityRule = { office: string; type: string };

export const PRIORITY_TYPES = [
  { value: 'Change of Accn', label: 'Change of Accn' },
  { value: 'Fresh', label: 'Fresh' },
];

const EVENT = 'awas-priority-rules';

/**
 * Priority rules are saved on the server, so the Seniority List, Quarter Allotment
 * and every computer use the same order. `version` changes whenever they are saved.
 */
export function usePriorityRules() {
  const [rules, setRules] = useState<PriorityRule[] | null>(null);
  const [version, setVersion] = useState(0);
  const load = useCallback(() => {
    api<{ priorityRules?: PriorityRule[] }>('/config')
      .then((c) => setRules(Array.isArray(c.priorityRules) ? c.priorityRules : []))
      .catch(() => setRules([]));
  }, []);
  useEffect(() => {
    load();
    const h = () => (load(), setVersion((v) => v + 1));
    window.addEventListener(EVENT, h);
    return () => window.removeEventListener(EVENT, h);
  }, [load]);
  const save = async (next: PriorityRule[]) => {
    await api('/priority-rules', { method: 'PUT', body: { rules: next } });
    window.dispatchEvent(new Event(EVENT));
  };
  return { rules, version, save };
}

export const ruleLabel = (r: PriorityRule) => `${r.office || 'Any office'} · ${r.type || 'Any type'}`;

/** One-line description of the order in force, for page notes and printouts. */
export const priorityText = (rules: PriorityRule[] | null) =>
  rules?.length ? `${rules.map((r, i) => `P${i + 1} ${ruleLabel(r)}`).join(' → ')} → P${rules.length + 1} Others` : 'Seniority only (date of enrolment)';

export function PriorityControls({ rules, onSave, className }: { rules: PriorityRule[] | null; onSave: (r: PriorityRule[]) => Promise<void>; className?: string }) {
  // Only the Administrator sets the allotment priority; everyone else sees it read-only.
  const { isAdmin: canEdit } = useAuth();
  const toast = useToast();
  const [draft, setDraft] = useState<PriorityRule[]>([]);
  const [offices, setOffices] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(rules ?? []), [rules]);
  useEffect(() => {
    // Offices as entered on applications (Applicant Register / New Application), so the match is exact.
    api<string[]>('/offices').then(setOffices).catch(() => setOffices([]));
  }, []);

  const dirty = JSON.stringify(draft) !== JSON.stringify(rules ?? []);
  const setRow = (i: number, patch: Partial<PriorityRule>) => setDraft((d) => d.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const moveTo = (from: number, to: number) =>
    setDraft((d) => {
      const n = [...d];
      const [r] = n.splice(from, 1);
      n.splice(to, 0, r);
      return n;
    });
  const dupes = new Set(draft.map((r, i) => (draft.findIndex((x) => x.office.toLowerCase() === r.office.toLowerCase() && x.type === r.type) < i ? i : -1)).filter((i) => i >= 0));

  const save = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      toast.success(draft.length ? 'Priority order saved. Seniority List and Quarter Allotment now use it.' : 'Priority cleared: seniority only.');
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  };

  const officeOpts = [...new Set([...offices, ...draft.map((r) => r.office).filter(Boolean)])].sort();

  return (
    <div className={cx('rounded-xl border border-violet-200 bg-gradient-to-r from-violet-50 via-white to-amber-50 px-4 py-3', className)}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 font-bold text-violet-800">
          <ListOrdered className="size-4" /> Priority Order for Allotment
          <span className="text-xs font-medium text-slate-500">(same on Seniority List and Quarter Allotment)</span>
        </h3>
        {canEdit && (
          <div className="flex gap-2">
            <Button size="sm" icon={Plus} onClick={() => setDraft((d) => [...d, { office: '', type: '' }])} disabled={draft.length >= 20}>Add Priority</Button>
            {dirty && <Button size="sm" icon={Undo2} onClick={() => setDraft(rules ?? [])}>Undo</Button>}
            <Button size="sm" variant="primary" icon={Save} loading={saving} disabled={!dirty || dupes.size > 0} onClick={save}>Save Priority</Button>
          </div>
        )}
      </div>

      {rules === null ? (
        <div className="h-9 animate-pulse rounded bg-slate-100" />
      ) : !draft.length ? (
        <p className="text-sm text-slate-600">
          No priority set: applicants are ranked by <b>seniority only</b> (date of enrolment in service).
          {canEdit && <> Click <b>Add Priority</b> to put e.g. your own office's Change of Accn first.</>}
        </p>
      ) : (
        <div className="space-y-2">
          <div className="hidden grid-cols-[140px_1fr_1fr_40px] gap-2 px-1 text-xs font-semibold text-slate-600 sm:grid">
            <span>Priority</span><span>Office</span><span>Type of Priority</span><span />
          </div>
          {draft.map((r, i) => (
            <div key={i} className={cx('grid items-center gap-2 rounded-lg sm:grid-cols-[140px_1fr_1fr_40px]', dupes.has(i) && 'ring-2 ring-red-300')}>
              <Select
                id={`prio-${i}`}
                value={String(i)}
                disabled={!canEdit}
                onChange={(v) => moveTo(i, Number(v))}
                options={draft.map((_, j) => ({ value: String(j), label: `Priority ${j + 1}` }))}
              />
              <Select id={`prio-office-${i}`} value={r.office} disabled={!canEdit} onChange={(v) => setRow(i, { office: v })} options={officeOpts} placeholder="Any office" />
              <Select id={`prio-type-${i}`} value={r.type} disabled={!canEdit} onChange={(v) => setRow(i, { type: v })} options={PRIORITY_TYPES} placeholder="Any type (Change & Fresh)" />
              {canEdit ? (
                <button type="button" className="grid size-9 place-items-center rounded-lg text-red-600 hover:bg-red-50" aria-label={`Remove priority ${i + 1}`} onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}>
                  <Trash2 className="size-4" />
                </button>
              ) : <span />}
            </div>
          ))}
          <div className="grid items-center gap-2 sm:grid-cols-[140px_1fr]">
            <span className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-600">Priority {draft.length + 1}</span>
            <span className="text-sm text-slate-600">All other applicants</span>
          </div>
          {dupes.size > 0 && <p className="text-sm font-semibold text-red-600">A highlighted priority repeats an earlier one. Change or remove it.</p>}
        </div>
      )}
      <p className="mt-2 text-xs text-slate-600">
        {!canEdit && <b>Set by the Administrator (Settings → Allotment Priority). </b>}
        Each applicant goes into the first priority they match. Within each priority, seniority is by <b>date of enrolment in service</b> (earliest first), then date of application.
        {dirty && <b className="text-amber-700"> Unsaved changes — click Save Priority to apply.</b>}
      </p>
    </div>
  );
}

export function PriorityChip({ row }: { row: Row }) {
  if (!row.priorityLabel) return null;
  const tones = ['bg-emerald-100 text-emerald-800', 'bg-sky-100 text-sky-800', 'bg-amber-100 text-amber-800', 'bg-violet-100 text-violet-800', 'bg-pink-100 text-pink-800'];
  const tone = String(row.priorityLabel).endsWith('Others') ? 'bg-slate-200 text-slate-700' : tones[(Number(row.priorityGroup) - 1) % tones.length];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${tone}`}>{row.priorityLabel}</span>;
}

/** The shared priority panel for a list page: saving it (here or on another page) reloads that page's list. */
export function PriorityPanel({ onChanged, className }: { onChanged: () => void; className?: string }) {
  const prio = usePriorityRules();
  useEffect(() => {
    if (prio.version) onChanged();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prio.version]);
  return <PriorityControls rules={prio.rules} onSave={prio.save} className={className} />;
}

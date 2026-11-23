import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Plus, Save, Trash2, UserPlus, Users } from 'lucide-react';
import { api, type Page, type Row } from '../lib/api';
import { useMasters, useToast } from '../lib/context';
import { isoDate } from '../lib/format';
import { FieldInput, type FieldDef } from './Form';

type Values = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
import { Button, Label, Modal, Select, cx } from './ui';

type Line = {
  quarterNo: string;
  mode: 'app' | 'new';
  applicationNo: string;
  person: { name: string; rank: string; serviceNo: string; officeName: string; trade: string; payLevel: string; entitlement: string };
  orderNo: string;
  allotmentDate: string;
  occupiedOn: string;
  boardRemarks: string;
};
const blankLine = (date: string): Line => ({
  quarterNo: '', mode: 'app', applicationNo: '', orderNo: '', allotmentDate: date, occupiedOn: '', boardRemarks: '',
  person: { name: '', rank: '', serviceNo: '', officeName: '', trade: '', payLevel: '', entitlement: '' },
});

const F: Record<string, FieldDef> = {
  proceedingsNo: { name: 'pb-no', label: 'Proceedings No.', placeholder: 'As written on the board (auto if blank)' },
  proceedingsDate: { name: 'pb-date', label: 'Date of Board', type: 'date', required: true },
  authority: { name: 'pb-auth', label: 'Authority for Proceedings', required: true, placeholder: 'e.g. Convening order No. 8765 dated 01-Oct-2026' },
  presidingOfficer: { name: 'pb-po', label: 'Presiding Officer', required: true, placeholder: 'Rank and name' },
  members: { name: 'pb-members', label: 'Members', type: 'list', required: true, addLabel: 'Add Member', placeholder: 'Rank and name of member' },
  document: { name: 'pb-doc', label: 'Signed Board Proceedings (PDF / scan)', type: 'file', required: true },
  remarks: { name: 'pb-remarks', label: 'Remarks / Decisions', type: 'textarea', rows: 3 },
};

const rankName = (r: Row) => `${r.rank && r.rank !== 'Civilian' ? `${r.rank} ` : ''}${r.name}`;

/** Record an allotment board already held, with its signed PDF; its allotments update every page. */
export function PastBoardModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { masters } = useMasters();
  const [p, setP] = useState<Values>({ proceedingsDate: isoDate(), members: [''] });
  const [lines, setLines] = useState<Line[]>([blankLine(isoDate())]);
  const [vacant, setVacant] = useState<Row[]>([]);
  const [apps, setApps] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ no: string; n: number } | null>(null);

  useEffect(() => {
    Promise.all([
      api<Page>('/c/quarters', { query: { status: 'Vacant', pageSize: 'all', sort: 'quarterNo' } }),
      api<Page>('/c/applications', { query: { in_status: 'Pending,Scrutiny,Eligible,Recommended', pageSize: 'all', sort: 'name', dir: 'asc' } }),
    ])
      .then(([q, a]) => (setVacant(q.rows), setApps(a.rows)))
      .catch(toast.error);
  }, [toast]);

  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const setPerson = (i: number, patch: Partial<Line['person']>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, person: { ...l.person, ...patch } } : l)));
  const usedQ = useMemo(() => new Set(lines.map((l) => l.quarterNo).filter(Boolean)), [lines]);
  const usedA = useMemo(() => new Set(lines.map((l) => l.applicationNo).filter(Boolean)), [lines]);

  const save = async () => {
    setError('');
    const members = (Array.isArray(p.members) ? p.members : []).map((m: string) => String(m).trim()).filter(Boolean);
    const missing = [
      !p.proceedingsDate && 'Date of Board', !String(p.authority ?? '').trim() && 'Authority', !String(p.presidingOfficer ?? '').trim() && 'Presiding Officer',
      !members.length && 'Members', !p.document?.fileId && 'Signed Board Proceedings (PDF)',
    ].filter(Boolean);
    if (missing.length) return setError(`Required: ${missing.join(', ')}.`);
    const used = lines.filter((l) => l.quarterNo || l.applicationNo || l.person.name || l.person.serviceNo);
    for (const [i, l] of used.entries()) {
      if (!l.quarterNo) return setError(`Allotment ${i + 1}: select the quarter.`);
      if (l.mode === 'app' && !l.applicationNo) return setError(`Allotment ${i + 1}: select the applicant, or choose "Not in system".`);
      if (l.mode === 'new' && (!l.person.name.trim() || !l.person.serviceNo.trim())) return setError(`Allotment ${i + 1}: enter the allottee's name and service no.`);
    }
    setBusy(true);
    try {
      const r = await api<{ proceedings: Row; created: number }>('/proceedings/past-board', {
        method: 'POST',
        body: {
          proceedings: { ...p, members },
          allotments: used.map((l) => ({
            quarterNo: l.quarterNo, orderNo: l.orderNo, allotmentDate: l.allotmentDate || p.proceedingsDate, occupiedOn: l.occupiedOn, boardRemarks: l.boardRemarks,
            ...(l.mode === 'app' ? { applicationNo: l.applicationNo } : { person: l.person }),
          })),
        },
      });
      setDone({ no: r.proceedings.proceedingsNo, n: r.created });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (done)
    return (
      <Modal title="Past Board Recorded" onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
        <div className="flex items-start gap-3">
          <CheckCircle2 className="size-8 shrink-0 text-green-600" />
          <div className="space-y-1 text-sm">
            <p className="text-base font-semibold">Board {done.no} saved with its signed PDF.</p>
            {done.n > 0 ? (
              <p>
                {done.n} allotment(s) created. The quarters are now <b>Occupied</b> in the Quarter Register, the applicants are <b>Allotted</b> (and off the Seniority List),
                and the allotments appear in Quarter Allotment, Quarter Occupation and Allotment Orders.
              </p>
            ) : (
              <p>No allotments were entered; you can link existing allotments later with Edit.</p>
            )}
            <p className="text-slate-600">The PDF is also in Reports &amp; Returns → Download Documents → Board Proceedings.</p>
          </div>
        </div>
      </Modal>
    );

  const field = (k: keyof typeof F, span = '') => (
    <div className={span}>
      <Label htmlFor={F[k].name} required={F[k].required}>{F[k].label}</Label>
      <FieldInput field={F[k]} value={p[k]} onChange={(v) => setP((x) => ({ ...x, [k]: v }))} />
    </div>
  );

  return (
    <Modal
      title="Record Past Allotment Board"
      wide
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Save} loading={busy} onClick={save}>Save Board</Button>
        </>
      }
    >
      <p className="mb-3 rounded-lg bg-violet-50 px-3 py-2 text-sm text-violet-900">
        Enter an allotment board that has already been held, attach its <b>signed proceedings (PDF)</b>, and list the allotments it decided.
        Saving updates every page: Quarter Register, Applicant Register, Seniority List, Quarter Allotment, Quarter Occupation, Allotment Orders and Dashboard.
      </p>

      <h3 className="mb-2 font-bold text-brand-700">1. Board Details</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {field('proceedingsNo')}
        {field('proceedingsDate')}
        {field('authority', 'sm:col-span-2')}
        {field('presidingOfficer', 'sm:col-span-2')}
        {field('members', 'sm:col-span-2')}
        {field('document', 'sm:col-span-2')}
        {field('remarks', 'sm:col-span-2')}
      </div>

      <div className="mt-5 mb-2 flex items-center justify-between">
        <h3 className="font-bold text-brand-700">2. Allotments Decided by the Board</h3>
        <Button size="sm" icon={Plus} onClick={() => setLines((l) => [...l, blankLine(String(p.proceedingsDate || isoDate()))])}>Add Allotment</Button>
      </div>
      <p className="mb-2 text-xs text-slate-600">Only quarters that are vacant now are listed. If an allottee has no application in the system, choose <b>Not in system</b> and enter their details; an application is created for them.</p>

      <div className="space-y-3">
        {lines.map((l, i) => {
          const q = vacant.find((x) => x.quarterNo === l.quarterNo);
          const app = apps.find((x) => x.applicationNo === l.applicationNo);
          const entitled = app ? app.entitlement || app.categoryRequested : l.person.entitlement;
          const above = q && entitled && q.category !== entitled;
          return (
            <div key={i} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="rounded-full bg-brand-700 px-2.5 py-0.5 text-xs font-bold text-white">Allotment {i + 1}</span>
                <button type="button" className="text-red-600 hover:text-red-800" aria-label={`Remove allotment ${i + 1}`} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                  <Trash2 className="size-4" />
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <Label htmlFor={`pb-q-${i}`} required>Quarter</Label>
                  <Select
                    id={`pb-q-${i}`}
                    value={l.quarterNo}
                    onChange={(v) => setLine(i, { quarterNo: v })}
                    placeholder="Select vacant quarter"
                    options={vacant.filter((x) => x.quarterNo === l.quarterNo || !usedQ.has(x.quarterNo)).map((x) => ({ value: x.quarterNo, label: `${x.quarterNo} · ${x.category} · ${x.station}${x.location ? ` · ${x.location}` : ''}` }))}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label>Allottee</Label>
                  <div className="mb-1.5 flex gap-1.5">
                    {(['app', 'new'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setLine(i, { mode: m })}
                        className={cx('flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold', l.mode === m ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white text-slate-700')}
                      >
                        {m === 'app' ? <Users className="size-3.5" /> : <UserPlus className="size-3.5" />}
                        {m === 'app' ? 'Applicant in system' : 'Not in system'}
                      </button>
                    ))}
                  </div>
                  {l.mode === 'app' ? (
                    <Select
                      id={`pb-a-${i}`}
                      value={l.applicationNo}
                      onChange={(v) => setLine(i, { applicationNo: v })}
                      placeholder="Select applicant"
                      options={apps
                        .filter((x) => x.applicationNo === l.applicationNo || !usedA.has(x.applicationNo))
                        .map((x) => ({ value: x.applicationNo, label: `${rankName(x)} (${x.serviceNo}) · ${x.officeName || '—'} · ${x.entitlement || x.categoryRequested} · ${x.status}` }))}
                    />
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-3">
                      <input className="input" placeholder="Name *" value={l.person.name} onChange={(e) => setPerson(i, { name: e.target.value })} />
                      <input className="input" placeholder="Service No. *" value={l.person.serviceNo} onChange={(e) => setPerson(i, { serviceNo: e.target.value })} />
                      <Select id={`pb-r-${i}`} value={l.person.rank} onChange={(v) => setPerson(i, { rank: v })} options={masters.ranks ?? []} placeholder="Rank" />
                      <Select id={`pb-off-${i}`} value={l.person.officeName} onChange={(v) => setPerson(i, { officeName: v })} options={masters.offices ?? []} placeholder="Office Name" />
                      <Select id={`pb-pl-${i}`} value={l.person.payLevel} onChange={(v) => setPerson(i, { payLevel: v })} options={masters.payLevels ?? []} placeholder="Pay Level" />
                      <Select id={`pb-e-${i}`} value={l.person.entitlement} onChange={(v) => setPerson(i, { entitlement: v })} options={masters.categories ?? []} placeholder="Entitlement" />
                    </div>
                  )}
                </div>
                <div>
                  <Label htmlFor={`pb-o-${i}`}>Allotment Order No.</Label>
                  <input id={`pb-o-${i}`} className="input" placeholder="Auto if blank" value={l.orderNo} onChange={(e) => setLine(i, { orderNo: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor={`pb-d-${i}`}>Allotment Date</Label>
                  <input id={`pb-d-${i}`} type="date" className="input" value={l.allotmentDate} onChange={(e) => setLine(i, { allotmentDate: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor={`pb-t-${i}`}>Taken Over On (if already)</Label>
                  <input id={`pb-t-${i}`} type="date" className="input" value={l.occupiedOn} onChange={(e) => setLine(i, { occupiedOn: e.target.value })} />
                </div>
                <div className="sm:col-span-3">
                  <input className="input" placeholder="Remarks by the Board for this allotment" value={l.boardRemarks} onChange={(e) => setLine(i, { boardRemarks: e.target.value })} />
                </div>
              </div>
              {above && (
                <p className="mt-2 text-xs font-semibold text-amber-700">
                  {q.category} is not the allottee's entitlement ({entitled}). Take an Undertaking Certificate (Download Documents → Blank Forms).
                </p>
              )}
            </div>
          );
        })}
        {!lines.length && <p className="text-sm text-slate-500">No allotments. Click Add Allotment, or save the board on its own.</p>}
      </div>
      {error && <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
    </Modal>
  );
}

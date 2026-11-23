import { useEffect, useMemo, useState } from 'react';
import { Archive, FileText, FolderDown, FolderOpen, Inbox, Loader2, Printer } from 'lucide-react';
import { api, getToken, ApiError } from '../lib/api';
import { useMasters, useToast } from '../lib/context';
import { printBlankApplication, printUndertaking } from '../lib/printApplication';
import { Badge, Button, Card, Label, Select, cx } from '../components/ui';

type DlFile = { fileId: string; name: string };
type DlItem = { id: number; folder: string; label: string; detail: string; status: string; officeName: string; files: DlFile[] };
type Kind = 'applications' | 'policies' | 'retentions' | 'proceedings' | 'forms';

const KINDS: { key: Kind; label: string }[] = [
  { key: 'applications', label: 'Applicant Documents' },
  { key: 'policies', label: 'Policy Documents' },
  { key: 'retentions', label: 'Retention / Extension Documents' },
  { key: 'proceedings', label: 'Board Proceedings' },
  { key: 'forms', label: 'Blank Forms' },
];
const STATUS_GROUPS: Record<string, string[]> = {
  'Pending scrutiny': ['Pending', 'Scrutiny'],
  'Accepted (Eligible / Recommended)': ['Eligible', 'Recommended'],
  Rejected: ['Rejected'],
  Allotted: ['Allotted'],
};

// The File System Access API (Chrome / Edge) lets us create real folders on this computer.
type DirHandle = {
  getDirectoryHandle: (name: string, o: { create: boolean }) => Promise<DirHandle>;
  getFileHandle: (name: string, o: { create: boolean }) => Promise<{ createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }> }>;
};
const pickDirectory = (window as unknown as { showDirectoryPicker?: (o: object) => Promise<DirHandle> }).showDirectoryPicker;

async function fetchFile(fileId: string): Promise<Blob> {
  const res = await fetch(`/api/uploads/${fileId}`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new ApiError('A document could not be downloaded.', res.status);
  return res.blob();
}

export default function Downloads() {
  const toast = useToast();
  const [kind, setKind] = useState<Kind>('applications');
  const [data, setData] = useState<{ root: string; items: DlItem[] } | null>(null);
  const [status, setStatus] = useState('');
  const [office, setOffice] = useState('');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<'' | 'zip' | 'folder'>('');
  const [progress, setProgress] = useState('');

  useEffect(() => {
    setData(null);
    setStatus('');
    setOffice('');
    setQ('');
    if (kind === 'forms') return;
    api<{ root: string; items: DlItem[] }>(`/downloads/${kind}`).then(setData).catch((e) => (toast.error(e), setData({ root: '', items: [] })));
  }, [kind, toast]);

  const offices = useMemo(() => [...new Set((data?.items ?? []).map((i) => i.officeName).filter(Boolean))].sort(), [data]);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.items ?? []).filter(
      (i) =>
        (!status || STATUS_GROUPS[status].includes(i.status)) &&
        (!office || i.officeName === office) &&
        (!needle || `${i.label} ${i.detail}`.toLowerCase().includes(needle)),
    );
  }, [data, status, office, q]);
  useEffect(() => setPicked(new Set(list.map((i) => i.id))), [list]);

  const chosen = list.filter((i) => picked.has(i.id));
  const fileCount = chosen.reduce((n, i) => n + i.files.length, 0);
  const rootName = `${data?.root ?? 'Documents'} ${new Date().toISOString().slice(0, 10)}`;

  const downloadZip = async () => {
    setBusy('zip');
    try {
      const res = await fetch(`/api/downloads/${kind}/zip`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: chosen.map((i) => i.id) }),
      });
      if (!res.ok) throw new ApiError((await res.json().catch(() => null))?.error ?? 'Download failed.', res.status);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `${rootName}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.success(`${rootName}.zip saved to your Downloads folder (${chosen.length} folder(s), ${fileCount} file(s)).`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy('');
    }
  };

  const saveToFolder = async () => {
    if (!pickDirectory) return;
    let dir: DirHandle;
    try {
      dir = await pickDirectory({ mode: 'readwrite', startIn: 'downloads' });
    } catch {
      return; // cancelled
    }
    setBusy('folder');
    try {
      const root = await dir.getDirectoryHandle(rootName, { create: true });
      let done = 0;
      for (const item of chosen) {
        const sub = await root.getDirectoryHandle(item.folder, { create: true });
        for (const f of item.files) {
          setProgress(`${++done} / ${fileCount}`);
          const blob = await fetchFile(f.fileId);
          const w = await (await sub.getFileHandle(f.name, { create: true })).createWritable();
          await w.write(blob);
          await w.close();
        }
      }
      toast.success(`Saved ${fileCount} file(s) into "${rootName}", one folder per ${kind === 'policies' ? 'policy' : kind === 'proceedings' ? 'board' : 'person'}.`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy('');
      setProgress('');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="tablist">
        {KINDS.map((k) => (
          <button
            key={k.key}
            role="tab"
            aria-selected={kind === k.key}
            onClick={() => setKind(k.key)}
            className={cx('rounded-full border px-4 py-1.5 text-sm font-semibold', kind === k.key ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-brand-50')}
          >
            {k.key === 'forms' && <FolderOpen className="mr-1.5 -mt-0.5 inline size-4" />}
            {k.label}
          </button>
        ))}
      </div>

      {kind === 'forms' ? (
        <BlankForms />
      ) : (
      <>
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          {kind === 'applications' && (
            <>
              <div className="w-64">
                <Label htmlFor="dl-status">Applications</Label>
                <Select id="dl-status" value={status} onChange={setStatus} options={Object.keys(STATUS_GROUPS)} placeholder="All applications" />
              </div>
              <div className="w-56">
                <Label htmlFor="dl-office">Office</Label>
                <Select id="dl-office" value={office} onChange={setOffice} options={offices} placeholder="All offices" />
              </div>
            </>
          )}
          <div className="min-w-56 flex-1">
            <Label htmlFor="dl-q">Search</Label>
            <input id="dl-q" className="input" placeholder={kind === 'policies' ? 'Policy name' : 'Name, service no. or application no.'} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" icon={Archive} loading={busy === 'zip'} disabled={!fileCount || !!busy} onClick={downloadZip}>
              Download ZIP ({fileCount} files)
            </Button>
            {pickDirectory && (
              <Button icon={busy === 'folder' ? Loader2 : FolderDown} disabled={!fileCount || !!busy} onClick={saveToFolder} className={cx(busy === 'folder' && '[&_svg]:animate-spin')}>
                {busy === 'folder' ? `Saving ${progress}` : 'Save into a Folder…'}
              </Button>
            )}
          </div>
        </div>
        <p className="mt-3 text-sm text-slate-600">
          <b>Download ZIP</b> saves one file, <i>{rootName}.zip</i>, to your Downloads folder; open it to find one folder per {kind === 'policies' ? 'policy' : kind === 'proceedings' ? 'board' : 'person'} with their documents.
          {pickDirectory ? (
            <> <b>Save into a Folder</b> asks you to pick a folder (e.g. Downloads) and creates the folders there directly, without a ZIP.</>
          ) : (
            <> (Saving straight into folders without a ZIP needs Chrome or Edge.)</>
          )}
        </p>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between bg-brand-50 px-4 py-2 text-sm">
          <span className="font-bold text-brand-800">
            {chosen.length} of {list.length} selected · {fileCount} file(s)
          </span>
          <span className="flex gap-3">
            <button type="button" className="font-semibold text-brand-700 hover:underline" onClick={() => setPicked(new Set(list.map((i) => i.id)))}>Select all</button>
            <button type="button" className="font-semibold text-brand-700 hover:underline" onClick={() => setPicked(new Set())}>Clear</button>
          </span>
        </div>
        {data === null ? (
          <p className="px-4 py-6 text-sm text-slate-500">Loading…</p>
        ) : !list.length ? (
          <p className="px-4 py-10 text-center text-slate-500">
            <Inbox className="mx-auto mb-2 size-8 opacity-50" />
            {data.items.length ? 'Nothing matches these filters.' : 'No documents have been uploaded here yet.'}
          </p>
        ) : (
          <ul className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto">
            {list.map((i) => (
              <li key={i.id}>
                <label className="flex cursor-pointer items-start gap-3 px-4 py-2.5 hover:bg-brand-50">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 accent-brand-700"
                    checked={picked.has(i.id)}
                    onChange={() => setPicked((s) => { const n = new Set(s); if (n.has(i.id)) n.delete(i.id); else n.add(i.id); return n; })}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-900">{i.label}</span>
                      <Badge status={i.status} />
                      {i.officeName && <span className="text-sm text-slate-500">{i.officeName}</span>}
                    </div>
                    <div className="text-xs text-slate-500">{i.detail}</div>
                    <div className="mt-1 flex items-start gap-1.5 text-xs text-slate-600">
                      <FolderOpen className="mt-px size-3.5 shrink-0 text-amber-600" />
                      <span><b>{i.folder}</b> / {i.files.map((f) => f.name).join(' · ')}</span>
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 text-xs font-semibold text-slate-700">{i.files.length} file(s)</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </Card>
      </>
      )}
    </div>
  );
}

/** Blank formats that can be printed and handed to an individual to fill in and apply. */
function BlankForms() {
  const toast = useToast();
  const { masters } = useMasters();
  const forms = [
    {
      title: 'New Application Form',
      detail: 'Application for Government Married Accommodation — fresh allotment or change of accommodation. One A4 page, with tick boxes and space to fill in by hand.',
      print: () => printBlankApplication(masters),
    },
    {
      title: 'Undertaking Certificate',
      detail: 'To vacate on demand — for an allottee given a quarter above entitlement, or an allottee from another office (to vacate when an own-office applicant needs it, even if entitled). Signed by two witnesses and countersigned by the Officer Commanding.',
      print: printUndertaking,
    },
  ];
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 bg-brand-50 px-4 py-2 text-sm font-bold text-brand-800">
        <FolderOpen className="size-4 text-amber-600" /> Blank Forms
      </div>
      <ul className="divide-y divide-slate-100">
        {forms.map((f) => (
          <li key={f.title} className="flex flex-wrap items-center gap-4 px-4 py-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md">
              <FileText className="size-5" />
            </span>
            <div className="min-w-60 flex-1">
              <div className="font-semibold text-slate-900">{f.title}</div>
              <div className="text-sm text-slate-600">{f.detail}</div>
            </div>
            <Button variant="primary" icon={Printer} onClick={() => f.print().catch(toast.error)}>Print Blank Form</Button>
          </li>
        ))}
      </ul>
      <p className="border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">
        Tip: in the print window choose <b>Save as PDF</b> to keep a copy you can email or share.
      </p>
    </Card>
  );
}

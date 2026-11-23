import { useCallback, useEffect, useRef, useState } from 'react';
import { ArchiveRestore, CalendarClock, DatabaseBackup, Download, FolderOpen, HardDriveDownload, Loader2, RotateCcw, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { api, getToken, ApiError } from '../lib/api';
import { useAuth, useToast } from '../lib/context';
import { fmtDateTime } from '../lib/format';
import { Button, Card, IconButton, PageHeader, cx, useConfirm } from '../components/ui';

type Backup = { name: string; kind: 'Manual' | 'Automatic' | 'Before Restore'; createdAt: string; size: number; records?: number; documents?: number };
type Restored = { safety: Backup; records: number; documents: number };

const size = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const KIND_TONE: Record<Backup['kind'], string> = {
  Manual: 'bg-blue-100 text-blue-800',
  Automatic: 'bg-emerald-100 text-emerald-800',
  'Before Restore': 'bg-amber-100 text-amber-800',
};

async function saveFile(url: string, name: string) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new ApiError((await res.json().catch(() => null))?.error ?? 'Download failed.', res.status);
  const href = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

export default function BackupPage() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState<{ folder: string; backups: Backup[] } | null>(null);
  const [busy, setBusy] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api<{ folder: string; backups: Backup[] }>('/backups').then(setData).catch((e) => (toast.error(e), setData({ folder: '', backups: [] })));
  }, [toast]);
  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  if (!isAdmin)
    return (
      <Card className="p-8 text-center text-slate-600">
        <ShieldCheck className="mx-auto mb-2 size-8 text-brand-700" />
        Backup &amp; Restore is available to the Administrator only.
      </Card>
    );

  const create = async (download: boolean) => {
    setBusy(download ? 'download' : 'create');
    try {
      const b = await api<Backup>('/backups', { method: 'POST' });
      if (download) await saveFile(`/api/backups/${encodeURIComponent(b.name)}/download`, b.name);
      toast.success(download ? `${b.name} saved to your Downloads folder.` : `Backup created: ${b.name}`);
      load();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy('');
    }
  };

  /** After a restore the data (including users) has changed, so the app starts afresh. */
  const finishRestore = (r: Restored) => {
    toast.success(`Restored ${r.records} records and ${r.documents} documents. A copy of the previous data was kept as ${r.safety.name}. The app will now reload.`);
    setTimeout(() => window.location.reload(), 2500);
  };

  const askRestore = (what: React.ReactNode) =>
    confirm({
      title: 'Restore backup',
      message: (
        <>
          Replace <b>all current data</b> (quarters, applications, allotments, users, settings and documents) with {what}?
          <br />
          <br />A <b>“Before Restore”</b> backup of the current data is taken automatically first, so this can be undone. Everyone will need to sign in again.
        </>
      ),
      confirmLabel: 'Restore',
      danger: true,
    });

  const restoreSaved = async (b: Backup) => {
    if (!(await askRestore(<>the backup of <b>{fmtDateTime(b.createdAt)}</b></>))) return;
    setBusy(b.name);
    try {
      finishRestore(await api<Restored>(`/backups/${encodeURIComponent(b.name)}/restore`, { method: 'POST' }));
    } catch (e) {
      toast.error(e);
      setBusy('');
    }
  };

  const restoreFile = async (f: File) => {
    if (!(await askRestore(<>the backup file <b>{f.name}</b></>))) return;
    setBusy('file');
    try {
      const res = await fetch('/api/backups/restore-file', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/zip' },
        body: f,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(body?.error ?? 'Restore failed.', res.status);
      finishRestore(body as Restored);
    } catch (e) {
      toast.error(e);
      setBusy('');
    }
  };

  const remove = async (b: Backup) => {
    if (!(await confirm({ title: 'Delete backup', message: <>Delete the backup of <b>{fmtDateTime(b.createdAt)}</b>? This cannot be undone.</>, confirmLabel: 'Delete', danger: true }))) return;
    try {
      await api(`/backups/${encodeURIComponent(b.name)}`, { method: 'DELETE' });
      toast.success('Backup deleted.');
      load();
    } catch (e) {
      toast.error(e);
    }
  };

  const last = data?.backups[0];
  const lastAuto = data?.backups.find((b) => b.kind === 'Automatic');

  return (
    <div className="space-y-4">
      <PageHeader icon={DatabaseBackup} title="Backup & Restore" subtitle="Keep a safe copy of all data and documents, and restore it when needed — works fully offline" />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-1 flex items-center gap-2 text-lg font-bold text-brand-700"><HardDriveDownload className="size-5" /> Create Backup</h2>
          <p className="mb-4 text-sm text-slate-600">
            One ZIP file with <b>all data</b> (quarters, applications, allotments, proceedings, users, settings) and <b>all uploaded documents</b>.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" icon={Download} loading={busy === 'download'} disabled={!!busy} onClick={() => create(true)}>Backup &amp; Download</Button>
            <Button icon={DatabaseBackup} loading={busy === 'create'} disabled={!!busy} onClick={() => create(false)}>Backup on this Computer</Button>
          </div>
          <p className="mt-3 text-xs text-slate-500">Tip: copy the downloaded file to a pen drive or another computer, so the data is safe even if this computer fails.</p>
        </Card>

        <Card className="p-5">
          <h2 className="mb-1 flex items-center gap-2 text-lg font-bold text-brand-700"><ArchiveRestore className="size-5" /> Restore from a File</h2>
          <p className="mb-4 text-sm text-slate-600">
            Choose an AWAS backup ZIP (e.g. from a pen drive). The current data is backed up automatically before it is replaced.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) restoreFile(f);
            }}
          />
          <Button icon={busy === 'file' ? Loader2 : Upload} disabled={!!busy} className={cx(busy === 'file' && '[&_svg]:animate-spin')} onClick={() => fileRef.current?.click()}>
            {busy === 'file' ? 'Restoring…' : 'Choose Backup File…'}
          </Button>
        </Card>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="flex items-center gap-3 p-4">
          <CalendarClock className="size-8 shrink-0 text-emerald-600" />
          <div className="text-sm">
            <div className="font-semibold">Automatic daily backup</div>
            <div className="text-slate-600">{lastAuto ? `Last: ${fmtDateTime(lastAuto.createdAt)}` : 'Taken when the app first runs each day'} · last 30 kept</div>
          </div>
        </Card>
        <Card className="flex items-center gap-3 p-4">
          <ShieldCheck className="size-8 shrink-0 text-blue-600" />
          <div className="text-sm">
            <div className="font-semibold">Latest backup</div>
            <div className="text-slate-600">{last ? `${fmtDateTime(last.createdAt)} · ${size(last.size)}` : 'None yet'}</div>
          </div>
        </Card>
        <Card className="flex items-center gap-3 p-4">
          <FolderOpen className="size-8 shrink-0 text-amber-600" />
          <div className="min-w-0 text-sm">
            <div className="font-semibold">Saved on this computer in</div>
            <div className="truncate font-mono text-xs text-slate-600" title={data?.folder}>{data?.folder || '…'}</div>
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between bg-brand-50 px-4 py-2 text-sm font-bold text-brand-800">
          <span>Backups on this Computer ({data?.backups.length ?? 0})</span>
        </div>
        {data === null ? (
          <p className="px-4 py-6 text-sm text-slate-500">Loading…</p>
        ) : !data.backups.length ? (
          <p className="px-4 py-8 text-center text-slate-500">No backups yet. Click <b>Backup on this Computer</b> to make the first one.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="w-14 text-center">S.No.</th>
                  <th>Date &amp; Time</th>
                  <th>Type</th>
                  <th>Size</th>
                  <th>File</th>
                  <th className="w-32 text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.backups.map((b, i) => (
                  <tr key={b.name}>
                    <td className="text-center">{i + 1}</td>
                    <td className="font-medium whitespace-nowrap">{fmtDateTime(b.createdAt)}</td>
                    <td><span className={cx('rounded-full px-2 py-0.5 text-xs font-semibold', KIND_TONE[b.kind])}>{b.kind}</span></td>
                    <td>{size(b.size)}</td>
                    <td className="font-mono text-xs text-slate-600">{b.name}</td>
                    <td className="text-center whitespace-nowrap">
                      <IconButton icon={Download} label="Download" onClick={() => saveFile(`/api/backups/${encodeURIComponent(b.name)}/download`, b.name).catch(toast.error)} />
                      <IconButton icon={busy === b.name ? Loader2 : RotateCcw} label="Restore this backup" tone="brand" disabled={!!busy} onClick={() => restoreSaved(b)} />
                      <IconButton icon={Trash2} label="Delete backup" tone="red" disabled={!!busy} onClick={() => remove(b)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

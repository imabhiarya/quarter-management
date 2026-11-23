import { useCallback, useEffect, useState } from 'react';
import { Settings as SettingsIcon, Plus, Pencil, Trash2, KeyRound, Save, Copy } from 'lucide-react';
import { api, type Row } from '../lib/api';
import { MASTER_LABELS, useAuth, useMasters, useToast } from '../lib/context';
import { fmtDateTime } from '../lib/format';
import { applyPrintConfig } from '../lib/printSettings';
import { Badge, Button, Card, DataTable, IconButton, Label, Modal, PageHeader, cx, useConfirm } from '../components/ui';
import { PriorityPanel } from '../components/PriorityControls';
import { FormModal } from '../components/Form';
import { CrudPage } from '../components/CrudPage';
import { signatories } from '../modules';

const TABS = ['User Management', 'Master Data', 'Allotment Priority', 'Signatories', 'System Configuration'] as const;

function PasswordReveal({ title, username, password, onClose }: { title: string; username: string; password: string; onClose: () => void }) {
  return (
    <Modal title={title} onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <p className="text-sm text-slate-700">Share this temporary password with <b>{username}</b> securely. It will not be shown again.</p>
      <div className="mt-3 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-lg">
        <span className="flex-1 select-all">{password}</span>
        <Button size="sm" icon={Copy} onClick={() => navigator.clipboard?.writeText(password)}>Copy</Button>
      </div>
    </Modal>
  );
}

function Users() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Row | null>(null);
  const [modal, setModal] = useState<React.ReactNode>(null);
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();
  const close = useCallback(() => setModal(null), []);

  const load = useCallback(() => {
    setLoading(true);
    api<Row[]>('/users').then(setRows).catch(toast.error).finally(() => setLoading(false));
  }, [toast]);
  useEffect(load, [load]);

  const form = (row: Row | null) =>
    setModal(
      <FormModal
        title={row ? 'Edit User' : 'Add User'}
        isEdit={!!row}
        initial={row ?? { role: 'Dealing Clerk', status: 'Active' }}
        onClose={close}
        fields={[
          { name: 'username', label: 'User Name', required: true, lockedOnEdit: true, hint: row ? undefined : 'Lowercase letters, digits, _ . -' },
          { name: 'fullName', label: 'Full Name', required: true },
          { name: 'role', label: 'Role', type: 'select', options: ['Administrator', 'Dealing Clerk', 'Committee Member'], required: true },
          { name: 'status', label: 'Status', type: 'select', options: ['Active', 'Inactive'], required: true },
          { name: 'email', label: 'Email' },
          ...(row ? [] : [{ name: 'password', label: 'Password', hint: 'Leave blank to generate a temporary password.' }]),
        ]}
        onSubmit={async (v) => {
          if (row) {
            await api(`/users/${row.id}`, { method: 'PUT', body: v });
            toast.success('User updated.');
            close();
          } else {
            const r = await api<{ user: Row; password?: string }>('/users', { method: 'POST', body: v });
            toast.success(`User ${r.user.username} created.`);
            setModal(r.password ? <PasswordReveal title="User Created" username={r.user.username} password={r.password} onClose={close} /> : null);
          }
          load();
        }}
      />,
    );

  const need = (fn: (r: Row) => void) => () => (selected ? fn(selected) : toast.error('Select a user in the table first.'));

  const removeUser = async (r: Row) => {
    if (r.id === user?.id) return toast.error('You cannot remove your own account.');
    if (!(await confirm({ title: 'Remove user', message: <>Remove user <b>{r.username}</b> ({r.fullName})? They will no longer be able to log in. Records they made are kept.</>, confirmLabel: 'Remove', danger: true }))) return;
    try {
      await api(`/users/${r.id}`, { method: 'DELETE' });
      toast.success(`User ${r.username} removed.`);
      setSelected(null);
      load();
    } catch (e) {
      toast.error(e);
    }
  };
  const resetPassword = async (r: Row) => {
    if (!(await confirm({ title: 'Reset password', message: <>Generate a new temporary password for <b>{r.username}</b>?</>, confirmLabel: 'Reset Password' }))) return;
    try {
      const { password } = await api<{ password: string }>(`/users/${r.id}/reset-password`, { method: 'POST' });
      setModal(<PasswordReveal title="Password Reset" username={r.username} password={password} onClose={close} />);
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" icon={Plus} onClick={() => form(null)}>Add User</Button>
        <Button icon={Pencil} onClick={need(form)}>Edit</Button>
        <Button icon={Trash2} onClick={need(removeUser)}>Remove</Button>
        <Button icon={KeyRound} onClick={need(resetPassword)}>Reset Password</Button>
      </div>
      <p className="text-sm text-slate-600">
        Use the buttons on each row, or select a row and use the buttons above. To stop someone logging in without removing them, edit the user and set Status to <b>Inactive</b>.
      </p>
      <Card className="overflow-hidden">
        <DataTable
          loading={loading}
          rows={rows}
          selectedId={selected?.id}
          onSelect={(r) => setSelected((s) => (s?.id === r.id ? null : r))}
          columns={[
            { key: 'username', label: 'User Name', render: (r) => r.username },
            { key: 'fullName', label: 'Full Name', render: (r) => r.fullName },
            { key: 'role', label: 'Role', render: (r) => r.role },
            { key: 'status', label: 'Status', render: (r) => <Badge status={r.status} /> },
            { key: 'lastLogin', label: 'Last Login', render: (r) => fmtDateTime(r.lastLogin) },
          ]}
          actions={(r) => (
            <span className="whitespace-nowrap">
              <IconButton icon={Pencil} label="Edit user" onClick={() => form(r)} />
              <IconButton icon={KeyRound} label="Reset password" tone="brand" onClick={() => resetPassword(r)} />
              <IconButton icon={Trash2} label={r.id === user?.id ? 'You cannot remove your own account' : 'Remove user'} tone="red" disabled={r.id === user?.id} onClick={() => removeUser(r)} />
            </span>
          )}
        />
      </Card>
      {modal}
    </div>
  );
}

function MasterData() {
  const { masters, reload } = useMasters();
  const [key, setKey] = useState('stations');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => setText((masters[key] ?? []).join('\n')), [key, masters]);
  const keys = Object.keys(MASTER_LABELS);

  return (
    <div className="grid gap-4 md:grid-cols-[260px_1fr]">
      <Card className="h-fit overflow-hidden">
        <ul>
          {keys.map((k) => (
            <li key={k}>
              <button
                onClick={() => setKey(k)}
                className={cx('flex w-full items-center justify-between border-b border-slate-100 px-4 py-2.5 text-left text-[15px]', key === k ? 'bg-brand-700 font-semibold text-white' : 'hover:bg-brand-50')}
              >
                {MASTER_LABELS[k]}
                <span className={cx('rounded-full px-2 text-xs', key === k ? 'bg-white/20' : 'bg-slate-100 text-slate-600')}>{masters[k]?.length ?? 0}</span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="p-5">
        <Label htmlFor="master-values">{MASTER_LABELS[key]} — one value per line</Label>
        <textarea id="master-values" className="input font-mono" rows={14} value={text} onChange={(e) => setText(e.target.value)} />
        <p className="mt-2 text-xs text-slate-500">Renaming a value does not change existing records that already use the old value.</p>
        <Button
          variant="primary"
          icon={Save}
          loading={busy}
          className="mt-3"
          onClick={async () => {
            setBusy(true);
            try {
              await api(`/masters/${key}`, { method: 'PUT', body: { values: text.split('\n') } });
              await reload();
              toast.success(`${MASTER_LABELS[key]} saved.`);
            } catch (e) {
              toast.error(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          Save
        </Button>
      </Card>
    </div>
  );
}

const CONFIG_FIELDS: { key: string; label: string; type?: string; hint?: string; options?: [string, string][] }[] = [
  { key: 'organisation', label: 'Organisation', hint: 'Printed on the letterhead of orders and proceedings.' },
  { key: 'office', label: 'Office' },
  { key: 'address', label: 'Address' },
  { key: 'ordersSignatory', label: 'Signing Authority for Orders' },
  { key: 'allotmentTenureYears', label: 'Standard Allotment Tenure (years)', type: 'number', hint: 'Used when an allotment is saved without a To Date.' },
  { key: 'vacationNoticeDays', label: 'Vacation Alert Window (days)', type: 'number', hint: 'Quarters due for vacation within this window appear in notifications.' },
  { key: 'letterheadAlign', label: 'Letterhead Alignment (all letters)', type: 'select', options: [['left', 'Left'], ['centre', 'Centre']] },
  { key: 'signatureAlign', label: 'Signature Block Position', type: 'select', options: [['left', 'Left'], ['right', 'Right']] },
  { key: 'takeoverDays', label: 'Take-over Period (days)', type: 'number', hint: 'Days after allotment within which the quarter must be taken over from the BSO (default 8).' },
  { key: 'takeoverAction', label: 'Action when not taken over (SRO 308)', type: 'textarea' },
  { key: 'printMarginTop', label: 'Print Margin – Top (mm)', type: 'number', hint: 'Applies to every printout (0–40 mm).' },
  { key: 'printMarginBottom', label: 'Print Margin – Bottom (mm)', type: 'number' },
  { key: 'printMarginLeft', label: 'Print Margin – Left (mm)', type: 'number', hint: 'Keep wider for filing / binding.' },
  { key: 'printMarginRight', label: 'Print Margin – Right (mm)', type: 'number' },
  { key: 'allotmentNotes', label: 'Allotment Order – Notes (one note per line; lettered (a), (b)… automatically)', type: 'textarea' },
  { key: 'retentionNotes', label: 'Retention / Extension Order – Notes (one note per line)', type: 'textarea' },
];

function SystemConfig() {
  const [cfg, setCfg] = useState<Record<string, string | number> | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => {
    api<Record<string, string | number>>('/config').then(setCfg).catch(toast.error);
  }, [toast]);
  if (!cfg) return <p className="text-slate-500">Loading…</p>;
  return (
    <Card className="max-w-3xl p-5">
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const saved = await api<Record<string, string | number>>('/config', {
              method: 'PUT',
              body: {
                ...cfg,
                allotmentTenureYears: Number(cfg.allotmentTenureYears),
                vacationNoticeDays: Number(cfg.vacationNoticeDays),
                takeoverDays: Number(cfg.takeoverDays),
                printMarginTop: Number(cfg.printMarginTop),
                printMarginRight: Number(cfg.printMarginRight),
                printMarginBottom: Number(cfg.printMarginBottom),
                printMarginLeft: Number(cfg.printMarginLeft),
              },
            });
            setCfg(saved);
            applyPrintConfig(saved);
            toast.success('Configuration saved.');
          } catch (err) {
            toast.error(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        {CONFIG_FIELDS.map((f) => (
          <div key={f.key} className={f.type === 'textarea' ? 'sm:col-span-2' : undefined}>
            <Label htmlFor={`cfg-${f.key}`}>{f.label}</Label>
            {f.type === 'select' ? (
              <select id={`cfg-${f.key}`} className="input" value={String(cfg[f.key] ?? f.options![0][0])} onChange={(e) => setCfg({ ...cfg, [f.key]: e.target.value })}>
                {f.options!.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            ) : f.type === 'textarea' ? (
              <textarea id={`cfg-${f.key}`} rows={8} className="input" value={cfg[f.key] ?? ''} onChange={(e) => setCfg({ ...cfg, [f.key]: e.target.value })} />
            ) : (
              <input id={`cfg-${f.key}`} type={f.type ?? 'text'} className="input" value={cfg[f.key] ?? ''} onChange={(e) => setCfg({ ...cfg, [f.key]: e.target.value })} />
            )}
            {f.hint && <p className="mt-1 text-xs text-slate-500">{f.hint}</p>}
          </div>
        ))}
        <div className="sm:col-span-2">
          <Button type="submit" variant="primary" icon={Save} loading={busy}>Save Configuration</Button>
        </div>
      </form>
    </Card>
  );
}

export default function Settings() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('User Management');
  const { isAdmin } = useAuth();
  return (
    <div className="space-y-4">
      <PageHeader icon={SettingsIcon} title="Settings" subtitle="Users, master data and system configuration" />
      {!isAdmin ? (
        <Card className="p-6 text-slate-700">Only administrators can change settings. Contact your administrator for access.</Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-1 border-b-2 border-brand-700/80" role="tablist">
            {TABS.map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cx('rounded-t-md px-5 py-2 text-sm font-semibold', tab === t ? 'bg-brand-700 text-white' : 'bg-brand-50 text-slate-800 hover:bg-brand-100')}>
                {t}
              </button>
            ))}
          </div>
          {tab === 'User Management' && <Users />}
          {tab === 'Master Data' && <MasterData />}
          {tab === 'Allotment Priority' && (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">
                The order in which accepted applicants are taken up for allotment. It applies on the Seniority List, Waiting List and Quarter Allotment;
                the office names come from <b>Master Data → Office Names</b>.
              </p>
              <PriorityPanel onChanged={() => {}} />
            </div>
          )}
          {tab === 'Signatories' && <CrudPage cfg={signatories} embedded />}
          {tab === 'System Configuration' && <SystemConfig />}
        </>
      )}
    </div>
  );
}

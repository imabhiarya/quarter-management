import { useEffect, useState, type ReactNode } from 'react';
import { Save, Plus, X, Search, Upload, Eye, Download, FileText, Loader2 } from 'lucide-react';
import { api, openUpload, downloadUpload, type Page, type Row } from '../lib/api';
import { useMasters, useToast } from '../lib/context';
import { fmtDate } from '../lib/format';
import { Button, IconButton, Label, Modal, Select, cx, Badge } from './ui';

type Opt = string | { value: string; label: string };
type Values = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export type FieldDef = {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'time' | 'select' | 'textarea' | 'lookup' | 'list' | 'picker' | 'file' | 'documents';
  /** Fixed options, or the key of a master list. */
  options?: Opt[] | string;
  required?: boolean;
  span?: 1 | 2;
  placeholder?: string;
  hint?: string;
  uppercase?: boolean;
  lockedOnEdit?: boolean;
  /** Hidden on create; useful for status fields set by the workflow. */
  editOnly?: boolean;
  lookup?: {
    collection: string;
    query?: Record<string, string>;
    value: string;
    label: (r: Row) => string;
    fill?: (r: Row) => Values;
    /** For `picker`: the copy of the record stored in the array. */
    snapshot?: (r: Row) => Values;
    /** For `picker`: a short note typed against each chosen item (e.g. board remarks). */
    itemNote?: { key: string; placeholder: string };
  };
  /** For `list`: the label of the add button. */
  addLabel?: string;
  /** For `textarea`: word limit, shown with a live counter. */
  maxWords?: number;
  /** For `file`: restrict to images (JPG / PNG) only. */
  imagesOnly?: boolean;
  /** For `textarea`: visible rows. */
  rows?: number;
};

export function useOptions(options: FieldDef['options']): Opt[] {
  const { masters } = useMasters();
  if (!options) return [];
  return typeof options === 'string' ? (masters[options] ?? []) : options;
}

function LookupInput({ field, value, onChange, invalid, disabled }: { field: FieldDef; value: string; onChange: (v: string, rec?: Row) => void; invalid?: boolean; disabled?: boolean }) {
  const [rows, setRows] = useState<Row[]>([]);
  const lk = field.lookup!;
  useEffect(() => {
    api<Page>(`/c/${lk.collection}`, { query: { ...lk.query, pageSize: 'all' } })
      .then((r) => setRows(r.rows))
      .catch(() => setRows([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lk.collection, JSON.stringify(lk.query)]);
  const opts = rows.map((r) => ({ value: String(r[lk.value]), label: lk.label(r) }));
  if (value && !opts.some((o) => o.value === value)) opts.unshift({ value, label: value });
  return (
    <Select
      id={field.name}
      value={value}
      invalid={invalid}
      disabled={disabled}
      placeholder={`Select ${field.label}`}
      options={opts}
      onChange={(v) => onChange(v, rows.find((r) => String(r[lk.value]) === v))}
    />
  );
}

type FileRef = { fileId: string; fileName: string };

/** A stored file with View and Download buttons. */
export function FileLink({ file }: { file?: FileRef | null }) {
  const toast = useToast();
  if (!file?.fileId) return <span className="text-slate-400">No document</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <FileText className="size-4 shrink-0 text-slate-500" />
      <span className="max-w-56 truncate" title={file.fileName}>{file.fileName}</span>
      <IconButton icon={Eye} label="View" onClick={() => openUpload(file.fileId).catch(toast.error)} />
      <IconButton icon={Download} label="Download" tone="brand" onClick={() => downloadUpload(file.fileId, file.fileName).catch(toast.error)} />
    </span>
  );
}

/** Uploads one PDF / JPG / PNG (max 5 MB) and stores a reference to it. */
function FileInput({ field, value, onChange, invalid }: { field: FieldDef; value: FileRef | null; onChange: (v: FileRef | null) => void; invalid?: boolean }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <div className={cx('flex flex-wrap items-center gap-2 rounded-md border px-3 py-2', invalid ? 'border-red-500' : 'border-slate-300')}>
      {value?.fileId ? <FileLink file={value} /> : <span className="text-sm text-slate-500">No file chosen</span>}
      <label className="btn btn-outline btn-sm ml-auto cursor-pointer">
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
        {value?.fileId ? 'Replace' : 'Upload'}
        <input
          id={field.name}
          type="file"
          accept={field.imagesOnly ? '.jpg,.jpeg,.png' : '.pdf,.jpg,.jpeg,.png'}
          className="sr-only"
          disabled={busy}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            const allowed = field.imagesOnly ? ['image/jpeg', 'image/png'] : ['application/pdf', 'image/jpeg', 'image/png'];
            if (!allowed.includes(f.type)) return toast.error(field.imagesOnly ? 'Only JPG or PNG images are accepted.' : 'Only PDF, JPG or PNG files are accepted.');
            if (f.size > 5 * 1024 * 1024) return toast.error('File exceeds the 5 MB limit.');
            setBusy(true);
            try {
              const fd = new FormData();
              fd.append('file', f);
              const r = await api<{ id: string; name: string }>('/uploads', { method: 'POST', body: fd });
              onChange({ fileId: r.id, fileName: r.name });
            } catch (err) {
              toast.error(err);
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {value?.fileId && (
        <button type="button" className="text-sm text-red-700 hover:underline" onClick={() => onChange(null)}>Remove</button>
      )}
    </div>
  );
}

type DocRow = { description: string; mandatory?: string; fileId?: string; fileName?: string };

/** Any number of supporting documents, each a description plus an uploaded PDF / JPG / PNG. */
function DocumentsInput({ field, value, onChange }: { field: FieldDef; value: DocRow[]; onChange: (v: DocRow[]) => void }) {
  const [busy, setBusy] = useState<number | null>(null);
  const toast = useToast();
  const set = (i: number, patch: Partial<DocRow>) => onChange(value.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const upload = async (i: number, f: File) => {
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(f.type)) return toast.error('Only PDF, JPG or PNG files are accepted.');
    if (f.size > 5 * 1024 * 1024) return toast.error('File exceeds the 5 MB limit.');
    setBusy(i);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const r = await api<{ id: string; name: string }>('/uploads', { method: 'POST', body: fd });
      set(i, { fileId: r.id, fileName: r.name, description: value[i].description || r.name.replace(/\.[^.]+$/, '') });
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="rounded-lg border border-slate-200">
      {value.length === 0 && <p className="px-3 py-3 text-sm text-slate-500">No documents attached.</p>}
      {value.map((d, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2 last:border-b-0">
          <span className="w-6 text-right text-sm font-semibold text-slate-500">{i + 1}.</span>
          <input
            id={i === 0 ? field.name : undefined}
            className="input h-9 min-w-48 flex-1"
            placeholder="Description, e.g. Medical certificate / Posting order"
            value={d.description}
            onChange={(e) => set(i, { description: e.target.value })}
          />
          {d.fileId ? (
            <FileLink file={{ fileId: d.fileId, fileName: d.fileName ?? 'document' }} />
          ) : (
            <label className="btn btn-outline btn-sm cursor-pointer">
              {busy === i ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              Choose File
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                className="sr-only"
                disabled={busy !== null}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) upload(i, f);
                }}
              />
            </label>
          )}
          <button type="button" aria-label="Remove document" title="Remove" className="rounded p-1.5 text-red-600 hover:bg-red-50" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <X className="size-4" />
          </button>
        </div>
      ))}
      <div className="px-3 py-2">
        <button type="button" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline" onClick={() => onChange([...value, { description: '', mandatory: 'No' }])}>
          <Plus className="size-4" /> {field.addLabel ?? 'Add Document'}
        </button>
        <span className="ml-3 text-xs text-slate-500">PDF / JPG / PNG, max 5 MB each</span>
      </div>
    </div>
  );
}

/** An editable list of short text values (e.g. member names). */
function ListInput({ field, value, onChange, invalid }: { field: FieldDef; value: string[]; onChange: (v: string[]) => void; invalid?: boolean }) {
  const items = value.length ? value : [''];
  const set = (i: number, v: string) => onChange(items.map((x, j) => (j === i ? v : x)));
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-6 text-right text-sm font-semibold text-slate-500">{i + 1}.</span>
          <input
            id={i === 0 ? field.name : undefined}
            className={cx('input', invalid && !item && 'invalid')}
            placeholder={field.placeholder}
            value={item}
            onChange={(e) => set(i, e.target.value)}
          />
          <button type="button" aria-label="Remove" title="Remove" className="rounded p-1.5 text-red-600 hover:bg-red-50 disabled:opacity-30" disabled={items.length === 1 && !item} onClick={() => onChange(items.filter((_, j) => j !== i))}>
            <X className="size-4" />
          </button>
        </div>
      ))}
      <button type="button" className="ml-8 inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline" onClick={() => onChange([...items, ''])}>
        <Plus className="size-4" /> {field.addLabel ?? 'Add'}
      </button>
    </div>
  );
}

/** Searchable multi-select that stores a snapshot of each chosen record. */
function PickerInput({ field, value, onChange, invalid }: { field: FieldDef; value: Values[]; onChange: (v: Values[]) => void; invalid?: boolean }) {
  const lk = field.lookup!;
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  useEffect(() => {
    api<Page>(`/c/${lk.collection}`, { query: { ...lk.query, pageSize: 'all' } }).then((r) => setRows(r.rows)).catch(() => setRows([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lk.collection, JSON.stringify(lk.query)]);
  const chosen = new Set(value.map((v) => String(v[lk.value])));
  const needle = q.trim().toLowerCase();
  const matches = rows.filter((r) => !chosen.has(String(r[lk.value])) && (!needle || lk.label(r).toLowerCase().includes(needle))).slice(0, 40);
  const snap = lk.snapshot ?? ((r: Row) => r);
  return (
    <div>
      {value.length > 0 && (
        <ul className="mb-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
          {value.map((v) => (
            <li key={String(v[lk.value])} className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-sm">
              <span className="min-w-60 flex-1">{lk.label(v as Row)}</span>
              {lk.itemNote && (
                <input
                  className="input h-8 min-w-48 flex-1 text-sm"
                  aria-label={lk.itemNote.placeholder}
                  placeholder={lk.itemNote.placeholder}
                  value={String(v[lk.itemNote.key] ?? '')}
                  onChange={(e) => onChange(value.map((x) => (x[lk.value] === v[lk.value] ? { ...x, [lk.itemNote!.key]: e.target.value } : x)))}
                />
              )}
              <button type="button" aria-label="Remove" className="rounded p-1 text-red-600 hover:bg-red-50" onClick={() => onChange(value.filter((x) => x[lk.value] !== v[lk.value]))}>
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
        <input
          id={field.name}
          className={cx('input pl-9', invalid && 'invalid')}
          placeholder={field.placeholder ?? 'Type to search…'}
          value={q}
          onChange={(e) => (setQ(e.target.value), setOpen(true))}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
        />
        {open && (
          <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
            {matches.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">No matches.</li>}
            {matches.map((r) => (
              <li key={r.id}>
                <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-brand-50" onMouseDown={(e) => e.preventDefault()} onClick={() => (onChange([...value, snap(r)]), setQ(''))}>
                  {lk.label(r)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export const countWords = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

export function FieldInput({ field, value, onChange, invalid, disabled }: { field: FieldDef; value: unknown; onChange: (v: unknown, fill?: Values) => void; invalid?: boolean; disabled?: boolean }) {
  const options = useOptions(field.options);
  const v = value === undefined || value === null ? '' : String(value);
  const common = { id: field.name, disabled, className: cx('input', invalid && 'invalid'), placeholder: field.placeholder };
  switch (field.type) {
    case 'select':
      // Keep a saved value visible even if it has since been removed from the list.
      return (
        <Select
          id={field.name}
          value={v}
          disabled={disabled}
          invalid={invalid}
          onChange={onChange}
          options={v && !options.some((o) => (typeof o === 'string' ? o : o.value) === v) ? [v, ...options] : options}
          placeholder={`Select ${field.label}`}
        />
      );
    case 'documents':
      return <DocumentsInput field={field} value={Array.isArray(value) ? (value as DocRow[]) : []} onChange={onChange} />;
    case 'file':
      return <FileInput field={field} value={(value as FileRef) ?? null} invalid={invalid} onChange={onChange} />;
    case 'list':
      return <ListInput field={field} value={Array.isArray(value) ? (value as string[]) : []} invalid={invalid} onChange={onChange} />;
    case 'picker':
      return <PickerInput field={field} value={Array.isArray(value) ? (value as Values[]) : []} invalid={invalid} onChange={onChange} />;
    case 'lookup':
      return <LookupInput field={field} value={v} invalid={invalid} disabled={disabled} onChange={(val, rec) => onChange(val, rec && field.lookup!.fill?.(rec))} />;
    case 'textarea':
      if (field.maxWords) {
        const words = countWords(v);
        return (
          <div>
            <textarea {...common} rows={field.rows ?? 8} className={cx('input resize-y', (invalid || words > field.maxWords) && 'invalid')} value={v} onChange={(e) => onChange(e.target.value)} />
            <div className={cx('mt-1 text-right text-xs', words > field.maxWords ? 'font-semibold text-red-700' : 'text-slate-500')}>
              {words.toLocaleString('en-IN')} / {field.maxWords.toLocaleString('en-IN')} words
            </div>
          </div>
        );
      }
      return <textarea {...common} rows={field.rows ?? 3} value={v} onChange={(e) => onChange(e.target.value)} />;
    case 'number':
      return <input {...common} type="number" inputMode="decimal" value={v} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />;
    default:
      return (
        <input
          {...common}
          type={field.type ?? 'text'}
          value={v}
          onChange={(e) => onChange(field.uppercase ? e.target.value.toUpperCase() : e.target.value)}
        />
      );
  }
}

export function FormModal({
  title, fields, initial, isEdit, onClose, onSubmit, intro,
}: {
  title: string;
  fields: FieldDef[];
  initial: Values;
  isEdit: boolean;
  onClose: () => void;
  onSubmit: (v: Values) => Promise<void>;
  intro?: ReactNode;
}) {
  const [values, setValues] = useState<Values>(initial);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const visible = fields.filter((f) => isEdit || !f.editOnly);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const empty = (v: unknown) =>
      v === undefined || v === null || v === '' || (Array.isArray(v) && v.every((x) => x === '' || x === undefined)) || (typeof v === 'object' && !Array.isArray(v) && !(v as FileRef).fileId);
    const missing = visible.filter((f) => f.required && empty(values[f.name]));
    setErrors(Object.fromEntries(missing.map((f) => [f.name, true])));
    if (missing.length) return setError(`Please fill in: ${missing.map((f) => f.label).join(', ')}`);
    const tooLong = visible.find((f) => f.maxWords && countWords(String(values[f.name] ?? '')) > f.maxWords);
    if (tooLong) {
      setErrors({ [tooLong.name]: true });
      return setError(`${tooLong.label} can be at most ${tooLong.maxWords!.toLocaleString('en-IN')} words.`);
    }
    setBusy(true);
    setError('');
    try {
      const cleaned = { ...values };
      for (const f of visible) if (f.type === 'list' && Array.isArray(cleaned[f.name])) cleaned[f.name] = (cleaned[f.name] as string[]).map((s) => s.trim()).filter(Boolean);
      for (const f of visible) {
        if (f.type !== 'documents' || !Array.isArray(cleaned[f.name])) continue;
        const docs = (cleaned[f.name] as DocRow[]).filter((d) => d.fileId || d.description.trim());
        const noFile = docs.find((d) => !d.fileId);
        if (noFile) throw new Error(`Upload a file for “${noFile.description.trim()}” or remove that row.`);
        cleaned[f.name] = docs.map((d) => ({ ...d, description: d.description.trim() || d.fileName || 'Document' }));
      }
      await onSubmit(cleaned);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      wide={visible.length > 8}
      footer={
        <>
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="crud-form" variant="primary" icon={Save} loading={busy}>
            {isEdit ? 'Save Changes' : 'Save'}
          </Button>
        </>
      }
    >
      {intro}
      <form id="crud-form" onSubmit={submit} noValidate className={cx('grid gap-x-4 gap-y-3', visible.length > 8 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
        {visible.map((f) => (
          <div key={f.name} className={cx(f.span === 2 && 'sm:col-span-full')}>
            <Label htmlFor={f.name} required={f.required}>{f.label}</Label>
            <FieldInput
              field={f}
              value={values[f.name]}
              invalid={errors[f.name]}
              disabled={isEdit && f.lockedOnEdit}
              onChange={(v, fill) => {
                setValues((cur) => ({ ...cur, ...(fill ?? {}), [f.name]: v }));
                setErrors((cur) => ({ ...cur, [f.name]: false }));
              }}
            />
            {f.hint && <p className="mt-1 text-xs text-slate-500">{f.hint}</p>}
          </div>
        ))}
      </form>
      {error && <p role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
    </Modal>
  );
}

export type ViewItem = { label: string; value: ReactNode; wide?: boolean };

export function viewItemsFor(fields: FieldDef[], row: Row): ViewItem[] {
  return fields.map((f) => {
    const raw = row[f.name];
    let value: ReactNode = raw === undefined || raw === null || raw === '' ? '—' : String(raw);
    if (f.type === 'date') value = fmtDate(raw);
    if (f.name === 'status') value = <Badge status={raw} />;
    if (f.type === 'textarea' && raw) value = <span className="whitespace-pre-line">{raw}</span>;
    if (f.type === 'list') value = Array.isArray(raw) && raw.length ? <ol className="list-decimal pl-5">{raw.map((x: string, i: number) => <li key={i}>{x}</li>)}</ol> : '—';
    if (f.type === 'file') value = <FileLink file={raw} />;
    if (f.type === 'documents')
      value =
        Array.isArray(raw) && raw.length ? (
          <ul className="space-y-1">
            {raw.map((d: DocRow, i: number) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{i + 1}. {d.description}</span>
                {d.fileId && <FileLink file={{ fileId: d.fileId, fileName: d.fileName ?? 'document' }} />}
              </li>
            ))}
          </ul>
        ) : (
          '—'
        );
    if (f.type === 'picker')
      value = Array.isArray(raw) && raw.length ? <ul className="list-disc space-y-0.5 pl-5">{raw.map((x: Row, i: number) => <li key={i}>{f.lookup!.label(x)}{f.lookup!.itemNote && x[f.lookup!.itemNote.key] ? <span className="text-slate-600"> — {x[f.lookup!.itemNote.key]}</span> : null}{x.status && x.status !== 'Allotted' ? <span className="ml-1 font-semibold text-red-700">({x.status})</span> : null}</li>)}</ul> : '—';
    return { label: f.label, value, wide: f.type === 'list' || f.type === 'picker' || f.type === 'documents' || f.span === 2 };
  });
}

export function ViewModal({ title, items, onClose, footer }: { title: string; items: ViewItem[]; onClose: () => void; footer?: ReactNode }) {
  return (
    <Modal title={title} onClose={onClose} wide={items.length > 12} footer={footer ?? <Button onClick={onClose}>Close</Button>}>
      <dl className={cx('grid gap-x-6 gap-y-3', items.length > 12 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
        {items.map((it) => (
          <div key={it.label} className={cx('border-b border-slate-100 pb-2', it.wide && 'sm:col-span-full')}>
            <dt className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{it.label}</dt>
            <dd className="mt-0.5 text-[15px] text-slate-900">{it.value}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}

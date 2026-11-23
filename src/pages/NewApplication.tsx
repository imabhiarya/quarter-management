import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  FilePlus2, User, MapPin, Coins, House, BedDouble, Medal, Phone, NotebookPen, Paperclip, Info, Upload, Eye, Trash2, Plus,
  Save, RotateCcw, ArrowLeft, Printer, Loader2, Mail, type LucideIcon,
} from 'lucide-react';
import { api, openUpload, type Row } from '../lib/api';
import { useAuth, useMasters, useToast } from '../lib/context';
import { entitlementFor, fmtDate, isoDate } from '../lib/format';
import { printApplication } from '../lib/printApplication';
import { Button, IconButton, Label, Select, cx } from '../components/ui';

type Doc = { description: string; mandatory: 'Yes' | 'No'; custom?: boolean; fileId?: string; fileName?: string };
type Values = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const DEFAULT_DOCS: Doc[] = [
  { description: 'Application Approved by Competent Authority', mandatory: 'Yes' },
  { description: 'Salary Slip', mandatory: 'No' },
  { description: 'Other Documents', mandatory: 'No' },
];

const EMPTY: Values = { applicationType: 'Fresh', exServiceman: 'No', applicationGround: 'Regular' };

const REQUIRED: [string, string][] = [
  ['serviceNo', 'Service No.'], ['rank', 'Rank'], ['trade', 'Trade'], ['name', 'Name'],
  ['officeName', 'Office Name'], ['subDivision', 'Sub Division'], ['dateOfJoiningStation', 'Date of Joining in Station'], ['dateOfEnrolment', 'Date of Enrolment'],
  ['payLevel', 'Pay Level'], ['payCell', 'Pay Cell'], ['basicPay', 'Basic Pay'],
  ['entitlement', 'Type of Accn Entitlement'], ['categoryRequested', 'Type of Accn Requested'], ['locationRequested', 'Location'], ['accnPool', 'Applied Accn Pool'], ['applicationGround', 'Application Ground'], ['applicationType', 'Application Type'],
  ['mobile', 'Mobile Number'], ['email', 'Email ID'],
];

function Section({ icon: Icon, title, children, className }: { icon: LucideIcon; title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cx('overflow-hidden rounded-xl border border-brand-200 bg-white shadow-sm', className)}>
      <h2 className="flex items-center gap-2.5 bg-gradient-to-r from-brand-100 via-brand-50 to-white px-4 py-1.5 text-lg font-bold text-brand-700">
        <Icon className="size-5" strokeWidth={2} />
        {title}
      </h2>
      <div className="px-4 pt-2 pb-3">{children}</div>
    </section>
  );
}

function Radio({ name, value, options, onChange }: { name: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div className="flex h-10 flex-wrap items-center gap-5">
      {options.map((o) => (
        <label key={o} className="flex cursor-pointer items-center gap-2 text-[15px]">
          <input type="radio" name={name} className="size-4 accent-brand-700" checked={value === o} onChange={() => onChange(o)} />
          {o}
        </label>
      ))}
    </div>
  );
}

export default function NewApplication() {
  const [params] = useSearchParams();
  const editId = params.get('id');
  const navigate = useNavigate();
  const toast = useToast();
  const { canEdit } = useAuth();
  const { masters } = useMasters();
  const [values, setValues] = useState<Values>(EMPTY);
  const [docs, setDocs] = useState<Doc[]>(DEFAULT_DOCS);
  const [appNo, setAppNo] = useState('');
  const [appDate, setAppDate] = useState(isoDate());
  const [errors, setErrors] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<number | null>(null);
  const [loaded, setLoaded] = useState<Row | null>(null);
  const fileInputs = useRef<(HTMLInputElement | null)[]>([]);

  const loadNext = () => api<{ value: string }>('/c/applications/next-number').then((r) => setAppNo(r.value)).catch(() => {});

  useEffect(() => {
    if (!editId) {
      setLoaded(null);
      setValues(EMPTY);
      setDocs(DEFAULT_DOCS);
      setAppDate(isoDate());
      loadNext();
      return;
    }
    api<Row>(`/c/applications/${editId}`)
      .then((r) => {
        setLoaded(r);
        setValues(r);
        setDocs(r.documents?.length ? r.documents : DEFAULT_DOCS);
        setAppNo(r.applicationNo);
        setAppDate(r.applicationDate);
      })
      .catch((e) => {
        toast.error(e);
        navigate('/applicant-register');
      });
  }, [editId, toast, navigate]);

  const set = (k: string, v: unknown) => {
    setValues((cur) => {
      const next = { ...cur, [k]: v };
      if (k === 'payLevel') {
        const ent = entitlementFor(String(v));
        if (ent) {
          next.entitlement = ent;
          if (!cur.categoryRequested || cur.categoryRequested === cur.entitlement) next.categoryRequested = ent;
        }
      }
      return next;
    });
    setErrors((e) => {
      if (!e.has(k)) return e;
      const n = new Set(e);
      n.delete(k);
      return n;
    });
  };

  const inv = (k: string) => errors.has(k);
  const text = (k: string, placeholder: string, extra: Partial<React.InputHTMLAttributes<HTMLInputElement>> = {}) => (
    <input id={k} className={cx('input', inv(k) && 'invalid')} placeholder={placeholder} value={values[k] ?? ''} onChange={(e) => set(k, e.target.value)} {...extra} />
  );
  const date = (k: string, disabled = false) => <input id={k} type="date" disabled={disabled} className={cx('input', inv(k) && 'invalid')} value={values[k] ?? ''} onChange={(e) => set(k, e.target.value)} />;
  const sel = (k: string, label: string, opts: string[], disabled = false) => (
    <Select id={k} value={values[k] ?? ''} onChange={(v) => set(k, v)} options={opts} placeholder={`Select ${label}`} invalid={inv(k)} disabled={disabled} />
  );
  const m = (k: string) => masters[k] ?? [];
  const exYes = values.exServiceman === 'Yes';
  const docTypes = useMemo(() => m('documentTypes'), [masters]); // eslint-disable-line react-hooks/exhaustive-deps

  const upload = async (i: number, file: File) => {
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) return toast.error('Only PDF, JPG or PNG files are accepted.');
    if (file.size > 5 * 1024 * 1024) return toast.error('File exceeds the 5 MB limit.');
    setUploading(i);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api<{ id: string; name: string }>('/uploads', { method: 'POST', body: fd });
      setDocs((d) => d.map((x, j) => (j === i ? { ...x, fileId: r.id, fileName: r.name } : x)));
    } catch (e) {
      toast.error(e);
    } finally {
      setUploading(null);
    }
  };

  const reset = () => {
    setValues(loaded ?? EMPTY);
    setDocs(loaded?.documents?.length ? loaded.documents : DEFAULT_DOCS);
    setErrors(new Set());
    setMessage('');
  };

  const save = async () => {
    const required: [string, string][] = values.applicationType === 'Change of Accn' ? [...REQUIRED, ['changeReason', 'Reason for Change']] : REQUIRED;
    const missing = required.filter(([k]) => values[k] === undefined || values[k] === null || String(values[k]).trim() === '');
    const bad = new Set(missing.map(([k]) => k));
    const problems: string[] = [];
    if (missing.length) problems.push(`Fill in: ${missing.map(([, l]) => l).join(', ')}.`);
    if (values.mobile && !/^\d{10}$/.test(String(values.mobile))) (bad.add('mobile'), problems.push('Mobile number must be 10 digits.'));
    if (values.dateOfRetirement && values.dateOfEnrolment && values.dateOfRetirement <= values.dateOfEnrolment) (bad.add('dateOfRetirement'), problems.push('Date of Retirement must be after the Date of Enrolment.'));
    if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(values.email))) (bad.add('email'), problems.push('Enter a valid email address.'));
    if (!editId) {
      const missingDocs = docs.filter((d) => d.mandatory === 'Yes' && !d.fileId);
      if (missingDocs.length) problems.push(`Upload mandatory document(s): ${missingDocs.map((d) => d.description || 'unnamed').join(', ')}.`);
    }
    const unnamed = docs.some((d) => d.fileId && !d.description.trim());
    if (unnamed) problems.push('Enter a description for each uploaded document.');
    setErrors(bad);
    if (problems.length) {
      setMessage(problems.join(' '));
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setMessage('');
    setBusy(true);
    try {
      const body = { ...values, applicationDate: appDate, documents: docs.filter((d) => d.fileId || !d.custom) };
      if (editId) {
        await api(`/c/applications/${editId}`, { method: 'PUT', body });
        toast.success('Application updated.');
      } else {
        const r = await api<Row>('/c/applications', { method: 'POST', body: { ...body, applicationNo: undefined } });
        toast.success(`Application ${r.applicationNo} saved. It is now pending in Application Scrutiny.`);
      }
      if (editId) navigate(-1);
      else navigate('/application-scrutiny');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setBusy(false);
    }
  };

  const L = (k: string, label: string, required = true) => <Label htmlFor={k} required={required}>{label}</Label>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <FilePlus2 className="size-11 text-brand-700" strokeWidth={1.6} />
          <div>
            <h1 className="text-2xl font-bold text-brand-700 sm:text-[28px]">{editId ? 'Edit Accommodation Application' : 'New Accommodation Application'}</h1>
            <p className="text-[15px] text-slate-700">Application for Government Married Accommodation</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-8 gap-y-1 rounded-xl border border-brand-200 bg-gradient-to-r from-brand-50 to-white px-5 py-2.5 text-[15px] font-semibold">
          <span>Application No. : <span className="font-medium">{appNo || '…'}</span></span>
          <span>Application Date : <span className="font-medium">{fmtDate(appDate)}</span></span>
        </div>
      </div>

      {message && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">{message}</p>}

      <Section icon={Mail} title="Application Receipt Details">
        <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
          <div>{L('indApplicationNo', "Individual's Application No.", false)}{text('indApplicationNo', 'Enter No. on application')}</div>
          <div>{L('indApplicationDate', "Individual's Application Date", false)}{date('indApplicationDate')}</div>
          <div>{L('forwardingLetterNo', 'Received Through Letter No.', false)}{text('forwardingLetterNo', 'Enter Letter No.')}</div>
          <div>{L('forwardingLetterDate', 'Letter Date', false)}{date('forwardingLetterDate')}</div>
          <div>{L('forwardedBy', 'Forwarded By (Unit / Office)', false)}{text('forwardedBy', 'Enter Unit / Office')}</div>
          <div>{L('receivedDate', 'Date of Receipt', false)}{date('receivedDate')}</div>
        </div>
      </Section>

      <Section icon={User} title="Service & Personal Details">
        <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1.3fr]">
          <div>{L('serviceNo', 'Service No.')}{text('serviceNo', 'Enter Service No.')}</div>
          <div>{L('rank', 'Rank')}{sel('rank', 'Rank', m('ranks'))}</div>
          <div>{L('trade', 'Trade')}{sel('trade', 'Trade', m('trades'))}</div>
          <div>
            {L('name', 'Name (in Block Letters)')}
            <input id="name" className={cx('input uppercase', inv('name') && 'invalid')} placeholder="Enter Full Name" value={values.name ?? ''} onChange={(e) => set('name', e.target.value.toUpperCase())} />
          </div>
        </div>
      </Section>

      <Section icon={MapPin} title="Posting & Service Details">
        <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
          <div>
            {L('officeName', 'Office Name')}
            {/* From Settings → Master Data → Office Names; an older name already on this application stays selectable. */}
            {sel('officeName', 'Office', values.officeName && !m('offices').includes(values.officeName) ? [values.officeName, ...m('offices')] : m('offices'))}
          </div>
          <div>{L('station', 'Station', false)}{sel('station', 'Station', m('stations'))}</div>
          <div>{L('subDivision', 'Sub Division')}{sel('subDivision', 'Sub Division', m('subDivisions'))}</div>
          <div>{L('dateOfJoiningStation', 'Date of Joining in Station')}{date('dateOfJoiningStation')}</div>
          <div>{L('dateOfEnrolment', 'Date of Enrolment in Service')}{date('dateOfEnrolment')}</div>
          <div>{L('dateOfRetirement', 'Date of Retirement', false)}{date('dateOfRetirement')}</div>
        </div>
      </Section>

      <div className="grid gap-3 xl:grid-cols-2">
        <Section icon={Coins} title="Pay Details">
          <div className="grid gap-x-4 gap-y-2 sm:grid-cols-3">
            <div>{L('payLevel', 'Pay Level')}{sel('payLevel', 'Level', m('payLevels'))}</div>
            <div>{L('payCell', 'Pay Cell')}{sel('payCell', 'Cell', m('payCells'))}</div>
            <div>{L('basicPay', 'Basic Pay (₹)')}{text('basicPay', 'Enter Basic Pay', { inputMode: 'numeric', onChange: (e) => set('basicPay', e.target.value.replace(/[^\d]/g, '')) })}</div>
          </div>
        </Section>
        <Section icon={House} title="Accommodation Entitlement & Request">
          <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2 2xl:grid-cols-3">
            <div>{L('entitlement', 'Type of Accn Entitlement')}{sel('entitlement', 'Entitlement', m('categories'))}</div>
            <div>{L('categoryRequested', 'Type of Accn Requested')}{sel('categoryRequested', 'Accn Requested', m('categories'))}</div>
            <div>{L('locationRequested', 'Location')}{sel('locationRequested', 'Location', m('locations'))}</div>
            <div>{L('accnPool', 'Applied Accn Pool')}{sel('accnPool', 'Pool', m('accnPools'))}</div>
            <div>{L('applicationGround', 'Application Ground')}{sel('applicationGround', 'Ground', m('applicationGrounds'))}</div>
            <div>{L('applicationType', 'Application Type')}<Radio name="applicationType" value={values.applicationType} options={['Fresh', 'Change of Accn']} onChange={(v) => (set('applicationType', v), v === 'Fresh' && set('changeReason', ''))} /></div>
            {values.applicationType === 'Change of Accn' && (
              <div>{L('changeReason', 'Reason for Change')}{sel('changeReason', 'Reason', m('changeReasons'))}</div>
            )}
          </div>
        </Section>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <Section icon={BedDouble} title="Previous Accommodation Details (if any)">
          <div className="grid gap-x-4 gap-y-2 sm:grid-cols-3">
            <div>{L('prevQuarterNo', 'Quarter No.', false)}{text('prevQuarterNo', 'Enter Quarter No.')}</div>
            <div>{L('prevCategory', 'Category', false)}{sel('prevCategory', 'Category', m('categories'))}</div>
            <div>{L('prevStation', 'Station', false)}{text('prevStation', 'Enter Station')}</div>
            <div>{L('prevFrom', 'From Date', false)}{date('prevFrom')}</div>
            <div>{L('prevTo', 'To Date', false)}{date('prevTo')}</div>
            <div>{L('prevReason', 'Reason for Vacation', false)}{sel('prevReason', 'Reason', m('vacationReasons'))}</div>
            <div className="sm:col-span-3">
              {L('prevLocation', 'Present Location / Address (where currently residing)', false)}
              {text('prevLocation', 'e.g. Qtr 12, Block C, Happy Valley, Shillong')}
            </div>
          </div>
        </Section>
        <Section icon={Medal} title="Ex-Service Man Details">
          <div className="grid gap-x-4 gap-y-2 sm:grid-cols-[auto_1fr]">
            <div className="sm:border-r sm:border-slate-200 sm:pr-4">
              {L('exServiceman', 'Are you an Ex-Service Man ?')}
              <Radio name="exServiceman" value={values.exServiceman} options={['Yes', 'No']} onChange={(v) => set('exServiceman', v)} />
            </div>
            <fieldset disabled={!exYes} className={cx('grid gap-x-3 gap-y-2 sm:grid-cols-2', !exYes && 'opacity-55')}>
              <legend className="mb-1 text-sm font-semibold text-red-700">If Yes, details of previous service</legend>
              <div>{L('exServiceNo', 'Service No. (Prev.)', false)}{text('exServiceNo', 'Enter Service No.')}</div>
              <div>{L('exRank', 'Rank (Prev.)', false)}{text('exRank', 'Enter Rank')}</div>
              <div>{L('exFrom', 'Service From', false)}{date('exFrom', !exYes)}</div>
              <div>{L('exTo', 'Service To', false)}{date('exTo', !exYes)}</div>
              <div>{L('exPayLevel', 'Last Pay Level', false)}{sel('exPayLevel', 'Level', m('payLevels'), !exYes)}</div>
              <div>{L('exBasicPay', 'Last Basic Pay (₹)', false)}{text('exBasicPay', 'Enter Last Basic Pay', { inputMode: 'numeric', onChange: (e) => set('exBasicPay', e.target.value.replace(/[^\d]/g, '')) })}</div>
            </fieldset>
          </div>
        </Section>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <Section icon={Phone} title="Contact Information">
          <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
            <div>{L('mobile', 'Mobile Number')}{text('mobile', 'Enter 10 digit mobile no.', { inputMode: 'numeric', maxLength: 10, onChange: (e) => set('mobile', e.target.value.replace(/\D/g, '')) })}</div>
            <div>{L('email', 'Email ID')}{text('email', 'Enter email address', { type: 'email' })}</div>
          </div>
        </Section>
        <Section icon={NotebookPen} title="Remarks">
          {L('remarks', 'Remarks / Purpose of Application', false)}
          <textarea id="remarks" rows={2} className="input" placeholder="Enter remarks / any other relevant information…" value={values.remarks ?? ''} onChange={(e) => set('remarks', e.target.value)} />
        </Section>
      </div>

      <Section icon={Paperclip} title="Documents Upload">
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <div className="space-y-3">
            <div className="rounded-lg border border-brand-200 bg-brand-50/70 p-4 text-sm">
              <h3 className="mb-2 flex items-center gap-2 font-bold text-brand-700"><Info className="size-4" /> Upload Guidelines</h3>
              <ul className="list-disc space-y-1 pl-5 text-slate-800">
                <li>Accepted format : PDF / JPG / PNG</li>
                <li>Maximum file size : 5 MB per file</li>
                <li>Mandatory documents are marked with <span className="text-red-600">*</span></li>
                <li>You can add, edit or delete document entries.</li>
              </ul>
            </div>
            <Button icon={Plus} className="no-print" onClick={() => setDocs((d) => [...d, { description: '', mandatory: 'No', custom: true }])}>Add Document</Button>
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="data-table compact doc-table">
              <thead>
                <tr>
                  <th className="w-14 text-center">Sl.No.</th>
                  <th>Document Description <span className="text-red-200">*</span></th>
                  <th className="w-28 text-center">Mandatory</th>
                  <th className="no-print w-36 text-center">Upload File</th>
                  <th>File Name</th>
                  <th className="no-print w-24 text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d, i) => (
                  <tr key={i}>
                    <td className="text-center">{i + 1}</td>
                    <td>
                      {d.custom ? (
                        <input className="input" placeholder="Enter document name (e.g. Undertaking, Acknowledgement etc.)" value={d.description} onChange={(e) => setDocs((x) => x.map((y, j) => (j === i ? { ...y, description: e.target.value } : y)))} />
                      ) : (
                        <Select value={d.description} options={docTypes.includes(d.description) ? docTypes : [d.description, ...docTypes]} onChange={(v) => setDocs((x) => x.map((y, j) => (j === i ? { ...y, description: v } : y)))} />
                      )}
                    </td>
                    <td className="text-center">
                      {d.custom ? (
                        <Select value={d.mandatory} options={['No', 'Yes']} onChange={(v) => setDocs((x) => x.map((y, j) => (j === i ? { ...y, mandatory: v as Doc['mandatory'] } : y)))} />
                      ) : (
                        <span className={d.mandatory === 'Yes' ? 'font-semibold text-red-600' : ''}>{d.mandatory}</span>
                      )}
                    </td>
                    <td className="no-print text-center">
                      <input ref={(el) => { fileInputs.current[i] = el; }} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(i, f); e.target.value = ''; }} />
                      <Button size="sm" icon={uploading === i ? Loader2 : Upload} disabled={uploading !== null} onClick={() => fileInputs.current[i]?.click()} className={cx(uploading === i && '[&_svg]:animate-spin')}>
                        Choose File
                      </Button>
                    </td>
                    <td className="max-w-48 truncate" title={d.fileName}>{d.fileName ?? <span className="text-slate-500">No file chosen</span>}</td>
                    <td className="no-print text-center whitespace-nowrap">
                      <IconButton icon={Eye} label="View file" disabled={!d.fileId} onClick={() => d.fileId && openUpload(d.fileId).catch(toast.error)} />
                      <IconButton
                        icon={Trash2}
                        label={d.custom ? 'Remove row' : 'Remove file'}
                        tone="red"
                        onClick={() => setDocs((x) => (d.custom ? x.filter((_, j) => j !== i) : x.map((y, j) => (j === i ? { ...y, fileId: undefined, fileName: undefined } : y))))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Section>

      <div className="no-print flex flex-wrap justify-center gap-3 pt-2 pb-4">
        {canEdit && <Button variant="primary" icon={Save} loading={busy} onClick={save} className="min-w-52 justify-center py-2.5 text-base">{editId ? 'Save Changes' : 'Save Application'}</Button>}
        <Button icon={RotateCcw} onClick={reset} className="min-w-36 justify-center py-2.5 text-base">Reset</Button>
        <Button icon={ArrowLeft} onClick={() => navigate(-1)} className="min-w-36 justify-center py-2.5 text-base">Back</Button>
        <Button icon={Printer} onClick={() => printApplication(values, docs, appNo, appDate).catch(toast.error)} className="min-w-44 justify-center py-2.5 text-base">Print Form</Button>
      </div>
    </div>
  );
}

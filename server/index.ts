import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { HTTPException } from 'hono/http-exception';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { db, all, get, insert, update, remove, findOne, tx, isoDate, addDays, addYears, UPLOAD_DIR, type Rec } from './db.ts';
import { seed, MASTERS } from './seed.ts';
import { hashPassword, verifyPassword, signToken, verifyToken, randomPassword } from './auth.ts';
import {
  COLLECTIONS, type Collection, prepareCreate, prepareUpdate, afterWrite, beforeDelete, decorate,
  nextNumber, listQuery, getRecord, getConfig, DEFAULT_CONFIG, PRIORITY_TYPES, occupation, proceedingsByOrder, priorityFor, WAITING_STATUSES,
} from './logic.ts';
import { quarterStats, waitingStats, dashboardStats, notifications, seniorityList, waitingList, vacancyMatrix, quartersByLocation, applicationsByLocation } from './stats.ts';
import { buildReport } from './reports.ts';
import { extractRules, assess } from './scrutiny.ts';
import { buildZip, type ZipEntry } from './zip.ts';
import { BACKUP_DIR, backupPath, createBackup, deleteBackup, isBackupName, listBackups, restoreBackup, startAutomaticBackups } from './backup.ts';

if (seed()) console.log('First run: database seeded with sample data.');
// Add any master lists introduced after the database was created.
for (const [key, values] of Object.entries(MASTERS))
  if (!findOne('masters', (m) => m.key === key)) insert('masters', { key, values });
// Allotments made before take-over tracking: older than the take-over period are taken as occupied.
for (const a of all('allotments'))
  if (a.status === 'Allotted' && !a.occupationStatus) {
    const by = addDays(a.allotmentDate, Number(getConfig().takeoverDays) || 8);
    update('allotments', a.id, by < isoDate() ? { occupationStatus: 'Occupied', occupiedOn: '', takeoverBy: by, occupationRemarks: 'Recorded before take-over tracking' } : { occupationStatus: 'Awaiting', takeoverBy: by });
  }

// Proceedings saved in the older meeting-based format: keep their text in Remarks.
for (const p of all('proceedings'))
  if (!Array.isArray(p.members))
    update('proceedings', p.id, {
      members: [],
      allotments: [],
      remarks: [p.subject, p.details].filter(Boolean).join('\n'),
      authority: p.authority ?? '',
      presidingOfficer: p.presidingOfficer ?? '',
    });

type Env = { Variables: { user: Rec } };
const app = new Hono<Env>();

const ROLES = ['Administrator', 'Dealing Clerk', 'Committee Member'];
const publicUser = ({ passwordHash: _p, ...u }: Rec) => u;
const fail = (status: 400 | 401 | 403 | 404, message: string): never => {
  throw new HTTPException(status, { message });
};

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  if (err instanceof SyntaxError) return c.json({ error: 'Malformed request body.' }, 400);
  console.error(err);
  return c.json({ error: 'Internal server error.' }, 500);
});

app.get('/api/health', (c) => c.json({ ok: true }));

/** Office Names became a master list (Settings → Master Data); start it from the offices already on applications. */
(function ensureOfficesMaster() {
  if (findOne('masters', (m) => m.key === 'offices')) return;
  const names = [...new Set(all('applications').map((a) => String(a.officeName ?? '').trim()).filter(Boolean))].sort((x, y) => x.localeCompare(y, 'en-GB'));
  insert('masters', { key: 'offices', values: names.length ? names : ['Own Office'] });
})();

/** Office name for the login page (shown before sign-in, so it holds nothing sensitive). */
app.get('/api/public-info', (c) => {
  const cfg = getConfig();
  return c.json({ organisation: cfg.organisation, office: cfg.office, address: cfg.address });
});

/* ---------------------------- Auth ---------------------------- */

app.post('/api/auth/login', async (c) => {
  const { username, password } = await c.req.json<{ username?: string; password?: string }>();
  const user = findOne('users', (u) => u.username === String(username ?? '').trim().toLowerCase());
  if (!user || !verifyPassword(String(password ?? ''), user.passwordHash)) fail(401, 'Invalid username or password.');
  if (user!.status !== 'Active') fail(403, 'This account is inactive. Contact the administrator.');
  const updated = update('users', user!.id, { lastLogin: new Date().toISOString() })!;
  return c.json({ token: await signToken(user!.id), user: publicUser(updated) });
});

app.use('/api/*', async (c, next) => {
  if (c.req.path === '/api/auth/login' || c.req.path === '/api/health' || c.req.path === '/api/public-info') return next();
  const header = c.req.header('authorization') ?? '';
  const id = header.startsWith('Bearer ') ? await verifyToken(header.slice(7)) : null;
  const user = id ? get('users', id) : undefined;
  if (!user || user.status !== 'Active') return c.json({ error: 'Your session has expired. Please sign in again.' }, 401);
  c.set('user', user);
  if (c.req.method !== 'GET' && user.role === 'Committee Member' && !c.req.path.startsWith('/api/auth/'))
    return c.json({ error: 'Your role has read-only access.' }, 403);
  // Settings (users, master data, signing officers, configuration) can only be changed by an Administrator.
  if (c.req.method !== 'GET' && user.role !== 'Administrator' && /^\/api\/c\/signatories(\/|$)/.test(c.req.path))
    return c.json({ error: 'Only an Administrator can change settings.' }, 403);
  await next();
});

const adminOnly = async (c: { get: (k: 'user') => Rec }, next: () => Promise<void>) => {
  if (c.get('user').role !== 'Administrator') fail(403, 'Only administrators can do this.');
  await next();
};

app.get('/api/auth/me', (c) => c.json(publicUser(c.get('user'))));

app.post('/api/auth/change-password', async (c) => {
  const { currentPassword, newPassword } = await c.req.json<{ currentPassword?: string; newPassword?: string }>();
  const user = c.get('user');
  if (!verifyPassword(String(currentPassword ?? ''), user.passwordHash)) fail(400, 'Current password is incorrect.');
  if (String(newPassword ?? '').length < 8) fail(400, 'New password must be at least 8 characters.');
  update('users', user.id, { passwordHash: hashPassword(String(newPassword)) });
  return c.json({ ok: true });
});

/* ---------------------------- Users ---------------------------- */

app.use('/api/users/*', adminOnly);
app.use('/api/users', adminOnly);

app.get('/api/users', (c) => c.json(all('users').map(publicUser)));

/** Settings is admin-only, so there must always be at least one active Administrator. */
const activeAdmins = () => all('users').filter((u) => u.role === 'Administrator' && u.status === 'Active').length;

app.post('/api/users', async (c) => {
  const b = await c.req.json<Record<string, string>>();
  const username = String(b.username ?? '').trim().toLowerCase();
  if (!/^[a-z0-9_.-]{3,32}$/.test(username)) fail(400, 'Username must be 3–32 characters: letters, digits, _ . -');
  if (findOne('users', (u) => u.username === username)) fail(400, 'That username is already taken.');
  if (!ROLES.includes(b.role)) fail(400, 'Select a valid role.');
  if (!b.fullName?.trim()) fail(400, 'Full name is required.');
  const password = b.password?.length ? b.password : randomPassword();
  if (password.length < 8 && b.password) fail(400, 'Password must be at least 8 characters.');
  const u = insert('users', { username, fullName: b.fullName.trim(), email: b.email ?? '', role: b.role, status: b.status || 'Active', lastLogin: '', passwordHash: hashPassword(password) });
  return c.json({ user: publicUser(u), password: b.password ? undefined : password }, 201);
});

app.put('/api/users/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const cur = get('users', id) ?? fail(404, 'User not found.');
  const b = await c.req.json<Record<string, string>>();
  if (b.role && !ROLES.includes(b.role)) fail(400, 'Select a valid role.');
  if (id === c.get('user').id && (b.status === 'Inactive' || (b.role && b.role !== 'Administrator'))) fail(400, 'You cannot demote or deactivate your own account.');
  const losesAdmin = cur.role === 'Administrator' && cur.status === 'Active' && ((b.role && b.role !== 'Administrator') || b.status === 'Inactive');
  if (losesAdmin && activeAdmins() <= 1) fail(400, 'This is the only active Administrator. Make another user Administrator first.');
  const u = update('users', id, { fullName: b.fullName ?? cur.fullName, email: b.email ?? cur.email, role: b.role ?? cur.role, status: b.status ?? cur.status });
  return c.json(publicUser(u!));
});

app.delete('/api/users/:id', (c) => {
  const id = Number(c.req.param('id'));
  if (id === c.get('user').id) fail(400, 'You cannot remove your own account.');
  const target = get('users', id) ?? fail(404, 'User not found.');
  if (target.role === 'Administrator' && target.status === 'Active' && activeAdmins() <= 1) fail(400, 'This is the only active Administrator and cannot be removed.');
  remove('users', id);
  return c.json({ ok: true });
});

app.post('/api/users/:id/reset-password', (c) => {
  const id = Number(c.req.param('id'));
  if (!get('users', id)) fail(404, 'User not found.');
  const password = randomPassword();
  update('users', id, { passwordHash: hashPassword(password) });
  return c.json({ password });
});

/* ------------------------- Backup & Restore ------------------------- */

app.use('/api/backups', adminOnly);
app.use('/api/backups/*', adminOnly);
const backupName = (n: string) => (isBackupName(n) && existsSync(backupPath(n)) ? n : fail(404, 'Backup not found.'));
const MAX_RESTORE = 1024 * 1024 * 1024; // 1 GB

app.get('/api/backups', (c) => c.json({ folder: BACKUP_DIR, backups: listBackups() }));
app.post('/api/backups', (c) => c.json(createBackup('Manual'), 201));
app.get('/api/backups/:name/download', (c) => {
  const name = backupName(c.req.param('name'));
  return c.body(readFileSync(backupPath(name)), 200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${name}"` });
});
app.delete('/api/backups/:name', (c) => {
  deleteBackup(backupName(c.req.param('name')));
  return c.json({ ok: true });
});
const runRestore = (buf: Buffer) => {
  try {
    return restoreBackup(buf);
  } catch (e) {
    return fail(400, e instanceof Error ? e.message : 'The backup could not be restored.');
  }
};
app.post('/api/backups/:name/restore', (c) => c.json(runRestore(readFileSync(backupPath(backupName(c.req.param('name')))))));
app.post('/api/backups/restore-file', async (c) => {
  const len = Number(c.req.header('content-length') ?? 0);
  if (len > MAX_RESTORE) fail(400, 'The backup file is larger than 1 GB.');
  const buf = Buffer.from(await c.req.arrayBuffer());
  if (!buf.length) fail(400, 'No backup file received.');
  return c.json(runRestore(buf));
});

/* ---------------------- Masters & configuration ---------------------- */

app.get('/api/masters', (c) => c.json(Object.fromEntries(all('masters').map((m) => [m.key, m.values]))));

app.put('/api/masters/:key', adminOnly, async (c) => {
  const key = c.req.param('key');
  const { values } = await c.req.json<{ values?: unknown }>();
  if (!Array.isArray(values)) fail(400, 'Values must be a list.');
  const list = [...new Set((values as unknown[]).map((v) => String(v).trim()).filter(Boolean))];
  if (!list.length) fail(400, 'At least one value is required.');
  const m = findOne('masters', (x) => x.key === key);
  if (m) update('masters', m.id, { values: list });
  else insert('masters', { key, values: list });
  return c.json({ key, values: list });
});

app.get('/api/config', (c) => c.json(getConfig()));

app.put('/api/config', adminOnly, async (c) => {
  const b = await c.req.json<Record<string, unknown>>();
  const next: Record<string, unknown> = {};
  for (const k of Object.keys(DEFAULT_CONFIG)) if (k in b) next[k] = b[k];
  const n = Number(next.allotmentTenureYears ?? getConfig().allotmentTenureYears);
  if (!Number.isInteger(n) || n < 1 || n > 10) fail(400, 'Allotment tenure must be 1–10 years.');
  if ('takeoverDays' in next) {
    const t = Number(next.takeoverDays);
    if (!Number.isInteger(t) || t < 1 || t > 90) fail(400, 'Take-over period must be 1–90 days.');
    next.takeoverDays = t;
  }
  for (const k of ['printMarginTop', 'printMarginRight', 'printMarginBottom', 'printMarginLeft'] as const) {
    if (!(k in next)) continue;
    const m = Number(next[k]);
    if (!Number.isFinite(m) || m < 0 || m > 40) fail(400, 'Print margins must be between 0 and 40 mm.');
    next[k] = m;
  }
  const cur = all('config')[0];
  const saved = cur ? update('config', cur.id, next) : insert('config', { ...DEFAULT_CONFIG, ...next });
  return c.json(saved);
});

/** Allotment priority rules, shared by the Seniority List, Waiting List and Quarter Allotment. Administrator only. */
app.put('/api/priority-rules', adminOnly, async (c) => {
  const b = await c.req.json<{ rules?: unknown }>().catch(() => ({ rules: undefined }));
  if (!Array.isArray(b.rules)) fail(400, 'Send the list of priority rules.');
  const list = b.rules as Record<string, unknown>[];
  if (list.length > 20) fail(400, 'At most 20 priority rules.');
  const rules = list.map((r) => ({ office: String(r?.office ?? '').trim(), type: String(r?.type ?? '') }));
  if (rules.some((r) => !PRIORITY_TYPES.includes(r.type))) fail(400, 'Type of priority must be Change of Accn, Fresh or Any.');
  const seen = new Set<string>();
  for (const [i, r] of rules.entries()) {
    const k = `${r.office.toLowerCase()}|${r.type}`;
    if (seen.has(k)) fail(400, `Priority ${i + 1} repeats an earlier priority (${r.office || 'Any office'} · ${r.type || 'Any type'}).`);
    seen.add(k);
  }
  const cur = all('config')[0];
  if (cur) update('config', cur.id, { priorityRules: rules });
  else insert('config', { ...DEFAULT_CONFIG, priorityRules: rules });
  return c.json({ rules });
});

/**
 * Record an allotment board that was held before (or outside) this system, with its signed PDF.
 * Every allotment it decided is created as a real allotment, so the Quarter Register, Applicant Register,
 * Seniority List, Allotment Orders, Quarter Occupation and Dashboard all update together.
 */
app.post('/api/proceedings/past-board', async (c) => {
  type Line = {
    quarterNo?: string; applicationNo?: string; orderNo?: string; allotmentDate?: string; occupiedOn?: string; boardRemarks?: string;
    person?: { name?: string; rank?: string; serviceNo?: string; officeName?: string; trade?: string; payLevel?: string; entitlement?: string };
  };
  const b = await c.req.json<{ proceedings?: Record<string, unknown>; allotments?: Line[] }>();
  const lines = Array.isArray(b.allotments) ? b.allotments : [];
  if (lines.length > 100) fail(400, 'At most 100 allotments per board.');
  const cfg = getConfig();
  const result = tx(() => {
    const proc = prepareCreate('proceedings', { ...(b.proceedings ?? {}), allotments: [] });
    const date = String(proc.proceedingsDate);
    const seenQ = new Set<string>();
    const seenS = new Set<string>();
    const snapshots: Record<string, unknown>[] = [];
    lines.forEach((l, i) => {
      const n = `Allotment ${i + 1}`;
      const qno = String(l.quarterNo ?? '').trim().toUpperCase();
      const q = findOne('quarters', (x) => x.quarterNo === qno);
      if (!q) fail(400, `${n}: quarter ${qno || '(blank)'} is not in the Quarter Register.`);
      if (q!.status !== 'Vacant') fail(400, `${n}: ${qno} is ${String(q!.status).toLowerCase()}${q!.occupant ? ` (${q!.occupant})` : ''}. Only a vacant quarter can be allotted.`);
      if (findOne('allotments', (a) => a.quarterNo === qno && a.status === 'Allotted')) fail(400, `${n}: ${qno} already has an active allotment.`);
      if (seenQ.has(qno)) fail(400, `${n}: ${qno} appears twice in this board.`);
      seenQ.add(qno);

      // The allottee: an application already in the system, or a person recorded from the board.
      let app: Rec | undefined;
      if (l.applicationNo) {
        app = findOne('applications', (a) => a.applicationNo === l.applicationNo);
        if (!app) fail(400, `${n}: application ${l.applicationNo} not found.`);
        if (!WAITING_STATUSES.includes(app!.status)) fail(400, `${n}: application ${l.applicationNo} is ${app!.status}.`);
      } else {
        const p = l.person ?? {};
        const serviceNo = String(p.serviceNo ?? '').trim().toUpperCase();
        const name = String(p.name ?? '').trim().toUpperCase();
        if (!serviceNo || !name) fail(400, `${n}: enter the allottee's name and service no., or choose an application.`);
        app = findOne('applications', (a) => a.serviceNo === serviceNo && WAITING_STATUSES.includes(a.status));
        if (!app) {
          if (findOne('allotments', (a) => a.serviceNo === serviceNo && a.status === 'Allotted')) fail(400, `${n}: ${serviceNo} already holds an allotted quarter.`);
          const entitlement = String(p.entitlement || q!.category);
          app = insert('applications', {
            applicationNo: nextNumber('applications', date), applicationDate: date, status: 'Eligible', name, serviceNo,
            rank: String(p.rank ?? '').trim(), trade: String(p.trade ?? '').trim(), officeName: String(p.officeName ?? '').trim(), payLevel: String(p.payLevel ?? '').trim(),
            entitlement, categoryRequested: q!.category, station: q!.station, subDivision: q!.subDivision, accnPool: q!.accnPool ?? '',
            applicationType: 'Fresh', applicationGround: 'Regular', priority: priorityFor(entitlement),
            waitingOrder: Math.max(0, ...all('applications').map((a) => Number(a.waitingOrder) || 0)) + 1,
            scrutinyDate: date, scrutinyRule: `Allotted by Board ${proc.proceedingsNo}`, source: 'Past Board',
            remarks: `Recorded from allotment board ${proc.proceedingsNo} dated ${date}.`,
          });
        }
      }
      if (seenS.has(app!.serviceNo)) fail(400, `${n}: ${app!.name} (${app!.serviceNo}) appears twice in this board.`);
      seenS.add(app!.serviceNo);

      const allotmentDate = String(l.allotmentDate || date);
      const orderNo = String(l.orderNo ?? '').trim() || nextNumber('allotments', allotmentDate)!;
      if (findOne('allotments', (a) => a.orderNo === orderNo)) fail(400, `${n}: allotment order no. ${orderNo} already exists.`);
      const occupiedOn = String(l.occupiedOn ?? '');
      if (occupiedOn && occupiedOn < allotmentDate) fail(400, `${n}: take-over date cannot be before the allotment date.`);
      const rec = insert('allotments', {
        orderNo, applicationNo: app!.applicationNo, quarterNo: qno, allotmentDate, fromDate: allotmentDate,
        toDate: addYears(allotmentDate, Number(cfg.allotmentTenureYears) || 3), status: 'Allotted',
        allotteeName: app!.name, serviceNo: app!.serviceNo, rank: app!.rank ?? '', payLevel: app!.payLevel ?? '',
        allotmentType: app!.applicationType === 'Change of Accn' ? 'Change' : 'Fresh',
        category: q!.category, station: q!.station, subDivision: q!.subDivision,
        occupationStatus: occupiedOn ? 'Occupied' : 'Awaiting', occupiedOn,
        takeoverBy: addDays(allotmentDate, Number(cfg.takeoverDays) || 8),
        remarks: `Allotted by Board ${proc.proceedingsNo}.`,
      });
      afterWrite('allotments', rec, null); // quarter → Occupied, application → Allotted
      snapshots.push({ orderNo, allotmentDate, quarterNo: qno, category: q!.category, rank: rec.rank, allotteeName: rec.allotteeName, serviceNo: rec.serviceNo, applicationNo: rec.applicationNo, boardRemarks: String(l.boardRemarks ?? '') });
    });
    const saved = insert('proceedings', { ...proc, allotments: snapshots, pastBoard: true });
    return { proceedings: saved, created: snapshots.length };
  });
  return c.json(result, 201);
});

/** Choices for the Priority filter (Seniority List, Waiting List, Quarter Allotment): P1…Pn and Others. */
app.get('/api/priority-options', (c) => {
  const rules = getConfig().priorityRules ?? [];
  if (!rules.length) return c.json([]);
  return c.json([
    ...rules.map((r, i) => ({ value: String(i + 1), label: `P${i + 1} · ${r.office || 'Any office'} · ${r.type || 'Any type'}` })),
    // "Others" only when no priority already catches everyone (Any office · Any type).
    ...(rules.some((r) => !r.office && !r.type) ? [] : [{ value: String(rules.length + 1), label: `P${rules.length + 1} · Others` }]),
  ]);
});

/* --------------------------- Statistics --------------------------- */

app.get('/api/stats/quarters', (c) => c.json(quarterStats(c.req.query())));
app.get('/api/stats/vacancy-matrix', (c) => c.json(vacancyMatrix(c.req.query())));
/** Quarter no. → location, so every quarter number on screen can show where it is. */
app.get('/api/quarter-locations', (c) => c.json(Object.fromEntries(all('quarters').map((q) => [q.quarterNo, String(q.location ?? '')]))));
app.get('/api/stats/quarters-by-location', (c) => c.json(quartersByLocation(c.req.query())));
app.get('/api/stats/applications-by-location', (c) => c.json(applicationsByLocation(c.req.query())));
app.get('/api/stats/waiting', (c) => c.json(waitingStats(c.req.query())));
app.get('/api/seniority', (c) => c.json(seniorityList(c.req.query())));

/** Current allotments with the allottee's office (from the application), for office-wise bulk orders. */
app.get('/api/allotments/office-wise', (c) => {
  const apps = new Map(all('applications').map((a) => [a.applicationNo, a]));
  const procs = proceedingsByOrder();
  const rows = all('allotments')
    .filter((a) => a.status === 'Allotted')
    .map((a) => {
      const app = a.applicationNo ? apps.get(a.applicationNo) : undefined;
      return { ...a, officeName: app?.officeName ?? '', trade: app?.trade ?? '', proceedingsNo: procs.get(a.orderNo) ?? '' } as Rec;
    })
    .sort((x, y) => String(y.allotmentDate).localeCompare(String(x.allotmentDate)) || String(x.orderNo).localeCompare(String(y.orderNo), 'en-GB', { numeric: true }));
  return c.json(rows);
});

/** Allotments with everything the allotment letter needs: trade and unit from the application, location from the quarter. */
app.get('/api/allotments/letter', (c) => {
  const ids = new Set(String(c.req.query('ids') ?? '').split(',').map(Number).filter(Boolean));
  const apps = new Map(all('applications').map((a) => [a.applicationNo, a]));
  const quarters = new Map(all('quarters').map((q) => [q.quarterNo, q]));
  return c.json(
    all('allotments')
      .filter((a) => ids.has(a.id))
      .map((a) => {
        const app = a.applicationNo ? apps.get(a.applicationNo) : undefined;
        const q = quarters.get(a.quarterNo);
        return { ...a, ...occupation(a), trade: app?.trade ?? '', officeName: app?.officeName ?? '', location: q?.station ?? a.station ?? '', block: q?.block ?? '' } as Rec;
      }),
  );
});

/**
 * Retention / extension cases with the details their orders need: trade and office from the person's
 * latest application (matched on service no.), quarter type and location from the quarter register.
 */
function retentionRows(filter: (r: Rec) => boolean) {
  const apps = all('applications').sort((a, b) => String(b.applicationDate).localeCompare(String(a.applicationDate)));
  const quarters = new Map(all('quarters').map((q) => [q.quarterNo, q]));
  return all('retentions')
    .filter(filter)
    .map((r) => {
      const app = apps.find((a) => a.serviceNo === r.serviceNo);
      const q = quarters.get(r.quarterNo);
      return { ...r, rank: app?.rank ?? '', trade: app?.trade ?? '', officeName: app?.officeName ?? '', category: q?.category ?? '', location: q?.station ?? r.station ?? '' } as Rec;
    })
    .sort((a, b) => String(b.fromDate).localeCompare(String(a.fromDate)));
}
app.get('/api/retentions/letter', (c) => {
  const ids = new Set(String(c.req.query('ids') ?? '').split(',').map(Number).filter(Boolean));
  return c.json(retentionRows((r) => ids.has(r.id)));
});
app.get('/api/retentions/office-wise', (c) => {
  const type = c.req.query('caseType');
  return c.json(retentionRows((r) => r.status === 'Approved' && (!type || r.caseType === type)));
});

/* --------------------- Document downloads (folder per person) --------------------- */

type DlFile = { fileId: string; name: string };
type DlItem = { id: number; folder: string; label: string; detail: string; status: string; officeName: string; files: DlFile[] };
const DL_KINDS = ['applications', 'policies', 'retentions', 'proceedings'] as const;
type DlKind = (typeof DL_KINDS)[number];
const DL_ROOT: Record<DlKind, string> = { applications: 'Applicant Documents', policies: 'Policy Documents', retentions: 'Retention-Extension Documents', proceedings: 'Board Proceedings' };

const safeName = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Document';
const extOf = (n: string) => (/\.[A-Za-z0-9]{1,5}$/.exec(n)?.[0] ?? '').toLowerCase();

/** Unique file names inside a folder: "Salary Slip.pdf", "Salary Slip (2).pdf". */
function nameFiles(docs: { description?: string; fileId?: string; fileName?: string }[]): DlFile[] {
  const used = new Set<string>();
  return docs
    .filter((d) => d.fileId)
    .map((d) => {
      const ext = extOf(d.fileName ?? '');
      const base = safeName(d.description || (d.fileName ?? '').replace(/\.[^.]+$/, '') || 'Document');
      let name = `${base}${ext}`;
      for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} (${n})${ext}`;
      used.add(name.toLowerCase());
      return { fileId: d.fileId!, name };
    });
}

function downloadItems(kind: DlKind): DlItem[] {
  const folders = new Set<string>();
  const unique = (f: string, extra: string) => {
    let name = safeName(f);
    if (folders.has(name.toLowerCase())) name = safeName(`${f} - ${extra}`);
    folders.add(name.toLowerCase());
    return name;
  };
  if (kind === 'applications')
    return all('applications')
      .map((a) => ({ a, files: nameFiles(Array.isArray(a.documents) ? a.documents : []) }))
      .filter((x) => x.files.length)
      .sort((x, y) => String(x.a.name).localeCompare(String(y.a.name)))
      .map(({ a, files }) => ({
        id: a.id,
        folder: unique(`${a.name} (${a.serviceNo})`, a.applicationNo),
        label: `${a.rank && a.rank !== 'Civilian' ? `${a.rank} ` : ''}${a.name} (${a.serviceNo})`,
        detail: `${a.applicationNo} · ${a.categoryRequested ?? ''}`,
        status: a.status,
        officeName: a.officeName ?? '',
        files,
      }));
  if (kind === 'policies')
    return all('policies')
      .filter((p) => p.document?.fileId)
      .map((p) => ({
        id: p.id,
        folder: unique(p.title, String(p.id)),
        label: p.title,
        detail: `${Array.isArray(p.rules) ? p.rules.length : 0} rules`,
        status: p.status,
        officeName: '',
        files: nameFiles([{ description: p.title, fileId: p.document.fileId, fileName: p.document.fileName }]),
      }));
  if (kind === 'proceedings')
    return all('proceedings')
      .filter((p) => p.document?.fileId)
      .sort((x, y) => String(y.proceedingsDate).localeCompare(String(x.proceedingsDate)))
      .map((p) => ({
        id: p.id,
        folder: unique(`${p.proceedingsNo} (${p.proceedingsDate})`, String(p.id)),
        label: `${p.proceedingsNo} · ${p.proceedingsDate}`,
        detail: `${p.presidingOfficer ?? ''} · ${Array.isArray(p.allotments) ? p.allotments.length : 0} allotment(s)`,
        status: 'Held',
        officeName: '',
        files: nameFiles([{ description: `Board Proceedings ${p.proceedingsNo}`, fileId: p.document.fileId, fileName: p.document.fileName }]),
      }));
  return all('retentions')
    .map((r) => ({ r, files: nameFiles(Array.isArray(r.documents) ? r.documents : []) }))
    .filter((x) => x.files.length)
    .map(({ r, files }) => ({
      id: r.id,
      folder: unique(`${r.name} (${r.serviceNo}) - ${r.caseType}`, String(r.id)),
      label: `${r.name} (${r.serviceNo})`,
      detail: `${r.caseType} · ${r.quarterNo}`,
      status: r.status,
      officeName: '',
      files,
    }));
}

const dlKind = (k: string): DlKind => ((DL_KINDS as readonly string[]).includes(k) ? (k as DlKind) : fail(404, 'Unknown download.'));

app.get('/api/downloads/:kind', (c) => c.json({ root: DL_ROOT[dlKind(c.req.param('kind'))], items: downloadItems(dlKind(c.req.param('kind'))) }));

app.post('/api/downloads/:kind/zip', async (c) => {
  const kind = dlKind(c.req.param('kind'));
  const { ids } = await c.req.json<{ ids?: number[] }>();
  const want = new Set((ids ?? []).map(Number));
  const items = downloadItems(kind).filter((i) => want.has(i.id));
  if (!items.length) fail(400, 'Select at least one entry with documents.');
  const root = `${DL_ROOT[kind]} ${isoDate()}`;
  const entries: ZipEntry[] = [];
  for (const it of items)
    for (const f of it.files) {
      const path = join(UPLOAD_DIR, f.fileId);
      if (/^[0-9a-f-]{36}$/.test(f.fileId) && existsSync(path)) entries.push({ name: `${root}/${it.folder}/${f.name}`, data: readFileSync(path) });
    }
  if (!entries.length) fail(404, 'The selected documents could not be found on the server.');
  return c.body(new Uint8Array(buildZip(entries)), 200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${encodeURIComponent(root)}.zip"`,
  });
});

/** Proceedings numbers (newest first), for the Proceedings dropdowns. */
app.get('/api/proceedings-list', (c) =>
  c.json(all('proceedings').filter((p) => p.proceedingsNo).sort((a, b) => String(b.proceedingsDate).localeCompare(String(a.proceedingsDate))).map((p) => p.proceedingsNo)),
);

/** Everything about one quarter: the register entry, present occupant, and its allotment / vacation / retention history. */
app.get('/api/quarter-details', (c) => {
  const no = String(c.req.query('quarterNo') ?? '');
  const q = findOne('quarters', (x) => x.quarterNo === no);
  if (!q) fail(404, `Quarter ${no} was not found.`);
  const allotments = all('allotments')
    .filter((a) => a.quarterNo === no)
    .map((a) => decorate('allotments', a))
    .sort((a, b) => String(b.allotmentDate).localeCompare(String(a.allotmentDate)));
  const current = allotments.find((a) => a.status === 'Allotted') ?? null;
  const app = current?.applicationNo ? findOne('applications', (a) => a.applicationNo === current.applicationNo) : undefined;
  return c.json({
    quarter: q,
    current: current ? { ...current, trade: app?.trade ?? '', mobile: app?.mobile ?? '' } : null,
    allotments,
    vacations: all('vacations').filter((v) => v.quarterNo === no).map((v) => decorate('vacations', v)).sort((a, b) => String(b.vacationDate).localeCompare(String(a.vacationDate))),
    retentions: all('retentions').filter((r) => r.quarterNo === no).sort((a, b) => String(b.fromDate).localeCompare(String(a.fromDate))),
  });
});

/** Office names in use (from applications), for office-wise dropdowns. */
app.get('/api/offices', (c) => {
  // The Office Names master (Settings), plus any older names still on applications so they can be matched.
  const master = (findOne('masters', (m) => m.key === 'offices')?.values as string[] | undefined) ?? [];
  const used = all('applications').map((a) => String(a.officeName ?? '').trim());
  return c.json([...new Set([...master, ...used].filter(Boolean))].sort((x, y) => x.localeCompare(y, 'en-GB')));
});

/** Automatic scrutiny of one application against the active policy. */
app.get('/api/scrutiny/:id', (c) => c.json(assess(getRecord('applications', Number(c.req.param('id'))))));

/**
 * Everything needed to print a proceeding with its appendices, read live:
 * Appendix A – the allotments in the proceeding, each with its quarter and full application;
 * Appendix B – the current waiting list with full applications.
 */
app.get('/api/proceedings/:id/appendix', (c) => {
  const p = decorate('proceedings', getRecord('proceedings', Number(c.req.param('id'))));
  const allotments = new Map(all('allotments').map((a) => [a.orderNo, a]));
  const quarters = new Map(all('quarters').map((q) => [q.quarterNo, q]));
  const apps = new Map(all('applications').map((a) => [a.applicationNo, decorate('applications', a)]));
  const appendixA = (p.allotments as Rec[]).map((s) => {
    const a = allotments.get(s.orderNo);
    return {
      allotment: a ? { ...a, ...occupation(a) } : { ...s, status: 'Deleted' },
      boardRemarks: s.boardRemarks ?? '',
      quarter: a ? (quarters.get(a.quarterNo) ?? null) : null,
      application: a?.applicationNo ? (apps.get(a.applicationNo) ?? null) : null,
    };
  });
  const categories = (all('masters').find((m) => m.key === 'categories')?.values as string[]) ?? [];
  return c.json({ proceeding: p, appendixA, appendixB: waitingList(), config: getConfig(), categories });
});
app.get('/api/stats/dashboard', (c) => c.json(dashboardStats(c.req.query('month') || isoDate().slice(0, 7))));
app.get('/api/notifications', (c) => c.json(notifications()));
app.get('/api/reports/:key', (c) => c.json(buildReport(c.req.param('key'), c.req.query())));

/* ----------------------------- Uploads ----------------------------- */

const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_UPLOAD = 20 * 1024 * 1024; // scanned board proceedings can be large

app.post('/api/uploads', async (c) => {
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) fail(400, 'No file received.');
  const f = file as File;
  if (!ALLOWED_MIME.includes(f.type)) fail(400, 'Only PDF, JPG or PNG files are accepted.');
  if (f.size > MAX_UPLOAD) fail(400, 'File exceeds the 20 MB limit.');
  const id = randomUUID();
  writeFileSync(join(UPLOAD_DIR, id), Buffer.from(await f.arrayBuffer()));
  db.prepare('INSERT INTO uploads (id, name, mime, size) VALUES (?, ?, ?, ?)').run(id, f.name.slice(0, 200), f.type, f.size);
  return c.json({ id, name: f.name, size: f.size, mime: f.type }, 201);
});

app.get('/api/uploads/:id', (c) => {
  const id = c.req.param('id');
  const meta = db.prepare('SELECT * FROM uploads WHERE id = ?').get(id) as { name: string; mime: string } | undefined;
  const path = join(UPLOAD_DIR, id);
  if (!meta || !/^[0-9a-f-]{36}$/.test(id) || !existsSync(path)) fail(404, 'File not found.');
  return c.body(readFileSync(path), 200, {
    'Content-Type': meta!.mime,
    'Content-Disposition': `inline; filename="${encodeURIComponent(meta!.name)}"`,
    'X-Content-Type-Options': 'nosniff',
  });
});

/* ------------------------- Generic records ------------------------- */

const collection = (name: string): Collection => {
  if (!(COLLECTIONS as readonly string[]).includes(name)) fail(404, 'Unknown collection.');
  return name as Collection;
};

app.get('/api/c/:col', (c) => c.json(listQuery(collection(c.req.param('col')), c.req.query())));

app.get('/api/c/:col/next-number', (c) => c.json({ value: nextNumber(collection(c.req.param('col')), c.req.query('date')) }));

app.get('/api/c/:col/:id', (c) => {
  const col = collection(c.req.param('col'));
  return c.json(decorate(col, getRecord(col, Number(c.req.param('id')))));
});

/** Reads the rules out of a policy PDF whenever its document is new or changed. */
async function withPolicyRules(body: Record<string, unknown>, prev?: Rec) {
  const doc = body.document as { fileId?: string } | null | undefined;
  if (!doc?.fileId) fail(400, 'Upload the policy document (PDF).');
  if (prev && prev.document?.fileId === doc!.fileId && Array.isArray(prev.rules) && prev.rules.length) return { ...body, rules: prev.rules };
  try {
    return { ...body, rules: await extractRules(doc!.fileId!) };
  } catch (e) {
    return fail(400, e instanceof Error ? e.message : 'Could not read the policy document.');
  }
}

app.post('/api/c/:col', async (c) => {
  const col = collection(c.req.param('col'));
  let body = await c.req.json();
  if (col === 'policies') body = await withPolicyRules(body);
  const rec = tx(() => {
    const r = insert(col, prepareCreate(col, body));
    afterWrite(col, r, null);
    return r;
  });
  return c.json(decorate(col, rec), 201);
});

app.put('/api/c/:col/:id', async (c) => {
  const col = collection(c.req.param('col'));
  const id = Number(c.req.param('id'));
  let body = await c.req.json();
  if (col === 'policies' && 'document' in body) body = await withPolicyRules(body, getRecord(col, id));
  const rec = tx(() => {
    const prev = getRecord(col, id);
    const r = update(col, id, prepareUpdate(col, prev, body))!;
    afterWrite(col, r, prev);
    return r;
  });
  return c.json(decorate(col, rec));
});

app.delete('/api/c/:col/:id', (c) => {
  const col = collection(c.req.param('col'));
  const id = Number(c.req.param('id'));
  tx(() => {
    beforeDelete(col, getRecord(col, id));
    remove(col, id);
  });
  return c.json({ ok: true });
});

/** Bulk create (imports) and partial updates (re-ordering), all-or-nothing. */
app.post('/api/c/:col/bulk', async (c) => {
  const col = collection(c.req.param('col'));
  const { create = [], patch = [] } = await c.req.json<{ create?: Record<string, unknown>[]; patch?: { id: number; data: Record<string, unknown> }[] }>();
  if (create.length + patch.length > 2000) fail(400, 'Too many rows in one request (max 2000).');
  const result = tx(() => {
    let created = 0;
    create.forEach((row, i) => {
      try {
        const r = insert(col, prepareCreate(col, row));
        afterWrite(col, r, null);
        created++;
      } catch (e) {
        if (e instanceof HTTPException) fail(400, `Row ${i + 1}: ${e.message}`);
        throw e;
      }
    });
    for (const p of patch) {
      const prev = getRecord(col, Number(p.id));
      const r = update(col, prev.id, prepareUpdate(col, prev, p.data))!;
      afterWrite(col, r, prev);
    }
    return { created, updated: patch.length };
  });
  return c.json(result);
});

app.all('/api/*', (c) => c.json({ error: 'Not found.' }, 404));

/* --------------------- Static front end (production) --------------------- */

const DIST = join(import.meta.dirname, '..', 'dist');
if (existsSync(DIST)) {
  app.use('/*', serveStatic({ root: DIST }));
  const indexHtml = readFileSync(join(DIST, 'index.html'), 'utf8');
  app.get('*', (c) => c.html(indexHtml));
}

startAutomaticBackups();
const port = Number(process.env.PORT) || 3001;
serve({ fetch: app.fetch, port }, () => {
  console.log(`AWAS API listening on http://localhost:${port}`);
  if (existsSync(DIST)) console.log(`Serving the web app from ${DIST}`);
});

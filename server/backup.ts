/**
 * Backup & Restore.
 * A backup is one ZIP file: the whole database (gmaams.db) plus every uploaded document (uploads/…),
 * with backup-info.json describing it. Backups are kept in DATA_DIR/backups and can be downloaded
 * (e.g. to a pen drive) and restored later, fully offline.
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { db, DATA_DIR, UPLOAD_DIR } from './db.ts';
import { buildZip, type ZipEntry } from './zip.ts';

export const BACKUP_DIR = join(DATA_DIR, 'backups');
mkdirSync(BACKUP_DIR, { recursive: true });

export type BackupKind = 'Manual' | 'Automatic' | 'Before Restore';
export type BackupInfo = { name: string; kind: BackupKind; createdAt: string; size: number; records?: number; documents?: number };

const KEEP_AUTOMATIC = 30;
const NAME_RE = /^AWAS-backup-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-(manual|automatic|before-restore)\.zip$/;
const UPLOAD_NAME_RE = /^[0-9a-f-]{36}$/;
const kindSlug: Record<BackupKind, string> = { Manual: 'manual', Automatic: 'automatic', 'Before Restore': 'before-restore' };
const slugKind = Object.fromEntries(Object.entries(kindSlug).map(([k, v]) => [v, k])) as Record<string, BackupKind>;

export const isBackupName = (name: string) => NAME_RE.test(name);

function stamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

/** A consistent copy of the live database, taken while the app keeps running. */
function snapshotDb(): Buffer {
  const tmp = join(BACKUP_DIR, `.snapshot-${process.pid}-${Date.now()}.db`);
  try {
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    return readFileSync(tmp);
  } finally {
    if (existsSync(tmp)) unlinkSync(tmp);
  }
}

export function createBackup(kind: BackupKind): BackupInfo {
  const createdAt = new Date().toISOString();
  const entries: ZipEntry[] = [{ name: 'gmaams.db', data: snapshotDb() }];
  const files = existsSync(UPLOAD_DIR) ? readdirSync(UPLOAD_DIR).filter((f) => UPLOAD_NAME_RE.test(f)) : [];
  for (const f of files) entries.push({ name: `uploads/${f}`, data: readFileSync(join(UPLOAD_DIR, f)) });
  const records = Number((db.prepare('SELECT COUNT(*) AS n FROM records').get() as { n: number }).n);
  const info = { app: 'AWAS', format: 1, kind, createdAt, records, documents: files.length };
  entries.push({ name: 'backup-info.json', data: Buffer.from(JSON.stringify(info, null, 2)) });

  // Two backups in the same second get distinct names.
  let d = new Date();
  let name = `AWAS-backup-${stamp(d)}-${kindSlug[kind]}.zip`;
  while (existsSync(join(BACKUP_DIR, name))) {
    d = new Date(d.getTime() + 1000);
    name = `AWAS-backup-${stamp(d)}-${kindSlug[kind]}.zip`;
  }
  const zip = buildZip(entries);
  writeFileSync(join(BACKUP_DIR, name), zip);
  if (kind === 'Automatic') pruneAutomatic();
  return { name, kind, createdAt, size: zip.length, records, documents: files.length };
}

export function listBackups(): BackupInfo[] {
  return readdirSync(BACKUP_DIR)
    .filter(isBackupName)
    .map((name) => {
      const st = statSync(join(BACKUP_DIR, name));
      const slug = name.replace(/^.*-(manual|automatic|before-restore)\.zip$/, '$1');
      return { name, kind: slugKind[slug] ?? 'Manual', createdAt: st.mtime.toISOString(), size: st.size };
    })
    .sort((a, b) => b.name.slice(12, 31).localeCompare(a.name.slice(12, 31)));
}

export const backupPath = (name: string) => join(BACKUP_DIR, name);

export function deleteBackup(name: string) {
  unlinkSync(join(BACKUP_DIR, name));
}

function pruneAutomatic() {
  for (const b of listBackups().filter((x) => x.kind === 'Automatic').slice(KEEP_AUTOMATIC)) deleteBackup(b.name);
}

/** One automatic backup per day, taken the first time the app runs that day (checked hourly). */
export function startAutomaticBackups() {
  const run = () => {
    try {
      const today = stamp().slice(0, 10);
      if (!listBackups().some((b) => b.kind === 'Automatic' && b.name.slice(12, 22) === today)) createBackup('Automatic');
    } catch (e) {
      console.error('Automatic backup failed:', e);
    }
  };
  run();
  setInterval(run, 60 * 60 * 1000).unref();
}

/* ------------------------------------------------------------------ */
/* Reading a backup ZIP                                                */
/* ------------------------------------------------------------------ */

function readZip(buf: Buffer): Map<string, Buffer> {
  // End of central directory: search backwards for its signature.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--)
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error('This file is not a valid ZIP backup.');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('The backup file is damaged.');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);
    if (method === 0) out.set(name, Buffer.from(raw));
    else if (method === 8) out.set(name, inflateRawSync(raw));
    else throw new Error(`Unsupported compression in backup entry ${name}.`);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Checks a backup before anything is changed; returns what it holds. */
function inspect(buf: Buffer) {
  const files = readZip(buf);
  const dbBuf = files.get('gmaams.db');
  let info: Record<string, unknown> = {};
  try {
    info = JSON.parse(files.get('backup-info.json')?.toString('utf8') ?? '{}');
  } catch {
    /* checked below */
  }
  if (!dbBuf || info.app !== 'AWAS') throw new Error('This is not an AWAS backup file.');
  const tmp = join(BACKUP_DIR, `.restore-${process.pid}-${Date.now()}.db`);
  writeFileSync(tmp, dbBuf);
  try {
    const check = new DatabaseSync(tmp, { readOnly: true });
    try {
      const ok = check.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('records','uploads')").all().length === 2;
      if (!ok) throw new Error('The database inside this backup is incomplete.');
      const admins = (check.prepare("SELECT data FROM records WHERE collection='users'").all() as { data: string }[])
        .map((r) => JSON.parse(r.data))
        .filter((u) => u.role === 'Administrator' && u.status === 'Active').length;
      if (!admins) throw new Error('This backup has no active Administrator, so nobody could sign in after restoring it.');
      const records = Number((check.prepare('SELECT COUNT(*) AS n FROM records').get() as { n: number }).n);
      return { tmp, files, records };
    } finally {
      check.close();
    }
  } catch (e) {
    unlinkSync(tmp);
    throw e;
  }
}

/**
 * Restores a backup over the live data. A "Before Restore" backup of the current data is taken first,
 * so a restore can always be undone.
 */
export function restoreBackup(buf: Buffer): { safety: BackupInfo; records: number; documents: number } {
  const { tmp, files, records } = inspect(buf);
  try {
    const safety = createBackup('Before Restore');
    db.exec(`ATTACH DATABASE '${tmp.replace(/'/g, "''")}' AS bk`);
    try {
      db.exec('BEGIN');
      try {
        db.exec('DELETE FROM records');
        db.exec('INSERT INTO records (id, collection, data, created_at, updated_at) SELECT id, collection, data, created_at, updated_at FROM bk.records');
        db.exec('DELETE FROM uploads');
        db.exec('INSERT INTO uploads (id, name, mime, size, created_at) SELECT id, name, mime, size, created_at FROM bk.uploads');
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    } finally {
      db.exec('DETACH DATABASE bk');
    }
    let documents = 0;
    for (const [name, data] of files) {
      const m = /^uploads\/([0-9a-f-]{36})$/.exec(name);
      if (!m) continue;
      writeFileSync(join(UPLOAD_DIR, m[1]), data);
      documents++;
    }
    return { safety, records, documents };
  } finally {
    if (existsSync(tmp)) unlinkSync(tmp);
  }
}

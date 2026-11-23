import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const DATA_DIR = process.env.DATA_DIR ?? join(import.meta.dirname, '..', 'data');
export const UPLOAD_DIR = join(DATA_DIR, 'uploads');
mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, 'gmaams.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS records (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    collection  TEXT NOT NULL,
    data        TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_records_collection ON records(collection);
  CREATE TABLE IF NOT EXISTS uploads (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    mime        TEXT NOT NULL,
    size        INTEGER NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Rec = Record<string, any> & { id: number };

interface Row {
  id: number | bigint;
  data: string;
  created_at: string;
  updated_at: string;
}

const parse = (r: Row): Rec => ({
  ...JSON.parse(r.data),
  id: Number(r.id),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const strip = (data: Record<string, unknown>) => {
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = data;
  return rest;
};

const stmts = {
  all: db.prepare('SELECT * FROM records WHERE collection = ? ORDER BY id'),
  get: db.prepare('SELECT * FROM records WHERE collection = ? AND id = ?'),
  insert: db.prepare('INSERT INTO records (collection, data) VALUES (?, ?)'),
  update: db.prepare("UPDATE records SET data = ?, updated_at = datetime('now') WHERE collection = ? AND id = ?"),
  remove: db.prepare('DELETE FROM records WHERE collection = ? AND id = ?'),
  count: db.prepare('SELECT COUNT(*) AS n FROM records WHERE collection = ?'),
};

export function all(col: string): Rec[] {
  return (stmts.all.all(col) as unknown as Row[]).map(parse);
}

export function get(col: string, id: number): Rec | undefined {
  const r = stmts.get.get(col, id) as unknown as Row | undefined;
  return r ? parse(r) : undefined;
}

export function findOne(col: string, pred: (r: Rec) => boolean): Rec | undefined {
  return all(col).find(pred);
}

export function insert(col: string, data: Record<string, unknown>): Rec {
  const r = stmts.insert.run(col, JSON.stringify(strip(data)));
  return get(col, Number(r.lastInsertRowid))!;
}

export function update(col: string, id: number, patch: Record<string, unknown>): Rec | undefined {
  const cur = get(col, id);
  if (!cur) return undefined;
  stmts.update.run(JSON.stringify(strip({ ...cur, ...patch })), col, id);
  return get(col, id);
}

export function remove(col: string, id: number): boolean {
  return Number(stmts.remove.run(col, id).changes) > 0;
}

export function count(col: string): number {
  return Number((stmts.count.get(col) as { n: number }).n);
}

let depth = 0;
/** Runs fn inside a transaction (re-entrant). */
export function tx<T>(fn: () => T): T {
  if (depth > 0) return fn();
  depth++;
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    depth--;
  }
}

/** Local-time ISO date (YYYY-MM-DD). */
export function isoDate(d = new Date()): string {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

/** Tenure end date: same day n years later, minus one day. */
export function addYears(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setFullYear(d.getFullYear() + n);
  d.setDate(d.getDate() - 1);
  return isoDate(d);
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00`) - Date.parse(`${fromIso}T00:00:00`)) / 86400000);
}

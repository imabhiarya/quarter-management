import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sign, verify } from 'hono/jwt';
import { DATA_DIR } from './db.ts';

function loadSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = join(DATA_DIR, '.jwt-secret');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const s = randomBytes(48).toString('hex');
  writeFileSync(file, s, { mode: 0o600 });
  return s;
}

const SECRET = loadSecret();
const TOKEN_TTL_SECONDS = 60 * 60 * 10; // 10-hour working day

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password: string, stored: string | undefined): boolean {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function signToken(userId: number): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign({ sub: String(userId), iat: now, exp: now + TOKEN_TTL_SECONDS }, SECRET, 'HS256');
}

export async function verifyToken(token: string): Promise<number | null> {
  try {
    const payload = await verify(token, SECRET, 'HS256');
    return Number(payload.sub) || null;
  } catch {
    return null;
  }
}

export function randomPassword(): string {
  return randomBytes(6).toString('base64url');
}

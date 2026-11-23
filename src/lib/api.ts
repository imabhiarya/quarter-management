const TOKEN_KEY = 'gmaams.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable – session lasts until reload */
  }
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type Query = Record<string, string | number | undefined | null>;

export function qs(query?: Query): string {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; query?: Query } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) body = opts.body;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(`/api${path}${qs(opts.query)}`, { method: opts.method ?? 'GET', headers, body });
  if (res.status === 401 && path !== '/auth/login') {
    setToken(null);
    window.dispatchEvent(new Event('gmaams:logout'));
  }
  const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status);
  // Quarter numbers on screen show their location; tell them when quarters (or a restore / past board) may have changed it.
  if ((opts.method ?? 'GET') !== 'GET' && /^\/(c\/quarters|backups|proceedings\/past-board)/.test(path)) window.dispatchEvent(new Event('awas-quarters-changed'));
  return data as T;
}

/** Fetches a protected file and opens it in a new tab. */
async function fetchUpload(id: string): Promise<Blob> {
  const res = await fetch(`/api/uploads/${id}`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new ApiError(res.status === 404 ? 'The file could not be found.' : 'Could not open the file.', res.status);
  return res.blob();
}

/** Opens a protected file in a new tab. The tab is opened first so pop-up blockers allow it. */
export async function openUpload(id: string) {
  const win = window.open('', '_blank');
  try {
    const url = URL.createObjectURL(await fetchUpload(id));
    if (win) win.location.href = url;
    else window.location.assign(url);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    win?.close();
    throw e;
  }
}

/** Downloads a protected file under its original name. */
export async function downloadUpload(id: string, name: string) {
  const url = URL.createObjectURL(await fetchUpload(id));
  const a = document.createElement('a');
  a.href = url;
  a.download = name || 'document';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export type Row = Record<string, any> & { id: number }; // eslint-disable-line @typescript-eslint/no-explicit-any
export type Page<T = Row> = { rows: T[]; total: number };

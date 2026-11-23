import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertTriangle, X } from 'lucide-react';
import { api, getToken, setToken, type Row } from './api';

/* ------------------------------- Auth ------------------------------- */

export type User = Row & { username: string; fullName: string; role: 'Administrator' | 'Dealing Clerk' | 'Committee Member' };

type AuthCtx = {
  user: User | null;
  ready: boolean;
  canEdit: boolean;
  isAdmin: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
};
const Auth = createContext<AuthCtx>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) return setReady(true);
    api<User>('/auth/me')
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    const onLogout = () => setUser(null);
    window.addEventListener('gmaams:logout', onLogout);
    return () => window.removeEventListener('gmaams:logout', onLogout);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const r = await api<{ token: string; user: User }>('/auth/login', { method: 'POST', body: { username, password } });
    setToken(r.token);
    setUser(r.user);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, ready, login, logout, canEdit: !!user && user.role !== 'Committee Member', isAdmin: user?.role === 'Administrator' }),
    [user, ready, login, logout],
  );
  return <Auth.Provider value={value}>{children}</Auth.Provider>;
}
export const useAuth = () => useContext(Auth);

/* ------------------------------ Masters ------------------------------ */

export type Masters = Record<string, string[]>;
const MastersCtx = createContext<{ masters: Masters; reload: () => Promise<void> }>({ masters: {}, reload: async () => {} });

export function MastersProvider({ children }: { children: ReactNode }) {
  const [masters, setMasters] = useState<Masters>({});
  const reload = useCallback(async () => setMasters(await api<Masters>('/masters')), []);
  useEffect(() => {
    // Every dropdown depends on these lists, so if the server is briefly unreachable (e.g. restarting), keep retrying.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const attempt = (delay: number) =>
      reload().catch(() => {
        if (!cancelled) timer = setTimeout(() => attempt(Math.min(delay * 2, 15000)), delay);
      });
    attempt(1000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [reload]);
  return <MastersCtx.Provider value={{ masters, reload }}>{children}</MastersCtx.Provider>;
}
export const useMasters = () => useContext(MastersCtx);

export const MASTER_LABELS: Record<string, string> = {
  offices: 'Office Names',
  stations: 'Stations / Locations',
  subDivisions: 'Sub-Divisions',
  categories: 'Quarter Categories',
  ranks: 'Ranks',
  trades: 'Trades',
  payLevels: 'Pay Levels',
  payCells: 'Pay Cells',
  vacationReasons: 'Vacation Reasons',
  documentTypes: 'Document Types',
  designations: 'Agenda Action By',
  venues: 'Meeting Venues',
  locations: 'Accommodation Locations',
  applicationGrounds: 'Application Grounds',
  accnPools: 'Accn Pools',
  rejectionReasons: 'Rejection Reasons',
  retentionGrounds: 'Retention / Extension Grounds',
  changeReasons: 'Reasons for Change of Accn',
};

/* ------------------------------- Toasts ------------------------------- */

type Toast = { id: number; kind: 'success' | 'error'; text: string };
const ToastCtx = createContext<{ success: (t: string) => void; error: (t: unknown) => void }>(null!);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);
  const value = useMemo(
    () => ({
      success: (t: string) => push('success', t),
      error: (e: unknown) => push('error', e instanceof Error ? e.message : String(e)),
    }),
    [push],
  );
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="no-print fixed right-4 bottom-4 z-[100] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`animate-in flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm shadow-lg ${
              t.kind === 'success' ? 'border-green-200 bg-green-50 text-green-900' : 'border-red-200 bg-red-50 text-red-900'
            }`}
          >
            {t.kind === 'success' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" />}
            <span className="flex-1">{t.text}</span>
            <button aria-label="Dismiss" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
              <X className="size-4 opacity-60" />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

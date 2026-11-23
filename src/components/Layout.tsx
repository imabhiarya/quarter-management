import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Link, useLocation } from 'react-router';
import {
  House, LayoutDashboard, Building2, CalendarDays, FilePlus2, Users, ClipboardCheck, ListOrdered, Award, KeyRound, DoorOpen,
  ScrollText, FileText, RefreshCcw, BarChart3, Settings, Bell, ChevronDown, MapPin, DatabaseBackup, LogOut, Lock, Menu, X, RotateCw,
  type LucideIcon,
} from 'lucide-react';
import { api } from '../lib/api';
import { loadPrintSettings } from '../lib/printSettings';
import { useAuth, useToast } from '../lib/context';
import { Button, Label, Modal, cx } from './ui';

/** Each page has its own colour pair (gradient start → end) and belongs to a section of the menu. */
export const NAV: { to: string; label: string; icon: LucideIcon; section: string; c: [string, string] }[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, section: 'Overview', c: ['#f43f5e', '#be123c'] },
  { to: '/quarter-register', label: 'Quarter Register', icon: Building2, section: 'Quarters', c: ['#3b82f6', '#1d4ed8'] },
  { to: '/vacation-report', label: 'Vacation Report', icon: CalendarDays, section: 'Quarters', c: ['#06b6d4', '#0e7490'] },
  { to: '/new-application', label: 'New Application', icon: FilePlus2, section: 'Applications', c: ['#10b981', '#047857'] },
  { to: '/applicant-register', label: 'Applicant Register', icon: Users, section: 'Applications', c: ['#8b5cf6', '#6d28d9'] },
  { to: '/application-scrutiny', label: 'Application Scrutiny', icon: ClipboardCheck, section: 'Applications', c: ['#f59e0b', '#b45309'] },
  { to: '/seniority-list', label: 'Seniority List', icon: Award, section: 'Applications', c: ['#eab308', '#a16207'] },
  { to: '/quarter-allotment', label: 'Quarter Allotment', icon: KeyRound, section: 'Allotment', c: ['#ec4899', '#be185d'] },
  { to: '/quarter-occupation', label: 'Quarter Occupation', icon: DoorOpen, section: 'Allotment', c: ['#14b8a6', '#0f766e'] },
  { to: '/waiting-list', label: 'Waiting List', icon: ListOrdered, section: 'Allotment', c: ['#6366f1', '#4338ca'] },
  { to: '/proceedings', label: 'Proceedings', icon: ScrollText, section: 'Records', c: ['#a855f7', '#7e22ce'] },
  { to: '/allotment-orders', label: 'Allotment Orders', icon: FileText, section: 'Records', c: ['#0ea5e9', '#0369a1'] },
  { to: '/retention-extension', label: 'Retention / Extension', icon: RefreshCcw, section: 'Records', c: ['#f97316', '#c2410c'] },
  { to: '/reports', label: 'Reports & Returns', icon: BarChart3, section: 'Admin', c: ['#22c55e', '#15803d'] },
  { to: '/settings', label: 'Settings', icon: Settings, section: 'Admin', c: ['#64748b', '#334155'] },
  { to: '/backup', label: 'Backup & Restore', icon: DatabaseBackup, section: 'Admin', c: ['#0d9488', '#155e75'] },
];

type Note = { id: string; title: string; detail: string; link: string; tone: 'warn' | 'info' | 'danger' };

function useOutside(ref: React.RefObject<HTMLElement | null>, onOutside: () => void) {
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onOutside();
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [ref, onOutside]);
}

function Notifications() {
  const [items, setItems] = useState<Note[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  useOutside(ref, () => setOpen(false));
  useEffect(() => {
    const load = () => api<Note[]>('/notifications').then(setItems).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [pathname]);
  return (
    <div ref={ref} className="relative">
      <button
        className="relative grid size-10 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-md shadow-violet-500/30 ring-1 ring-white/30 transition hover:scale-105"
        aria-label={`Notifications (${items.length})`}
        onClick={() => setOpen((o) => !o)}
      >
        <Bell className={cx('size-5', items.length > 0 && 'origin-top animate-[wiggle_1.2s_ease-in-out_2]')} />
        {items.length > 0 && (
          <span className="absolute -top-1 -right-1 grid size-5 place-items-center rounded-full bg-gradient-to-br from-amber-400 to-red-500 text-[11px] font-bold ring-2 ring-brand-900">{items.length > 9 ? '9+' : items.length}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-800 shadow-xl">
          <div className="border-b border-slate-100 px-4 py-2.5 font-semibold text-brand-700">Notifications</div>
          <ul className="max-h-96 overflow-y-auto">
            {items.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-500">You’re all caught up.</li>}
            {items.map((n) => (
              <li key={n.id}>
                <Link to={n.link} onClick={() => setOpen(false)} className="flex gap-3 border-b border-slate-50 px-4 py-2.5 hover:bg-brand-50">
                  <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', n.tone === 'danger' ? 'bg-red-500' : n.tone === 'warn' ? 'bg-amber-500' : 'bg-sky-500')} />
                  <span>
                    <span className="block text-sm font-medium">{n.title}</span>
                    <span className="block text-xs text-slate-500">{n.detail}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ChangePassword({ onClose }: { onClose: () => void }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next.length < 8) return setError('New password must be at least 8 characters.');
    if (next !== confirm) return setError('The new passwords do not match.');
    setBusy(true);
    try {
      await api('/auth/change-password', { method: 'POST', body: { currentPassword: cur, newPassword: next } });
      toast.success('Password changed.');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Change Password"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="pw-form" variant="primary" loading={busy}>Change Password</Button>
        </>
      }
    >
      <form id="pw-form" onSubmit={submit} className="space-y-3">
        <div><Label htmlFor="pw-cur" required>Current password</Label><input id="pw-cur" type="password" autoComplete="current-password" className="input" value={cur} onChange={(e) => setCur(e.target.value)} /></div>
        <div><Label htmlFor="pw-new" required>New password</Label><input id="pw-new" type="password" autoComplete="new-password" className="input" value={next} onChange={(e) => setNext(e.target.value)} /></div>
        <div><Label htmlFor="pw-cf" required>Confirm new password</Label><input id="pw-cf" type="password" autoComplete="new-password" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
        {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      </form>
    </Modal>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false));
  const initials =
    String(user?.fullName ?? user?.username ?? '?')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('') || '?';
  const rainbow = 'bg-[linear-gradient(135deg,#f59e0b,#ec4899,#8b5cf6,#06b6d4)]';
  return (
    <div ref={ref} className="relative">
      {/* Gradient ring around a frosted pill */}
      <button
        className={cx('group rounded-full p-[2px] shadow-lg shadow-black/20 transition hover:scale-[1.03] hover:shadow-pink-500/30', rainbow)}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2.5 rounded-full bg-brand-900/85 py-1 pr-3 pl-1 backdrop-blur">
          <span className="relative">
            <span className={cx('grid size-9 place-items-center rounded-full text-sm font-bold tracking-wide text-white ring-2 ring-white/80', rainbow)}>
              {initials}
            </span>
            <span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full bg-emerald-400 ring-2 ring-brand-900" title="Online" />
          </span>
          <span className="hidden flex-col items-start leading-tight sm:flex">
            <span className="text-[15px] font-semibold">{user?.fullName}</span>
            <span className="bg-gradient-to-r from-amber-300 via-pink-300 to-cyan-300 bg-clip-text text-[11px] font-semibold tracking-wider text-transparent uppercase">
              {user?.role}
            </span>
          </span>
          <ChevronDown className={cx('size-4 text-white/80 transition-transform', open && 'rotate-180')} />
        </span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-3 w-72 overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-800 shadow-2xl">
          <div className={cx('flex items-center gap-3 px-4 py-4 text-white', rainbow)}>
            <span className="grid size-12 place-items-center rounded-full bg-white/25 text-lg font-bold ring-2 ring-white/70 backdrop-blur">{initials}</span>
            <div className="min-w-0">
              <div className="truncate font-semibold drop-shadow-sm">{user?.fullName}</div>
              <div className="truncate text-xs text-white/90">@{user?.username}</div>
              <span className="mt-1 inline-block rounded-full bg-white/25 px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase">{user?.role}</span>
            </div>
          </div>
          <div className="p-2">
            <button role="menuitem" className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium hover:bg-violet-50" onClick={() => (setPw(true), setOpen(false))}>
              <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-violet-500 to-cyan-500 text-white"><Lock className="size-4" /></span>
              Change password
            </button>
            <button role="menuitem" className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-red-700 hover:bg-red-50" onClick={logout}>
              <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-orange-500 to-pink-600 text-white"><LogOut className="size-4" /></span>
              Sign out
            </button>
          </div>
        </div>
      )}
      {pw && <ChangePassword onClose={() => setPw(false)} />}
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  const { isAdmin } = useAuth();
  useEffect(() => {
    loadPrintSettings();
  }, []);
  const { pathname } = useLocation();
  // Organisation under the system name, from Settings → System Configuration (e.g. "CWE Shillong").
  const [officeLine, setOfficeLine] = useState('');
  useEffect(() => {
    api<{ organisation: string }>('/public-info')
      .then((c) => setOfficeLine(c.organisation ?? ''))
      .catch(() => {});
  }, [pathname]);
  useEffect(() => setNavOpen(false), [pathname]);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="no-print sticky top-0 z-30 flex h-[76px] items-center gap-3 overflow-visible bg-[linear-gradient(110deg,#3b0617_0%,#6b0d2e_35%,#7a1040_60%,#4c1d5e_100%)] px-3 text-white shadow-lg shadow-brand-900/30 sm:px-5">
        {/* Soft colour glows behind the bar */}
        <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <span className="absolute -top-16 left-24 size-48 rounded-full bg-pink-500/25 blur-3xl" />
          <span className="absolute -top-20 left-1/2 size-56 rounded-full bg-violet-500/20 blur-3xl" />
          <span className="absolute -top-16 right-40 size-48 rounded-full bg-amber-400/15 blur-3xl" />
        </span>
        {/* Rainbow accent line */}
        <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] bg-[linear-gradient(90deg,#f59e0b,#ec4899,#8b5cf6,#06b6d4,#10b981)]" />

        <button className="relative rounded-lg p-1.5 hover:bg-white/10 lg:hidden" aria-label="Open menu" onClick={() => setNavOpen(true)}>
          <Menu className="size-6" />
        </button>
        <Link to="/" className="group relative flex items-center gap-3">
          <span className="grid size-12 place-items-center rounded-2xl bg-[linear-gradient(135deg,#f59e0b,#ec4899,#8b5cf6)] shadow-lg shadow-pink-500/30 ring-2 ring-white/30 transition group-hover:rotate-[-6deg] group-hover:scale-105">
            <House className="size-7" strokeWidth={2.4} />
          </span>
          <span className="flex flex-col leading-none">
            <span className="bg-[linear-gradient(90deg,#fff,#fde68a,#fbcfe8)] bg-clip-text text-[28px] font-extrabold tracking-wider text-transparent sm:text-[30px]">AWAS</span>
            <span className="mt-1 hidden text-[9px] font-semibold tracking-[0.25em] text-white/60 uppercase sm:block">Accommodation</span>
          </span>
        </Link>
        <span className="relative mx-2 hidden h-10 w-px bg-gradient-to-b from-transparent via-white/50 to-transparent md:block" />
        <span className="relative hidden min-w-0 flex-col gap-1 leading-tight md:flex">
          <span className="truncate text-lg font-semibold tracking-wide xl:text-[21px]">Govt Married Accommodation Management System</span>
          {officeLine && (
            <span className="inline-flex w-fit max-w-full items-center gap-1.5 truncate rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-medium text-white/90 ring-1 ring-white/20 backdrop-blur xl:text-[13px]">
              <MapPin className="size-3.5 shrink-0 text-amber-300" />
              <span className="truncate">{officeLine}</span>
            </span>
          )}
        </span>
        <div className="relative ml-auto flex items-center gap-2 sm:gap-3">
          <button
            className="group flex items-center gap-2 rounded-full bg-white/10 py-1.5 pr-3.5 pl-1.5 ring-1 ring-white/20 backdrop-blur transition hover:bg-white/20"
            title="Refresh the whole app"
            aria-label="Refresh"
            onClick={() => window.location.reload()}
          >
            <span className="grid size-7 place-items-center rounded-full bg-gradient-to-br from-cyan-400 to-emerald-500 shadow-md shadow-cyan-500/30">
              <RotateCw className="size-4 transition-transform duration-500 group-hover:rotate-180" />
            </span>
            <span className="hidden text-sm font-semibold sm:inline">Refresh</span>
          </button>
          <Notifications />
          <span className="hidden h-8 w-px bg-gradient-to-b from-transparent via-white/40 to-transparent sm:block" />
          <UserMenu />
        </div>
      </header>

      <div className="flex">
        {navOpen && <div className="no-print fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setNavOpen(false)} />}
        <aside
          className={cx(
            'no-print fixed inset-y-0 left-0 z-40 w-72 shrink-0 overflow-y-auto border-r border-white/60 bg-[linear-gradient(180deg,#fff7fa_0%,#fbf1ff_45%,#eef6ff_100%)] pt-2 pb-6 shadow-[4px_0_24px_-12px_rgba(111,15,47,0.25)] transition-transform lg:sticky lg:top-[76px] lg:z-10 lg:h-[calc(100vh-76px)] lg:translate-x-0',
            navOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <div className="mb-2 flex items-center justify-between px-4 lg:hidden">
            <span className="font-bold text-brand-700">Menu</span>
            <button aria-label="Close menu" onClick={() => setNavOpen(false)}><X className="size-5" /></button>
          </div>
          <nav className="px-3">
            {NAV.filter((n) => !['/settings', '/backup'].includes(n.to) || isAdmin).map(({ to, label, icon: Icon, section, c }, i, list) => (
              <div key={to}>
                {section !== list[i - 1]?.section && (
                  <div className="side-section" style={{ '--i': i } as React.CSSProperties}>{section}</div>
                )}
                <NavLink
                  to={to}
                  end={to === '/'}
                  style={{ '--i': i, '--c1': c[0], '--c2': c[1] } as React.CSSProperties}
                  className={({ isActive }) => cx('side-link', isActive && 'active')}
                >
                  <span className="side-ico">
                    <Icon className="size-[18px]" strokeWidth={2.2} />
                  </span>
                  <span className="truncate">{label}</span>
                </NavLink>
              </div>
            ))}
          </nav>
        </aside>
        <main className="min-w-0 flex-1 p-3 sm:p-5">{children}</main>
      </div>
    </div>
  );
}

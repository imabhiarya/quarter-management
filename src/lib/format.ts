const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** YYYY-MM-DD → 05-Mar-2026 */
export function fmtDate(s?: string | null): string {
  if (!s) return '—';
  const [y, m, d] = String(s).slice(0, 10).split('-');
  if (!d) return String(s);
  return `${d}-${MON[Number(m) - 1]}-${y}`;
}

export function fmtDateTime(s?: string | null): string {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return String(s);
  return `${fmtDate(isoDate(d))} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** YYYY-MM → November 2026 */
export const monthLabel = (ym: string, short = false) =>
  ym ? `${(short ? MON : MONTH_FULL)[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}` : '';

export function isoDate(d = new Date()): string {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}

export const currentMonth = () => isoDate().slice(0, 7);
export const currentYear = () => isoDate().slice(0, 4);

export function recentMonths(n = 24): { value: string; label: string }[] {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  return Array.from({ length: n }, () => {
    d.setMonth(d.getMonth() - 1);
    const v = isoDate(d).slice(0, 7);
    return { value: v, label: monthLabel(v, true).replace(' ', ' - ') };
  });
}

export function yearOptions(back = 6, ahead = 1): string[] {
  const y = Number(currentYear());
  return Array.from({ length: back + ahead + 1 }, (_, i) => String(y + ahead - i));
}

export const MONTH_OPTIONS = MONTH_FULL.map((label, i) => ({ value: String(i + 1).padStart(2, '0'), label }));

/** Pay level → entitled accommodation type. */
export function entitlementFor(payLevel?: string): string {
  const n = Number(String(payLevel ?? '').replace(/\D/g, ''));
  if (!n) return '';
  return n <= 5 ? 'Type I' : n <= 9 ? 'Type II' : n <= 12 ? 'Type III' : 'Type IV';
}

export const pad2 = (n: number) => String(n).padStart(2, '0');

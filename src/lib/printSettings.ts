import { api } from './api';

/** Page margins (mm) used by every printout. Set in Settings → System Configuration. */
export type PrintMargins = { top: number; right: number; bottom: number; left: number };

export const DEFAULT_MARGINS: PrintMargins = { top: 15, right: 12, bottom: 15, left: 20 };
let margins: PrintMargins = { ...DEFAULT_MARGINS };

const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : d);

export function applyPrintConfig(cfg: Record<string, unknown>) {
  margins = {
    top: num(cfg.printMarginTop, DEFAULT_MARGINS.top),
    right: num(cfg.printMarginRight, DEFAULT_MARGINS.right),
    bottom: num(cfg.printMarginBottom, DEFAULT_MARGINS.bottom),
    left: num(cfg.printMarginLeft, DEFAULT_MARGINS.left),
  };
}

export async function loadPrintSettings() {
  try {
    applyPrintConfig(await api<Record<string, unknown>>('/config'));
  } catch {
    /* keep the defaults */
  }
}

export const getMargins = (): PrintMargins => ({ ...margins });

/** CSS that applies the margins to every page, including named landscape pages. */
export function marginCss(): string {
  const m = `${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm`;
  return `@page{margin:${m}} @page appendix{margin:${m}} html,body{margin:0 !important;padding:0}`;
}

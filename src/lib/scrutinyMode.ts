/** Scrutiny mode chosen on the Application Scrutiny page, remembered on this browser. */
export type ScrutinyMode = 'auto' | 'manual';
const KEY = 'awas.scrutinyMode';

export function getScrutinyMode(): ScrutinyMode {
  try {
    return localStorage.getItem(KEY) === 'manual' ? 'manual' : 'auto';
  } catch {
    return 'auto';
  }
}

export function setScrutinyMode(mode: ScrutinyMode) {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* storage unavailable: the choice lasts until the page reloads */
  }
}

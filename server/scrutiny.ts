/**
 * Offline policy reading and automatic scrutiny.
 *
 * - extractRules: pulls the text out of a policy PDF and splits it into numbered rules / paras.
 * - assess: runs the checks the system can verify for an application and, for each,
 *   finds the rule in the active policy that the check corresponds to (by keywords).
 *
 * Nothing leaves this computer. Only text PDFs can be read; scanned images have no text.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractText, getDocumentProxy } from 'unpdf';
import { all, db, isoDate, UPLOAD_DIR, type Rec } from './db.ts';

/* ------------------------------------------------------------------ */
/* Reading the policy                                                  */
/* ------------------------------------------------------------------ */

// A new rule starts on a line such as "4.", "4)", "4.1", "Para 4", "Rule 4(a)", "Clause 12 -".
const RULE_START = /^\s*(?:(?:para(?:graph)?|rule|clause|section|article)\s*\.?\s*\d+[a-z]?(?:\s*\([a-z0-9]+\))?|\d{1,3}(?:\.\d{1,3})*\s*[.):-])\s*/i;

export function splitRules(text: string): string[] {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const rules: string[] = [];
  let current = '';
  for (const line of lines) {
    if (RULE_START.test(line)) {
      if (current) rules.push(current);
      current = line;
    } else if (current) {
      // Re-join words broken across lines ("L-" + "9").
      current += current.endsWith('-') ? line : ` ${line}`;
    }
  }
  if (current) rules.push(current);
  if (rules.length) return rules.map((r) => r.slice(0, 1000));

  // No numbering found: fall back to one rule per sentence.
  return lines
    .join(' ')
    .split(/(?<=[.;])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 25)
    .map((s) => s.slice(0, 1000));
}

export async function extractRules(fileId: string): Promise<string[]> {
  const meta = db.prepare('SELECT mime FROM uploads WHERE id = ?').get(fileId) as { mime: string } | undefined;
  if (!meta) throw new Error('The policy document could not be found. Upload it again.');
  if (meta.mime !== 'application/pdf') throw new Error('The policy document must be a PDF so that its rules can be read.');
  const pdf = await getDocumentProxy(new Uint8Array(readFileSync(join(UPLOAD_DIR, fileId))));
  const { text } = await extractText(pdf, { mergePages: false });
  const rules = splitRules((text as string[]).join('\n'));
  if (!rules.length)
    throw new Error('No readable text was found in this PDF. It may be a scanned image; upload a text PDF (e.g. saved from Word).');
  return rules;
}

/* ------------------------------------------------------------------ */
/* Automatic checks                                                    */
/* ------------------------------------------------------------------ */

export type Check = {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
  /** Reason recorded if the application is rejected on this check. */
  reason: string;
  rule: string | null;
};

export type Assessment = {
  policy: { id: number; title: string } | null;
  checks: Check[];
  decision: 'Eligible' | 'Rejected';
  reason: string;
  rule: string | null;
};

const KEYWORDS: Record<string, string[]> = {
  posting: ['posted', 'posting', 'permanent', 'joined the station', 'station'],
  entitlement: ['entitle', 'pay level', 'pay matrix', 'type i', 'higher than'],
  documents: ['document', 'accompanied', 'enclos', 'salary slip', 'certificate', 'attach'],
  holding: ['already holding', 'in occupation', 'occupation', 'holding government', 'holding govt', 'already allotted'],
  duplicate: ['duplicate', 'one application', 'more than one', 'only one'],
};

/** The rule whose text best matches a check's keywords. */
function matchRule(rules: string[], key: string): string | null {
  let best: string | null = null;
  let bestScore = 0;
  for (const r of rules) {
    const t = r.toLowerCase();
    const score = KEYWORDS[key].reduce((s, k) => s + (t.includes(k) ? (k.includes(' ') ? 2 : 1) : 0), 0);
    if (score > bestScore) (best = r), (bestScore = score);
  }
  return best;
}

const typeFor = (payLevel: unknown) => {
  const n = Number(String(payLevel ?? '').replace(/\D/g, ''));
  return n ? (n <= 5 ? 'Type I' : n <= 9 ? 'Type II' : n <= 12 ? 'Type III' : 'Type IV') : '';
};

/** Most recent active policy that has rules. */
export function activePolicy(): Rec | undefined {
  return all('policies')
    .filter((p) => p.status === 'Active' && Array.isArray(p.rules) && p.rules.length)
    .sort((a, b) => String(b.effectiveFrom ?? b.createdAt).localeCompare(String(a.effectiveFrom ?? a.createdAt)) || b.id - a.id)[0];
}

export function assess(app: Rec, ctx?: { quarters: Rec[]; applications: Rec[]; policy?: Rec; categories: string[] }): Assessment {
  const quarters = ctx?.quarters ?? all('quarters');
  const applications = ctx?.applications ?? all('applications');
  const policy = ctx ? ctx.policy : activePolicy();
  const categories = ctx?.categories ?? ((all('masters').find((m) => m.key === 'categories')?.values as string[]) ?? []);
  const rules: string[] = policy?.rules ?? [];
  const rank = (t: string) => categories.indexOf(t);

  const entitled = typeFor(app.payLevel) || app.entitlement || '';
  const docs: { description: string; mandatory: string; fileId?: string }[] = Array.isArray(app.documents) ? app.documents : [];
  const missingDocs = docs.filter((d) => d.mandatory === 'Yes' && !d.fileId).map((d) => d.description);
  const holding = quarters.find((q) => q.status === 'Occupied' && q.occupantServiceNo && q.occupantServiceNo === app.serviceNo);
  const duplicate = applications.find(
    (a) => a.id !== app.id && a.serviceNo === app.serviceNo && ['Pending', 'Scrutiny', 'Eligible', 'Recommended'].includes(a.status),
  );
  const joinedFuture = app.dateOfJoiningStation && app.dateOfJoiningStation > isoDate();
  const isChange = app.applicationType && app.applicationType !== 'Fresh';

  const checks: Check[] = [
    {
      key: 'posting',
      label: 'Posted in the station',
      ok: !!app.station && !!app.dateOfJoiningStation && !joinedFuture,
      detail: !app.station ? 'Station not recorded' : !app.dateOfJoiningStation ? 'Date of joining station not recorded' : joinedFuture ? 'Date of joining station is in the future' : `Joined ${app.station}`,
      reason: 'Not posted in the station',
      rule: matchRule(rules, 'posting'),
    },
    {
      key: 'entitlement',
      label: 'Entitlement by pay level',
      ok: !!entitled && !!app.categoryRequested && rank(app.categoryRequested) <= rank(entitled),
      detail: !entitled ? 'Pay level not recorded' : `${app.payLevel} → entitled to ${entitled}; requested ${app.categoryRequested || '—'}`,
      reason: 'Not entitled for the accn requested',
      rule: matchRule(rules, 'entitlement'),
    },
    {
      key: 'documents',
      label: 'Mandatory documents',
      ok: missingDocs.length === 0,
      detail: missingDocs.length ? `Missing: ${missingDocs.join(', ')}` : docs.length ? 'All mandatory documents uploaded' : 'No mandatory documents listed',
      reason: 'Incomplete / invalid documents',
      rule: matchRule(rules, 'documents'),
    },
    {
      key: 'holding',
      label: 'Not already holding Govt accommodation',
      ok: !holding || !!isChange,
      detail: holding ? `Occupying ${holding.quarterNo}${isChange ? ' — allowed for change of accommodation' : ''}` : 'No quarter held at the station',
      reason: 'Already holding Govt accommodation',
      rule: matchRule(rules, 'holding'),
    },
    {
      key: 'duplicate',
      label: 'No duplicate application',
      ok: !duplicate,
      detail: duplicate ? `Also applied under ${duplicate.applicationNo} (${duplicate.status})` : 'Only application for this service no.',
      reason: 'Duplicate application',
      rule: matchRule(rules, 'duplicate'),
    },
  ];

  const failed = checks.find((c) => !c.ok);
  return {
    policy: policy ? { id: policy.id, title: policy.title } : null,
    checks,
    decision: failed ? 'Rejected' : 'Eligible',
    reason: failed?.reason ?? '',
    rule: failed ? failed.rule : (checks.find((c) => c.key === 'entitlement')?.rule ?? checks.find((c) => c.rule)?.rule ?? null),
  };
}

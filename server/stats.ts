import { all, isoDate, addDays, daysBetween, type Rec } from './db.ts';
import { filterRows, decorate, getConfig, occupation, WAITING_STATUSES, ACCEPTED_STATUSES, priorityOf } from './logic.ts';

export function quarterStats(q: Record<string, string>) {
  const rows = filterRows(all('quarters'), {
    station: q.station ?? '',
    subDivision: q.subDivision ?? '',
    category: q.category ?? '',
    accnPool: q.accnPool ?? '',
    location: q.location ?? '',
  });
  const by = (s: string) => rows.filter((r) => r.status === s).length;
  return { total: rows.length, occupied: by('Occupied'), vacant: by('Vacant'), underRepair: by('Under Repair') };
}

export function waitingList(q: Record<string, string> = {}): Rec[] {
  const rows = all('applications')
    .filter((a) => ACCEPTED_STATUSES.includes(a.status))
    .map((a) => decorate('applications', a));
  // Same allotment priority as the Seniority List and Quarter Allotment, then the waiting-list order.
  const rules = getConfig().priorityRules ?? [];
  for (const a of rows) Object.assign(a, (({ group, label }) => ({ priorityGroup: group, priorityLabel: label }))(priorityOf(a, rules)));
  return filterRows(rows, q).sort((a, b) => a.priorityGroup - b.priorityGroup || (Number(a.waitingOrder) || 0) - (Number(b.waitingOrder) || 0));
}

/**
 * Seniority list: applications accepted in Application Scrutiny (Eligible, Recommended) and not yet allotted,
 * numbered separately within each accn type + accn pool. Seniority is by date of enrolment (earliest first),
 * then date of application, then application number.
 * Numbers are worked out before the text search, so searching never changes them.
 */
export function seniorityList(q: Record<string, string>) {
  const master = (key: string) => (all('masters').find((m) => m.key === key)?.values as string[]) ?? [];
  const categories = master('categories');
  const pools = master('accnPools');
  const rank = (list: string[], v: string) => (list.indexOf(v) + 1 || 99);
  const rows = filterRows(
    all('applications').filter((a) => ACCEPTED_STATUSES.includes(a.status)).map((a) => decorate('applications', a)),
    { categoryRequested: q.category ?? '', accnPool: q.accnPool ?? '', locationRequested: q.locationRequested ?? '', station: q.station ?? '' },
  );
  const s = (v: unknown) => String(v ?? '');
  const rules = getConfig().priorityRules ?? [];
  for (const a of rows) {
    const p = priorityOf(a, rules);
    a.priorityGroup = p.group;
    a.priorityLabel = p.label;
  }
  rows.sort(
    (a, b) =>
      rank(categories, a.categoryRequested) - rank(categories, b.categoryRequested) ||
      rank(pools, a.accnPool) - rank(pools, b.accnPool) ||
      a.priorityGroup - b.priorityGroup ||
      // Missing enrolment dates go to the end of their group.
      (s(a.dateOfEnrolment) || '9999').localeCompare(s(b.dateOfEnrolment) || '9999') ||
      s(a.applicationDate).localeCompare(s(b.applicationDate)) ||
      s(a.applicationNo).localeCompare(s(b.applicationNo), 'en-GB', { numeric: true }),
  );
  const counters = new Map<string, number>();
  const numbered = rows.map((a) => {
    const key = `${a.categoryRequested}|${a.accnPool ?? ''}`;
    const n = (counters.get(key) ?? 0) + 1;
    counters.set(key, n);
    return { ...a, seniorityNo: n };
  });
  // Like the text search, the priority filter is applied after numbering, so it never changes seniority numbers.
  return filterRows(numbered, { 'search_serviceNo,name,applicationNo': q.search ?? '', priorityGroup: q.priorityGroup ?? '' });
}

export function waitingStats(q: Record<string, string>) {
  const rows = waitingList({
    station: q.station ?? '',
    subDivision: q.subDivision ?? '',
    categoryRequested: q.categoryRequested ?? '',
    payLevel: q.payLevel ?? '',
    applicationType: q.applicationType ?? '',
    priorityGroup: q.priorityGroup ?? '',
  });
  const vacant = all('quarters').filter((x) => x.status === 'Vacant');
  let nextDue: string | null = null;
  for (const a of rows) {
    const match = vacant.find((v) => v.category === a.categoryRequested && (!a.station || v.station === a.station));
    if (match) {
      nextDue = `${match.quarterNo} (${match.category})`;
      break;
    }
  }
  return {
    total: rows.length,
    fresh: rows.filter((r) => r.applicationType === 'Fresh').length,
    change: rows.filter((r) => r.applicationType !== 'Fresh').length,
    longestWaiting: rows.reduce((m, r) => Math.max(m, Number(r.waitingDays) || 0), 0),
    nextDue,
  };
}

export function dashboardStats(month: string) {
  const quarters = all('quarters');
  const apps = all('applications');
  const allotments = all('allotments');

  const monthApps = apps.filter((a) => String(a.applicationDate ?? '').startsWith(month));
  const inStatus = (rows: Rec[], s: string[]) => rows.filter((r) => s.includes(r.status)).length;

  const recentProceedings = all('proceedings')
    .sort((x, y) => String(y.proceedingsDate).localeCompare(String(x.proceedingsDate)) || y.id - x.id)
    .slice(0, 4)
    .map((p) => ({ id: p.id, proceedingsNo: p.proceedingsNo, proceedingsDate: p.proceedingsDate, presidingOfficer: p.presidingOfficer, allotments: Array.isArray(p.allotments) ? p.allotments.length : 0 }));

  return {
    totalQuarters: quarters.length,
    vacantQuarters: quarters.filter((q) => q.status === 'Vacant').length,
    pendingApplications: inStatus(apps, WAITING_STATUSES),
    allottedQuarters: quarters.filter((q) => q.status === 'Occupied').length,
    recentApplications: apps
      .sort((a, b) => String(b.applicationDate).localeCompare(String(a.applicationDate)) || b.id - a.id)
      .slice(0, 5)
      .map((a) => ({ id: a.id, applicationNo: a.applicationNo, name: a.name, rank: a.rank, entitlement: a.categoryRequested, applicationDate: a.applicationDate, status: a.status })),
    recentProceedings,
    takeover: (() => {
      const cfg = getConfig();
      const states = allotments.filter((a) => a.status === 'Allotted').map((a) => occupation(a, cfg).occState);
      return {
        awaiting: states.filter((s) => s === 'Awaiting Take-over' || s === 'Deferment Granted').length,
        overdue: states.filter((s) => s === 'Overdue' || s === 'Not Taken Over').length,
      };
    })(),
    funnel: {
      received: monthApps.length,
      eligible: inStatus(monthApps, ['Eligible', 'Recommended', 'Allotted']),
      recommended: inStatus(monthApps, ['Recommended', 'Allotted']),
      allotted: allotments.filter((a) => String(a.allotmentDate ?? '').startsWith(month) && a.status !== 'Cancelled').length,
    },
  };
}

export function notifications() {
  const today = isoDate();
  const cfg = getConfig();
  const horizon = addDays(today, Number(cfg.vacationNoticeDays) || 30);
  const items: { id: string; title: string; detail: string; link: string; tone: 'warn' | 'info' | 'danger' }[] = [];

  for (const q of all('quarters')) {
    if (q.status === 'Occupied' && q.vacationDue && q.vacationDue <= horizon) {
      const days = daysBetween(today, q.vacationDue);
      items.push({
        id: `vac-${q.id}`,
        title: `${q.quarterNo} ${days < 0 ? 'overdue for vacation' : 'due for vacation'}`,
        detail: `${q.occupant} · ${days < 0 ? `${-days} days overdue` : `in ${days} days`}`,
        link: '/quarter-register',
        tone: days < 0 ? 'danger' : 'warn',
      });
    }
  }
  const scrutiny = all('applications').filter((a) => a.status === 'Pending').length;
  if (scrutiny) items.push({ id: 'apps', title: `${scrutiny} application(s) awaiting scrutiny`, detail: 'Open Application Scrutiny', link: '/application-scrutiny', tone: 'info' });
  const pendingTakeover = all('allotments')
    .filter((a) => a.status === 'Allotted')
    .map((a) => ({ a, o: occupation(a, cfg) }))
    .filter(({ o }) => o.occState === 'Overdue' || o.occState === 'Not Taken Over');
  if (pendingTakeover.length)
    items.unshift({
      id: 'takeover',
      title: `${pendingTakeover.length} allotted quarter(s) not taken over`,
      detail: 'Action due as per Rule 7 (1) of SRO 308',
      link: '/quarter-occupation',
      tone: 'danger',
    });
  const retention = all('retentions').filter((r) => r.status === 'Under Consideration').length;
  if (retention) items.push({ id: 'ret', title: `${retention} retention/extension case(s) under consideration`, detail: 'Awaiting decision', link: '/retention-extension', tone: 'info' });
  return items;
}

/**
 * Vacant quarters by location (or station) and type, next to the accepted applicants waiting for that
 * location and type — so an applicant can be allotted a quarter at the location they chose.
 */
export function vacancyMatrix(q: Record<string, string>) {
  const by = q.groupBy === 'station' ? 'station' : 'location';
  const master = (key: string) => (all('masters').find((m) => m.key === key)?.values as string[]) ?? [];
  const categories = master('categories');
  const quarters = filterRows(all('quarters'), { station: q.station ?? '', subDivision: q.subDivision ?? '', category: q.category ?? '', location: q.location ?? '' });
  const vacant = quarters.filter((x) => x.status === 'Vacant');
  const waiting = all('applications').filter((a) => ACCEPTED_STATUSES.includes(a.status) && (!q.category || (a.entitlement || a.categoryRequested) === q.category));
  const groupOfQ = (x: Rec) => String((by === 'location' ? x.location : x.station) || '').trim() || 'Not specified';
  const groupOfA = (a: Rec) => String((by === 'location' ? a.locationRequested : a.station) || '').trim() || 'Not specified';
  const order = by === 'location' ? master('locations') : master('stations');
  const groups = [...new Set([...order, ...vacant.map(groupOfQ), ...waiting.map(groupOfA)])].filter((g) => g !== 'Not specified' || vacant.some((x) => groupOfQ(x) === g) || waiting.some((a) => groupOfA(a) === g));
  const rows = groups.map((g) => {
    const cells = Object.fromEntries(
      categories.map((c) => [
        c,
        {
          vacant: vacant.filter((x) => groupOfQ(x) === g && x.category === c).map((x) => ({ quarterNo: x.quarterNo, station: x.station, subDivision: x.subDivision, location: x.location ?? '', accnPool: x.accnPool ?? '', block: x.block ?? '' })),
          waiting: waiting.filter((a) => groupOfA(a) === g && (a.entitlement || a.categoryRequested) === c).length,
        },
      ]),
    );
    return { group: g, cells, vacant: Object.values(cells).reduce((n, c) => n + c.vacant.length, 0), waiting: Object.values(cells).reduce((n, c) => n + c.waiting, 0) };
  });
  return { groupBy: by, categories, rows, totalVacant: vacant.length, totalWaiting: waiting.length };
}

/** Quarter Register, location-wise: total / occupied / vacant / under repair per location, with type-wise vacant. */
export function quartersByLocation(q: Record<string, string>) {
  const master = (key: string) => (all('masters').find((m) => m.key === key)?.values as string[]) ?? [];
  const categories = master('categories');
  const rows = filterRows(all('quarters'), { station: q.station ?? '', subDivision: q.subDivision ?? '', category: q.category ?? '', accnPool: q.accnPool ?? '' });
  const loc = (x: Rec) => String(x.location ?? '').trim();
  const names = [...new Set([...master('locations'), ...rows.map(loc).filter(Boolean)])];
  const make = (name: string, list: Rec[]) => ({
    location: name,
    total: list.length,
    occupied: list.filter((x) => x.status === 'Occupied').length,
    vacant: list.filter((x) => x.status === 'Vacant').length,
    underRepair: list.filter((x) => x.status === 'Under Repair').length,
    vacantByType: Object.fromEntries(categories.map((c) => [c, list.filter((x) => x.status === 'Vacant' && x.category === c).length])),
  });
  const out = names.map((n) => make(n, rows.filter((x) => loc(x) === n)));
  const none = rows.filter((x) => !loc(x));
  return { categories, rows: out, notSet: none.length ? make('', none) : null };
}

/** Applicant Register, location-wise: applications per chosen location and type of quarter requested. */
export function applicationsByLocation(q: Record<string, string>) {
  const master = (key: string) => (all('masters').find((m) => m.key === key)?.values as string[]) ?? [];
  const categories = master('categories');
  const rows = filterRows(all('applications'), {
    station: q.station ?? '', subDivision: q.subDivision ?? '', status: q.status ?? '', in_status: q.in_status ?? '', q: q.q ?? '',
  });
  const loc = (a: Rec) => String(a.locationRequested ?? '').trim();
  const pending = (a: Rec) => WAITING_STATUSES.includes(a.status);
  const make = (name: string, list: Rec[]) => ({
    location: name,
    total: list.length,
    pending: list.filter(pending).length,
    allotted: list.filter((a) => a.status === 'Allotted').length,
    byType: Object.fromEntries(categories.map((c) => {
      const t = list.filter((a) => a.categoryRequested === c);
      return [c, { total: t.length, pending: t.filter(pending).length }];
    })),
  });
  const names = [...new Set([...master('locations'), ...rows.map(loc).filter(Boolean)])];
  const none = rows.filter((a) => !loc(a));
  return { categories, rows: names.map((n) => make(n, rows.filter((a) => loc(a) === n))), notSet: none.length ? make('', none) : null, total: rows.length };
}

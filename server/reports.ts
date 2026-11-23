import { HTTPException } from 'hono/http-exception';
import { all } from './db.ts';
import { waitingList } from './stats.ts';
import { ACCEPTED_STATUSES, occupation, getConfig } from './logic.ts';

type Col = { key: string; label: string; type?: 'date' | 'number' };
type Report = { title: string; subtitle: string; columns: Col[]; rows: Record<string, unknown>[] };

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

const sorted = <T extends Record<string, unknown>>(rows: T[], key: string) =>
  [...rows].sort((a, b) => String(a[key] ?? '').localeCompare(String(b[key] ?? ''), 'en-GB', { numeric: true }));

export function buildReport(key: string, q: Record<string, string>): Report {
  const year = q.year || String(new Date().getFullYear());
  const month = q.month || `${year}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const categories = (all('masters').find((m) => m.key === 'categories')?.values as string[]) ?? ['Type I', 'Type II', 'Type III', 'Type IV'];

  switch (key) {
    case 'monthly-vacation':
      return {
        title: 'Monthly Vacation Report',
        subtitle: `Quarters vacated during ${monthName(month)}`,
        columns: [
          { key: 'subDivision', label: 'Sub-Division' }, { key: 'quarterNo', label: 'Quarter No.' }, { key: 'category', label: 'Category' },
          { key: 'prevOccupant', label: 'Previous Occupant' }, { key: 'serviceNo', label: 'Service No.' },
          { key: 'vacationDate', label: 'Vacation Date', type: 'date' }, { key: 'reason', label: 'Reason' },
        ],
        rows: sorted(all('vacations').filter((v) => String(v.vacationDate).startsWith(month)), 'vacationDate'),
      };

    case 'occupancy': {
      const quarters = all('quarters');
      const stations = [...new Set(quarters.map((x) => x.station))].sort();
      const rows: Record<string, unknown>[] = [];
      for (const station of stations)
        for (const category of categories) {
          const set = quarters.filter((x) => x.station === station && x.category === category);
          if (!set.length) continue;
          const n = (s: string) => set.filter((x) => x.status === s).length;
          rows.push({ station, category, total: set.length, occupied: n('Occupied'), vacant: n('Vacant'), repair: n('Under Repair'), rate: `${Math.round((n('Occupied') / set.length) * 100)}%` });
        }
      return {
        title: 'Quarter Occupancy Report',
        subtitle: 'Station and category-wise occupancy position as on date',
        columns: [
          { key: 'station', label: 'Station' }, { key: 'category', label: 'Category' }, { key: 'total', label: 'Total', type: 'number' },
          { key: 'occupied', label: 'Occupied', type: 'number' }, { key: 'vacant', label: 'Vacant', type: 'number' },
          { key: 'repair', label: 'Under Repair', type: 'number' }, { key: 'rate', label: 'Occupancy' },
        ],
        rows,
      };
    }

    case 'applicant-summary': {
      const apps = all('applications').filter((a) => String(a.applicationDate).startsWith(year));
      const statuses = ['Pending', 'Scrutiny', 'Eligible', 'Recommended', 'Allotted', 'Rejected', 'Withdrawn'];
      const rows = categories.map((category) => {
        const set = apps.filter((a) => a.categoryRequested === category);
        const row: Record<string, unknown> = { category, total: set.length };
        for (const s of statuses) row[s] = set.filter((a) => a.status === s).length;
        return row;
      });
      return {
        title: 'Applicant Summary',
        subtitle: `Applications received during ${year}, by category and status`,
        columns: [{ key: 'category', label: 'Category' }, { key: 'total', label: 'Total', type: 'number' }, ...statuses.map((s) => ({ key: s, label: s, type: 'number' as const }))],
        rows,
      };
    }

    case 'waiting-list':
      return {
        title: 'Waiting List Report',
        subtitle: 'Applicants accepted in scrutiny and awaiting allotment, in waiting-list order',
        columns: [
          { key: 'applicationNo', label: 'Application No.' }, { key: 'serviceNo', label: 'Service No.' }, { key: 'rank', label: 'Rank' },
          { key: 'name', label: 'Name' }, { key: 'payLevel', label: 'Pay Level' }, { key: 'categoryRequested', label: 'Category' },
          { key: 'applicationType', label: 'Type' }, { key: 'applicationDate', label: 'Date of Application', type: 'date' },
          { key: 'waitingDays', label: 'Waiting Days', type: 'number' }, { key: 'priority', label: 'Priority' },
        ],
        rows: waitingList(),
      };

    case 'allotment-statement':
      return {
        title: 'Allotment Statement',
        subtitle: `Allotments made during ${year}`,
        columns: [
          { key: 'orderNo', label: 'Order No.' }, { key: 'allotmentDate', label: 'Date', type: 'date' }, { key: 'quarterNo', label: 'Quarter No.' },
          { key: 'category', label: 'Category' }, { key: 'allotteeName', label: 'Allottee' }, { key: 'serviceNo', label: 'Service No.' },
          { key: 'allotmentType', label: 'Type' }, { key: 'toDate', label: 'Retention Upto', type: 'date' }, { key: 'status', label: 'Status' },
        ],
        rows: sorted(all('allotments').filter((a) => String(a.allotmentDate).startsWith(year)), 'allotmentDate'),
      };

    case 'retention-extension':
      return {
        title: 'Retention / Extension Report',
        subtitle: `Cases commencing in ${year}`,
        columns: [
          { key: 'name', label: 'Name' }, { key: 'serviceNo', label: 'Service No.' }, { key: 'quarterNo', label: 'Quarter No.' },
          { key: 'caseType', label: 'Case Type' }, { key: 'fromDate', label: 'From', type: 'date' }, { key: 'toDate', label: 'To', type: 'date' },
          { key: 'reason', label: 'Grounds' }, { key: 'status', label: 'Status' },
        ],
        rows: sorted(all('retentions').filter((r) => String(r.fromDate).startsWith(year)), 'fromDate'),
      };

    case 'proceedings-register':
      return {
        title: 'Proceedings Register',
        subtitle: `Proceedings recorded during ${year}`,
        columns: [
          { key: 'proceedingsNo', label: 'Proceedings No.' }, { key: 'proceedingsDate', label: 'Date', type: 'date' },
          { key: 'authority', label: 'Authority' }, { key: 'presidingOfficer', label: 'Presiding Officer' },
          { key: 'memberList', label: 'Members' }, { key: 'allotmentList', label: 'Allotments' },
        ],
        rows: sorted(all('proceedings').filter((p) => String(p.proceedingsDate).startsWith(year)), 'proceedingsDate').map((p) => ({
          ...p,
          memberList: Array.isArray(p.members) ? p.members.join(', ') : '',
          allotmentList: Array.isArray(p.allotments) ? p.allotments.map((a: Record<string, string>) => `${a.quarterNo} – ${a.allotteeName}`).join('; ') : '',
        })),
      };

    case 'occupation': {
      const cfg = getConfig();
      const apps = new Map(all('applications').map((a) => [a.applicationNo, a]));
      const quarters = new Map(all('quarters').map((q) => [q.quarterNo, q]));
      const d = (s: string) => (s ? s.split('-').reverse().join('-') : '');
      const rows = all('allotments')
        .filter((a) => String(a.allotmentDate).startsWith(year) && a.status !== 'Cancelled')
        .map((a) => {
          const o = occupation(a, cfg);
          const app = a.applicationNo ? apps.get(a.applicationNo) : undefined;
          const remarks =
            o.occState === 'Occupied' ? (a.occupiedOn ? `Occupied on ${d(a.occupiedOn)}` : 'Occupied')
            : o.occState === 'Deferment Granted' ? `Deferment up to ${d(a.deferredUpto)}`
            : o.occState === 'Awaiting Take-over' ? `Take-over due by ${d(o.occDeadline)}`
            : o.occState;
          return {
            orderNo: a.orderNo, allotmentDate: a.allotmentDate, serviceNo: a.serviceNo,
            name: `${a.allotteeName}${app?.trade ? `, ${app.trade}` : ''}`,
            quarter: `${a.quarterNo}${quarters.get(a.quarterNo)?.station ? ` (${quarters.get(a.quarterNo)!.station})` : ''}`,
            category: a.category, unit: app?.officeName ?? '', remarks,
            action: o.occState === 'Overdue' || o.occState === 'Not Taken Over' ? o.occAction : '',
          };
        })
        .sort((x, y) => String(x.allotmentDate).localeCompare(String(y.allotmentDate)));
      return {
        title: 'Quarter Occupation Report',
        subtitle: `Take-over position of quarters allotted during ${year}`,
        columns: [
          { key: 'orderNo', label: 'Order No.' }, { key: 'allotmentDate', label: 'Allotted On', type: 'date' },
          { key: 'serviceNo', label: 'MES / Service No.' }, { key: 'name', label: 'Name & Designation' },
          { key: 'quarter', label: 'Qtr No & Location' }, { key: 'category', label: 'Type of Qtr' },
          { key: 'unit', label: 'Unit' }, { key: 'remarks', label: 'Remarks' }, { key: 'action', label: 'Action as per SRO 308' },
        ],
        rows,
      };
    }

    case 'annual-return': {
      const quarters = all('quarters');
      const allotments = all('allotments').filter((a) => String(a.allotmentDate).startsWith(year) && a.status !== 'Cancelled');
      const vacations = all('vacations').filter((v) => String(v.vacationDate).startsWith(year));
      const apps = all('applications');
      const rows = categories.map((category) => {
        const qs = quarters.filter((x) => x.category === category);
        return {
          category,
          held: qs.length,
          occupied: qs.filter((x) => x.status === 'Occupied').length,
          vacant: qs.filter((x) => x.status === 'Vacant').length,
          repair: qs.filter((x) => x.status === 'Under Repair').length,
          allotted: allotments.filter((a) => a.category === category).length,
          vacated: vacations.filter((v) => v.category === category).length,
          received: apps.filter((a) => a.categoryRequested === category && String(a.applicationDate).startsWith(year)).length,
          waiting: apps.filter((a) => a.categoryRequested === category && ACCEPTED_STATUSES.includes(a.status)).length,
        };
      });
      return {
        title: 'Annual Return',
        subtitle: `Annual return of married accommodation for the year ${year}`,
        columns: [
          { key: 'category', label: 'Category' }, { key: 'held', label: 'Quarters Held', type: 'number' },
          { key: 'occupied', label: 'Occupied', type: 'number' }, { key: 'vacant', label: 'Vacant', type: 'number' },
          { key: 'repair', label: 'Under Repair', type: 'number' }, { key: 'allotted', label: 'Allotted in Year', type: 'number' },
          { key: 'vacated', label: 'Vacated in Year', type: 'number' }, { key: 'received', label: 'Applications Received', type: 'number' },
          { key: 'waiting', label: 'On Waiting List', type: 'number' },
        ],
        rows,
      };
    }
  }
  throw new HTTPException(404, { message: 'Unknown report.' });
}

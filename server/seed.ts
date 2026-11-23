import { db, insert, count, tx, isoDate, addDays, addYears } from './db.ts';
import { hashPassword } from './auth.ts';
import { nextNumber, priorityFor, DEFAULT_CONFIG } from './logic.ts';

export const MASTERS: Record<string, string[]> = {
  stations: ['Station A', 'Station B', 'Station C'],
  subDivisions: ['SD-I', 'SD-II', 'SD-III'],
  categories: ['Type I', 'Type II', 'Type III', 'Type IV'],
  ranks: ['Sep', 'Nk', 'Hav', 'Nb Sub', 'Sub', 'Sub Maj', 'Lt', 'Capt', 'Maj', 'Lt Col', 'Col', 'Civilian'],
  trades: ['Engrs', 'Sigs', 'Arty', 'Inf', 'ASC', 'EME', 'AOC', 'AMC', 'Clerk', 'Admin'],
  payLevels: Array.from({ length: 14 }, (_, i) => `L-${i + 1}`),
  payCells: Array.from({ length: 20 }, (_, i) => String(i + 1)),
  vacationReasons: ['Transfer', 'Posting Out', 'Retirement', 'Own Accommodation', 'Change of Accommodation', 'Death', 'Other'],
  documentTypes: ['Application Approved by Competent Authority', 'Salary Slip', 'Marriage Certificate', 'Posting Order', 'Other Documents'],
  designations: ['Chairman', 'Member Secretary', 'BSO (Accom)', 'Committee', 'Dealing Clerk'],
  venues: ['Conf. Room', 'Station HQ', 'BSO Office'],
  applicationGrounds: ['Regular', 'Medical', 'Special Sanction'],
  accnPools: ['Defence Pool', 'General Pool', 'Station Pool'],
  retentionGrounds: ['Children’s education', 'Medical grounds', 'Posted to non-family station', 'Compassionate grounds', 'Retirement / superannuation', 'Other'],
  rejectionReasons: ['Not entitled for the accn requested', 'Incomplete / invalid documents', 'Already holding Govt accommodation', 'Not posted in the station', 'Duplicate application', 'Other'],
  changeReasons: ['Promotion', 'Accn Under Repair', 'Other'],
  locations: ['Cantonment Area', 'Officers Enclave', 'Married Accommodation Project (MAP)', 'Station Colony'],
};

const SURNAMES = ['Kumar', 'Singh', 'Verma', 'Pandey', 'Yadav', 'Sharma', 'Gupta', 'Mishra', 'Rao', 'Patel', 'Nair', 'Menon', 'Das', 'Reddy', 'Joshi', 'Iyer', 'Khan', 'Thakur', 'Chauhan', 'Bose', 'Pillai', 'Rawat', 'Negi', 'Bhatt', 'Saini'];
const INITIALS = 'RASPMKVNDHJLTGBC';

function person(i: number) {
  const name = `${INITIALS[i % INITIALS.length]}. ${SURNAMES[(i * 7) % SURNAMES.length]}`.toUpperCase();
  const lvl = 1 + ((i * 5) % 14);
  const rank = lvl >= 13 ? 'Col' : lvl >= 12 ? 'Lt Col' : lvl >= 11 ? 'Maj' : lvl >= 10 ? 'Capt' : lvl >= 8 ? 'Sub' : lvl >= 6 ? 'Nb Sub' : lvl >= 4 ? 'Hav' : 'Nk';
  return {
    name,
    serviceNo: `EX-${1001 + i}`,
    rank: i % 6 === 5 ? 'Civilian' : rank,
    trade: MASTERS.trades[i % MASTERS.trades.length],
    payLevel: `L-${lvl}`,
  };
}

function categoryFor(payLevel: string) {
  const n = Number(payLevel.replace(/\D/g, ''));
  return n <= 5 ? 'Type I' : n <= 9 ? 'Type II' : n <= 12 ? 'Type III' : 'Type IV';
}

export function seed(force = false): boolean {
  if (!force && count('users') > 0) return false;

  tx(() => {
    if (force) db.exec('DELETE FROM records; DELETE FROM uploads;');
    const today = isoDate();
    const year = Number(today.slice(0, 4));
    const ym = today.slice(0, 7);

    for (const [key, values] of Object.entries(MASTERS)) insert('masters', { key, values });
    insert('config', { ...DEFAULT_CONFIG });

    const users = [
      { username: 'admin', fullName: 'System Administrator', role: 'Administrator', password: 'admin123' },
      { username: 'bso_accom', fullName: 'BSO (Accom)', role: 'Dealing Clerk', password: 'clerk123' },
      { username: 'member1', fullName: 'Committee Member', role: 'Committee Member', password: 'member123' },
    ];
    for (const u of users)
      insert('users', { username: u.username, fullName: u.fullName, role: u.role, status: 'Active', email: '', lastLogin: '', passwordHash: hashPassword(u.password) });

    /* Quarters + allotments for the occupied ones -------------------- */
    let p = 0;
    const occupiedPeople: { quarterNo: string; station: string; category: string; orderNo: string; allotmentDate: string; person: ReturnType<typeof person> }[] = [];
    MASTERS.categories.forEach((category, ci) => {
      for (let j = 0; j < 16; j++) {
        const quarterNo = `QTR-${ci + 1}${String(j + 1).padStart(2, '0')}`;
        const station = MASTERS.stations[j % 3];
        const subDivision = MASTERS.subDivisions[Math.floor(j / 2) % 3];
        const status = j % 7 === 3 ? 'Vacant' : j === 13 && ci % 2 === 0 ? 'Under Repair' : 'Occupied';
        const q: Record<string, unknown> = { quarterNo, category, accnPool: MASTERS.accnPools[j % 5 === 4 ? 1 : 0], station, subDivision, status, block: `Block ${String.fromCharCode(65 + (j % 4))}`, plinthArea: [45, 60, 80, 110][ci], remarks: '' };
        if (status === 'Occupied') {
          let who = person(p++);
          while (categoryFor(who.payLevel) !== category) who = person(p++);
          const allotmentDate = addDays(today, -(40 + ((j * 97 + ci * 61) % 950)));
          const toDate = addYears(allotmentDate, 3);
          Object.assign(q, { occupant: `${who.name} (${who.rank})`, occupantServiceNo: who.serviceNo, allotmentDate, vacationDue: toDate });
          const applicationDate = addDays(allotmentDate, -75);
          const appNo = nextNumber('applications', applicationDate)!;
          insert('applications', {
            applicationNo: appNo, applicationDate, ...who, officeName: `${station} Office`, station, subDivision,
            dateOfJoiningStation: addDays(applicationDate, -30), dateOfEnrolment: addDays(applicationDate, -3650 - j * 200),
            payCell: String(1 + (j % 10)), basicPay: 25000 + Number(who.payLevel.slice(2)) * 9000, entitlement: category, categoryRequested: category,
            applicationType: 'Fresh', mobile: `98${String(10000000 + p * 7919).slice(0, 8)}`, email: `${who.serviceNo.toLowerCase()}@example.gov.in`,
            exServiceman: 'No', status: 'Allotted', allottedQuarter: quarterNo, priority: priorityFor(category), waitingOrder: 0, documents: [],
          });
          const orderNo = nextNumber('allotments', allotmentDate)!;
          occupiedPeople.push({ quarterNo, station, category, orderNo, allotmentDate, person: who });
          insert('allotments', {
            orderNo, allotmentDate, quarterNo, category, station, subDivision,
            applicationNo: appNo, allotteeName: who.name, serviceNo: who.serviceNo, rank: who.rank, payLevel: who.payLevel,
            allotmentType: 'Fresh', fromDate: allotmentDate, toDate, status: 'Allotted',
          });
        }
        insert('quarters', q);
      }
    });

    /* Vacations for currently vacant quarters ------------------------ */
    const reasons = ['Transfer', 'Posting Out', 'Retirement', 'Own Accommodation', 'Transfer'];
    let v = 0;
    for (const ci of [0, 1, 2, 3])
      for (const j of [3, 10]) {
        const quarterNo = `QTR-${ci + 1}${String(j + 1).padStart(2, '0')}`;
        const who = person(200 + v);
        const vacationDate = v < 5 ? `${ym}-${String(Math.min(2 + v * 5, 28)).padStart(2, '0')}` : addDays(today, -(40 + v * 20));
        insert('vacations', {
          quarterNo, category: MASTERS.categories[ci], station: MASTERS.stations[j % 3], subDivision: MASTERS.subDivisions[Math.floor(j / 2) % 3],
          prevOccupant: who.name, serviceNo: who.serviceNo, vacationDate, reason: reasons[v % reasons.length], status: 'Vacant', remarks: '',
        });
        v++;
      }

    /* Waiting list applications -------------------------------------- */
    const statuses = ['Eligible', 'Eligible', 'Recommended', 'Eligible', 'Scrutiny', 'Eligible', 'Pending', 'Eligible', 'Scrutiny', 'Recommended', 'Eligible', 'Pending', 'Eligible', 'Scrutiny', 'Pending', 'Eligible', 'Eligible', 'Pending'];
    statuses.forEach((status, i) => {
      const who = person(100 + i);
      const cat = categoryFor(who.payLevel);
      const applicationDate = addDays(today, -(200 - i * 11));
      const station = MASTERS.stations[i % 3];
      insert('applications', {
        applicationNo: nextNumber('applications', applicationDate), applicationDate, ...who, officeName: `${station} Office`, station,
        subDivision: MASTERS.subDivisions[i % 3], dateOfJoiningStation: addDays(applicationDate, -20), dateOfEnrolment: addDays(applicationDate, -3000 - i * 150),
        payCell: String(1 + (i % 12)), basicPay: 25000 + Number(who.payLevel.slice(2)) * 9000, entitlement: cat, categoryRequested: cat,
        applicationType: i % 3 === 2 ? 'Change of Accn' : 'Fresh', mobile: `97${String(20000000 + i * 104729).slice(0, 8)}`,
        email: `${who.serviceNo.toLowerCase()}@example.gov.in`, exServiceman: i % 5 === 0 ? 'Yes' : 'No', status,
        priority: priorityFor(cat), waitingOrder: i + 1, documents: [], remarks: '',
      });
    });

    /* Committees, meetings, agenda, proceedings ---------------------- */
    const chairs = ['Col A. Mehta', 'Col R. Singh', 'Col S. Verma'];
    [year, year - 1, year - 2].forEach((y, i) =>
      insert('committees', {
        orderNo: `AC/${y}/01`, orderDate: `${y}-01-${String(10 - i * 2).padStart(2, '0')}`, validUpto: `${y}-12-31`, station: '',
        chairman: chairs[i], members: 'Lt Col K. Nair\nMaj P. Gill\nBSO (Accom) – Member Secretary', memberCount: 3,
        status: i === 0 ? 'Active' : 'Closed',
      }),
    );

    const purposes = ['Monthly Allotment', 'Retention / Extension', 'Allotment & Other Cases'];
    const meetings: { meetingNo: string; meetingDate: string; status: string }[] = [];
    for (let m = 1; m <= 12; m++) {
      const meetingDate = `${year}-${String(m).padStart(2, '0')}-${m === 11 ? '25' : '05'}`;
      const meetingNo = `ACM/${String(m).padStart(2, '0')}/${year}`;
      const status = meetingDate < today ? 'Held' : 'Scheduled';
      meetings.push({ meetingNo, meetingDate, status });
      insert('meetings', { meetingNo, meetingDate, time: '1100 hrs', venue: 'Conf. Room', purpose: purposes[(m - 1) % 3], station: '', status });
    }
    const held = meetings.filter((m) => m.status === 'Held').slice(-4);
    const nextMeeting = meetings.find((m) => m.status === 'Scheduled');

    const agenda: [string, string, string][] = [
      ['Confirmation of Minutes', 'Confirmation of previous meeting proceedings.', 'Chairman'],
      ['Vacation Report', 'Review of monthly vacation position.', 'BSO (Accom)'],
      ['New Applications', 'Scrutiny of new accommodation applications.', 'Member Secretary'],
      ['Allotment Proposal', 'Consideration of allotment as per waiting list.', 'Committee'],
      ['Retention / Extension', 'Cases for retention and extension.', 'Committee'],
    ];
    for (const m of [held[held.length - 1], nextMeeting]) {
      if (!m) continue;
      agenda.forEach(([item, description, actionBy], i) =>
        insert('agendas', { meetingNo: m.meetingNo, meetingDate: m.meetingDate, sequence: i + 1, item, description, actionBy }),
      );
    }

    const allAllotments = occupiedPeople.slice(5, 17);
    held.forEach(({ meetingDate }, i) => {
      const mm = meetingDate.slice(5, 7);
      insert('proceedings', {
        proceedingsNo: `PROC/${mm}/${year}`, proceedingsDate: meetingDate,
        authority: `Station HQ letter No. ${1200 + i}/Q/Accn dated ${meetingDate.split('-').reverse().join('-')}`,
        presidingOfficer: 'Col A. Mehta',
        members: ['Lt Col K. Nair', 'Maj P. Gill', 'BSO (Accom)'],
        allotments: allAllotments.slice(i * 3, i * 3 + 3).map(({ quarterNo, category, orderNo, allotmentDate, person: who }) => ({ orderNo, allotmentDate, quarterNo, category, rank: who.rank, allotteeName: who.name, serviceNo: who.serviceNo })),
        remarks: 'Allotments recommended as per waiting list seniority.',
      });
    });

    insert('policies', {
      title: 'Allotment of Govt Married Accommodation – Station Rules (sample)',
      authorityRef: 'SRO 308 (sample reference)',
      issuedBy: 'Station Headquarters',
      issueDate: `${year}-01-01`,
      effectiveFrom: `${year}-01-01`,
      status: 'Active',
      document: null,
      rules: [
        'Para 3 – Applicant must be posted in the station on a permanent basis',
        'Para 4 – Accommodation is allotted as per entitlement by pay level',
        'Para 5 – Mandatory documents must accompany the application',
        'Para 6 – Seniority is reckoned from the date of enrolment',
        'Para 9 – An applicant already holding Govt accommodation is not eligible',
      ],
      remarks: 'Sample policy created with the demo data. Replace with the actual policy document.',
    });

    /* Retention / extension cases ------------------------------------ */
    occupiedPeople.slice(0, 5).forEach(({ quarterNo, station, person: who }, i) =>
      insert('retentions', {
        name: who.name, serviceNo: who.serviceNo, quarterNo, station, caseType: i % 2 ? 'Extension' : 'Retention',
        fromDate: `${year}-0${1 + i}-01`, toDate: i % 2 ? `${year}-0${4 + i}-30` : `${year}-12-31`,
        reason: i % 2 ? 'Children’s education' : 'Posted to non-family station', status: i === 1 ? 'Under Consideration' : 'Approved',
      }),
    );
  });
  return true;
}

if (process.argv[1]?.endsWith('seed.ts')) {
  seed(process.argv.includes('--reset'));
  console.log('Database seeded. Logins: admin/admin123, bso_accom/clerk123, member1/member123');
}

import type { FieldDef } from './components/Form';

/** Every field of an application, in the order shown on its details view. */
export const applicationView: FieldDef[] = [
  { name: 'applicationNo', label: 'Application No.' }, { name: 'applicationDate', label: 'Application Date', type: 'date' },
  { name: 'status', label: 'Status' }, { name: 'indApplicationNo', label: "Individual's Appl. No." },
  { name: 'indApplicationDate', label: "Individual's Appl. Date", type: 'date' }, { name: 'forwardingLetterNo', label: 'Received Through Letter No.' },
  { name: 'forwardingLetterDate', label: 'Letter Date', type: 'date' }, { name: 'forwardedBy', label: 'Forwarded By' },
  { name: 'receivedDate', label: 'Date of Receipt', type: 'date' },
  { name: 'serviceNo', label: 'Service No.' }, { name: 'rank', label: 'Rank' },
  { name: 'trade', label: 'Trade' }, { name: 'name', label: 'Name' }, { name: 'officeName', label: 'Office' },
  { name: 'station', label: 'Station' }, { name: 'subDivision', label: 'Sub Division' },
  { name: 'dateOfJoiningStation', label: 'Joined Station', type: 'date' }, { name: 'dateOfEnrolment', label: 'Enrolment', type: 'date' }, { name: 'dateOfRetirement', label: 'Date of Retirement', type: 'date' },
  { name: 'payLevel', label: 'Pay Level' }, { name: 'payCell', label: 'Pay Cell' }, { name: 'basicPay', label: 'Basic Pay (₹)' },
  { name: 'entitlement', label: 'Entitlement' }, { name: 'categoryRequested', label: 'Accn Requested' }, { name: 'locationRequested', label: 'Location Requested' }, { name: 'accnPool', label: 'Applied Accn Pool' }, { name: 'applicationGround', label: 'Application Ground' }, { name: 'applicationType', label: 'Application Type' }, { name: 'changeReason', label: 'Reason for Change' },
  { name: 'priority', label: 'Priority' }, { name: 'waitingDays', label: 'Waiting Days' }, { name: 'allottedQuarter', label: 'Allotted Quarter' },
  { name: 'prevQuarterNo', label: 'Prev. Quarter No.' }, { name: 'prevCategory', label: 'Prev. Category' }, { name: 'prevStation', label: 'Prev. Station' },
  { name: 'prevFrom', label: 'Prev. Accn From', type: 'date' }, { name: 'prevTo', label: 'Prev. Accn To', type: 'date' }, { name: 'prevReason', label: 'Reason for Vacation' },
  { name: 'prevLocation', label: 'Present Location / Address' },
  { name: 'exServiceman', label: 'Ex-Serviceman' }, { name: 'exServiceNo', label: 'Service No. (Prev.)' }, { name: 'exRank', label: 'Rank (Prev.)' },
  { name: 'exFrom', label: 'Prev. Service From', type: 'date' }, { name: 'exTo', label: 'Prev. Service To', type: 'date' },
  { name: 'exPayLevel', label: 'Last Pay Level' }, { name: 'exBasicPay', label: 'Last Basic Pay (₹)' }, { name: 'mobile', label: 'Mobile' }, { name: 'email', label: 'Email' },
  { name: 'remarks', label: 'Remarks', type: 'textarea' }, { name: 'statusRemarks', label: 'Status Remarks', type: 'textarea' },
  { name: 'scrutinyPolicy', label: 'Scrutiny: Policy / Authority' }, { name: 'scrutinyRule', label: 'Scrutiny: Rule / Para Applied' },
  { name: 'scrutinyMode', label: 'Scrutiny Mode' },
  { name: 'rejectionReason', label: 'Rejection Reason' }, { name: 'scrutinyDate', label: 'Scrutiny Date', type: 'date' }, { name: 'scrutinisedBy', label: 'Scrutinised By' },
];

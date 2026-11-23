import type { FieldDef } from './components/Form';

/** Fields of a signing officer (Settings → Signatories and the print window). */
export const signatoryFields: FieldDef[] = [
  { name: 'name', label: 'Name', required: true, placeholder: 'e.g. Sumit Kumar Saxena' },
  { name: 'designation', label: 'Designation', required: true, placeholder: 'e.g. SBSO' },
  { name: 'forLine', label: 'Signs For (last line)', placeholder: 'e.g. for CWE Shillong' },
  { name: 'status', label: 'Status', type: 'select', options: ['Active', 'Inactive'], required: true, hint: 'Only active officers appear in the print dropdown.' },
  {
    name: 'signature', label: 'Signature Image (optional)', type: 'file', imagesOnly: true, span: 2,
    hint: 'A scanned signature (PNG with a white or transparent background works best). Leave empty to sign by hand on the printout.',
  },
];

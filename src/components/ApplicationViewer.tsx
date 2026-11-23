import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Paperclip, Pencil, Printer } from 'lucide-react';
import { api, type Page, type Row } from '../lib/api';
import { useAuth, useToast } from '../lib/context';
import { printApplication } from '../lib/printApplication';
import { applicationView } from '../applicationFields';
import { Button } from './ui';
import { ViewModal, viewItemsFor } from './Form';
import { DocumentsModal } from './Workflow';

const Ctx = createContext<(applicationNo: string) => void>(() => {});

/** Lets any Application No. on any page open that application's details. */
export function ApplicationViewerProvider({ children }: { children: ReactNode }) {
  const [app, setApp] = useState<Row | null>(null);
  const [docs, setDocs] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();
  const { canEdit } = useAuth();

  const open = useCallback(
    (applicationNo: string) => {
      api<Page>('/c/applications', { query: { applicationNo, pageSize: 1 } })
        .then((r) => (r.rows[0] ? setApp(r.rows[0]) : toast.error(`Application ${applicationNo} was not found.`)))
        .catch(toast.error);
    },
    [toast],
  );

  return (
    <Ctx.Provider value={open}>
      {children}
      {app && !docs && (
        <ViewModal
          title={`Application ${app.applicationNo}`}
          items={viewItemsFor([...applicationView, { name: 'scrutinyRemarks', label: 'Scrutiny Remarks', type: 'textarea' }], app)}
          onClose={() => setApp(null)}
          footer={
            <>
              <Button icon={Paperclip} onClick={() => setDocs(true)}>Documents</Button>
              <Button icon={Printer} onClick={() => printApplication(app, Array.isArray(app.documents) ? app.documents : [], app.applicationNo, app.applicationDate).catch(toast.error)}>
                Print Application
              </Button>
              {canEdit && (
                <Button icon={Pencil} onClick={() => (setApp(null), navigate(`/new-application?id=${app.id}`))}>Edit</Button>
              )}
              <Button variant="primary" onClick={() => setApp(null)}>Close</Button>
            </>
          }
        />
      )}
      {app && docs && <DocumentsModal row={app} onClose={() => setDocs(false)} />}
    </Ctx.Provider>
  );
}

/** An Application No. that opens the application when clicked. */
export function ApplicationLink({ no }: { no?: string }) {
  const open = useContext(Ctx);
  if (!no) return <span className="text-slate-400">—</span>;
  return (
    <button
      type="button"
      title="Open application"
      className="font-semibold whitespace-nowrap text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-900 hover:decoration-blue-700"
      onClick={(e) => {
        e.stopPropagation();
        open(no);
      }}
    >
      {no}
    </button>
  );
}

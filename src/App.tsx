import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { Loader2 } from 'lucide-react';
import { AuthProvider, MastersProvider, ToastProvider, useAuth } from './lib/context';
import { ConfirmProvider } from './components/ui';
import { Layout } from './components/Layout';
import { ApplicationViewerProvider } from './components/ApplicationViewer';
import { QuarterViewerProvider } from './components/QuarterViewer';
import { CrudPage } from './components/CrudPage';
import { MODULES } from './modules';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import NewApplication from './pages/NewApplication';
import Reports from './pages/Reports';
import Seniority from './pages/Seniority';
import Settings from './pages/Settings';
import Backup from './pages/Backup';

function Shell() {
  const { user, ready } = useAuth();
  if (!ready)
    return (
      <div className="grid min-h-screen place-items-center text-brand-700">
        <Loader2 className="size-8 animate-spin" />
      </div>
    );
  if (!user) return <Login />;
  return (
    <MastersProvider>
      <ApplicationViewerProvider>
      <QuarterViewerProvider>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          {MODULES.map((m) => (
            <Route key={m.key} path={`/${m.key}`} element={<CrudPage key={m.key} cfg={m} />} />
          ))}
          <Route path="/new-application" element={<NewApplication />} />
          <Route path="/seniority-list" element={<Seniority />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/backup" element={<Backup />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
      </QuarterViewerProvider>
      </ApplicationViewerProvider>
    </MastersProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <ConfirmProvider>
          <AuthProvider>
            <Shell />
          </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}

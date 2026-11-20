import { Suspense, lazy } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { WorkspaceProvider } from './contexts/WorkspaceContext';
import { Toaster } from './components/ui/Toaster';
import { RequireAuth } from './components/RequireAuth';
import { AppLayout } from './components/AppLayout';
import { PageFallback } from './components/ui/PageFallback';

/*
  Routes are split. On a phone the whole app used to arrive as one ~300 kB
  gzipped bundle, so signing in meant downloading Konva and the entire canvas
  engine first. Each page now loads on demand; the canvas chunk is only
  fetched when the workspace is actually opened.
*/
const SignInPage = lazy(() => import('./pages/SignInPage').then((m) => ({ default: m.SignInPage })));
const ResetPasswordPage = lazy(() =>
  import('./pages/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage })),
);
const AdminPage = lazy(() => import('./pages/AdminPage').then((m) => ({ default: m.AdminPage })));
const WorkspacePage = lazy(() => import('./pages/WorkspacePage').then((m) => ({ default: m.WorkspacePage })));
const TeamsPage = lazy(() => import('./pages/TeamsPage').then((m) => ({ default: m.TeamsPage })));
const InvitationsPage = lazy(() =>
  import('./pages/InvitationsPage').then((m) => ({ default: m.InvitationsPage })),
);
const JoinInvitePage = lazy(() => import('./pages/JoinInvitePage').then((m) => ({ default: m.JoinInvitePage })));
const BookmarksPage = lazy(() => import('./pages/BookmarksPage').then((m) => ({ default: m.BookmarksPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })));

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <WorkspaceProvider>
          <HashRouter>
            <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/signin" element={<SignInPage />} />
              <Route path="/admin" element={<AdminPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/invite/:token" element={<JoinInvitePage />} />
              <Route
                element={
                  <RequireAuth>
                    <AppLayout />
                  </RequireAuth>
                }
              >
                <Route path="/" element={<Navigate to="/workspace" replace />} />
                <Route path="/workspace" element={<WorkspacePage />} />
                <Route path="/workspace/:workspaceId" element={<WorkspacePage />} />
                <Route path="/teams" element={<TeamsPage />} />
                <Route path="/teams/:workspaceId" element={<TeamsPage />} />
                <Route path="/invitations" element={<InvitationsPage />} />
                <Route path="/bookmarks" element={<BookmarksPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
            </Suspense>
          </HashRouter>
          <Toaster />
        </WorkspaceProvider>
      </AuthProvider>
    </ToastProvider>
  );
}

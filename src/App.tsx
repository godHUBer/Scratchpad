import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { WorkspaceProvider } from './contexts/WorkspaceContext';
import { Toaster } from './components/ui/Toaster';
import { RequireAuth } from './components/RequireAuth';
import { AppLayout } from './components/AppLayout';
import { SignInPage } from './pages/SignInPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { WorkspacePage } from './pages/WorkspacePage';
import { TeamsPage } from './pages/TeamsPage';
import { InvitationsPage } from './pages/InvitationsPage';
import { JoinInvitePage } from './pages/JoinInvitePage';
import { BookmarksPage } from './pages/BookmarksPage';
import { SettingsPage } from './pages/SettingsPage';
import { NotFoundPage } from './pages/NotFoundPage';

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <WorkspaceProvider>
          <HashRouter>
            <Routes>
              <Route path="/signin" element={<SignInPage />} />
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
          </HashRouter>
          <Toaster />
        </WorkspaceProvider>
      </AuthProvider>
    </ToastProvider>
  );
}

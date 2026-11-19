import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { PageLoader } from './ui/Spinner';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();

  if (loading) return <PageLoader />;
  if (!session) {
    const target = `${location.pathname}${location.search}`;
    const search = target && target !== '/' ? `?next=${encodeURIComponent(target)}` : '';
    return <Navigate to={`/signin${search}`} replace />;
  }
  return <>{children}</>;
}

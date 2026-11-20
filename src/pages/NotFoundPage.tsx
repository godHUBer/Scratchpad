import { Link } from 'react-router-dom';
import { EmptyState } from '../components/ui/EmptyState';

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-lg p-6">
      <EmptyState
        icon="link"
        title="That page is not on the map"
        action={
          <>
            <Link className="btn btn-primary" to="/workspace">
              Back to workspace
            </Link>
            <Link className="btn" to="/teams">
              My teams
            </Link>
          </>
        }
      >
        The link may be mistyped, or the page moved. Hash routing keeps every Scratchpad screen one hop from here.
      </EmptyState>
    </div>
  );
}

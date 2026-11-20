import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../integrations/supabase/client';
import { useWorkspaces } from '../contexts/WorkspaceContext';
import { useToast } from '../contexts/ToastContext';
import { BookmarkEditorModal } from '../components/canvas/BookmarkEditorModal';
import { EmptyState } from '../components/ui/EmptyState';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Skeleton } from '../components/ui/Spinner';
import { canEdit } from '../lib/permissions';
import { hostnameOf, relativeTime } from '../lib/format';
import { humanizeError } from '../lib/errors';
import { parseMediaUrl, normalizeUrlInput } from '../lib/drive';
import type { Bookmark } from '../types';
import { Icon } from '../components/ui/Icon';

export function BookmarksPage() {
  const { currentWorkspace, currentRole, loading: workspaceLoading, setActiveWorkspace } = useWorkspaces();
  const toast = useToast();
  const navigate = useNavigate();
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [editor, setEditor] = useState<{ open: boolean; bookmark: Bookmark | null }>({ open: false, bookmark: null });
  const [deleteTarget, setDeleteTarget] = useState<Bookmark | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!currentWorkspace) {
      setBookmarks([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error: listError } = await supabase
      .from('bookmarks')
      .select('*')
      .eq('workspace_id', currentWorkspace.id)
      .order('created_at', { ascending: false });
    if (listError) setError(humanizeError(listError));
    else {
      setBookmarks((data ?? []) as Bookmark[]);
      setError(null);
    }
    setLoading(false);
  }, [currentWorkspace]);

  useEffect(() => {
    void load();
  }, [load]);

  const categories = useMemo(
    () => Array.from(new Set(bookmarks.map((b) => b.category).filter((c): c is string => Boolean(c)))).sort(),
    [bookmarks],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return bookmarks.filter((bookmark) => {
      if (category !== 'all' && (bookmark.category ?? '') !== category) return false;
      if (!q) return true;
      return (
        bookmark.title.toLowerCase().includes(q) ||
        bookmark.url.toLowerCase().includes(q) ||
        (bookmark.description ?? '').toLowerCase().includes(q) ||
        (bookmark.category ?? '').toLowerCase().includes(q)
      );
    });
  }, [bookmarks, query, category]);

  const canWrite = canEdit(currentRole);
  const media = useMemo(() => filtered.slice(0, 200).map((b) => parseMediaUrl(normalizeUrlInput(b.url))), [filtered]);

  if (workspaceLoading) {
    return (
      <div className="mx-auto max-w-5xl p-4">
        <Skeleton className="h-10 w-64" />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 p-3 sm:p-5">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Bookmarks</h1>
          <p className="text-sm text-ink-soft">
            Library for <strong>{currentWorkspace?.name ?? 'your workspace'}</strong>
            {currentWorkspace?.type === 'personal' ? ' (private)' : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canWrite}
            title={canWrite ? 'Add a bookmark' : 'Viewers cannot add bookmarks'}
            onClick={() => setEditor({ open: true, bookmark: null })}
          >
            + New bookmark
          </button>
        </div>
      </header>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[200px] flex-1">
          <label className="label" htmlFor="bookmark-search">
            Search
          </label>
          <input
            id="bookmark-search"
            className="input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="title, url, note…"
          />
        </div>
        <div>
          <label className="label" htmlFor="bookmark-category">
            Category
          </label>
          <select
            id="bookmark-category"
            className="input min-w-[150px]"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="all">All ({bookmarks.length})</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error ? (
        <p className="rounded-xl border-[3px] border-ink bg-coral px-3 py-2 text-sm font-bold" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="bookmark"
          title={bookmarks.length === 0 ? 'No bookmarks yet' : 'Nothing matches that filter'}
          action={
            bookmarks.length === 0 && canWrite ? (
              <button type="button" className="btn btn-primary" onClick={() => setEditor({ open: true, bookmark: null })}>
                Add your first bookmark
              </button>
            ) : null
          }
        >
          {bookmarks.length === 0
            ? 'Save links here, then drop them on the canvas as cards. Google Drive links work too.'
            : 'Try a different search or category.'}
        </EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((bookmark, index) => {
            const info = media[index];
            const isDrive = info?.provider === 'drive' || info?.provider === 'docs';
            return (
              <li
                key={bookmark.id}
                className="paper-flat relative flex flex-col justify-between gap-2 p-3"
                style={{ backgroundColor: bookmark.color }}
              >
                <div className="min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="line-clamp-2 font-extrabold leading-tight">{bookmark.title}</p>
                    {bookmark.category ? <span className="chip shrink-0 bg-paper">{bookmark.category}</span> : null}
                  </div>
                  <p className="mt-1 truncate text-[11px] font-bold text-ink-soft">
                    {isDrive ? 'Google Drive · ' : ''}
                    {hostnameOf(bookmark.url)}
                  </p>
                  {bookmark.description ? (
                    <p className="mt-1 line-clamp-3 text-xs text-ink-soft">{bookmark.description}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <span className="text-[10px] font-bold text-ink-soft">{relativeTime(bookmark.created_at)}</span>
                  <div className="flex gap-1">
                    <a
                      href={bookmark.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="btn min-h-7 px-2 py-0.5 text-[11px]"
                    >
                      Open <Icon name="external" size={12} className="inline" />
                    </a>
                    <button
                      type="button"
                      className="btn min-h-7 px-2 py-0.5 text-[11px]"
                      disabled={!canWrite}
                      onClick={() => setEditor({ open: true, bookmark })}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger min-h-7 px-2 py-0.5 text-[11px]"
                      disabled={!canWrite}
                      onClick={() => setDeleteTarget(bookmark)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="paper-flat flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
        <p className="text-ink-soft">
          Want these on the whiteboard? Open the canvas and use <strong>Bookmark</strong> in the toolbar.
        </p>
        <button
          type="button"
          className="btn"
          onClick={() => {
            if (currentWorkspace) {
              setActiveWorkspace(currentWorkspace.id);
              navigate(`/workspace/${currentWorkspace.id}`);
            } else navigate('/workspace');
          }}
        >
          Open canvas
        </button>
      </div>

      <BookmarkEditorModal
        open={editor.open}
        workspaceId={currentWorkspace?.id ?? null}
        bookmark={editor.bookmark}
        allowDelete
        onClose={() => setEditor({ open: false, bookmark: null })}
        onSaved={() => {
          void load();
          toast.success(editor.bookmark ? 'Bookmark updated.' : 'Bookmark added.');
        }}
        onDeleted={async (id) => {
          setBookmarks((list) => list.filter((b) => b.id !== id));
          toast.success('Bookmark deleted.');
          void id;
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete this bookmark?"
        destructive
        busy={busy}
        confirmLabel="Delete bookmark"
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          setBusy(true);
          try {
            const { data, error: rpcError } = await supabase.rpc('delete_bookmark', { p_bookmark_id: deleteTarget.id });
            if (rpcError) throw new Error(humanizeError(rpcError));
            setBookmarks((list) => list.filter((b) => b.id !== deleteTarget.id));
            toast.success(
              typeof data === 'number' && data > 0
                ? `Bookmark deleted. ${data} canvas card${data === 1 ? '' : 's'} unlinked.`
                : 'Bookmark deleted.',
            );
          } catch (err) {
            toast.error(humanizeError(err));
          } finally {
            setBusy(false);
            setDeleteTarget(null);
          }
        }}
      >
        <p>
          The bookmark is removed from this library. Cards on the canvas stay but become “bookmark removed” until you
          attach a new one.
        </p>
      </ConfirmDialog>
    </div>
  );
}

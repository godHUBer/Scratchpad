import { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { supabase } from '../../integrations/supabase/client';
import { humanizeError } from '../../lib/errors';
import type { Bookmark } from '../../types';

const COLORS = ['#f7c948', '#7fd18b', '#8ec5ff', '#c9b6ff', '#ff8a80', '#fffdf6'];

export interface BookmarkDraft {
  title: string;
  url: string;
  description: string;
  category: string;
  color: string;
}

interface BookmarkEditorModalProps {
  open: boolean;
  workspaceId: string | null;
  bookmark: Bookmark | null;
  /** prefill (for example when the URL came from a Drive link) */
  prefill?: Partial<BookmarkDraft>;
  onClose: () => void;
  onSaved: (bookmark: Bookmark) => void;
  onDeleted?: (id: string, unlinkedCards: number) => void;
  allowDelete?: boolean;
}

export function BookmarkEditorModal({
  open,
  workspaceId,
  bookmark,
  prefill,
  onClose,
  onSaved,
  onDeleted,
  allowDelete,
}: BookmarkEditorModalProps) {
  const [draft, setDraft] = useState<BookmarkDraft>({
    title: '',
    url: '',
    description: '',
    category: '',
    color: COLORS[0]!,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [cardCount, setCardCount] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft({
      title: bookmark?.title ?? prefill?.title ?? '',
      url: bookmark?.url ?? prefill?.url ?? '',
      description: bookmark?.description ?? prefill?.description ?? '',
      category: bookmark?.category ?? prefill?.category ?? '',
      color: bookmark?.color ?? prefill?.color ?? COLORS[0]!,
    });
    setError(null);
    setConfirmDelete(false);
    setCardCount(null);
    if (bookmark) {
      void supabase.rpc('bookmark_card_count', { p_bookmark_id: bookmark.id }).then(({ data }) => {
        if (typeof data === 'number') setCardCount(data);
      });
    }
  }, [open, bookmark, prefill]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!workspaceId) return;
    setBusy(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('save_bookmark', {
        p_workspace_id: workspaceId,
        p_title: draft.title.trim(),
        p_url: draft.url.trim(),
        p_description: draft.description.trim() || null,
        p_category: draft.category.trim() || null,
        p_color: draft.color,
        p_id: bookmark?.id ?? null,
      });
      if (rpcError) throw new Error(humanizeError(rpcError));
      if (!data) throw new Error('The bookmark could not be saved.');
      onSaved(data as Bookmark);
      onClose();
    } catch (err) {
      setError(humanizeError(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!bookmark) return;
    setBusy(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('delete_bookmark', { p_bookmark_id: bookmark.id });
      if (rpcError) throw new Error(humanizeError(rpcError));
      onDeleted?.(bookmark.id, typeof data === 'number' ? data : 0);
      onClose();
    } catch (err) {
      setError(humanizeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={bookmark ? 'Edit bookmark' : 'New bookmark'}
      description="Bookmarks live in this workspace's library and can be placed on the canvas as cards."
      busy={busy}
      footer={
        <>
          {allowDelete && bookmark ? (
            <button
              type="button"
              className="btn btn-danger mr-auto"
              disabled={busy}
              onClick={() => (confirmDelete ? void remove() : setConfirmDelete(true))}
            >
              {confirmDelete ? 'Yes, delete' : 'Delete'}
            </button>
          ) : null}
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="bookmark-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : bookmark ? 'Save bookmark' : 'Add bookmark'}
          </button>
        </>
      }
    >
      <form id="bookmark-form" onSubmit={submit} className="space-y-3">
        <div>
          <label className="label" htmlFor="bm-url">
            URL (https only)
          </label>
          <input
            id="bm-url"
            className="input"
            value={draft.url}
            onChange={(event) => setDraft({ ...draft, url: event.target.value })}
            placeholder="https://…"
            data-autofocus
            required
            type="url"
          />
        </div>
        <div>
          <label className="label" htmlFor="bm-title">
            Title
          </label>
          <input
            id="bm-title"
            className="input"
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            maxLength={200}
            required
            placeholder="What is this link?"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="bm-category">
              Category
            </label>
            <input
              id="bm-category"
              className="input"
              value={draft.category}
              onChange={(event) => setDraft({ ...draft, category: event.target.value })}
              maxLength={60}
              placeholder="inspiration"
            />
          </div>
          <div>
            <p className="label">Card colour</p>
            <div className="flex flex-wrap gap-1.5">
              {COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setDraft({ ...draft, color })}
                  aria-label={`Colour ${color}`}
                  aria-pressed={draft.color === color}
                  className={`h-7 w-7 rounded-full border-2 border-ink pointer-coarse:h-10 pointer-coarse:w-10 ${
                    draft.color === color ? 'ring-2 ring-ink ring-offset-1' : ''
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="bm-description">
            Notes <span className="font-normal text-ink-soft">(optional)</span>
          </label>
          <textarea
            id="bm-description"
            className="input min-h-[72px]"
            value={draft.description}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            maxLength={1000}
          />
        </div>

        {confirmDelete ? (
          <p className="rounded-xl border-[3px] border-ink bg-coral px-3 py-2 text-sm font-bold">
            {cardCount && cardCount > 0
              ? `${cardCount} canvas card${cardCount === 1 ? '' : 's'} will be unlinked (the cards stay, the bookmark record is removed).`
              : 'This removes the bookmark from the library.'}
          </p>
        ) : null}

        {error ? (
          <p className="rounded-xl border-[3px] border-ink bg-coral px-3 py-2 text-sm font-bold" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useWorkspaces } from '../contexts/WorkspaceContext';
import { useToast } from '../contexts/ToastContext';
import { useCanvasItems } from '../hooks/useCanvasItems';
import { usePresence } from '../hooks/usePresence';
import { WorkspaceCanvas } from '../components/canvas/WorkspaceCanvas';
import { FloatingToolbar, type Tool } from '../components/canvas/FloatingToolbar';
import { ContextToolbox } from '../components/canvas/ContextToolbox';
import { TextEditorModal } from '../components/canvas/TextEditorModal';
import { BookmarkEditorModal, type BookmarkDraft } from '../components/canvas/BookmarkEditorModal';
import { AddMediaLinkModal } from '../components/canvas/AddMediaLinkModal';
import { MemberListModal } from '../components/teams/MemberListModal';
import { InviteModal } from '../components/teams/InviteModal';
import { MemberAvatars } from '../components/MemberAvatars';
import { PageLoader, Spinner } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { canEdit, roleLabel, writeBlockedMessage } from '../lib/permissions';
import { humanizeError } from '../lib/errors';
import type { CanvasItem, MediaAsset } from '../types';

type MediaModalKind = 'image' | 'audio' | 'video' | 'media_link';

interface LastCanvasAction {
  label: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

export function WorkspacePage() {
  const { workspaceId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const {
    workspaces,
    currentWorkspace,
    currentRole,
    setActiveWorkspace,
    members,
    loading: workspacesLoading,
    error: workspaceError,
    refresh,
  } = useWorkspaces();

  const [tool, setTool] = useState<Tool>('select');
  const [brushColor, setBrushColor] = useState('#080808');
  const [brushSize, setBrushSize] = useState(6);
  const [textSize, setTextSize] = useState(22);
  const [textColor, setTextColor] = useState('#080808');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [toolboxCollapsed, setToolboxCollapsed] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CanvasItem | null>(null);

  // text editing
  const [lastCanvasAction, setLastCanvasAction] = useState<LastCanvasAction | null>(null);
  const [textEditor, setTextEditor] = useState<{ item: CanvasItem | null; position: { x: number; y: number } | null }>(
    { item: null, position: null },
  );
  // bookmark editing
  const [bookmarkEditor, setBookmarkEditor] = useState<{
    open: boolean;
    bookmarkId: string | null;
    prefill: Partial<BookmarkDraft>;
  }>({ open: false, bookmarkId: null, prefill: {} });
  // media editing
  const [mediaEditor, setMediaEditor] = useState<{ open: boolean; kind: MediaModalKind; asset: MediaAsset | null }>({
    open: false,
    kind: 'image',
    asset: null,
  });

  const workspace = useMemo(
    () => workspaces.find((w) => w.id === workspaceId) ?? null,
    [workspaces, workspaceId],
  );

  // keep the URL and the active workspace in sync
  useEffect(() => {
    if (!workspaceId) {
      if (currentWorkspace) navigate(`/workspace/${currentWorkspace.id}`, { replace: true });
      return;
    }
    if (workspace && currentWorkspace?.id !== workspace.id) setActiveWorkspace(workspace.id);
    else if (!workspace && !workspacesLoading) {
      // URL points at a workspace the user cannot see (RLS or deleted)
      toast.error('That workspace does not exist or you do not have access.');
      navigate('/workspace', { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, workspace, workspacesLoading, currentWorkspace?.id]);

  const canWrite = canEdit(currentRole);
  const [undoAvailable, setUndoAvailable] = useState(false);
  const [zoom, setZoom] = useState(1);

  const handleRemote = useCallback(
    (item: CanvasItem | null, kind: 'insert' | 'update' | 'delete') => {
      if (kind === 'delete') {
        setSelectedIds((ids) => (item ? ids.filter((id) => id !== item.id) : ids));
      }
    },
    [],
  );


  const canvas = useCanvasItems({
    workspaceId: workspace?.id ?? null,
    canWrite,
    onRemoteChange: handleRemote,
  });

  const { online } = usePresence(workspace?.id ?? null);

  // drop selections whose rows disappeared (deleted locally or by a teammate)
  useEffect(() => {
    setSelectedIds((ids) => {
      const next = ids.filter((id) => canvas.items.some((item) => item.id === id));
      return next.length === ids.length ? ids : next;
    });
  }, [canvas.items]);

  // ---------------------------------------------------------------- keyboard
  useEffect(() => {
    const onKey = async (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (typing) return;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent(event.shiftKey ? 'scratchpad:redo' : 'scratchpad:undo'));
        return;
      }
      if (event.key === 'Escape') {
        setSelectedIds([]);
        setTool('select');
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedIds.length > 0) {
        event.preventDefault();
        if (!canWrite) {
          toast.error(writeBlockedMessage(currentRole));
          return;
        }
        const targets = canvas.items.filter((item) => selectedIds.includes(item.id));
        if (targets.length === 1) setDeleteTarget(targets[0]!);
        else {
          for (const item of targets) {
            try {
              await canvas.deleteItem(item.id);
            } catch (err) {
              toast.error(humanizeError(err));
            }
          }
          setSelectedIds([]);
          toast.success(`Deleted ${targets.length} items.`);
        }
      }
      if (event.key === 'v' && !event.metaKey && !event.ctrlKey) setTool('select');
      if (event.key === 't' && !event.metaKey && !event.ctrlKey) setTool('text');
      if (event.key === 'b' && !event.metaKey && !event.ctrlKey) setTool('brush');
      if (event.key === 'e' && !event.metaKey && !event.ctrlKey) setTool('eraser');
      if (event.key === 'h' && !event.metaKey && !event.ctrlKey) setTool('pan');

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key) && selectedIds.length > 0) {
        event.preventDefault();
        if (!canWrite) return;
        const step = event.shiftKey ? 40 : 8;
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
        const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
        const moves = canvas.items
          .filter((item) => selectedIds.includes(item.id))
          .map((item) => ({ id: item.id, x: item.position_x + dx, y: item.position_y + dy }));
        try {
          await canvas.moveItems(moves);
        } catch (err) {
          toast.error(humanizeError(err));
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedIds, canWrite, currentRole, canvas, toast]);

  // ------------------------------------------------------------- canvas API
  const api = useMemo(
    () => ({
      items: canvas.items,
      createItem: canvas.createItem,
      patchItem: canvas.patchItem,
      moveItems: canvas.moveItems,
      deleteItem: canvas.deleteItem,
      duplicateItem: canvas.duplicateItem,
      setLayer: canvas.setLayer,
    }),
    [canvas.items, canvas.createItem, canvas.patchItem, canvas.moveItems, canvas.deleteItem, canvas.duplicateItem, canvas.setLayer],
  );

  const guardWrite = () => {
    if (!canWrite) {
      toast.error(writeBlockedMessage(currentRole));
      return false;
    }
    return true;
  };

  const selectedItems = canvas.items.filter((item) => selectedIds.includes(item.id));

  const openTextFor = (item: CanvasItem) => {
    if (!guardWrite()) return;
    setTextEditor({ item, position: null });
  };

  const createTextAt = (position: { x: number; y: number }) => {
    if (!guardWrite()) return;
    setTextEditor({ item: null, position });
  };

  const handleTextSave = async (value: { text: string; fontSize: number; color: string; align: 'left' | 'center' | 'right' }) => {
    const content = { text: value.text, fontSize: value.fontSize, color: value.color, align: value.align };
    if (textEditor.item) {
      const beforeContent = { ...textEditor.item.content };
      await canvas.patchItem(textEditor.item.id, {
        content: { ...textEditor.item.content, ...content },
        width: Math.max(textEditor.item.width, Math.min(720, (value.text.length || 10) * value.fontSize * 0.6 + 40)),
        height: Math.max(60, Math.ceil((value.text.length || 10) / 30) * value.fontSize * 1.6 + 30),
      });
      const targetId = textEditor.item.id;
      setLastCanvasAction({
        label: 'text-edit',
        undo: () => canvas.patchItem(targetId, { content: beforeContent }).then(() => undefined),
        redo: () => canvas.patchItem(targetId, { content: { ...beforeContent, ...content } }).then(() => undefined),
      });
      toast.success('Text updated.');
    } else if (textEditor.position) {
      const created = await canvas.createItem({
        item_type: 'text',
        position_x: textEditor.position.x - 40,
        position_y: textEditor.position.y - 20,
        width: Math.max(220, Math.min(720, (value.text.length || 10) * value.fontSize * 0.62 + 40)),
        height: Math.max(70, Math.ceil((value.text.length || 10) / 30) * value.fontSize * 1.6 + 30),
        content,
      });
      setLastCanvasAction({
        label: 'text-add',
        undo: () => canvas.deleteItem(created.id).then(() => undefined),
        redo: async () => {
          await canvas.createItem({
            item_type: 'text',
            position_x: created.position_x,
            position_y: created.position_y,
            width: created.width,
            height: created.height,
            content: created.content,
          });
        },
      });
      toast.success('Text added.');
    }
  };

  const openMedia = (kind: MediaModalKind) => {
    if (!guardWrite()) return;
    setMediaEditor({ open: true, kind, asset: null });
  };

  const onMediaSaved = async (asset: MediaAsset) => {
    const existing = mediaEditor.asset;
    if (existing) {
      toast.success('Media link updated.');
      return;
    }
    const [first] = selectedItems;
    const created = await canvas.createItem({
      item_type: asset.file_type === 'link' ? 'media_link' : (asset.file_type as 'image' | 'audio' | 'video'),
      position_x: first ? first.position_x + 40 : -window.innerWidth / (2 * zoom) + 120,
      position_y: first ? first.position_y + 40 : -window.innerHeight / (2 * zoom) + 140,
      width: asset.file_type === 'image' ? 320 : asset.file_type === 'audio' ? 300 : 380,
      height: asset.file_type === 'image' ? 240 : asset.file_type === 'audio' ? 120 : 240,
      content: { caption: asset.file_name ?? asset.file_type },
      media_asset_id: asset.id,
    });
    setLastCanvasAction({
      label: 'media-add',
      undo: () => canvas.deleteItem(created.id).then(() => undefined),
      redo: async () => {
        await canvas.createItem({
          item_type: created.item_type,
          position_x: created.position_x,
          position_y: created.position_y,
          width: created.width,
          height: created.height,
          content: created.content,
          media_asset_id: created.media_asset_id,
        });
      },
    });
  };

  const onBookmarkSaved = async (bookmark: { id: string; title: string; url: string }) => {
    if (bookmarkEditor.bookmarkId) {
      toast.success('Bookmark updated.');
      return;
    }
    const [first] = selectedItems;
    const created = await canvas.createItem({
      item_type: 'bookmark',
      position_x: first ? first.position_x + 40 : -window.innerWidth / (2 * zoom) + 100,
      position_y: first ? first.position_y + 40 : -window.innerHeight / (2 * zoom) + 120,
      width: 280,
      height: 170,
      content: { caption: bookmark.title },
      bookmark_id: bookmark.id,
    });
    setLastCanvasAction({
      label: 'bookmark-add',
      undo: () => canvas.deleteItem(created.id).then(() => undefined),
      redo: async () => {
        await canvas.createItem({
          item_type: 'bookmark',
          position_x: created.position_x,
          position_y: created.position_y,
          width: created.width,
          height: created.height,
          content: created.content,
          bookmark_id: created.bookmark_id,
        });
      },
    });
  };

  if (workspacesLoading && workspaces.length === 0) return <PageLoader />;

  if (workspaceError) {
    return (
      <div className="p-6">
        <EmptyState
          emoji="🛠️"
          title="Could not load your workspaces"
          action={
            <button type="button" className="btn btn-primary" onClick={() => void refresh()}>
              Try again
            </button>
          }
        >
          {workspaceError}
        </EmptyState>
      </div>
    );
  }

  if (!workspace || !user) {
    return (
      <div className="p-6">
        <EmptyState emoji="🗂️" title="No workspace selected">
          Pick a workspace from the menu, or create a team to get started.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="relative flex h-[calc(100vh-61px)] flex-col">
      <div className="relative flex-1 overflow-hidden">
        <FloatingToolbar
          tool={tool}
          onTool={(next) => setTool(next)}
          disabledActions={!canWrite}
          onText={() => createTextAt({ x: 0, y: 0 })}
          onImage={() => openMedia('image')}
          onAudio={() => openMedia('audio')}
          onVideo={() => openMedia('video')}
          onMediaLink={() => openMedia('media_link')}
          onBookmark={() => {
            if (!guardWrite()) return;
            setBookmarkEditor({ open: true, bookmarkId: null, prefill: {} });
          }}
          syncState={canvas.sync}
          lastSavedAt={canvas.lastSavedAt}
          conflictCount={canvas.conflicts}
          onRetrySync={() => void canvas.reload()}
        />

        <div className="absolute right-2 top-2 z-20 flex flex-col items-end gap-1.5">
          <MemberAvatars members={members} online={online.map((o) => o.user_id)} onOpen={() => setMembersOpen(true)} />
          {online.length > 1 ? (
            <span className="chip bg-mint">{online.length} online</span>
          ) : null}
          {workspace.type === 'personal' ? <span className="chip bg-paper">private</span> : null}
          <span className="chip bg-paper" title="Your role in this workspace">
            {roleLabel(currentRole ?? 'viewer')}
          </span>
        </div>

        {canvas.loading ? (
          <div className="absolute inset-0 z-10 grid place-items-center bg-cream/60">
            <div className="paper px-5 py-4">
              <Spinner label="Loading the canvas…" />
            </div>
          </div>
        ) : null}

        {canvas.error ? (
          <div className="absolute inset-x-2 top-16 z-20">
            <div className="paper mx-auto max-w-lg px-4 py-3">
              <p className="text-sm font-bold text-coral">Canvas error</p>
              <p className="text-xs">{canvas.error}</p>
              <button type="button" className="btn mt-2 min-h-8 px-3 py-0.5 text-xs" onClick={() => void canvas.reload()}>
                Retry
              </button>
            </div>
          </div>
        ) : null}

        <WorkspaceCanvas
          api={api}
          bookmarks={canvas.bookmarks}
          media={canvas.media}
          tool={tool}
          setTool={setTool}
          canWrite={canWrite}
          brushColor={brushColor}
          brushSize={brushSize}
          textSize={textSize}
          textColor={textColor}
          selectedIds={selectedIds}
          setSelectedIds={setSelectedIds}
          onOpenTextEditor={openTextFor}
          onCreateText={createTextAt}
          onError={(message) => toast.error(message)}
          onUndoAvailable={setUndoAvailable}
          onZoomChange={setZoom}
          onEraseNotice={() =>
            toast.info('Eraser: click a drawing, text or card to delete it. Ctrl+Z brings it back.')
          }
          onOpenCardEditor={(item) => {
            if (!guardWrite()) return;
            if (item.item_type === 'bookmark') {
              const bookmark = item.bookmark_id ? canvas.bookmarks[item.bookmark_id] : null;
              setBookmarkEditor({ open: true, bookmarkId: bookmark?.id ?? null, prefill: {} });
            } else {
              const asset = item.media_asset_id ? canvas.media[item.media_asset_id] : null;
              setMediaEditor({ open: true, kind: 'media_link', asset: asset ?? null });
            }
          }}
        />

        <ContextToolbox
          tool={tool}
          brushColor={brushColor}
          setBrushColor={setBrushColor}
          brushSize={brushSize}
          setBrushSize={setBrushSize}
          textSize={textSize}
          setTextSize={setTextSize}
          textColor={textColor}
          setTextColor={setTextColor}
          selected={selectedItems}
          canWrite={canWrite}
          role={currentRole}
          bookmarks={canvas.bookmarks}
          media={canvas.media}
          onEditText={openTextFor}
          onEditCard={(item) => {
            if (!guardWrite()) return;
            if (item.item_type === 'bookmark') {
              const bookmark = item.bookmark_id ? canvas.bookmarks[item.bookmark_id] : null;
              setBookmarkEditor({ open: true, bookmarkId: bookmark?.id ?? null, prefill: {} });
            } else {
              const asset = item.media_asset_id ? canvas.media[item.media_asset_id] : null;
              setMediaEditor({ open: true, kind: 'media_link', asset: asset ?? null });
            }
          }}
          onDuplicate={async (item) => {
            if (!guardWrite()) return;
            try {
              const copy = await canvas.duplicateItem(item.id);
              setLastCanvasAction({
                label: 'duplicate',
                undo: () => canvas.deleteItem(copy.id).then(() => undefined),
                redo: async () => {
                  await canvas.duplicateItem(item.id);
                },
              });
              toast.success('Duplicated.');
            } catch (err) {
              toast.error(humanizeError(err));
            }
          }}
          onDelete={(item) => setDeleteTarget(item)}
          onLayer={async (item, direction) => {
            if (!guardWrite()) return;
            try {
              await canvas.setLayer(item.id, direction);
            } catch (err) {
              toast.error(humanizeError(err));
            }
          }}
          collapsed={toolboxCollapsed}
          onToggleCollapsed={() => setToolboxCollapsed((value) => !value)}
        />

        {undoAvailable ? (
          <button
            type="button"
            className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-full border-[3px] border-ink bg-paper px-3 py-1 text-xs font-black hard-shadow-sm"
            onClick={() => window.dispatchEvent(new CustomEvent('scratchpad:undo'))}
          >
            ↶ Undo available (Ctrl/⌘ Z)
          </button>
        ) : null}
      </div>

      <TextEditorModal
        open={textEditor.item !== null || textEditor.position !== null}
        item={textEditor.item}
        defaultSize={textSize}
        defaultColor={textColor}
        onClose={() => setTextEditor({ item: null, position: null })}
        onSave={handleTextSave}
      />

      <BookmarkEditorModal
        open={bookmarkEditor.open}
        workspaceId={workspace.id}
        allowDelete
        bookmark={
          bookmarkEditor.bookmarkId ? canvas.bookmarks[bookmarkEditor.bookmarkId] ?? null : null
        }
        prefill={bookmarkEditor.prefill}
        onClose={() => {
          setBookmarkEditor({ open: false, bookmarkId: null, prefill: {} });
          void canvas.refreshBookmarks();
        }}
        onSaved={(bookmark) => {
          void canvas.refreshBookmarks();
          void onBookmarkSaved(bookmark);
        }}
        onDeleted={(id, unlinked) => {
          void canvas.refreshBookmarks();
          toast.info(
            unlinked > 0
              ? `Bookmark deleted. ${unlinked} canvas card${unlinked === 1 ? '' : 's'} unlinked.`
              : 'Bookmark deleted.',
          );
          void id;
        }}
      />

      <AddMediaLinkModal
        open={mediaEditor.open}
        workspaceId={workspace.id}
        asset={mediaEditor.asset}
        onClose={() => {
          setMediaEditor({ open: false, kind: 'image', asset: null });
          void canvas.refreshMedia();
        }}
        onSaved={(asset) => {
          void canvas.refreshMedia();
          void onMediaSaved(asset);
        }}
      />

      <MemberListModal
        open={membersOpen}
        workspace={workspace}
        onClose={() => setMembersOpen(false)}
        onInvite={() => {
          setMembersOpen(false);
          setInviteOpen(true);
        }}
      />

      <InviteModal open={inviteOpen} workspace={workspace} onClose={() => setInviteOpen(false)} />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete this item?"
        destructive
        confirmLabel="Delete"
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            const snapshot = deleteTarget;
            await canvas.deleteItem(snapshot.id);
            setSelectedIds((ids) => ids.filter((id) => id !== snapshot.id));
            setLastCanvasAction({
              label: 'delete',
              undo: async () => {
                await canvas.createItem({
                  item_type: snapshot.item_type,
                  position_x: snapshot.position_x,
                  position_y: snapshot.position_y,
                  width: snapshot.width,
                  height: snapshot.height,
                  content: snapshot.content,
                  bookmark_id: snapshot.bookmark_id,
                  media_asset_id: snapshot.media_asset_id,
                });
              },
              redo: () => canvas.deleteItem(snapshot.id).then(() => undefined),
            });
            toast.success('Deleted.');
          } catch (err) {
            toast.error(humanizeError(err));
          } finally {
            setDeleteTarget(null);
          }
        }}
      >
        <p>
          {deleteTarget?.item_type === 'draw'
            ? 'This drawing stroke will be removed for everyone in this workspace.'
            : deleteTarget?.item_type === 'bookmark'
              ? 'The card is removed from the canvas. The bookmark stays in the library.'
              : 'This removes the item for everyone in this workspace. You can undo right after deleting.'}
        </p>
      </ConfirmDialog>

      <CanvasUndoBinding action={lastCanvasAction} onChanged={() => void canvas.reload()} />
    </div>
  );
}

/** Mirrors the page-level actions into the canvas undo stack (Ctrl/⌘+Z). */
function CanvasUndoBinding({
  action,
  onChanged,
}: {
  action: LastCanvasAction | null;
  onChanged: () => void;
}) {
  useEffect(() => {
    if (!action) return;
    const listener = async (event: Event) => {
      const detail = (event as CustomEvent<{ target?: string }>).detail;
      if (detail?.target === 'canvas') return; // canvas handles its own strokes/moves
      event.preventDefault();
      try {
        if (event.type === 'scratchpad:undo') await action.undo();
        else await action.redo();
        onChanged();
      } catch {
        /* the toast for individual failures is raised by the action itself */
      }
    };
    window.addEventListener('scratchpad:undo', listener);
    window.addEventListener('scratchpad:redo', listener);
    return () => {
      window.removeEventListener('scratchpad:undo', listener);
      window.removeEventListener('scratchpad:redo', listener);
    };
  }, [action, onChanged]);
  return null;
}

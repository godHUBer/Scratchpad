import type { Bookmark } from '../../types';
import { hostnameOf } from '../../lib/format';

export function BookmarkCardBody({ bookmark }: { bookmark: Bookmark | null }) {
  if (!bookmark) {
    return (
      <div className="flex h-full w-full flex-col justify-center gap-1 p-3">
        <p className="text-sm font-extrabold">Bookmark removed</p>
        <p className="text-xs text-ink-soft">
          The library entry behind this card was deleted. Delete the card or attach a new bookmark.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col justify-between gap-2 p-3">
      <div className="min-w-0">
        <p className="text-[10px] font-black uppercase tracking-widest text-ink-soft">
          {bookmark.category || 'Bookmark'}
        </p>
        <p className="mt-0.5 line-clamp-2 text-sm font-extrabold leading-tight">{bookmark.title}</p>
        {bookmark.description ? (
          <p className="mt-1 line-clamp-3 text-xs leading-snug text-ink-soft">{bookmark.description}</p>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] font-bold text-ink-soft">{hostnameOf(bookmark.url)}</span>
        <a
          href={bookmark.url}
          target="_blank"
          rel="noreferrer noopener"
          className="chip shrink-0 bg-paper hover:bg-mustard"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          Open
        </a>
      </div>
    </div>
  );
}

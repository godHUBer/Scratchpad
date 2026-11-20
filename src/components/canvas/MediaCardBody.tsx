import { useEffect, useMemo, useState } from 'react';
import {
  driveDirectUrl,
  driveOpenUrl,
  isIframeAllowed,
  isSafeMediaSrc,
  mediaFailureExplanation,
  type DriveLinkInfo,
} from '../../lib/drive';
import type { MediaAsset } from '../../types';
import { hostnameOf } from '../../lib/format';

export type MediaStatus = 'direct' | 'embed' | 'fallback' | 'inaccessible' | 'unsupported';

interface MediaCardBodyProps {
  asset: MediaAsset | null;
  /** Called when the rendering strategy changes so the card can show a badge. */
  onStatus?: (status: MediaStatus) => void;
  /** When the host already handles dragging (DOM card shell). */
  embedded?: boolean;
}

/**
 * Renders a media reference with a progressive fallback:
 *   direct <img>/<audio>/<video> -> Drive preview iframe -> open-in-Drive panel.
 * A successful iframe load is never treated as proof that playback works.
 */
export function MediaCardBody({ asset, onStatus }: MediaCardBodyProps) {
  const [status, setStatus] = useState<MediaStatus>('direct');
  const [showEmbed, setShowEmbed] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [embedLoaded, setEmbedLoaded] = useState(false);

  const info = useMemo<DriveLinkInfo | null>(() => {
    if (!asset) return null;
    const isDrive = Boolean(asset.drive_file_id);
    return {
      provider: isDrive ? 'drive' : 'direct',
      fileId: asset.drive_file_id,
      kind: asset.file_type,
      directUrl:
        isDrive && asset.drive_file_id
          ? driveDirectUrl(asset.drive_file_id, asset.file_type)
          : asset.file_type === 'link'
            ? null
            : asset.original_url,
      previewUrl:
        isDrive && asset.drive_file_id ? `https://drive.google.com/file/d/${asset.drive_file_id}/preview` : null,
      openUrl: isDrive && asset.drive_file_id ? driveOpenUrl(asset.drive_file_id) : asset.original_url,
      needsManualType: false,
      providerLabel: isDrive ? 'Google Drive' : hostnameOf(asset.original_url),
    };
  }, [asset]);

  useEffect(() => {
    setShowEmbed(false);
    setTimedOut(false);
    setEmbedLoaded(false);
    setStatus(asset ? 'direct' : 'inaccessible');
  }, [asset?.id, asset]);

  useEffect(() => {
    onStatus?.(status);
  }, [status, onStatus]);

  // Drive-hosted audio/video cannot stream from a direct URL, so start in
  // embed mode. Anything else gets the old "demote after a timeout" treatment.
  useEffect(() => {
    if (!asset || !info?.previewUrl) return;
    if (asset.file_type !== 'audio' && asset.file_type !== 'video') return;
    if (showEmbed) return;
    if (asset.drive_file_id && !info.directUrl) {
      setShowEmbed(true);
      setStatus('embed');
      return;
    }
    const timer = window.setTimeout(() => setTimedOut(true), 9000);
    return () => window.clearTimeout(timer);
  }, [asset, info?.previewUrl, info?.directUrl, showEmbed]);

  useEffect(() => {
    if (timedOut && info?.previewUrl) {
      setShowEmbed(true);
      setStatus('embed');
    } else if (timedOut) {
      setStatus('unsupported');
    }
  }, [timedOut, info?.previewUrl]);

  if (!asset) {
    return (
      <LinkPanel
        title="Media missing"
        message="This card pointed at a media reference that has been deleted from the workspace library. Add a new media link, or delete this card."
      />
    );
  }

  const openUrl = info?.openUrl ?? asset.original_url;
  const direct = info?.directUrl && isSafeMediaSrc(info.directUrl) ? info.directUrl : null;
  const embedAllowed = info?.previewUrl ? isIframeAllowed(info.previewUrl) : false;

  const fallbackPanel = (
    <LinkPanel
      title={asset.file_name ?? 'Media link'}
      message={mediaFailureExplanation(asset.file_type, info?.provider ?? 'direct')}
      openUrl={openUrl}
      extra={
        embedAllowed && !showEmbed
          ? () => {
              setShowEmbed(true);
              setStatus('embed');
            }
          : undefined
      }
    />
  );

  if (asset.file_type === 'video' && direct && !showEmbed) {
    return (
      <div className="relative h-full w-full">
        <video
          className="h-full w-full rounded-[13px] bg-ink object-contain"
          src={direct}
          controls
          controlsList="nodownload"
          playsInline
          preload="metadata"
          crossOrigin="anonymous"
          onLoadedMetadata={() => setStatus('direct')}
          onError={() => {
            if (embedAllowed) {
              setShowEmbed(true);
              setStatus('embed');
            } else {
              setStatus('inaccessible');
            }
          }}
        />
      </div>
    );
  }

  // Drive audio: there is no streamable direct URL (see driveDirectUrl), so go
  // straight to Drive's player rather than mounting an <audio> that must fail
  // first. A plain https audio file still gets the native player.
  if (asset.file_type === 'audio' && direct && !showEmbed) {
    return (
      <div className="flex h-full w-full flex-col justify-between gap-2 p-3">
        <p className="truncate text-sm font-extrabold">{asset.file_name ?? 'Audio'}</p>
        <audio
          className="w-full"
          src={direct}
          controls
          preload="metadata"
          onLoadedMetadata={() => setStatus('direct')}
          onError={() => {
            if (embedAllowed) {
              setShowEmbed(true);
              setStatus('embed');
            } else {
              setStatus('inaccessible');
            }
          }}
        >
          <track kind="captions" />
        </audio>
      </div>
    );
  }

  // Drive audio/video with a usable preview: fill the card with the player.
  // The old 132px audio card clipped Drive's player chrome, which is what made
  // attached audio look broken.
  //
  // Two things matter here:
  //  - the iframe must not sit on a black background. Before it loads (or if it
  //    is blocked entirely, e.g. by an aggressive blocker) the card was one
  //    solid black rectangle with no hint of what it was.
  //  - there is always a way out: the file name and an "open in Drive" link are
  //    outside the iframe, so they work even when the embed does not.
  if ((asset.file_type === 'audio' || asset.file_type === 'video') && showEmbed && info?.previewUrl && embedAllowed) {
    return (
      <div className="flex h-full w-full flex-col bg-cream">
        <div className="flex items-center justify-between gap-1 border-b-2 border-ink/30 px-2 py-1">
          <span className="truncate text-[10px] font-black uppercase tracking-wider text-ink-soft">
            {asset.file_type} · {info.providerLabel}
          </span>
          <a
            href={openUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="shrink-0 text-[10px] font-bold underline decoration-2 underline-offset-2"
            onPointerDown={(event) => event.stopPropagation()}
          >
            Open
          </a>
        </div>
        <div className="relative flex-1">
          <iframe
            src={info.previewUrl}
            title={asset.file_name ?? 'Media preview'}
            className="h-full w-full border-0"
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
            allowFullScreen
            loading="lazy"
            onLoad={() => setEmbedLoaded(true)}
          />
          {!embedLoaded ? (
            // Shown until the iframe reports a load. Deliberately opaque text on
            // cream, so a blocked embed reads as "preview loading", not a glitch.
            <div className="pointer-events-none absolute inset-0 grid place-items-center gap-1 bg-cream p-2 text-center">
              <p className="truncate text-xs font-extrabold">{asset.file_name ?? 'Media'}</p>
              <p className="text-[10px] font-bold text-ink-soft">
                Loading {info.providerLabel} preview… if it stays blank, use Open.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  if (asset.file_type === 'image' && direct && !showEmbed) {
    // The card shell paints its own background and border, and the Konva layer
    // paints the same image underneath for crisp zooming. Keeping the DOM <img>
    // transparent to the eye but present in the tree means the picture is
    // visible during a drag (when the Konva copy is hidden) and the card has a
    // real element to double-click.
    return (
      <div className="relative h-full w-full">
        <img
          src={direct}
          alt={asset.file_name ?? 'Shared image'}
          className="h-full w-full rounded-[13px] object-cover"
          loading="lazy"
          draggable={false}
          onLoad={() => setStatus('direct')}
          onError={() => {
            if (embedAllowed) {
              setShowEmbed(true);
              setStatus('embed');
            } else {
              setStatus('inaccessible');
            }
          }}
        />
      </div>
    );
  }

  if (showEmbed && info?.previewUrl && embedAllowed) {
    return (
      <div className="flex h-full w-full flex-col">
        <iframe
          src={info.previewUrl}
          title={asset.file_name ?? 'Media preview'}
          className="h-full w-full flex-1 rounded-t-[13px] border-0 bg-ink"
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
          loading="lazy"
        />
        <p className="border-t-2 border-ink/30 px-2 py-1 text-[10px] font-bold text-ink-soft">
          If playback fails,{' '}
          <a href={openUrl} target="_blank" rel="noreferrer noopener" className="underline">
            open in {info.providerLabel}
          </a>
        </p>
      </div>
    );
  }

  return fallbackPanel;
}

function LinkPanel({
  title,
  message,
  openUrl,
  extra,
}: {
  title: string;
  message: string;
  openUrl?: string;
  extra?: () => void;
}) {
  return (
    <div className="flex h-full w-full flex-col justify-between gap-2 p-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-extrabold">{title}</p>
        <p className="mt-1 line-clamp-3 text-xs leading-snug text-ink-soft">{message}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {openUrl ? (
          <a
            href={openUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="chip bg-mustard hover:bg-paper"
            onPointerDown={(event) => event.stopPropagation()}
          >
            Open original
          </a>
        ) : null}
        {extra ? (
          <button
            type="button"
            className="chip bg-sky hover:bg-paper"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              extra();
            }}
          >
            Try embedded preview
          </button>
        ) : null}
      </div>
    </div>
  );
}

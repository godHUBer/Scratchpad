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
  interactive: boolean;
  /** When the host already handles dragging (DOM card shell). */
  embedded?: boolean;
}

/**
 * Renders a media reference with a progressive fallback:
 *   direct <img>/<audio>/<video> -> Drive preview iframe -> open-in-Drive panel.
 * A successful iframe load is never treated as proof that playback works.
 */
export function MediaCardBody({ asset, onStatus, interactive }: MediaCardBodyProps) {
  const [status, setStatus] = useState<MediaStatus>('direct');
  const [showEmbed, setShowEmbed] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

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
    setStatus(asset ? 'direct' : 'inaccessible');
  }, [asset?.id, asset]);

  useEffect(() => {
    onStatus?.(status);
  }, [status, onStatus]);

  // demote to the Drive preview if a direct player never becomes ready
  useEffect(() => {
    if (!asset || !info?.previewUrl) return;
    if (asset.file_type !== 'audio' && asset.file_type !== 'video') return;
    if (showEmbed) return;
    const timer = window.setTimeout(() => setTimedOut(true), 9000);
    return () => window.clearTimeout(timer);
  }, [asset, info?.previewUrl, showEmbed]);

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
        {embedAllowed ? (
          <button
            type="button"
            className="self-start text-xs font-bold underline decoration-2 underline-offset-2"
            onClick={(event) => {
              event.stopPropagation();
              setShowEmbed(true);
              setStatus('embed');
            }}
          >
            Use Drive preview instead
          </button>
        ) : null}
      </div>
    );
  }

  if (asset.file_type === 'image' && direct && !showEmbed) {
    return (
      <div className="relative h-full w-full">
        <img
          src={direct}
          alt={asset.file_name ?? 'Shared image'}
          className="h-full w-full rounded-[13px] object-cover"
          loading="lazy"
          draggable={!interactive}
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
            Open original ↗
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

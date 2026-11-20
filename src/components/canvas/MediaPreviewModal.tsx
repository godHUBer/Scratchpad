import { Modal } from '../ui/Modal';
import {
  driveOpenUrl,
  isIframeAllowed,
  mediaFailureExplanation,
  type DriveLinkInfo,
} from '../../lib/drive';
import { hostnameOf } from '../../lib/format';
import { useMemo } from 'react';
import type { MediaAsset } from '../../types';

/**
 * Full-size preview for a media card.
 *
 * Why this exists: double-clicking an image did nothing visible, because the
 * only handler edited the link — a *write*, which viewers are not allowed to
 * do, and which meant nobody could simply look at a picture at full size. This
 * dialog is read-only, so it works for every role.
 */
export function MediaPreviewModal({
  open,
  asset,
  onClose,
  onEdit,
}: {
  open: boolean;
  asset: MediaAsset | null;
  onClose: () => void;
  onEdit?: () => void;
}) {
  const info = useMemo<DriveLinkInfo | null>(() => {
    if (!asset) return null;
    const isDrive = Boolean(asset.drive_file_id);
    return {
      provider: isDrive ? 'drive' : 'direct',
      fileId: asset.drive_file_id,
      kind: asset.file_type,
      directUrl: isDrive && asset.drive_file_id ? null : asset.original_url,
      previewUrl:
        isDrive && asset.drive_file_id
          ? `https://drive.google.com/file/d/${asset.drive_file_id}/preview`
          : null,
      openUrl: isDrive && asset.drive_file_id ? driveOpenUrl(asset.drive_file_id) : asset.original_url,
      needsManualType: false,
      providerLabel: isDrive ? 'Google Drive' : hostnameOf(asset.original_url),
    };
  }, [asset]);

  const title = asset?.file_name ?? (asset ? `This ${asset.file_type}` : 'Media');
  const embedAllowed = info?.previewUrl ? isIframeAllowed(info.previewUrl) : false;

  return (
    <Modal
      open={open && Boolean(asset)}
      onClose={onClose}
      title={title}
      description={asset ? `${asset.file_type} · ${info?.providerLabel ?? 'link'}` : undefined}
      size="lg"
      footer={
        <>
          {onEdit ? (
            <button type="button" className="btn" onClick={onEdit}>
              Edit link
            </button>
          ) : null}
          {info?.openUrl ? (
            <a className="btn btn-primary" href={info.openUrl} target="_blank" rel="noreferrer noopener">
              Open original
            </a>
          ) : null}
        </>
      }
    >
      {!asset || !info ? (
        <p className="text-sm text-ink-soft">Nothing to preview.</p>
      ) : asset.file_type === 'image' ? (
        <figure className="space-y-2">
          <img
            src={info.directUrl ?? info.previewUrl ?? ''}
            alt={title}
            className="max-h-[60vh] w-full rounded-xl border-[3px] border-ink bg-ink object-contain"
          />
          <figcaption className="text-xs font-semibold text-ink-soft">
            {mediaFailureExplanation('image', info.provider)}
          </figcaption>
        </figure>
      ) : asset.file_type === 'video' ? (
        <video
          className="max-h-[60vh] w-full rounded-xl border-[3px] border-ink bg-ink"
          src={info.directUrl ?? undefined}
          controls
          playsInline
          preload="metadata"
        />
      ) : asset.file_type === 'audio' ? (
        <div className="space-y-3">
          <div className="grid place-items-center rounded-xl border-[3px] border-ink bg-cream p-6">
            <p className="text-sm font-extrabold">{title}</p>
            <audio className="mt-3 w-full" src={info.directUrl ?? undefined} controls preload="metadata">
              <track kind="captions" />
            </audio>
          </div>
          {embedAllowed && info.previewUrl ? (
            <iframe
              title="Drive audio preview"
              src={info.previewUrl}
              className="h-72 w-full rounded-xl border-[3px] border-ink"
              allow="autoplay; encrypted-media"
            />
          ) : null}
        </div>
      ) : embedAllowed && info.previewUrl ? (
        <iframe
          title="Embedded preview"
          src={info.previewUrl}
          className="h-[60vh] w-full rounded-xl border-[3px] border-ink"
          allow="autoplay; encrypted-media; fullscreen"
        />
      ) : (
        <p className="text-sm text-ink-soft">{mediaFailureExplanation(asset.file_type, info.provider)}</p>
      )}
    </Modal>
  );
}

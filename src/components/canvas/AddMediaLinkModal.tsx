import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../integrations/supabase/client';
import { humanizeError } from '../../lib/errors';
import {
  isIframeAllowed,
  isSafeMediaSrc,
  mediaFailureExplanation,
  normalizeUrlInput,
  parseMediaUrl,
  type DriveLinkInfo,
} from '../../lib/drive';
import type { MediaAsset, MediaKind } from '../../types';
import { Icon, type IconName } from '../ui/Icon';

interface AddMediaLinkModalProps {
  open: boolean;
  workspaceId: string | null;
  /** Which toolbar button opened this — the modal must not silently say "image". */
  initialKind?: MediaKind;
  /** Editing an existing asset instead of creating one. */
  asset?: MediaAsset | null;
  onClose: () => void;
  onSaved: (asset: MediaAsset) => void;
}

// Inline SVG, not emoji: these rendered as tofu boxes on any machine without a
// colour-emoji font (see Icon.tsx for the full explanation).
const KIND_OPTIONS: Array<{ value: MediaKind; label: string; icon: IconName }> = [
  { value: 'image', label: 'Image', icon: 'image' },
  { value: 'audio', label: 'Audio', icon: 'audio' },
  { value: 'video', label: 'Video', icon: 'video' },
  { value: 'link', label: 'Link card', icon: 'link' },
];

export function AddMediaLinkModal({ open, workspaceId, initialKind = 'image', asset, onClose, onSaved }: AddMediaLinkModalProps) {
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [kind, setKind] = useState<MediaKind>('image');
  const [name, setName] = useState('');
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<'idle' | 'loading' | 'ok' | 'failed'>('idle');

  useEffect(() => {
    if (!open) return;
    setUrl(asset?.original_url ?? '');
    // Seed from the button the user pressed. Before this, `kind` defaulted to
    // 'image' regardless, so the audio/video/Link buttons all opened an
    // image-typed form and saved image assets.
    setKind(asset?.file_type ?? initialKind);
    setName(asset?.file_name ?? '');
    setManual(Boolean(asset));
    setError(null);
    setProbe('idle');
  }, [open, asset, initialKind]);

  const parsed = useMemo<DriveLinkInfo | null>(() => {
    const normalized = normalizeUrlInput(url);
    if (!normalized) return null;
    return parseMediaUrl(normalized);
  }, [url]);

  // auto-fill the detected type unless the user has taken over
  useEffect(() => {
    if (!parsed || manual) return;
    if (parsed.kind !== 'link') {
      setKind(parsed.kind);
    } else if (parsed.needsManualType) {
      // unknown Drive file: keep the current choice but flag manual selection
      setManual(true);
    }
    if (!name) {
      const guessName = parsed.fileId
        ? `Drive file ${parsed.fileId.slice(0, 6)}…`
        : decodeURIComponent(new URL(normalizeUrlInput(url)).pathname.split('/').filter(Boolean).pop() ?? 'Media');
      setName(guessName);
    }
  }, [parsed, manual, name, url]);

  const previewSrc = useMemo(() => {
    if (!parsed) return null;
    if (kind === 'image') return parsed.directUrl ?? parsed.previewUrl;
    return parsed.directUrl;
  }, [parsed, kind]);

  const save = async () => {
    if (!workspaceId) return;
    const normalized = normalizeUrlInput(url);
    const info = parseMediaUrl(normalized);
    if (!info) {
      setError('Paste an https:// link (Google Drive share links work best).');
      return;
    }
    if (!manual && !info.fileId && info.provider === 'drive') {
      setError('That Drive link has no recognisable file id. Copy the “Share → Copy link” URL.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('save_media_asset', {
        p_workspace_id: workspaceId,
        p_original_url: normalized,
        p_file_type: kind,
        p_drive_file_id: info.fileId,
        p_file_name: name.trim() || null,
        p_id: asset?.id ?? null,
      });
      if (rpcError) throw new Error(humanizeError(rpcError));
      if (!data) throw new Error('The media reference could not be saved.');
      onSaved(data as MediaAsset);
      toast.success(asset ? 'Media link updated.' : 'Media added to the canvas.');
      onClose();
    } catch (err) {
      setError(humanizeError(err));
    } finally {
      setBusy(false);
    }
  };

  const isDrive = parsed?.provider === 'drive' || parsed?.provider === 'docs';
  const embedAllowed = parsed?.previewUrl ? isIframeAllowed(parsed.previewUrl) : false;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={asset ? 'Edit media link' : 'Add media from a link'}
      description="Paste a Google Drive share link or a direct https media URL. Files stay in Drive — Scratchpad only stores the link and its metadata."
      size="lg"
      busy={busy}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !parsed}>
            {busy ? 'Saving…' : asset ? 'Save changes' : 'Add to canvas'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="media-url">
            Media URL
          </label>
          <input
            id="media-url"
            className="input"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              setProbe('idle');
              setManual(false);
            }}
            placeholder="https://drive.google.com/file/d/…/view?usp=sharing"
            data-autofocus
            inputMode="url"
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
            {parsed ? (
              <>
                <span className="chip bg-mint">{parsed.providerLabel}</span>
                {parsed.fileId ? <span className="chip">id {parsed.fileId.slice(0, 8)}…</span> : null}
                <span className="chip bg-mustard">detected: {parsed.kind}</span>
                {parsed.needsManualType ? (
                  <span className="chip bg-coral">pick the type manually</span>
                ) : null}
              </>
            ) : url ? (
              <span className="chip bg-coral">not a valid https link</span>
            ) : (
              <span className="text-ink-soft">Drive links, mp4/mp3/png, YouTube, Vimeo…</span>
            )}
          </div>
        </div>

        <fieldset>
          <legend className="label">Media type</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {KIND_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  setKind(option.value);
                  setManual(true);
                }}
                aria-pressed={kind === option.value}
                className={`btn min-h-10 justify-start px-2 py-1 text-sm ${
                  kind === option.value ? 'bg-mustard' : 'bg-paper'
                }`}
              >
                <Icon name={option.icon} size={16} /> {option.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-ink-soft">
            Detection is a best guess — Google Drive does not expose a file type without the Drive API. You can always
            change it.
          </p>
        </fieldset>

        <div>
          <label className="label" htmlFor="media-name">
            Display name <span className="font-normal text-ink-soft">(optional)</span>
          </label>
          <input
            id="media-name"
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={200}
            placeholder="e.g. Moodboard for spring campaign"
          />
        </div>

        <section className="rounded-2xl border-[3px] border-ink bg-cream p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-black uppercase tracking-widest">Preview</h3>
            <span className="chip">{probe === 'ok' ? 'loads ✓' : probe === 'failed' ? 'not loading' : 'test only'}</span>
          </div>

          {!parsed ? (
            <p className="text-sm text-ink-soft">Paste a link to see a preview.</p>
          ) : kind === 'image' && previewSrc && isSafeMediaSrc(previewSrc) ? (
            <div>
              <img
                src={previewSrc}
                alt="Preview"
                className="max-h-56 w-full rounded-xl border-2 border-ink object-contain"
                loading="lazy"
                onLoad={() => setProbe('ok')}
                onError={() => setProbe('failed')}
              />
              {probe === 'failed' && embedAllowed ? (
                <div className="mt-2">
                  <iframe
                    title="Drive preview"
                    src={parsed.previewUrl!}
                    className="h-56 w-full rounded-xl border-2 border-ink"
                    allow="autoplay; encrypted-media; fullscreen"
                  />
                  <p className="mt-1 text-xs text-ink-soft">
                    The direct image did not load, so this is Google's embedded preview. It still needs the file to be
                    shared.
                  </p>
                </div>
              ) : null}
              {probe === 'failed' && !embedAllowed ? (
                <p className="mt-2 rounded-xl border-[3px] border-ink bg-coral px-3 py-2 text-xs font-bold">
                  {mediaFailureExplanation('image', parsed.provider)} Permission failures are decided by Google Drive,
                  not Scratchpad.
                </p>
              ) : null}
            </div>
          ) : kind === 'video' && previewSrc && isSafeMediaSrc(previewSrc) ? (
            <video
              src={previewSrc}
              className="max-h-56 w-full rounded-xl border-2 border-ink bg-ink"
              controls
              preload="metadata"
              onLoadedMetadata={() => setProbe('ok')}
              onError={() => setProbe('failed')}
            />
          ) : kind === 'audio' && previewSrc && isSafeMediaSrc(previewSrc) ? (
            <audio
              src={previewSrc}
              controls
              preload="metadata"
              className="w-full"
              onLoadedMetadata={() => setProbe('ok')}
              onError={() => setProbe('failed')}
            />
          ) : embedAllowed && parsed.previewUrl ? (
            <iframe
              title="Embedded preview"
              src={parsed.previewUrl}
              className="h-56 w-full rounded-xl border-2 border-ink"
              allow="autoplay; encrypted-media; fullscreen"
            />
          ) : (
            <div className="rounded-xl border-2 border-ink bg-paper p-3">
              <p className="text-sm font-bold">{parsed.providerLabel} link card</p>
              <p className="mt-1 text-xs text-ink-soft">
                {parsed.provider === 'other'
                  ? 'This site is not an approved embed provider, so the card links out instead of embedding a page.'
                  : 'No inline preview for this link — the card opens it in a new tab.'}
              </p>
            </div>
          )}

          {parsed?.provider === 'drive' || parsed?.provider === 'docs' ? (
            <p className="mt-2 text-xs text-ink-soft">
              {isDrive && parsed.fileId ? (
                <>
                  Drive file <code className="font-mono">{parsed.fileId}</code>.{' '}
                </>
              ) : null}
              If it does not load, open the file in Drive and set sharing to{' '}
              <strong>Anyone with the link → Viewer</strong>.
            </p>
          ) : null}
        </section>

        <div className="rounded-2xl border-[3px] border-ink bg-mustard/40 px-3 py-2 text-xs font-semibold">
          <strong>Heads up:</strong> anyone with this link may be able to open the original file — Google Drive sharing is separate from
          Scratchpad permissions. Scratchpad never stores the file itself, only this link.
        </div>

        {error ? (
          <p className="rounded-xl border-[3px] border-ink bg-coral px-3 py-2 text-sm font-bold" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

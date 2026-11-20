// Google Drive shared-link helpers. No Google Drive API, no OAuth, no SDK.
//
// Everything here is a *heuristic*: without the Drive API we cannot read a
// file's MIME type or permissions, so type detection is best-effort and the UI
// always offers a manual override.

import type { MediaKind } from '../types';

export interface DriveLinkInfo {
  provider: 'drive' | 'docs' | 'direct' | 'youtube' | 'vimeo' | 'other';
  fileId: string | null;
  /** Guessed kind; callers must let the user override. */
  kind: MediaKind;
  /** Direct <img>/<video>/<audio> candidate, when one can be derived. */
  directUrl: string | null;
  /** Drive's embeddable preview iframe. */
  previewUrl: string | null;
  /** Provider page to open in a new tab. */
  openUrl: string;
  /** True when we could not infer a usable type. */
  needsManualType: boolean;
  providerLabel: string;
}

const DRIVE_ID = /^[A-Za-z0-9_-]{10,}$/;

/**
 * Parse any supported media URL.
 * Returns `null` for inputs that are not usable https URLs.
 */
export function parseMediaUrl(rawInput: string): DriveLinkInfo | null {
  const raw = (rawInput ?? '').trim();
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;

  const host = url.hostname.toLowerCase();
  const path = url.pathname;

  // --- Google Drive -------------------------------------------------------
  if (host === 'drive.google.com' || host === 'docs.google.com') {
    const fileId = extractDriveId(url);
    const guessed = guessKindFromName(path) ?? 'link';
    return {
      provider: host === 'docs.google.com' ? 'docs' : 'drive',
      fileId,
      kind: guessed,
      directUrl: fileId ? driveDirectUrl(fileId, guessed) : null,
      previewUrl: fileId ? `https://drive.google.com/file/d/${fileId}/preview` : null,
      openUrl: raw,
      needsManualType: guessed === 'link',
      providerLabel: 'Google Drive',
    };
  }

  // already-direct Google image host
  if (/^lh\d\.googleusercontent\.com$/.test(host) && path.startsWith('/d/')) {
    const fileId = path.split('/')[2] ?? null;
    return {
      provider: 'drive',
      fileId: fileId && DRIVE_ID.test(fileId) ? fileId : null,
      kind: 'image',
      directUrl: raw,
      previewUrl: fileId ? `https://drive.google.com/file/d/${fileId}/preview` : null,
      openUrl: raw,
      needsManualType: false,
      providerLabel: 'Google Drive',
    };
  }

  if (host === 'drive.usercontent.google.com') {
    const id = url.searchParams.get('id');
    return {
      provider: 'drive',
      fileId: id,
      kind: 'link',
      directUrl: raw,
      previewUrl: id ? `https://drive.google.com/file/d/${id}/preview` : null,
      openUrl: raw,
      needsManualType: true,
      providerLabel: 'Google Drive',
    };
  }

  // --- other embeddable providers ----------------------------------------
  if (host === 'www.youtube.com' || host === 'youtube.com' || host === 'youtu.be') {
    return {
      provider: 'youtube',
      fileId: null,
      kind: 'video',
      directUrl: null,
      previewUrl: youtubeEmbedUrl(url),
      openUrl: raw,
      needsManualType: false,
      providerLabel: 'YouTube',
    };
  }
  if (host === 'vimeo.com' || host === 'www.vimeo.com') {
    const id = path.split('/').filter(Boolean)[0];
    return {
      provider: 'vimeo',
      fileId: id ?? null,
      kind: 'video',
      directUrl: null,
      previewUrl: id && /^\d+$/.test(id) ? `https://player.vimeo.com/video/${id}` : null,
      openUrl: raw,
      needsManualType: !id,
      providerLabel: 'Vimeo',
    };
  }

  // --- direct file URL ----------------------------------------------------
  const guessed = guessKindFromName(path) ?? 'link';
  if (isLikelyDirectMedia(url)) {
    return {
      provider: 'direct',
      fileId: null,
      kind: guessed,
      directUrl: raw,
      previewUrl: null,
      openUrl: raw,
      needsManualType: guessed === 'link',
      providerLabel: 'Direct link',
    };
  }

  // --- anything else: a plain link card, never an embedded page -----------
  return {
    provider: 'other',
    fileId: null,
    kind: 'link',
    directUrl: null,
    previewUrl: null,
    openUrl: raw,
    needsManualType: false,
    providerLabel: host,
  };
}

/** Extract a Drive file id from every sharing URL shape Google produces. */
export function extractDriveId(url: URL): string | null {
  // Only Google hosts can carry a Drive id; never trust a lookalike path.
  const host = url.hostname.toLowerCase();
  if (host !== 'drive.google.com' && host !== 'docs.google.com') return null;
  const path = url.pathname;

  // /file/d/<id>/view
  const fileD = path.match(/\/file\/d\/([A-Za-z0-9_-]+)/);
  if (fileD?.[1]) return fileD[1];

  // /d/<id>/edit (docs, slides, sheets, drawings)
  const docsD = path.match(/\/d\/([A-Za-z0-9_-]+)/);
  if (docsD?.[1]) return docsD[1];

  // ?id=<id> (open, uc, thumbnail)
  const id = url.searchParams.get('id');
  if (id && DRIVE_ID.test(id)) return id;

  // /drive/folders/<id> is a folder, not media
  return null;
}

/**
 * Best-effort direct URL for Drive content.
 *
 * Images work: `lh3.googleusercontent.com/d/<id>` is a real image response.
 *
 * Audio and video do **not**. The only streamable-looking Drive endpoint left is
 * `drive.usercontent.google.com/download?id=…&export=download`, and that replies
 * with `Content-Disposition: attachment`. A browser will download it, not
 * decode it, so `<audio>`/`<video src="…">` fires `error` and never plays — the
 * "Google Drive audio looks buggy" report. Returning the URL anyway just makes
 * every player fail once before falling back, so we return null and let the
 * caller go straight to Drive's preview iframe (which does handle both).
 */
export function driveDirectUrl(fileId: string, kind: MediaKind): string | null {
  if (!DRIVE_ID.test(fileId)) return null;
  if (kind === 'image') return `https://lh3.googleusercontent.com/d/${fileId}=w2000`;
  return null;
}

export function drivePreviewUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/preview`;
}

export function driveOpenUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

const EXT_KIND: Record<string, MediaKind> = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', avif: 'image', svg: 'image', bmp: 'image',
  mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio', aac: 'audio', flac: 'audio', opus: 'audio',
  mp4: 'video', webm: 'video', mov: 'video', m4v: 'video', ogv: 'video',
};

/** Guess a kind from a path or filename; null when unknown. */
export function guessKindFromName(nameOrPath: string): MediaKind | null {
  const clean = nameOrPath.split('?')[0]?.split('#')[0] ?? '';
  const ext = clean.includes('.') ? clean.split('.').pop()?.toLowerCase() : undefined;
  if (!ext) return null;
  return EXT_KIND[ext] ?? null;
}

function isLikelyDirectMedia(url: URL): boolean {
  const kind = guessKindFromName(url.pathname);
  if (kind) return true;
  // hosted media services without extensions
  const h = url.hostname;
  return h === 'i.imgur.com' || h === 'images.unsplash.com' || h === 'media.giphy.com' || h === 'i.giphy.com';
}

function youtubeEmbedUrl(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = url.pathname.split('/')[1] ?? null;
  else if (url.pathname === '/watch') id = url.searchParams.get('v');
  else if (url.pathname.startsWith('/embed/')) id = url.pathname.split('/')[2] ?? null;
  else if (url.pathname.startsWith('/shorts/')) id = url.pathname.split('/')[2] ?? null;
  return id && /^[A-Za-z0-9_-]{6,}$/.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null;
}

/** Providers allowed to render inside an iframe. Everything else becomes a link card. */
const IFRAME_ALLOWLIST = new Set([
  'drive.google.com',
  'docs.google.com',
  'drive.usercontent.google.com',
  'www.youtube-nocookie.com',
  'www.youtube.com',
  'player.vimeo.com',
  'www.loom.com',
  'open.spotify.com',
  'w.soundcloud.com',
]);

export function isIframeAllowed(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && IFRAME_ALLOWLIST.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** True when the URL is safe to put in an <img>/<video>/<audio> src. */
export function isSafeMediaSrc(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Human-readable explanation for a media card failure state.
 */
export function mediaFailureExplanation(kind: MediaKind, provider: DriveLinkInfo['provider']): string {
  if (provider === 'drive' || provider === 'docs') {
    return kind === 'image'
      ? 'The image could not be loaded. Google Drive only serves files that are shared as "Anyone with the link". Check the file sharing settings, or open it in Drive.'
      : 'Playback is not available in this browser. Google Drive decides whether a file can be streamed here. Open the original file in Drive instead.';
  }
  return 'This link could not be loaded as media. It may require a sign-in, be private, or point at a page rather than a file.';
}

export function normalizeUrlInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // Accept bare Google Drive ids pasted by users
  if (DRIVE_ID.test(trimmed)) return `https://drive.google.com/file/d/${trimmed}/view`;
  return `https://${trimmed}`;
}

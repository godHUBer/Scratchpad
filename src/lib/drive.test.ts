import { describe, expect, it } from 'vitest';
import {
  driveDirectUrl,
  extractDriveId,
  guessKindFromName,
  isIframeAllowed,
  isSafeMediaSrc,
  normalizeUrlInput,
  parseMediaUrl,
} from './drive';

describe('extractDriveId', () => {
  const cases: Array<[string, string | null]> = [
    ['https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view?usp=sharing', '1AbCdEfGhIjKlMnOpQrStUvWxYz012345'],
    ['https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/preview', '1AbCdEfGhIjKlMnOpQrStUvWxYz012345'],
    ['https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUvWxYz012345', '1AbCdEfGhIjKlMnOpQrStUvWxYz012345'],
    ['https://drive.google.com/uc?id=1AbCdEfGhIjKlMnOpQrStUvWxYz012345&export=download', '1AbCdEfGhIjKlMnOpQrStUvWxYz012345'],
    ['https://docs.google.com/presentation/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit', '1AbCdEfGhIjKlMnOpQrStUvWxYz012345'],
    ['https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz012345', null],
    ['https://example.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345', null],
  ];
  it.each(cases)('%s', (input, expected) => {
    expect(extractDriveId(new URL(input))).toBe(expected);
  });
});

describe('parseMediaUrl', () => {
  it('rejects http and empty input', () => {
    expect(parseMediaUrl('http://drive.google.com/file/d/abc/view')).toBeNull();
    expect(parseMediaUrl('   ')).toBeNull();
    expect(parseMediaUrl('not a url')).toBeNull();
  });

  it('rejects javascript: and data: urls', () => {
    expect(parseMediaUrl('javascript:alert(1)')).toBeNull();
    expect(parseMediaUrl('data:image/png;base64,AAAA')).toBeNull();
  });

  it('parses a drive image link with an extension hint', () => {
    const info = parseMediaUrl('https://drive.google.com/file/d/1AbCdEfGhIjKl/view?usp=sharing&name=cat.png');
    expect(info?.provider).toBe('drive');
    expect(info?.fileId).toBe('1AbCdEfGhIjKl');
  });

  it('without an extension the type needs manual selection', () => {
    const info = parseMediaUrl('https://drive.google.com/file/d/1AbCdEfGhIjKl/view?usp=sharing');
    expect(info?.kind).toBe('link');
    expect(info?.needsManualType).toBe(true);
    expect(info?.previewUrl).toBe('https://drive.google.com/file/d/1AbCdEfGhIjKl/preview');
  });

  it('builds a preview url for drive links', () => {
    const info = parseMediaUrl('https://drive.google.com/open?id=1AbCdEfGhIjKl');
    expect(info?.previewUrl).toBe('https://drive.google.com/file/d/1AbCdEfGhIjKl/preview');
  });

  it('detects a direct image url', () => {
    const info = parseMediaUrl('https://images.unsplash.com/photo-123.jpg');
    expect(info?.provider).toBe('direct');
    expect(info?.kind).toBe('image');
    expect(info?.directUrl).toBe('https://images.unsplash.com/photo-123.jpg');
  });

  it('detects direct audio and video urls', () => {
    expect(parseMediaUrl('https://cdn.example.com/song.mp3')?.kind).toBe('audio');
    expect(parseMediaUrl('https://cdn.example.com/clip.mp4')?.kind).toBe('video');
  });

  it('maps youtube and vimeo to embeddable previews', () => {
    expect(parseMediaUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')?.previewUrl).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    );
    expect(parseMediaUrl('https://youtu.be/dQw4w9WgXcQ')?.kind).toBe('video');
    expect(parseMediaUrl('https://vimeo.com/123456789')?.previewUrl).toBe('https://player.vimeo.com/video/123456789');
  });

  it('treats unknown sites as plain link cards', () => {
    const info = parseMediaUrl('https://someblog.example/post/hello');
    expect(info?.provider).toBe('other');
    expect(info?.kind).toBe('link');
    expect(info?.previewUrl).toBeNull();
  });

  it('accepts the lh3 direct-image host and keeps the file id', () => {
    const info = parseMediaUrl('https://lh3.googleusercontent.com/d/1AbCdEfGhIjKl');
    expect(info?.kind).toBe('image');
    expect(info?.fileId).toBe('1AbCdEfGhIjKl');
  });
});

describe('driveDirectUrl', () => {
  it('uses the image host for images', () => {
    expect(driveDirectUrl('1AbCdEfGhIjKl', 'image')).toContain('lh3.googleusercontent.com/d/1AbCdEfGhIjKl');
  });
  it('does not offer a direct URL for audio/video (Drive replies with an attachment)', () => {
    // Regression: the download endpoint returns Content-Disposition: attachment,
    // so an <audio>/<video> pointed at it can never play. Callers must use the
    // preview iframe instead.
    expect(driveDirectUrl('1AbCdEfGhIjKl', 'video')).toBeNull();
    expect(driveDirectUrl('1AbCdEfGhIjKl', 'audio')).toBeNull();
  });
  it('returns null for links', () => {
    expect(driveDirectUrl('1AbCdEfGhIjKl', 'link')).toBeNull();
  });
  it('rejects ids with invalid characters', () => {
    expect(driveDirectUrl('../../etc/passwd', 'image')).toBeNull();
  });
});

describe('guessKindFromName', () => {
  it('handles common extensions and unknown ones', () => {
    expect(guessKindFromName('/a/b/photo.WEBP')).toBe('image');
    expect(guessKindFromName('voice memo.m4a')).toBe('audio');
    expect(guessKindFromName('clip.mov')).toBe('video');
    expect(guessKindFromName('document.pdf')).toBeNull();
    expect(guessKindFromName('no-extension')).toBeNull();
  });
});

describe('iframe allowlist', () => {
  it('allows only known providers over https', () => {
    expect(isIframeAllowed('https://drive.google.com/file/d/abc/preview')).toBe(true);
    expect(isIframeAllowed('https://player.vimeo.com/video/1')).toBe(true);
    expect(isIframeAllowed('https://evil.example/file/d/abc/preview')).toBe(false);
    expect(isIframeAllowed('http://drive.google.com/file/d/abc/preview')).toBe(false);
    expect(isIframeAllowed('javascript:alert(1)')).toBe(false);
    // hostname lookalike must not pass
    expect(isIframeAllowed('https://drive.google.com.evil.example/x')).toBe(false);
  });
});

describe('isSafeMediaSrc', () => {
  it('requires https', () => {
    expect(isSafeMediaSrc('https://x.example/a.png')).toBe(true);
    expect(isSafeMediaSrc('http://x.example/a.png')).toBe(false);
    expect(isSafeMediaSrc('ftp://x.example/a.png')).toBe(false);
  });
});

describe('normalizeUrlInput', () => {
  it('adds https and expands bare drive ids', () => {
    expect(normalizeUrlInput('example.com/a.png')).toBe('https://example.com/a.png');
    expect(normalizeUrlInput('1AbCdEfGhIjKlMnOpQrStUvWxYz012345')).toBe(
      'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view',
    );
    expect(normalizeUrlInput('  ')).toBe('');
  });
});

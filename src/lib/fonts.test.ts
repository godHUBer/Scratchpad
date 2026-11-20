import { describe, expect, it } from 'vitest';
import {
  BUILTIN_FONTS,
  DEFAULT_FONT,
  primaryFamily,
  fontStack,
  parseFontImport,
  readImportedFonts,
  serializeFonts,
  FONTS_STORAGE_KEY,
  type ImportedFont,
} from './fonts';

const existing: ImportedFont[] = [
  { family: 'Brand Sans', url: 'https://fonts.example.com/brand.css', isStylesheet: true, addedAt: '2026-01-01T00:00:00.000Z' },
];

describe('builtin fonts', () => {
  it('exposes distinct families and always includes the default', () => {
    const families = BUILTIN_FONTS.map((font) => font.family);
    expect(new Set(families).size).toBe(families.length);
    expect(families).toContain(DEFAULT_FONT);
  });

  it('every builtin stack starts with its own family', () => {
    // the stack may quote the first name ('Courier New'); compare unquoted
    const firstInStack = (stack: string) =>
      (stack.split(',')[0] ?? '').trim().replace(/^['"]|['"]$/g, '').toLowerCase();
    for (const font of BUILTIN_FONTS) {
      expect(firstInStack(font.stack)).toBe(primaryFamily(font.family).toLowerCase());
    }
  });
});

describe('parseFontImport', () => {
  it('accepts an https stylesheet', () => {
    const result = parseFontImport({ family: 'Inter', url: 'https://fonts.googleapis.com/css2?family=Inter' });
    expect(result.ok).toBe(true);
    expect(result.font).toMatchObject({ family: 'Inter', isStylesheet: true });
  });

  it('accepts a direct font file and marks it as a file', () => {
    const result = parseFontImport({ family: 'Grotesk', url: 'https://cdn.example.com/grotesk.woff2' });
    expect(result.ok).toBe(true);
    expect(result.font?.isStylesheet).toBe(false);
  });

  it('rejects http, javascript: and garbage URLs', () => {
    expect(parseFontImport({ family: 'A', url: 'http://example.com/a.css' }).problem).toBe('not-https');
    expect(parseFontImport({ family: 'A', url: 'javascript:alert(1)' }).problem).toBe('not-https');
    expect(parseFontImport({ family: 'A', url: 'not a url' }).problem).toBe('bad-url');
    expect(parseFontImport({ family: 'A', url: '' }).problem).toBe('bad-url');
  });

  it('rejects empty and hostile family names', () => {
    expect(parseFontImport({ family: '   ', url: 'https://x.example/a.css' }).problem).toBe('empty-name');
    expect(parseFontImport({ family: 'Bad; Drop', url: 'https://x.example/a.css' }).problem).toBe('bad-name');
    expect(parseFontImport({ family: 'a'.repeat(81), url: 'https://x.example/a.css' }).problem).toBe('bad-name');
    // quotes would let a name escape the CSS string it is interpolated into
    expect(parseFontImport({ family: '"x"', url: 'https://x.example/a.css' }).problem).toBe('bad-name');
  });

  it('rejects duplicates by family name and by URL', () => {
    expect(parseFontImport({ family: 'brand sans', url: 'https://other.example/x.css' }, existing).problem).toBe(
      'duplicate',
    );
    expect(
      parseFontImport({ family: 'Something else', url: 'https://fonts.example.com/brand.css' }, existing).problem,
    ).toBe('duplicate');
  });
});

describe('fontStack / primaryFamily', () => {
  it('uses the builtin stack when the family is known', () => {
    const georgia = BUILTIN_FONTS.find((font) => font.label === 'Georgia')!;
    expect(fontStack(georgia.family)).toBe(georgia.stack);
  });

  it('appends the default stack to imported families', () => {
    expect(fontStack('Brand Sans')).toContain('Brand Sans');
    expect(fontStack('Brand Sans')).toContain('Trebuchet MS');
  });

  it('falls back safely and strips quotes for Konva', () => {
    expect(fontStack(undefined)).toBe(DEFAULT_FONT);
    expect(primaryFamily("'Courier New', monospace")).toBe('Courier New');
    expect(primaryFamily(undefined)).toBe('Trebuchet MS');
  });
});

describe('readImportedFonts', () => {
  const storage = (value: string | null) => ({ getItem: (key: string) => (key === FONTS_STORAGE_KEY ? value : null) });

  it('returns [] for null storage and corrupt JSON', () => {
    expect(readImportedFonts(null)).toEqual([]);
    expect(readImportedFonts(storage('{not json'))).toEqual([]);
    expect(readImportedFonts(storage('{"a":1}'))).toEqual([]);
  });

  it('drops entries that are not https or have unusable names', () => {
    const raw = serializeFonts([
      { family: 'Good', url: 'https://x.example/a.css', isStylesheet: true, addedAt: '2026-01-01T00:00:00.000Z' },
      { family: 'Bad URL', url: 'http://x.example/a.css', isStylesheet: true, addedAt: '2026-01-01T00:00:00.000Z' },
      { family: 'Bad"Name', url: 'https://x.example/b.css', isStylesheet: true, addedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    const fonts = readImportedFonts(storage(raw));
    expect(fonts.map((font) => font.family)).toEqual(['Good']);
  });

  it('round-trips through serializeFonts', () => {
    expect(readImportedFonts(storage(serializeFonts(existing)))).toEqual(existing);
  });
});

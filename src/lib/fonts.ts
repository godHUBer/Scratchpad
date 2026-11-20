/**
 * Font registry for canvas text.
 *
 * Why this exists: the canvas used to hard-code `Trebuchet MS` for every text
 * and note item. People who wanted a heading (serif), a code snippet (mono) or
 * their own brand face had no way to say so.
 *
 * Imported fonts are fonts the *user* brings: we only ever accept a stylesheet
 * or font-file URL, hand it to the browser, and remember the family name. There
 * is no upload, no storage of font binaries, and nothing is fetched from
 * Scratchpad's origin.
 */

/** Fonts that need no network access: they resolve to faces the OS already has. */
export interface BuiltinFont {
  /** Value stored on the canvas item and passed to CSS/Konva. */
  family: string;
  label: string;
  /** Shown next to the name in the picker. */
  note: string;
  /** CSS font stack, so a missing face degrades sensibly. */
  stack: string;
}

const SANS_FALLBACK = "'Trebuchet MS', 'Segoe UI', system-ui, sans-serif";
const SERIF_FALLBACK = "Georgia, 'Times New Roman', serif";
const MONO_FALLBACK = "'Courier New', ui-monospace, monospace";
export const DEFAULT_FONT = SANS_FALLBACK;

export const BUILTIN_FONTS: BuiltinFont[] = [
  { family: DEFAULT_FONT, label: 'Trebuchet', note: 'default', stack: SANS_FALLBACK },
  { family: "Verdana, Geneva, sans-serif", label: 'Verdana', note: 'sans', stack: 'Verdana, Geneva, sans-serif' },
  { family: "Georgia, 'Times New Roman', serif", label: 'Georgia', note: 'serif', stack: SERIF_FALLBACK },
  { family: "'Times New Roman', Times, serif", label: 'Times', note: 'serif', stack: "'Times New Roman', Times, serif" },
  { family: "Garamond, 'Palatino Linotype', serif", label: 'Garamond', note: 'serif', stack: "Garamond, 'Palatino Linotype', serif" },
  { family: "'Courier New', ui-monospace, monospace", label: 'Courier', note: 'mono', stack: MONO_FALLBACK },
  { family: "'Comic Sans MS', 'Chalkboard SE', cursive", label: 'Comic', note: 'casual', stack: "'Comic Sans MS', 'Chalkboard SE', cursive" },
  { family: "'Trebuchet MS', 'Segoe UI', sans-serif", label: 'Trebuchet wide', note: 'ui', stack: SANS_FALLBACK },
];

export const BUILTIN_FAMILIES = new Set(BUILTIN_FONTS.map((font) => font.family));

/** An imported font, as remembered on this device. */
export interface ImportedFont {
  /** Family name used in CSS and Konva. */
  family: string;
  /** Where the browser can fetch it (stylesheet or direct font file). */
  url: string;
  /** true when `url` points at a stylesheet that declares @font-face. */
  isStylesheet: boolean;
  addedAt: string;
}

export const FONTS_STORAGE_KEY = 'scratchpad.fonts';

/** Basic CSS-family sanity: letters, digits, spaces, dots, dashes, underscores. */
const FAMILY_PATTERN = /^[A-Za-z0-9 _.-]{1,80}$/;

export type ImportProblem = 'empty-name' | 'bad-name' | 'bad-url' | 'not-https' | 'duplicate';

export interface ImportResult {
  ok: boolean;
  font?: ImportedFont;
  problem?: ImportProblem;
  message?: string;
}

function looksLikeStylesheet(url: URL): boolean {
  const path = url.pathname.toLowerCase();
  if (path.endsWith('.css')) return true;
  if (/\.(woff2?|ttf|otf|eot)$/.test(path)) return false;
  // Google Fonts CSS endpoints have no file extension.
  return true;
}

/**
 * Validate and normalise a user-supplied font import.
 *
 * Only https is accepted: a font loaded from http would be blocked as mixed
 * content on the deployed site, so accepting it would only create confusion.
 */
export function parseFontImport(input: { family: string; url: string }, existing: ImportedFont[] = []): ImportResult {
  const family = input.family.trim();
  if (!family) return { ok: false, problem: 'empty-name', message: 'Give the font a name.' };
  if (!FAMILY_PATTERN.test(family)) {
    return {
      ok: false,
      problem: 'bad-name',
      message: 'Font names may only use letters, numbers, spaces, dots, dashes and underscores.',
    };
  }

  const raw = input.url.trim();
  if (!raw) return { ok: false, problem: 'bad-url', message: 'Paste a stylesheet or font-file URL.' };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, problem: 'bad-url', message: 'That does not look like a URL.' };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, problem: 'not-https', message: 'Fonts must be served over https://.' };
  }

  const duplicate = existing.find(
    (font) => font.family.toLowerCase() === family.toLowerCase() || font.url === url.toString(),
  );
  if (duplicate) {
    return {
      ok: false,
      problem: 'duplicate',
      message: `“${duplicate.family}” is already imported on this device.`,
    };
  }

  return {
    ok: true,
    font: {
      family,
      url: url.toString(),
      isStylesheet: looksLikeStylesheet(url),
      addedAt: new Date().toISOString(),
    },
  };
}

/** True when a family is either built in or already imported. */
export function isKnownFamily(family: string, imported: ImportedFont[] = []): boolean {
  return BUILTIN_FAMILIES.has(family) || imported.some((font) => font.family === family);
}

/**
 * Build the CSS stack for a family.
 *
 * Konva accepts a single family name; CSS prefers a stack. Keeping this in one
 * place means the DOM editor and the canvas paint never disagree.
 */
export function fontStack(family: string | undefined): string {
  if (!family) return DEFAULT_FONT;
  const builtin = BUILTIN_FONTS.find((font) => font.family === family);
  if (builtin) return builtin.stack;
  return `${family}, ${SANS_FALLBACK}`;
}

/** Bare family name, for APIs that take one name only (Konva, FontFace). */
export function primaryFamily(family: string | undefined): string {
  if (!family) return 'Trebuchet MS';
  const first = family.split(',')[0]?.trim() ?? '';
  return first.replace(/^['"]|['"]$/g, '') || 'Trebuchet MS';
}

/** Read the saved imports without throwing on corrupt storage. */
export function readImportedFonts(storage: Pick<Storage, 'getItem'> | null): ImportedFont[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(FONTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry): ImportedFont[] => {
      if (!entry || typeof entry !== 'object') return [];
      const row = entry as Record<string, unknown>;
      const family = typeof row['family'] === 'string' ? row['family'] : '';
      const url = typeof row['url'] === 'string' ? row['url'] : '';
      if (!family || !url || !FAMILY_PATTERN.test(family)) return [];
      if (!url.startsWith('https://')) return [];
      return [
        {
          family,
          url,
          isStylesheet: row['isStylesheet'] !== false,
          addedAt: typeof row['addedAt'] === 'string' ? row['addedAt'] : new Date(0).toISOString(),
        },
      ];
    });
  } catch {
    return [];
  }
}

export function serializeFonts(fonts: ImportedFont[]): string {
  return JSON.stringify(fonts);
}

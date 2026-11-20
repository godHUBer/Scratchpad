import { useEffect, useMemo, useState } from 'react';
import {
  BUILTIN_FONTS,
  FONTS_STORAGE_KEY,
  DEFAULT_FONT,
  fontStack,
  parseFontImport,
  readImportedFonts,
  serializeFonts,
  type ImportedFont,
} from '../../lib/fonts';

/**
 * Font chooser for text and note items.
 *
 * Two halves: a list of fonts the OS already has, and a small importer for
 * anything else the user wants (a Google Fonts stylesheet, or a direct .woff2
 * URL). Imports are remembered per device in localStorage and are applied by
 * injecting the stylesheet that declares the @font-face.
 */

/** Inject (or reuse) the <link> that declares an imported font. */
function ensureFontLoaded(font: ImportedFont): void {
  if (!font.isStylesheet) {
    // a direct font file has no @font-face; register one so CSS can find it
    const id = `font-face-${font.family.replace(/\W+/g, '-')}`;
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `@font-face{font-family:"${font.family}";src:url("${font.url}");font-display:swap}`;
    document.head.appendChild(style);
    return;
  }
  const id = `font-link-${font.family.replace(/\W+/g, '-')}`;
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = font.url;
  document.head.appendChild(link);
}

function useImportedFonts() {
  const [fonts, setFonts] = useState<ImportedFont[]>([]);

  useEffect(() => {
    const stored = readImportedFonts(window.localStorage);
    setFonts(stored);
    for (const font of stored) ensureFontLoaded(font);
  }, []);

  const persist = (next: ImportedFont[]) => {
    setFonts(next);
    try {
      window.localStorage.setItem(FONTS_STORAGE_KEY, serializeFonts(next));
    } catch {
      // storage full / disabled: the font still works for this session
    }
  };

  const add = (font: ImportedFont) => {
    ensureFontLoaded(font);
    persist([...readImportedFonts(window.localStorage), font]);
  };

  const remove = (family: string) => {
    persist(fonts.filter((font) => font.family !== family));
    document.getElementById(`font-link-${family.replace(/\W+/g, '-')}`)?.remove();
    document.getElementById(`font-face-${family.replace(/\W+/g, '-')}`)?.remove();
  };

  return { fonts, add, remove };
}

export function FontPicker({
  value,
  onChange,
  compact = false,
}: {
  value: string | undefined;
  onChange: (family: string) => void;
  /** Renders a single inline select (for the toolbox) instead of the full panel. */
  compact?: boolean;
}) {
  const { fonts, add, remove } = useImportedFonts();
  const [showImport, setShowImport] = useState(false);
  const [family, setFamily] = useState('');
  const [url, setUrl] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const current = value ?? DEFAULT_FONT;
  const options = useMemo(
    () => [
      ...BUILTIN_FONTS.map((font) => ({ family: font.family, label: font.label, note: font.note })),
      ...fonts.map((font) => ({ family: font.family, label: font.family, note: 'imported' })),
    ],
    [fonts],
  );

  const importFont = () => {
    const result = parseFontImport({ family, url }, fonts);
    if (!result.ok || !result.font) {
      setProblem(result.message ?? 'That font could not be imported.');
      return;
    }
    add(result.font);
    onChange(result.font.family);
    setFamily('');
    setUrl('');
    setProblem(null);
    setShowImport(false);
  };

  if (compact) {
    return (
      <div className="space-y-1">
        <label className="label" htmlFor="font-family-select">
          Font
        </label>
        <select
          id="font-family-select"
          className="input"
          value={current}
          onChange={(event) => onChange(event.target.value)}
          style={{ fontFamily: fontStack(current) }}
        >
          {options.map((option) => (
            <option key={option.family} value={option.family} style={{ fontFamily: fontStack(option.family) }}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="text-xs font-bold underline decoration-2 underline-offset-2"
          onClick={() => setShowImport((open) => !open)}
        >
          {showImport ? 'Close font import' : 'Import a font…'}
        </button>
        {showImport ? (
          <ImportFields
            family={family}
            url={url}
            problem={problem}
            onFamily={setFamily}
            onUrl={setUrl}
            onImport={importFont}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="label mb-0">Font</span>
        <button
          type="button"
          className="btn min-h-7 px-2 py-0.5 text-[11px]"
          onClick={() => setShowImport((open) => !open)}
          aria-expanded={showImport}
        >
          {showImport ? 'Cancel' : '+ Import'}
        </button>
      </div>

      <div className="grid max-h-44 gap-1 overflow-y-auto pr-1 sm:grid-cols-2" role="radiogroup" aria-label="Font family">
        {options.map((option) => {
          const active = option.family === current;
          return (
            <button
              key={option.family}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(option.family)}
              className={`flex items-center justify-between gap-2 rounded-xl border-2 px-2 py-1.5 text-left ${
                active ? 'border-ink bg-mustard' : 'border-ink/25 bg-paper hover:border-ink'
              }`}
            >
              <span className="truncate text-sm font-bold" style={{ fontFamily: fontStack(option.family) }}>
                {option.label}
              </span>
              <span className="shrink-0 text-[10px] font-black uppercase tracking-wider text-ink-soft">
                {option.note}
              </span>
            </button>
          );
        })}
      </div>

      {fonts.length > 0 ? (
        <ul className="space-y-1">
          {fonts.map((font) => (
            <li key={font.family} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate font-bold">{font.family}</span>
              <button
                type="button"
                className="font-bold underline decoration-2 underline-offset-2 text-coral"
                onClick={() => {
                  remove(font.family);
                  if (current === font.family) onChange(DEFAULT_FONT);
                }}
              >
                remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {showImport ? (
        <ImportFields
          family={family}
          url={url}
          problem={problem}
          onFamily={setFamily}
          onUrl={setUrl}
          onImport={importFont}
        />
      ) : null}

      <p className="text-[11px] leading-snug text-ink-soft">
        Imported fonts are loaded from the URL you provide and remembered on this device. Teammates need to import the
        same URL to see it.
      </p>
    </div>
  );
}

function ImportFields({
  family,
  url,
  problem,
  onFamily,
  onUrl,
  onImport,
}: {
  family: string;
  url: string;
  problem: string | null;
  onFamily: (value: string) => void;
  onUrl: (value: string) => void;
  onImport: () => void;
}) {
  return (
    <div className="space-y-1.5 rounded-xl border-2 border-ink/30 bg-cream/70 p-2">
      <input
        className="input min-h-8 py-1 text-xs"
        value={family}
        onChange={(event) => onFamily(event.target.value)}
        placeholder="Family name, e.g. Inter"
        maxLength={80}
        aria-label="Font family name"
      />
      <input
        className="input min-h-8 py-1 text-xs"
        value={url}
        onChange={(event) => onUrl(event.target.value)}
        placeholder="https://fonts.googleapis.com/css2?family=Inter"
        inputMode="url"
        aria-label="Font stylesheet or file URL"
      />
      <button type="button" className="btn btn-primary min-h-8 w-full px-2 py-0.5 text-xs" onClick={onImport}>
        Load font
      </button>
      {problem ? (
        <p className="text-[11px] font-bold text-coral" role="alert">
          {problem}
        </p>
      ) : (
        <p className="text-[11px] text-ink-soft">
          Google Fonts: use “Copy CSS link”. Any https stylesheet or .woff2/.ttf URL works.
        </p>
      )}
    </div>
  );
}

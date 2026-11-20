import { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import type { CanvasItem } from '../../types';
import { FontPicker } from './FontPicker';
import { fontStack, DEFAULT_FONT } from '../../lib/fonts';

interface TextEditorModalProps {
  open: boolean;
  item: CanvasItem | null;
  initialText?: string;
  onClose: () => void;
  onSave: (value: {
    text: string;
    fontSize: number;
    color: string;
    align: 'left' | 'center' | 'right';
    fontFamily: string;
  }) => Promise<void>;
  defaultSize: number;
  defaultColor: string;
}

export function TextEditorModal({
  open,
  item,
  initialText,
  onClose,
  onSave,
  defaultSize,
  defaultColor,
}: TextEditorModalProps) {
  const [text, setText] = useState('');
  const [fontSize, setFontSize] = useState(defaultSize);
  const [color, setColor] = useState(defaultColor);
  const [align, setAlign] = useState<'left' | 'center' | 'right'>('left');
  const [fontFamily, setFontFamily] = useState<string>(DEFAULT_FONT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setText(item?.content.text ?? initialText ?? '');
    setFontSize(item?.content.fontSize ?? defaultSize);
    setColor(item?.content.color ?? defaultColor);
    setAlign(item?.content.align ?? 'left');
    setFontFamily(item?.content.fontFamily ?? DEFAULT_FONT);
    setError(null);
  }, [open, item, initialText, defaultSize, defaultColor]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSave({ text, fontSize, color, align, fontFamily });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the text.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={item ? 'Edit text' : 'Add text'}
      description="Text blocks move and resize like any other object."
      size="md"
      busy={busy}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="text-editor-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : item ? 'Save text' : 'Add to canvas'}
          </button>
        </>
      }
    >
      <form id="text-editor-form" onSubmit={submit} className="space-y-3">
        <div>
          <label className="label" htmlFor="text-content">
            Text
          </label>
          <textarea
            id="text-content"
            className="input min-h-[120px] text-base font-semibold"
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={2000}
            data-autofocus
            placeholder="Write a thought, a heading, a todo…"
            required
            style={{ fontFamily: fontStack(fontFamily), fontSize, color }}
          />
        </div>
        <FontPicker value={fontFamily} onChange={setFontFamily} />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="font-size">
              Size · {fontSize}px
            </label>
            <input
              id="font-size"
              type="range"
              min={12}
              max={72}
              value={fontSize}
              onChange={(event) => setFontSize(Number(event.target.value))}
              className="w-full accent-ink"
            />
          </div>
          <div>
            <label className="label" htmlFor="text-align">
              Alignment
            </label>
            <select
              id="text-align"
              className="input"
              value={align}
              onChange={(event) => setAlign(event.target.value as 'left' | 'center' | 'right')}
            >
              <option value="left">Left</option>
              <option value="center">Centre</option>
              <option value="right">Right</option>
            </select>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="text-color">
            Colour
          </label>
          <div className="flex items-center gap-2">
            <input
              id="text-color"
              type="color"
              value={color}
              onChange={(event) => setColor(event.target.value)}
              className="h-10 w-14 cursor-pointer rounded border-[3px] border-ink bg-paper p-0.5"
            />
            <span className="chip">{color}</span>
          </div>
        </div>
        {error ? (
          <p className="rounded-xl border-[3px] border-ink bg-coral px-3 py-2 text-sm font-bold" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

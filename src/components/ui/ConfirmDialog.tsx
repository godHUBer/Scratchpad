import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Modal } from './Modal';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  /**
   * When set, the confirm button stays disabled until the user types this exact
   * string. Used for actions that destroy more than one person's work (disbanding
   * a team), where a single misplaced click is not an acceptable undo story.
   */
  requireTyped?: string;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive,
  busy,
  requireTyped,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  // Reset whenever the dialog is reopened for a different subject, so a name
  // typed once cannot silently authorise a second, different deletion.
  useEffect(() => {
    if (open) setTyped('');
  }, [open, requireTyped]);

  const blocked = Boolean(requireTyped) && typed.trim() !== requireTyped;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      busy={busy}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn ${destructive ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={busy || blocked}
            data-autofocus={requireTyped ? undefined : true}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-sm leading-relaxed">
        {children}
        {requireTyped ? (
          <div className="mt-3">
            <label className="label" htmlFor="confirm-typed">
              Type <span className="font-mono">{requireTyped}</span> to confirm
            </label>
            <input
              id="confirm-typed"
              className="input"
              value={typed}
              autoComplete="off"
              onChange={(event) => setTyped(event.target.value)}
              data-autofocus={requireTyped ? true : undefined}
            />
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

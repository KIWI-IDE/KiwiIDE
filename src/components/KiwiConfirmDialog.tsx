import { useEffect, useRef } from "react";
import { t } from "../i18n";

interface KiwiConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  /** The lines of what is about to happen, when naming them helps. */
  details?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * A question in the middle of the window, with two answers and no field.
 *
 * The input dialog next door always wants something typed, and a notice in the
 * corner is easy to miss and easier to let expire. Something that is about to
 * move files asks here, before it moves them.
 */
export function KiwiConfirmDialog({
  open,
  title,
  description,
  details = [],
  confirmLabel = "Bestätigen",
  cancelLabel = "Abbrechen",
  onCancel,
  onConfirm,
}: KiwiConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    // The confirming button holds the focus, so Enter answers and Escape
    // refuses without anybody reaching for the mouse.
    confirmRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, open]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      // Clicking beside it is the same as saying no, which is the safe answer.
      if (event.target === event.currentTarget) onCancel();
    }}>
      <div className="modal confirm-dialog" role="alertdialog" aria-modal="true" aria-label={t(title)}>
        <header className="modal-header">
          <div><span><strong>{t(title)}</strong>{description && <small>{t(description)}</small>}</span></div>
        </header>
        {details.length > 0 && (
          <ul className="confirm-details">
            {details.map((line) => <li key={line}>{line}</li>)}
          </ul>
        )}
        <footer className="modal-footer">
          <span />
          <button type="button" className="secondary-button" onClick={onCancel}>{t(cancelLabel)}</button>
          <button
            type="button"
            ref={confirmRef}
            className="primary-button"
            onClick={onConfirm}
          >
            {t(confirmLabel)}
          </button>
        </footer>
      </div>
    </div>
  );
}

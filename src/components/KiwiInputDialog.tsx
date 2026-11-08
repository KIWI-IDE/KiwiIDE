import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { t } from "../i18n";

interface KiwiInputDialogProps {
  open: boolean;
  title: string;
  description?: string;
  label: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  variant?: "dialog" | "quick";
  /** Masks the field; used for tokens so they are not shown on screen. */
  secret?: boolean;
  validate?: (value: string) => string | null;
  onCancel: () => void;
  onConfirm: (value: string) => void | Promise<void>;
}

export function KiwiInputDialog({
  open,
  title,
  description,
  label,
  initialValue = "",
  placeholder,
  confirmLabel = "Erstellen",
  variant = "quick",
  secret = false,
  validate,
  onCancel,
  onConfirm,
}: KiwiInputDialogProps) {
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setValue(initialValue);
  }, [initialValue, open]);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel, open]);
  const error = useMemo(() => value.trim() ? validate?.(value.trim()) || null : "Bitte einen Wert eingeben.", [validate, value]);
  if (!open) return null;

  const submit = async () => {
    if (error) return;
    setBusy(true);
    try {
      await onConfirm(value.trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={variant === "quick" ? "quick-popup-backdrop" : "modal-backdrop"} onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <form className={`modal input-dialog ${variant === "quick" ? "quick-input-popover" : ""}`} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <header className={variant === "quick" ? "quick-input-header" : "modal-header"}><div><span><strong>{title}</strong>{description && <small>{description}</small>}</span></div><button type="button" onClick={onCancel} aria-label={t("Dialog schließen")}><X size={17} /></button></header>
        <label><span>{label}</span><input autoFocus type={secret ? "password" : "text"} autoComplete={secret ? "off" : undefined} aria-label={label} value={value} onChange={(event) => setValue(event.target.value)} placeholder={placeholder} spellCheck={false} /></label>
        {error && value.length > 0 && <div className="dialog-error">{error}</div>}
        {variant === "quick" ? (
          <footer className="quick-input-footer"><span>Enter {confirmLabel.toLocaleLowerCase()} · Esc schließen</span></footer>
        ) : (
          <footer className="modal-footer"><span /><button type="button" className="secondary-button" onClick={onCancel}>{t("Abbrechen")}</button><button className="primary-button" disabled={Boolean(error) || busy}>{confirmLabel}</button></footer>
        )}
      </form>
    </div>
  );
}

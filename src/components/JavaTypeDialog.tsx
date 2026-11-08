import { Braces, Check, ChevronDown, ChevronRight, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { JavaSourceKind, JavaTypeOptions } from "../types";
import { t } from "../i18n";

const typeChoices: Array<{ kind: JavaSourceKind; label: string; glyph: string }> = [
  { kind: "class", label: "Klasse", glyph: "C" },
  { kind: "interface", label: "Interface", glyph: "I" },
  { kind: "record", label: "Record", glyph: "R" },
  { kind: "enum", label: "Enum", glyph: "E" },
  { kind: "annotation", label: "Annotation", glyph: "@" },
  { kind: "exception", label: "Exception", glyph: "⚡" },
  { kind: "junit", label: "JUnit-Test", glyph: "T" },
];

interface JavaTypeDialogProps {
  open: boolean;
  initialKind: JavaSourceKind;
  packageName: string;
  onCancel: () => void;
  onCreate: (spec: { kind: JavaSourceKind; name: string; options: JavaTypeOptions }) => void | Promise<void>;
}

export function JavaTypeDialog({
  open,
  initialKind,
  packageName,
  onCancel,
  onCreate,
}: JavaTypeDialogProps) {
  const [kind, setKind] = useState<JavaSourceKind>(initialKind);
  // Empty rather than prefilled: a suggested name has to be deleted before the
  // real one can be typed, and it is the same three keystrokes every time.
  const [name, setName] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [modifier, setModifier] = useState<JavaTypeOptions["modifier"]>("");
  const [isPublic, setIsPublic] = useState(true);
  const [extendsType, setExtendsType] = useState("");
  const [interfaces, setInterfaces] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKind(initialKind);
    setName("");
    setAdvanced(false);
    setModifier("");
    setIsPublic(initialKind !== "junit");
    setExtendsType("");
    setInterfaces("");
  }, [initialKind, open]);

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

  const error = useMemo(() => {
    if (!/^[A-Za-z_$][\w$]*$/.test(name.trim())) return "Bitte einen gültigen Java-Typnamen eingeben.";
    const typePattern = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:<[^;\n{}]+>)?$/;
    if (extendsType.trim() && !typePattern.test(extendsType.trim())) return "Die Basisklasse ist ungültig.";
    const entries = interfaces.split(",").map((value) => value.trim()).filter(Boolean);
    if (entries.some((value) => !typePattern.test(value))) return "Mindestens ein Interface-Name ist ungültig.";
    return null;
  }, [extendsType, interfaces, name]);

  if (!open) return null;

  const submit = async () => {
    if (error || busy) return;
    setBusy(true);
    try {
      await onCreate({
        kind,
        name: name.trim(),
        options: {
          isPublic: kind === "junit" ? false : isPublic,
          modifier: kind === "class" ? modifier : "",
          extendsType: kind === "class" ? extendsType.trim() : "",
          interfaces: ["class", "interface", "enum", "record"].includes(kind)
            ? interfaces.split(",").map((value) => value.trim()).filter(Boolean)
            : [],
        },
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="quick-popup-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <form
        className="modal java-type-dialog quick-create-popover"
        role="dialog"
        aria-modal="true"
        aria-labelledby="java-type-dialog-title"
        onSubmit={(event) => { event.preventDefault(); void submit(); }}
      >
        <header className="java-quick-header">
          <span id="java-type-dialog-title">{t("Neue Java-Klasse")}</span>
          <button type="button" onClick={onCancel} aria-label={t("Dialog schließen")}><X size={15} /></button>
        </header>

        <label className="java-quick-name">
          <Braces size={15} />
          <input
            autoFocus
            aria-label={t("Name")}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("Name")}
            spellCheck={false}
          />
        </label>

        <div className="java-quick-kinds" role="listbox" aria-label={t("Java-Typ")}>
          {typeChoices.map((choice) => (
            <button
              type="button"
              role="option"
              aria-selected={kind === choice.kind}
              className={kind === choice.kind ? "active" : ""}
              key={choice.kind}
              onClick={() => setKind(choice.kind)}
            >
              <span className={`context-java-kind ${choice.kind}-kind`}>{choice.glyph}</span>
              <span>{choice.label}</span>
              {kind === choice.kind && <Check size={13} />}
            </button>
          ))}
        </div>

        <button className="java-advanced-toggle" type="button" onClick={() => setAdvanced((value) => !value)}>
          {advanced ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          Weitere Optionen
          <small>{packageName || "Default Package"}</small>
        </button>

        {advanced && (
          <div className="java-quick-options">
            {kind !== "junit" && (
              <label className="java-type-check">
                <input type="checkbox" checked={isPublic} onChange={(event) => setIsPublic(event.target.checked)} />
                <span>{t("Als")} <code>{t("public")}</code> {t("erstellen")}</span>
              </label>
            )}
            {kind === "class" && (
              <>
                <label><span>{t("Modifier")}</span><select value={modifier} onChange={(event) => setModifier(event.target.value as JavaTypeOptions["modifier"])}>
                  <option value="">{t("Keine")}</option>
                  <option value="abstract">{t("abstract")}</option>
                  <option value="final">{t("final")}</option>
                </select></label>
                <label><span>{t("Basisklasse")}</span><input value={extendsType} onChange={(event) => setExtendsType(event.target.value)} placeholder={t("BaseService")} /></label>
              </>
            )}
            {["class", "interface", "enum", "record"].includes(kind) && (
              <label className="java-type-wide"><span>{kind === "interface" ? "Erweiterte Interfaces" : "Interfaces"}</span>
                <input value={interfaces} onChange={(event) => setInterfaces(event.target.value)} placeholder={t("Runnable, Serializable")} />
              </label>
            )}
          </div>
        )}

        {error && name.length > 0 && <div className="dialog-error">{error}</div>}
        <footer className="java-quick-footer">
          <span>{t("Enter erstellen · Esc schließen")}</span>
          <button className="primary-button" disabled={Boolean(error) || busy}>{busy ? "Erstelle …" : "Erstellen"}</button>
        </footer>
      </form>
    </div>
  );
}

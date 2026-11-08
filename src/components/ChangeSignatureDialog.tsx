import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { JavaMethodSignature, JavaSignatureParameter } from "../language/java-refactor";
import { t } from "../i18n";

export function ChangeSignatureDialog({
  signature,
  onCancel,
  onPreview,
}: {
  signature: JavaMethodSignature;
  onCancel: () => void;
  onPreview: (value: { name: string; returnType: string; parameters: JavaSignatureParameter[] }) => void | Promise<void>;
}) {
  const [name, setName] = useState(signature.name);
  const [returnType, setReturnType] = useState(signature.returnType);
  const [parameters, setParameters] = useState<JavaSignatureParameter[]>(signature.parameters.map((item, index) => ({
    ...item,
    sourceIndex: item.sourceIndex ?? index,
  })));
  const [busy, setBusy] = useState(false);
  const error = useMemo(() => {
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) return "Der Methodenname ist ungültig.";
    if (!returnType.trim()) return "Der Rückgabetyp darf nicht leer sein.";
    const names = new Set<string>();
    for (const parameter of parameters) {
      if (!parameter.type.trim()) return "Jeder Parameter benötigt einen Typ.";
      if (!/^[A-Za-z_$][\w$]*$/.test(parameter.name)) return `Ungültiger Parametername: ${parameter.name || "(leer)"}`;
      if (names.has(parameter.name)) return `Der Parameter ${parameter.name} ist doppelt vorhanden.`;
      names.add(parameter.name);
      if (parameter.sourceIndex === null && !String(parameter.defaultValue || "").trim()) {
        return `Für den neuen Parameter ${parameter.name} wird ein Wert für bestehende Aufrufstellen benötigt.`;
      }
    }
    return "";
  }, [name, parameters, returnType]);

  const update = (index: number, patch: Partial<JavaSignatureParameter>) => {
    setParameters((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  };
  const move = (index: number, direction: -1 | 1) => {
    setParameters((items) => {
      const target = index + direction;
      if (target < 0 || target >= items.length) return items;
      const next = [...items];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  return (
    <div className="quick-action-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <form className="change-signature-dialog" onSubmit={async (event) => {
        event.preventDefault();
        if (error || busy) return;
        setBusy(true);
        try {
          await onPreview({ name, returnType, parameters });
        } finally {
          setBusy(false);
        }
      }}>
        <header>
          <div><strong>{t("Methodensignatur ändern")}</strong><small>{t("Alle Deklarationen und Aufrufstellen werden vorab angezeigt.")}</small></div>
          <button className="icon-button" type="button" onClick={onCancel} aria-label={t("Schließen")}><X size={16} /></button>
        </header>
        <div className="signature-main-fields">
          <label><span>{t("Name")}</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label><span>{t("Rückgabetyp")}</span><input value={returnType} onChange={(event) => setReturnType(event.target.value)} /></label>
        </div>
        <section className="signature-parameters">
          <header><strong>{t("Parameter")}</strong><button type="button" onClick={() => setParameters((items) => [...items, { sourceIndex: null, type: "String", name: `parameter${items.length + 1}`, defaultValue: '""' }])}><Plus size={14} /> {t("Hinzufügen")}</button></header>
          {parameters.length === 0 ? <div className="empty-inline">{t("Keine Parameter")}</div> : parameters.map((parameter, index) => (
            <div className="signature-parameter" key={`${parameter.sourceIndex ?? "new"}-${index}`}>
              <input aria-label={`Typ Parameter ${index + 1}`} value={parameter.type} onChange={(event) => update(index, { type: event.target.value })} placeholder={t("Typ")} />
              <input aria-label={`Name Parameter ${index + 1}`} value={parameter.name} onChange={(event) => update(index, { name: event.target.value })} placeholder={t("Name")} />
              {parameter.sourceIndex === null
                ? <input aria-label={`Standardwert Parameter ${index + 1}`} value={parameter.defaultValue || ""} onChange={(event) => update(index, { defaultValue: event.target.value })} placeholder={t("Wert an Aufrufstellen")} />
                : <span className="signature-existing">{t("vorhanden")}</span>}
              <button className="icon-button" type="button" disabled={index === 0} onClick={() => move(index, -1)} aria-label={t("Nach oben")}><ArrowUp size={14} /></button>
              <button className="icon-button" type="button" disabled={index === parameters.length - 1} onClick={() => move(index, 1)} aria-label={t("Nach unten")}><ArrowDown size={14} /></button>
              <button className="icon-button danger" type="button" onClick={() => setParameters((items) => items.filter((_, itemIndex) => itemIndex !== index))} aria-label={t("Entfernen")}><Trash2 size={14} /></button>
            </div>
          ))}
        </section>
        {error && <div className="inline-field-error">{error}</div>}
        <footer><button type="button" onClick={onCancel}>{t("Abbrechen")}</button><button className="primary-button" type="submit" disabled={Boolean(error) || busy}>{busy ? "Analysiere …" : "Vorschau öffnen"}</button></footer>
      </form>
    </div>
  );
}

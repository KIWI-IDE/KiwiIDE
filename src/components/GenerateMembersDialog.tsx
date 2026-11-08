import { Check, WandSparkles, X } from "lucide-react";
import { useMemo, useState } from "react";
import { t } from "../i18n";
import { parseJavaFields, type JavaGenerationKind } from "../language/java-code-generation";

/**
 * Built per render, not once at module load: `t` reads the active locale at
 * call time, so a module-level constant would freeze the first language.
 */
function buildModes(): Array<{ id: JavaGenerationKind; label: string; hint: string }> {
  return [
    { id: "constructor", label: t("Konstruktor"), hint: t("Parameter und Zuweisungen für die gewählten Felder — ohne Auswahl entsteht ein parameterloser Konstruktor") },
    { id: "getters", label: t("Nur Getter"), hint: t("Lesezugriff, boolean wird zu is…") },
    { id: "setters", label: t("Nur Setter"), hint: t("Schreibzugriff, final-Felder werden übersprungen") },
    { id: "accessors", label: t("Getter und Setter"), hint: t("Beides in einem Durchgang") },
    { id: "equalsHashCode", label: "equals() und hashCode()", hint: t("Vergleich über die gewählten Felder") },
    { id: "toString", label: "toString()", hint: t("Lesbare Darstellung der gewählten Felder") },
  ];
}

/**
 * Field picker in front of the Java member generation.
 *
 * The generator itself accepts a field selection; this only decides what goes
 * into it. `setters` pre-selects assignable fields only, because a final field
 * can never take one.
 */
export function GenerateMembersDialog({
  source,
  initialKind,
  onClose,
  onGenerate,
}: {
  source: string;
  initialKind: JavaGenerationKind;
  onClose: () => void;
  onGenerate: (kind: JavaGenerationKind, fields: string[]) => void;
}) {
  const modes = buildModes();
  const fields = useMemo(() => parseJavaFields(source), [source]);
  const [kind, setKind] = useState<JavaGenerationKind>(initialKind);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(fields.map((field) => field.name)));

  const assignable = (name: string) => !fields.find((field) => field.name === name)?.isFinal;
  const usable = fields.filter((field) => kind !== "setters" || assignable(field.name));
  const chosen = [...selected].filter((name) => usable.some((field) => field.name === name));
  const allChosen = usable.length > 0 && chosen.length === usable.length;

  const toggle = (name: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    return next;
  });

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div
        className="modal generate-members-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="generate-members-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div><WandSparkles size={17} /><strong id="generate-members-title">{t("Member generieren")}</strong></div>
          <button onClick={onClose} aria-label={t("Schließen")}><X size={16} /></button>
        </div>

        <div className="generate-members-modes" role="radiogroup" aria-label={t("Was soll generiert werden")}>
          {modes.map((mode) => (
            <button
              key={mode.id}
              role="radio"
              aria-checked={kind === mode.id}
              className={kind === mode.id ? "active" : ""}
              onClick={() => setKind(mode.id)}
            >
              {mode.label}
            </button>
          ))}
        </div>
        <p className="generate-members-hint">{modes.find((mode) => mode.id === kind)?.hint}</p>

        <div className="generate-members-fieldhead">
          <span>{t("Felder")}</span>
          <button
            onClick={() => setSelected(allChosen ? new Set() : new Set(usable.map((field) => field.name)))}
            disabled={!usable.length}
          >
            {allChosen ? t("Keine") : t("Alle")}
          </button>
        </div>

        <div className="generate-members-fields">
          {fields.length === 0 && <p className="generate-members-empty">{t("Diese Klasse hat keine Instanzfelder.")}</p>}
          {fields.map((field) => {
            const skipped = kind === "setters" && field.isFinal;
            return (
              <label key={field.name} className={skipped ? "skipped" : ""}>
                <input
                  type="checkbox"
                  checked={!skipped && selected.has(field.name)}
                  disabled={skipped}
                  onChange={() => toggle(field.name)}
                />
                <code>{field.type}</code>
                <span>{field.name}</span>
                {field.isFinal && <em title={t("final")}>{t("final")}</em>}
              </label>
            );
          })}
        </div>

        <div className="modal-actions">
          <button onClick={onClose}>{t("Abbrechen")}</button>
          <button
            className="primary-button"
            // A constructor without fields is a deliberate choice, not an empty
            // selection: it produces the parameterless one frameworks require.
            disabled={!chosen.length && kind !== "constructor"}
            onClick={() => onGenerate(kind, chosen)}
          >
            <Check size={14} /> {t("Generieren")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Small parts the workbench draws in several places.
 *
 * A badge saying what is wrong with a file, something to look at while a job
 * runs, the update's progress, a tree of debugger variables or of a build's
 * dependencies, and the icon button they all sit next to. Each takes what it
 * shows as a prop and keeps nothing of its own.
 */
import { Check, ChevronDown, ChevronRight, ListTodo, LoaderCircle, Pencil, TriangleAlert } from "lucide-react";
import { useState } from "react";
import type { DebugVariable, DependencyNode, UpdateRuntimeState } from "../types";
import type { TaskComment } from "../utils";
import { t } from "../i18n";

export const emptyDiagnostics: Array<{ severity?: number; range: { start: { line: number; character: number } }; message: string }> = [];

/**
 * Health summary for the open file, pinned to the top right of the editor.
 * Errors first, then warnings, then open TODO/FIXME markers; a clean file only
 * shows the green check. Every row jumps to its first occurrence.
 */
export function FileHealthBadge({
  diagnostics,
  tasks,
  onJump,
}: {
  diagnostics: Array<{ severity?: number; range: { start: { line: number; character: number } }; message: string }>;
  tasks: TaskComment[];
  onJump: (line: number, column: number) => void;
}) {
  const errors = diagnostics.filter((item) => item.severity === 1);
  const warnings = diagnostics.filter((item) => item.severity === 2);
  const clean = !errors.length && !warnings.length && !tasks.length;
  const jumpToDiagnostic = (list: typeof diagnostics) => {
    const first = [...list].sort((left, right) => left.range.start.line - right.range.start.line)[0];
    if (first) onJump(first.range.start.line + 1, first.range.start.character + 1);
  };
  return (
    <div className="file-health" role="status" aria-label={t("Status der Datei")}>
      {clean ? (
        <span className="file-health-item ok" title={t("Keine Probleme gefunden")}><Check size={13} /></span>
      ) : (
        <>
          {errors.length > 0 && (
            <button className="file-health-item error" title={`${errors.length} Fehler · zum ersten springen`} onClick={() => jumpToDiagnostic(errors)}>
              <span className="file-health-dot" />{errors.length}
            </button>
          )}
          {warnings.length > 0 && (
            <button className="file-health-item warning" title={`${warnings.length} Warnungen · zur ersten springen`} onClick={() => jumpToDiagnostic(warnings)}>
              <TriangleAlert size={12} />{warnings.length}
            </button>
          )}
          {tasks.length > 0 && (
            <button className="file-health-item task" title={`${tasks.length} TODO/FIXME · zum ersten springen`} onClick={() => onJump(tasks[0].line, tasks[0].column)}>
              <ListTodo size={12} />{tasks.length}
            </button>
          )}
        </>
      )}
    </div>
  );
}

export function BusyIndicator({ label, detail, progress }: {
  label: string;
  detail?: string;
  /** Shown as a bar when the work is countable; a spinner alone says nothing. */
  progress?: { done: number; total: number };
}) {
  return (
    <div className="kiwi-busy" role="status" aria-live="polite">
      <LoaderCircle className="kiwi-spinner" size={20} />
      <span>
        <strong>{label}{progress && <em className="kiwi-busy-count">{progress.done}/{progress.total}</em>}</strong>
        {detail && <small>{detail}</small>}
        {progress && (
          <span
            className="kiwi-busy-progress"
            role="progressbar"
            aria-valuenow={progress.done}
            aria-valuemin={0}
            aria-valuemax={progress.total}
          >
            <span style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
          </span>
        )}
      </span>
    </div>
  );
}

export function UpdateProgress({ state }: { state: UpdateRuntimeState | null }) {
  if (!state || !["checking", "downloading", "preparing", "installing", "restarting"].includes(state.status)) return null;
  const content: Record<string, { label: string; detail: string }> = {
    checking: { label: "Suche nach Updates", detail: "Der sichere HTTPS-Releasekanal wird geprüft …" },
    downloading: { label: `Kiwi ${state.version || ""} wird geladen`, detail: "Download und SHA-256-Prüfung laufen im Hintergrund …" },
    preparing: { label: "Workspace wird gesichert", detail: "Tabs, Entwürfe und Fensterzustand werden verifiziert …" },
    installing: { label: `Kiwi ${state.version || ""} wird eingespielt`, detail: "Das geprüfte Paket wird übernommen …" },
    restarting: { label: "Kiwi öffnet sich gleich wieder", detail: state.reason || "Die aktualisierte Version stellt den Workspace automatisch wieder her." },
  };
  const current = content[state.status];
  return (
    <div className="update-runtime-banner" role="status" aria-live="assertive">
      <LoaderCircle className="kiwi-spinner" size={18} />
      <span><strong>{current.label}</strong><small>{current.detail}</small></span>
    </div>
  );
}

export function DebugVariableTree({
  variables,
  childrenByReference,
  onExpand,
  onWatch,
  onSetValue,
  depth = 0,
}: {
  variables: DebugVariable[];
  childrenByReference: Record<string, DebugVariable[]>;
  onExpand: (referenceId: number) => void;
  onWatch: (name: string) => void;
  onSetValue: (name: string) => void;
  depth?: number;
}) {
  return (
    <>
      {variables.map((variable, index) => {
        const referenceId = variable.referenceId || 0;
        const children = referenceId ? childrenByReference[String(referenceId)] : undefined;
        return (
          <div className="debug-variable-node" key={`${variable.name}:${referenceId}:${index}`}>
            <button
              className="debug-variable-row"
              style={{ paddingLeft: 8 + depth * 14 }}
              onClick={() => {
                if (variable.hasChildren && referenceId) onExpand(referenceId);
                else onWatch(variable.name);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                onWatch(variable.name);
              }}
              title={variable.type || variable.name}
            >
              <span className="debug-variable-chevron">
                {variable.hasChildren ? children ? <ChevronDown size={12} /> : <ChevronRight size={12} /> : null}
              </span>
              <strong>{variable.name}</strong>
              <span>{variable.value}</span>
              {variable.type && <small>{variable.type}</small>}
            </button>
            {/* Editing a value is a deliberate act, so it has its own control
                rather than sharing the click that expands and watches. */}
            <button
              className="debug-variable-set"
              title={t("Wert ändern")}
              onClick={(event) => { event.stopPropagation(); onSetValue(variable.name); }}
            ><Pencil size={11} /></button>
            {children && (
              <DebugVariableTree
                variables={children}
                childrenByReference={childrenByReference}
                onExpand={onExpand}
                onWatch={onWatch}
                onSetValue={onSetValue}
                depth={depth + 1}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

export function DependencyNodeTree({ nodes, depth = 0 }: { nodes: DependencyNode[]; depth?: number }) {
  return (
    <>
      {nodes.map((node) => (
        <div className={`dependency-node ${node.conflict ? "conflict" : ""}`} key={`${node.id}:${depth}`}>
          <details open={depth === 0}>
            <summary style={{ paddingLeft: 8 + depth * 12 }}>
              <ChevronRight size={11} />
              <span><strong>{node.artifact}</strong><small>{node.group}</small></span>
              {node.requestedVersion && <del>{node.requestedVersion}</del>}
              <b>{node.version}</b>
              {node.scope && <em>{node.scope}</em>}
              {node.conflict && <mark>{t("Konflikt")}</mark>}
            </summary>
            <div className="dependency-artifacts">
              {node.sourcePath && <button onClick={() => void window.kiwi?.file.reveal(node.sourcePath!)}>{t("Sources")}</button>}
              {node.javadocPath && <button onClick={() => void window.kiwi?.file.reveal(node.javadocPath!)}>{t("Javadoc")}</button>}
            </div>
            <DependencyNodeTree nodes={node.children} depth={depth + 1} />
          </details>
        </div>
      ))}
    </>
  );
}

export function IconButton({
  label,
  children,
  onClick,
  active = false,
  disabled = false,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      className={`icon-button ${active ? "active" : ""} ${className}`}
      title={t(label)}
      aria-label={t(label)}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

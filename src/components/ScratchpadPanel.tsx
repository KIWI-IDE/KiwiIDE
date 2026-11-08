import React, { useState, useEffect } from "react";
import {
  FileText,
  Plus,
  Trash2,
  Copy,
  Check,
  Eye,
  FileCode,
  Download,
  X,
  FileCheck,
} from "lucide-react";
import { t } from "../i18n";

interface ScratchpadProps {
  workspaceRoot: string;
  onClose?: () => void;
  onSaveAsFile?: (title: string, content: string) => void;
}

interface ScratchNote {
  id: string;
  title: string;
  content: string;
  language: string;
  updatedAt: number;
}

const DEFAULT_NOTES: ScratchNote[] = [
  {
    id: "note-1",
    title: "Projekt-Notizen",
    content: "# Projekt-Notizen\n\n- [ ] Wichtiges Feature testen\n- [ ] API-Endpoints dokumentieren\n- [ ] Deployment prüfen\n\n*Temporäre Gedanken hier festhalten. Bleibt lokal gespeichert und wird nicht im Git committet.*",
    language: "markdown",
    updatedAt: Date.now(),
  },
  {
    id: "note-2",
    title: "Scratch.ts",
    content: "// Schnelle TypeScript-Schnipsel & Entwürfe\ninterface ApiResponse<T> {\n  data: T;\n  status: number;\n}\n\nconsole.log('Testing in scratchpad');",
    language: "typescript",
    updatedAt: Date.now(),
  },
];

export function ScratchpadPanel({ workspaceRoot, onClose, onSaveAsFile }: ScratchpadProps) {
  const storageKey = `kiwi.scratchpad.${workspaceRoot || "global"}`;

  const [notes, setNotes] = useState<ScratchNote[]>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) return JSON.parse(saved);
    } catch {}
    return DEFAULT_NOTES;
  });

  const [activeNoteId, setActiveNoteId] = useState<string>(notes[0]?.id || "note-1");
  const [copied, setCopied] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(notes));
    } catch {}
  }, [notes, storageKey]);

  const activeNote = notes.find((n) => n.id === activeNoteId) || notes[0];

  const handleUpdateContent = (newContent: string) => {
    setNotes((prev) =>
      prev.map((n) => (n.id === activeNote?.id ? { ...n, content: newContent, updatedAt: Date.now() } : n))
    );
  };

  const handleUpdateTitle = (newTitle: string) => {
    setNotes((prev) =>
      prev.map((n) => (n.id === activeNote?.id ? { ...n, title: newTitle, updatedAt: Date.now() } : n))
    );
  };

  const handleUpdateLanguage = (newLang: string) => {
    setNotes((prev) =>
      prev.map((n) => (n.id === activeNote?.id ? { ...n, language: newLang, updatedAt: Date.now() } : n))
    );
  };

  const handleAddNote = () => {
    const newId = `note-${Date.now()}`;
    const newNote: ScratchNote = {
      id: newId,
      title: `Notiz ${notes.length + 1}`,
      content: "",
      language: "markdown",
      updatedAt: Date.now(),
    };
    setNotes([...notes, newNote]);
    setActiveNoteId(newId);
  };

  const handleDeleteNote = (id: string) => {
    if (notes.length <= 1) return;
    const remaining = notes.filter((n) => n.id !== id);
    setNotes(remaining);
    if (activeNoteId === id) {
      setActiveNoteId(remaining[0].id);
    }
  };

  const handleCopy = async () => {
    if (!activeNote) return;
    try {
      await navigator.clipboard.writeText(activeNote.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const handleSaveFile = () => {
    if (!activeNote) return;
    if (onSaveAsFile) {
      onSaveAsFile(activeNote.title, activeNote.content);
    } else {
      const blob = new Blob([activeNote.content], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = activeNote.title.includes(".") ? activeNote.title : `${activeNote.title}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        background: "var(--bg-editor, #1e1e1e)",
        color: "var(--text-main, #cccccc)",
      }}
    >
      {/* Top Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "8px 16px",
          background: "var(--bg-secondary, #252526)",
          borderBottom: "1px solid var(--border-color, #333)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <FileText size={16} color="var(--accent-color, #98c379)" />
          <strong style={{ fontSize: "13px" }}>Scratchpad & Projekt-Notizen</strong>
          <span style={{ fontSize: "11px", opacity: 0.6 }}>(Lokaler Speicher)</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            type="button"
            onClick={handleAddNote}
            title="Neue Notiz hinzufügen"
            style={{
              background: "var(--accent-color, #0e639c)",
              border: "none",
              color: "#fff",
              borderRadius: "3px",
              padding: "3px 8px",
              fontSize: "11px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <Plus size={12} />
            <span>Neu</span>
          </button>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              title={t("Schließen")}
              style={{
                background: "transparent",
                border: "none",
                color: "inherit",
                cursor: "pointer",
                padding: "4px",
              }}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Tabs / Notes Strip */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "2px",
          padding: "4px 12px 0",
          background: "var(--bg-secondary, #252526)",
          borderBottom: "1px solid var(--border-color, #333)",
          overflowX: "auto",
        }}
      >
        {notes.map((n) => {
          const isActive = n.id === activeNote?.id;
          return (
            <div
              key={n.id}
              onClick={() => setActiveNoteId(n.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                background: isActive ? "var(--bg-editor, #1e1e1e)" : "transparent",
                color: isActive ? "#fff" : "var(--text-muted, #888)",
                borderBottom: isActive ? "2px solid #98c379" : "none",
                padding: "5px 10px",
                fontSize: "12px",
                cursor: "pointer",
                borderRadius: "3px 3px 0 0",
              }}
            >
              <span>{n.title}</span>
              {notes.length > 1 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteNote(n.id);
                  }}
                  title="Notiz löschen"
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "inherit",
                    opacity: 0.5,
                    cursor: "pointer",
                    padding: "0 2px",
                  }}
                >
                  <X size={10} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Note Action Toolbar */}
      {activeNote && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "6px 14px",
            background: "var(--bg-editor, #1e1e1e)",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <input
              type="text"
              value={activeNote.title}
              onChange={(e) => handleUpdateTitle(e.target.value)}
              style={{
                background: "transparent",
                border: "none",
                color: "#fff",
                fontWeight: 600,
                fontSize: "12px",
                outline: "none",
              }}
            />
            <select
              value={activeNote.language}
              onChange={(e) => handleUpdateLanguage(e.target.value)}
              style={{
                background: "var(--bg-input, #333)",
                border: "1px solid var(--border-input, #444)",
                color: "inherit",
                fontSize: "11px",
                borderRadius: "3px",
                padding: "2px 6px",
              }}
            >
              <option value="markdown">Markdown</option>
              <option value="plaintext">Plain Text</option>
              <option value="typescript">TypeScript</option>
              <option value="javascript">JavaScript</option>
              <option value="json">JSON</option>
              <option value="sql">SQL</option>
            </select>
          </div>

          <div style={{ display: "flex", gap: "6px" }}>
            {activeNote.language === "markdown" && (
              <button
                type="button"
                onClick={() => setShowPreview(!showPreview)}
                style={{
                  background: showPreview ? "var(--accent-color, #0e639c)" : "transparent",
                  border: "1px solid var(--border-input, #555)",
                  color: "#fff",
                  borderRadius: "3px",
                  padding: "2px 8px",
                  fontSize: "11px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <Eye size={11} />
                <span>Vorschau</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleCopy}
              title="In Zwischenablage kopieren"
              style={{
                background: "transparent",
                border: "1px solid var(--border-input, #555)",
                color: "inherit",
                borderRadius: "3px",
                padding: "2px 8px",
                fontSize: "11px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              {copied ? <Check size={11} color="#4ec9b0" /> : <Copy size={11} />}
              <span>{copied ? "Kopiert" : "Kopieren"}</span>
            </button>
            <button
              type="button"
              onClick={handleSaveFile}
              title="Als Datei exportieren"
              style={{
                background: "transparent",
                border: "1px solid var(--border-input, #555)",
                color: "inherit",
                borderRadius: "3px",
                padding: "2px 8px",
                fontSize: "11px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              <Download size={11} />
              <span>Export</span>
            </button>
          </div>
        </div>
      )}

      {/* Editor / Preview Area */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {activeNote && (
          <div style={{ flex: 1, display: "flex", height: "100%" }}>
            <textarea
              value={activeNote.content}
              onChange={(e) => handleUpdateContent(e.target.value)}
              placeholder="Gedanken, Code-Schnipsel oder Notizen hier einfügen…"
              style={{
                flex: showPreview ? 1 : 1,
                height: "100%",
                background: "transparent",
                border: "none",
                outline: "none",
                color: "#d4d4d4",
                fontFamily: "var(--editor-font, monospace)",
                fontSize: "13px",
                padding: "16px",
                resize: "none",
                lineHeight: "1.5",
              }}
            />

            {showPreview && (
              <div
                style={{
                  flex: 1,
                  height: "100%",
                  borderLeft: "1px solid var(--border-color, #333)",
                  background: "var(--bg-secondary, #252526)",
                  padding: "16px",
                  overflowY: "auto",
                  fontSize: "13px",
                  lineHeight: "1.6",
                }}
              >
                <div style={{ whiteSpace: "pre-wrap" }}>{activeNote.content}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

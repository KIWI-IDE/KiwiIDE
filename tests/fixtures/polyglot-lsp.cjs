/** A real stdio LSP peer used to verify the client's wire protocol. */
const { createMessageConnection, StreamMessageReader, StreamMessageWriter } = require("vscode-jsonrpc/node");
const connection = createMessageConnection(new StreamMessageReader(process.stdin), new StreamMessageWriter(process.stdout));
const documents = new Map();
const notifications = [];
let initialization;
const offsetAt = (text, position) => text.split("\n").slice(0, position.line).reduce((length, line) => length + line.length + 1, 0) + position.character;
connection.onRequest("initialize", async (params) => {
  initialization = params;
  if (process.argv.includes("--delayed")) await new Promise((resolve) => setTimeout(resolve, 120));
  if (process.argv.includes("--hang")) return new Promise(() => undefined);
  return { capabilities: { positionEncoding: "utf-16", completionProvider: { resolveProvider: true }, textDocumentSync: { openClose: true, change: 2, save: { includeText: true } } } };
});
connection.onNotification("initialized", () => notifications.push({ method: "initialized" }));
connection.onNotification("textDocument/didOpen", ({ textDocument }) => {
  documents.set(textDocument.uri, { ...textDocument });
  notifications.push({ method: "open", ...textDocument });
  connection.sendNotification("textDocument/publishDiagnostics", {
    uri: process.argv.includes("--normalized-uri")
      ? textDocument.uri.replace(/^file:\/\/\/([a-z]):/i, (_all, drive) => `file:///${drive.toLowerCase()}%3A`)
      : textDocument.uri,
    version: textDocument.version,
    diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, severity: 2, message: "fixture diagnostic" }],
  });
});
connection.onNotification("textDocument/didChange", ({ textDocument, contentChanges }) => {
  const current = documents.get(textDocument.uri);
  if (!current) throw new Error("change before open");
  for (const change of contentChanges) {
    current.text = change.range
      ? current.text.slice(0, offsetAt(current.text, change.range.start)) + change.text + current.text.slice(offsetAt(current.text, change.range.end))
      : change.text;
  }
  current.version = textDocument.version;
  notifications.push({ method: "change", ...textDocument, contentChanges });
});
connection.onNotification("textDocument/didSave", (params) => notifications.push({ method: "save", ...params }));
connection.onNotification("textDocument/didClose", ({ textDocument }) => {
  documents.delete(textDocument.uri);
  notifications.push({ method: "close", ...textDocument });
});
connection.onRequest("textDocument/completion", (params, token) => {
  const document = documents.get(params.textDocument.uri);
  if (document?.text === "__CRASH__") process.exit(7);
  if (document?.text === "__CANCEL__") return new Promise((resolve) => token.onCancellationRequested(() => resolve({ items: [{ label: "cancelled" }] })));
  return { isIncomplete: false, items: [{ label: "fixtureCompletion", kind: 3, detail: document?.text || "missing" }] };
});
connection.onRequest("completionItem/resolve", (item) => ({ ...item, detail: JSON.stringify({ documents: Object.fromEntries(documents), notifications, initialization, pid: process.pid }) }));
connection.onRequest("shutdown", () => null);
connection.onNotification("exit", () => process.exit(0));
connection.listen();

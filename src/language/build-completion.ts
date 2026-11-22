/**
 * Wires the build-file completion into Monaco.
 *
 * The rules live in {@link ./build-files}; this only turns them into Monaco
 * items and asks the package sources when a coordinate is being typed. Registered for
 * the languages a build file resolves to, and filtered by file name so an
 * ordinary XML or Groovy file is left alone.
 *
 * The search combines public Maven repositories. mvnrepository.com — the site
 * people mean when they say "look it up" — answers a program with a Cloudflare
 * challenge and cannot be queried at all, so every proposal carries a link to
 * its page there instead, which is the half of that site a machine can honour.
 */

import type * as MonacoEditor from "monaco-editor";
import type { DependencyCandidate, KiwiApi, VersionCatalogInfo, GradleEditorState } from "../types";
import { gradleModelSuggestions, gradleProjectForFile, gradleTaskSuggestions } from "./gradle-model-completion";
import { reportCompletionStatus } from "./completion-status";
import {
  buildFileKind,
  coordinateQueryAt,
  coordinateSpanAt,
  gradleCompletions,
  gradleCoordinateText,
  gradleCatalogQueryAt,
  mavenCompletions,
  mavenDependencyEdits,
  mvnRepositoryUrl,
  type ArtifactCoordinate,
  type BuildSuggestion,
} from "./build-files";

/** Languages a build file can be opened as. */
const BUILD_LANGUAGES = ["xml", "groovy", "kotlin"];

/** Maven Central over a cold connection can take seconds; a widget cannot wait. */
const SEARCH_TIMEOUT_MS = 6_000;

let installed: MonacoEditor.IDisposable[] = [];

/**
 * Answers already given, so retyping one character does not ask again.
 *
 * Completion fires on every keystroke, and the same prefix is typed over and
 * over while a name is being narrowed down. Small on purpose: this is a
 * convenience, not an offline index.
 */
const searchCache = new Map<string, DependencyCandidate[]>();

async function withTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("KIWI_COMPLETION_TIMEOUT")), SEARCH_TIMEOUT_MS);
  });
  try {
    return await Promise.race([work, guard]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function searchDependencies(api: KiwiApi, query: string): Promise<DependencyCandidate[]> {
  const key = query.toLowerCase();
  const cached = searchCache.get(key);
  if (cached) return cached;
  const found = await withTimeout(
    api.project.searchDependencies(query, 40),
  );
  if (found.length) {
    if (searchCache.size > 60) searchCache.clear();
    searchCache.set(key, found);
  }
  return found;
}

function toMonacoItems(
  monaco: typeof MonacoEditor,
  suggestions: BuildSuggestion[],
  range: MonacoEditor.IRange,
): MonacoEditor.languages.CompletionItem[] {
  return suggestions.map((suggestion, index) => ({
    label: suggestion.label,
    kind: monaco.languages.CompletionItemKind.Property,
    detail: suggestion.detail,
    insertText: suggestion.insertText ?? suggestion.label,
    insertTextRules: suggestion.snippet
      ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
      : undefined,
    // Keeps the order this module chose instead of Monaco's alphabetical one:
    // the common entries are listed first on purpose.
    sortText: String(index).padStart(3, "0"),
    range,
  }));
}

/** The command the documentation link runs, since a plain link is denied. */
export const OPEN_ARTIFACT_PAGE_COMMAND = "kiwi.openArtifactPage";

/**
 * The link every coordinate proposal carries, as Monaco markdown.
 *
 * Written as a command rather than an https link because the workbench refuses
 * every window-open on purpose; the command hands the address to the main
 * process, which only ever opens this one host.
 */
function artifactDocumentation(candidate: ArtifactCoordinate) {
  const url = mvnRepositoryUrl(candidate.groupId, candidate.artifactId, candidate.version);
  const argument = encodeURIComponent(JSON.stringify([url]));
  return {
    value: [
      `**${candidate.groupId}:${candidate.artifactId}**`,
      "",
      `Neueste Version: \`${candidate.version}\``,
      "",
      `[Auf mvnrepository.com ansehen](command:${OPEN_ARTIFACT_PAGE_COMMAND}?${argument})`,
    ].join("\n"),
    isTrusted: true,
  };
}

/**
 * Registers completion for `pom.xml` and Gradle scripts.
 *
 * Safe to call again — a second call replaces the previous registration rather
 * than adding a second provider that would double every suggestion.
 */
export function installBuildFileCompletion(monaco: typeof MonacoEditor, api: KiwiApi, workspaceRoot: () => string = () => ""): void {
  for (const disposable of installed) disposable.dispose();
  installed = [];
  const catalogs = new Map<string, { expires: number; value: Promise<VersionCatalogInfo[]> }>();
  const gradleModels = new Map<string, { expires: number; value: Promise<GradleEditorState> }>();
  const loadCatalogs = (root: string) => {
    const cached = catalogs.get(root);
    if (cached && cached.expires > Date.now()) return cached.value;
    const value = api.project.listDependencies(root).then(model => model.catalogs).catch(error => { catalogs.delete(root); throw error; });
    catalogs.set(root, { expires: Date.now() + 1500, value });
    return value;
  };
  if (api.project.onGradleEditorModel) {
    const remove = api.project.onGradleEditorModel(event => {
      gradleModels.delete(event.root);
      for (const model of monaco.editor.getModels()) {
        if (buildFileKind(model.uri.fsPath) === "gradle" && workspaceRoot() === event.root) {
          reportCompletionStatus(model.uri.fsPath, event.state === "ready" ? "ready" : event.state === "error" ? "sync-error" : "syncing", event.reason, "gradle");
        }
      }
    });
    installed.push({ dispose: remove });
  }

  installed.push(monaco.editor.registerCommand(OPEN_ARTIFACT_PAGE_COMMAND, (_accessor, url: string) => {
    void api.app.openArtifactPage(String(url || "")).catch(() => undefined);
  }));

  for (const language of BUILD_LANGUAGES) {
    installed.push(monaco.languages.registerCompletionItemProvider(language, {
      // A coordinate is typed inside a string or an element, where Monaco would
      // not ask on its own.
      triggerCharacters: ["<", ".", ":", "\"", "'", " "],
      provideCompletionItems: async (model, position, _context, cancellation) => {
        const kind = buildFileKind(model.uri.fsPath);
        if (!kind) return { suggestions: [] };

        const text = model.getValue();
        const offset = model.getOffsetAt(position);
        const word = model.getWordUntilPosition(position);
        const range: MonacoEditor.IRange = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: position.column,
        };
        /** Offsets from the pure rules, as the range Monaco needs. */
        const spanToRange = (span: { start: number; end: number }): MonacoEditor.IRange => {
          const from = model.getPositionAt(span.start);
          const to = model.getPositionAt(span.end);
          return {
            startLineNumber: from.lineNumber,
            startColumn: from.column,
            endLineNumber: to.lineNumber,
            endColumn: to.column,
          };
        };

        let gradleState: GradleEditorState | null = null;
        const activeRoot = workspaceRoot();
        if (kind === "gradle" && activeRoot && api.project.gradleEditorModel) {
          try {
            let cached = gradleModels.get(activeRoot);
            if (!cached || cached.expires < Date.now()) {
              cached = { expires: Date.now() + 1500, value: api.project.gradleEditorModel(activeRoot) };
              gradleModels.set(activeRoot, cached);
            }
            gradleState = await cached.value;
            if (cancellation?.isCancellationRequested || model.isDisposed?.() || workspaceRoot() !== activeRoot || model.getValue() !== text) return { suggestions: [] };
            reportCompletionStatus(model.uri.fsPath, gradleState.state === "ready" ? "ready" : gradleState.state === "error" ? "sync-error" : "syncing", gradleState.reason, "gradle");
          } catch (error) {
            reportCompletionStatus(model.uri.fsPath, "sync-error", error instanceof Error ? error.message : "", "gradle");
          }
        }

        const configurations = gradleState?.model ? gradleProjectForFile(gradleState.model, model.uri.fsPath)?.configurations || [] : [];
        if (kind === "gradle") {
          const task = gradleState?.model && gradleTaskSuggestions(gradleState.model, model.uri.fsPath, text, offset);
          if (task) return { suggestions: toMonacoItems(monaco, task.suggestions, spanToRange(task)) };
          const accessor = gradleCatalogQueryAt(text, offset, configurations);
          const root = workspaceRoot();
          if (accessor && root) {
            let allCatalogs: VersionCatalogInfo[];
            try { allCatalogs = await loadCatalogs(root); }
            catch (error) {
              reportCompletionStatus(model.uri.fsPath, "catalog-missing", error instanceof Error ? error.message : "", "catalog");
              return { suggestions: [] };
            }
            // Do not publish an answer into a different project or draft.
            if (cancellation?.isCancellationRequested || model.isDisposed?.() || workspaceRoot() !== root || model.getValue() !== text) return { suggestions: [] };
            const matchingCatalogs = allCatalogs.filter(entry => !accessor.catalog || entry.name === accessor.catalog);
            if (matchingCatalogs.length) {
              const members = matchingCatalogs.flatMap(catalog => [
                ...catalog.libraries.map(library => ({
                  accessor: `${catalog.name}.${library.alias.replace(/[-_]+/g, ".")}`,
                  detail: `${library.groupId}:${library.artifactId}${library.version ? `:${library.version}` : ""}`,
                })),
                ...catalog.versions.map(version => ({
                  accessor: `${catalog.name}.versions.${version.key.replace(/[-_]+/g, ".")}`,
                  detail: version.version,
                })),
              ]);
              const matchingMembers = members.filter(member => member.accessor.toLowerCase().startsWith(accessor.accessor.toLowerCase()));
              reportCompletionStatus(model.uri.fsPath, matchingMembers.length ? "ready" : "no-matches", "", "catalog");
              return { suggestions: matchingMembers.map(member => ({
                label: member.accessor,
                kind: monaco.languages.CompletionItemKind.Module,
                detail: member.detail,
                insertText: member.accessor,
                range: spanToRange(accessor),
                filterText: member.accessor,
                sortText: `0-${member.accessor}`,
              })) };
            }
            if (!accessor.catalog || accessor.catalog === "libs") reportCompletionStatus(model.uri.fsPath, "catalog-missing", "", "catalog");
          }
        }

        const coordinate = coordinateQueryAt(text, offset, kind, configurations);
        if (coordinate) {
          try {
            if (coordinate.field === "version") {
              const versions = await withTimeout(
                api.project.dependencyVersions(coordinate.groupId, coordinate.artifactId),
              );
              reportCompletionStatus(model.uri.fsPath, versions.length ? "ready" : "no-matches", "", "sources");
              return {
                suggestions: versions.slice(0, 40).map((version, index) => ({
                  label: version,
                  kind: monaco.languages.CompletionItemKind.Value,
                  detail: `${coordinate.groupId}:${coordinate.artifactId}`,
                  documentation: artifactDocumentation({
                    groupId: coordinate.groupId,
                    artifactId: coordinate.artifactId,
                    version,
                  }),
                  insertText: version,
                  // Newest first is how the service returns them; keep that.
                  sortText: String(index).padStart(3, "0"),
                  range,
                })),
              };
            }
            // Two characters is where a search stops returning the whole index.
            if (coordinate.term.length < 2) return { suggestions: [] };
            const candidates = await searchDependencies(
              api,
              coordinate.field === "artifactId" && coordinate.groupId
                ? `${coordinate.groupId} ${coordinate.term}`
                : coordinate.term,
            );
            reportCompletionStatus(model.uri.fsPath, candidates.length ? "ready" : "no-matches", "", "sources");
            const span = coordinateSpanAt(text, offset, kind, configurations);
            const coordinateRange = span ? spanToRange(span) : range;
            return {
              suggestions: candidates.map((candidate, index) => {
                // The whole coordinate, not the segment under the caret:
                // completing "gson" to a group left the artifact and the
                // version to be typed, which is most of the work.
                const label = `${candidate.groupId}:${candidate.artifactId}`;
                const documentation = artifactDocumentation(candidate);
                if (kind === "gradle") {
                  return {
                    label,
                    kind: monaco.languages.CompletionItemKind.Module,
                    detail: `${candidate.version}${candidate.sourceLabel ? ` · ${candidate.sourceLabel}` : ""}`,
                    documentation,
                    insertText: gradleCoordinateText(candidate),
                    filterText: `${candidate.artifactId} ${label}`,
                    sortText: String(index).padStart(3, "0"),
                    range: coordinateRange,
                  };
                }
                const [primary, ...rest] = mavenDependencyEdits(text, offset, candidate);
                return {
                  label,
                  kind: monaco.languages.CompletionItemKind.Module,
                  detail: candidate.version,
                  documentation,
                  insertText: primary?.newText ?? candidate.artifactId,
                  filterText: `${candidate.artifactId} ${label}`,
                  sortText: String(index).padStart(3, "0"),
                  range: primary ? spanToRange(primary) : coordinateRange,
                  // The other two elements of the block, filled in the same
                  // edit so the dependency is complete when it is accepted.
                  additionalTextEdits: rest.map((edit) => ({
                    range: spanToRange(edit),
                    text: edit.newText,
                  })),
                };
              }),
            };
          } catch (error) {
            // Maven Central is reached over the network; an offline editor must
            // still complete elements and blocks rather than report a failure.
            reportCompletionStatus(model.uri.fsPath, error instanceof Error && error.message === "KIWI_COMPLETION_TIMEOUT" ? "timeout" : "source-unreachable", "", "sources");
            return { suggestions: [] };
          }
        }

        reportCompletionStatus(model.uri.fsPath, "ready", "", "sources");
        const suggestions = kind === "maven"
          ? mavenCompletions(text, offset)
          : gradleCompletions(text, offset);
        const dynamic = kind === "gradle" && gradleState?.model ? gradleModelSuggestions(gradleState.model, model.uri.fsPath, text, offset) : [];
        const merged = [...dynamic, ...suggestions].filter((entry, index, rows) => rows.findIndex(other => other.label === entry.label) === index);
        return { suggestions: toMonacoItems(monaco, merged, range), incomplete: gradleState?.state === "loading" };
      },
    }));
  }
}

# Editor macros, structural search and GitHub Actions

## Editor macros

Open an editable file with one cursor. Choose **Start macro recording** in the
editor's **…** menu, use the command palette, or press **Ctrl+Alt+Shift+R**.
The status bar shows a red recording indicator and the number of recorded steps.
Use the same shortcut or click **Stop** to finish and name the macro.

The macro manager lets you save, rename or delete macros, assign an unused
shortcut and choose 1–100 repetitions. **Ctrl+Alt+Shift+M** opens the manager;
**Ctrl+Alt+Shift+P** plays the last used or last saved macro. These IDE shortcuts
can also be changed in the keybinding settings.

Macros record edits and cursor/selection movements in the active editor. They
do not execute terminal commands, builds, Git operations or clipboard reads.
Saved macros live in the local Kiwi profile and are available across projects.
Recordings stop when switching files, when undo/redo runs or multiple cursors are
used. A recording can contain up to 500 steps and 500 KB of data.

Replay is calculated completely in memory before changing the document. If the
steps cannot be applied at the current cursor, the buffer stays unchanged.
Successful replay is one editor undo operation and does not save the file.
Line-end navigation adapts to different line lengths; other movements are
relative to the cursor and may require a similar code layout.

## Structural search and replace

Choose **Structural search** in the editor's **…** menu or command palette,
or press **Ctrl+Alt+Shift+F**. Select a source language and enter a search pattern
and replacement. For example:

```java
// Find
System.out.println($value$)

// Replace with
logger.info($value$)
```

`$value$` captures a balanced expression. `$$args$$` captures a comma-separated
argument list, including an empty list. Repeated placeholder names must capture
the same token sequence. For example, `equals($x$, $x$)` matches `equals(a, a)`
but not `equals(a, b)`. Captured source is inserted verbatim in the replacement.

Matching uses code tokens and balanced delimiters, ignoring whitespace and
comments. It is not semantic type analysis: it does not resolve method overloads
or determine whether two receiver variables have the same type. Quoted strings,
text blocks, JavaScript regex literals and template literals are treated as
opaque tokens; calls inside template interpolations are not searched.

Java, JavaScript/TypeScript, Kotlin/Gradle Kotlin, Python and the supported C-style
source extensions can be searched. Dependency/build directories and generated
output are excluded. Files with unsaved editor changes are skipped and listed;
save them and search again to include them.

**Find & preview** only reads files. Review the before/after text and select the
individual matches to apply. An empty replacement deletes the matching code.
Kiwi refuses a stale preview if any selected file changed on disk or became
unsaved in the editor. Changes are saved to disk with a project undo checkpoint.
Searches are bounded to 500 matches, 100 matching files and 3,000 scanned files;
large files and complex patterns are limited to keep the IDE responsive. A
limited search is explicitly marked. Preview plans expire after 15 minutes.

## GitHub Actions

Open **GitHub Actions** from the Git menu or command palette. The project's
`origin` remote identifies the GitHub repository. Public runs can be read
without signing in; private repositories require the GitHub account configured
in Kiwi. Fine-grained tokens need **Actions: read** for runs and logs, and
**Actions: write** to re-run failed jobs.

Filter runs by branch, workflow or status and browse pages of 30 runs. Select a
run to inspect its jobs and steps; **View log** loads a job's text output. Visible
views refresh every 15 seconds. Up to 100 jobs and the first 2 MB of a job log are
shown, with a link to the full run on GitHub.

For a completed failed run, **Re-run failed jobs** opens a confirmation showing
the run, branch and commit. Only confirming starts work on GitHub. It can consume
Actions minutes. No workflow is started automatically when opening the view.
GitHub credentials stay in the main process and are not forwarded to signed log
storage URLs. Permission errors and unavailable logs are displayed in the view.

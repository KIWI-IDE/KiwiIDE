import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
// The checkpoint the run last announced. Declared up here because the steps
// below run at module level, before any declaration further down is reachable.
let lastTrace = "";

/**
 * How much longer than usual every wait may take.
 *
 * One machine's quiet afternoon is another's release build. Rather than tuning
 * two hundred individual budgets for the busiest moment either of them has,
 * the gate raises them all at once.
 */
const patience = Math.max(1, Number(process.env.KIWI_E2E_PATIENCE) || 1);
// Read from package.json so a release bump needs no edit here.
const appVersion = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8")).version;
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "kiwi-electron-e2e-"));
const first = path.join(fixture, "alpha");
const second = path.join(fixture, "beta");
const userData = path.join(fixture, "user-data");
const packaged = process.argv.includes("--packaged");
const portable = process.argv.includes("--portable");
const deployed = packaged || portable;
const wallpaper = path.join(root, "assets", "icons", "kiwi-256.png");
const electron = portable
  ? path.resolve(process.env.KIWI_PORTABLE_EXE || path.join(root, "release", `Kiwi-IDE-${appVersion}-portable.exe`))
  : packaged
    ? path.join(root, "release", "win-unpacked", "Kiwi IDE.exe")
    : path.join(root, "node_modules", "electron", "dist", "electron.exe");
// A fixed DevTools port made concurrent/repeated build verification attach to
// another smoke run. That mixed two temporary workspaces and correctly caused
// PathGuard failures. Reserve an ephemeral loopback port for this process.
const port = Number(process.env.KIWI_E2E_CDP_PORT) || await findAvailablePort();

await Promise.all([
  createProject(first, "Alpha"),
  createProject(second, "Beta"),
  fs.mkdir(userData, { recursive: true }),
]);
await fs.writeFile(path.join(userData, "settings.json"), JSON.stringify({
  schemaVersion: 6,
  backgroundImage: wallpaper,
  backgroundOpacity: 40,
}));
await Promise.all([
  fs.writeFile(path.join(second, "src", "Marker.java"), "public interface Marker {}\n"),
  fs.writeFile(path.join(second, "src", "Worker.java"), "public class Worker {}\n"),
  fs.writeFile(path.join(second, "src", "Mode.java"), "public enum Mode { FAST, SAFE }\n"),
  fs.writeFile(
    path.join(second, "src", "Broken.java"),
    "public class Broken { void use(Marker value) {} void fail() { use(new Worker()); } }\n",
  ),
  // Feeds the TODO tool window. The counterpart for the syntax check is
  // written much later, because it would break the build assertions below.
  fs.writeFile(
    path.join(second, "src", "Chores.java"),
    "public class Chores {\n    // TODO: split this class\n    void run() {}\n}\n",
  ),
]);
const compactPackage = path.join(second, "src", "main", "java", "de", "rauchigesetwas", "player", "spigot");
await fs.mkdir(compactPackage, { recursive: true });
await fs.writeFile(
  path.join(compactPackage, "CoreAPI.java"),
  "package de.rauchigesetwas.player.spigot;\npublic final class CoreAPI {}\n",
);
const dragSourceDirectory = path.join(second, "drag-source");
const dragTargetDirectory = path.join(second, "drag-target");
const dragSourceFile = path.join(dragSourceDirectory, "Dragged.txt");
const dragSourceFileTwo = path.join(dragSourceDirectory, "DraggedToo.txt");
const dragTargetFile = path.join(dragTargetDirectory, "Dragged.txt");
const dragTargetFileTwo = path.join(dragTargetDirectory, "DraggedToo.txt");
await fs.mkdir(dragSourceDirectory);
await fs.mkdir(dragTargetDirectory);
await fs.writeFile(dragSourceFile, "moved by Explorer drag-and-drop\n");
await fs.writeFile(dragSourceFileTwo, "second selected file\n");
const largeFolder = path.join(second, "zz-large-folder");
await fs.mkdir(largeFolder, { recursive: true });
await Promise.all(Array.from({ length: 1200 }, (_, index) =>
  fs.writeFile(path.join(largeFolder, `Entry${String(index).padStart(4, "0")}.txt`), `Explorer fixture ${index}\n`)));

// A real local repository drives the advanced Git UI without any network
// dependency. Two independently modified files also catch stale Monaco hunk
// decorations after switching editor tabs.
const gitHunkFirst = path.join(second, "src", "GitHunkFirst.java");
const gitHunkSecond = path.join(second, "src", "GitHunkSecond.java");
const gitMergeFile = path.join(second, "src", "MergeVisual.java");
await Promise.all([
  fs.writeFile(gitHunkFirst, "public class GitHunkFirst {\n    int value = 1;\n}\n"),
  fs.writeFile(gitHunkSecond, "public class GitHunkSecond {\n    int value = 10;\n}\n"),
  fs.writeFile(gitMergeFile, "public class MergeVisual {\n    String source = \"base\";\n}\n"),
  fs.writeFile(path.join(second, ".gitignore"), "build/\n.kiwi/\nzz-large-folder/\ndrag-source/\ndrag-target/\n"),
]);
runGit(second, ["init", "-b", "main"]);
runGit(second, ["config", "user.email", "kiwi-e2e@example.invalid"]);
runGit(second, ["config", "user.name", "Kiwi E2E"]);
runGit(second, ["add", "."]);
runGit(second, ["commit", "-m", "Initial project"]);
runGit(second, ["switch", "-c", "feature/e2e"]);
await fs.writeFile(path.join(second, "RebaseOne.txt"), "one\n");
runGit(second, ["add", "RebaseOne.txt"]);
runGit(second, ["commit", "-m", "Rebase one"]);
await fs.writeFile(path.join(second, "RebaseTwo.txt"), "two\n");
runGit(second, ["add", "RebaseTwo.txt"]);
runGit(second, ["commit", "-m", "Rebase two"]);
runGit(second, ["remote", "add", "origin", "https://github.com/kiwi/ide.git"]);
await Promise.all([
  fs.writeFile(gitHunkFirst, "public class GitHunkFirst {\n    int value = 2;\n}\n"),
  fs.writeFile(gitHunkSecond, "public class GitHunkSecond {\n    int value = 20;\n}\n"),
]);

const child = spawn(electron, [
  ...(!deployed ? [root] : []),
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userData}`,
  // Chromium stops rendering a window it considers occluded and throttles what
  // is left. Six different checks in this suite read something painted —
  // CodeLens, a gutter glyph, a terminal buffer, a welcome window — and they
  // have been failing one at a time, in no pattern, on a machine that is
  // building installers in the background. The CodeLens probe measured it
  // directly: visibility "hidden", empty lens list.
  //
  // Asking for a frame does not help, because afterFrames() deliberately races
  // a timer so an occluded window cannot hang the run — it returns having
  // painted nothing. These switches remove the condition instead of each check
  // working around it, and they apply to the application under test only.
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-background-timer-throttling",
], {
  cwd: root,
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
  // No splash minimum and no startup preload. Three runs waiting fifteen
  // seconds each on a window this gate never looks at is three quarters of
  // a minute spent proving nothing, and the preload's steps spawn processes
  // that made these runs less reliable than they were.
  env: {
    ...process.env,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    KIWI_LOAD_DIST: "1",
    KIWI_SPLASH_MINIMUM_MS: "300",
    KIWI_STARTUP_PRELOAD: "0",
  },
});
let logs = "";
child.stdout.on("data", (data) => { logs += data.toString(); });
child.stderr.on("data", (data) => { logs += data.toString(); });

try {
  // A portable build unpacks its whole payload into %TEMP% before the first
  // window exists, which takes far longer than launching an installed app.
  const welcomeTarget = await waitForTarget("welcome", portable ? 120_000 : 20_000);
  let cdp = await createCdp(welcomeTarget.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  await waitFor(() => evaluate(cdp, "document.readyState === 'complete' && Boolean(window.kiwi)"), 15_000, "preload API");
  await waitFor(() => evaluate(cdp, "Boolean(document.querySelector('.project-hub'))"), 10_000, "standalone welcome window");
  assert.equal(await evaluate(cdp, "new URLSearchParams(location.search).get('window')"), "welcome");

  await evaluate(cdp, `window.kiwi.settings.update({
    workspaceHistoryMigrated: false,
    recentProjects: [],
    lastWorkspace: ""
  }).then(() => {
    localStorage.setItem("kiwi.lastWorkspace", ${JSON.stringify(first)});
    setTimeout(() => location.reload(), 25);
    return true;
  })`, true);
  await waitFor(
    () => evaluate(cdp, `(() => {
      const project = [...document.querySelectorAll('.hub-project-main')]
        .find(item => item.dataset.projectRoot === ${JSON.stringify(first)});
      return Boolean(project) && document.querySelector('.hub-recents small')?.textContent === '1 zuletzt verwendet';
    })()`),
    10_000,
    "legacy recent project migration in hub",
  );
  assert.equal(await evaluate(cdp, `Promise.all([
    window.kiwi.workspace.list(),
    window.kiwi.settings.get()
  ]).then(([state, settings]) =>
    settings.workspaceHistoryMigrated === true
      && state.activeRoot === null
      && state.resumableProjects.some(project => project.root === ${JSON.stringify(first)})
  )`, true), true, "Recovered project was not persisted as an inactive Hub entry.");

  const roots = JSON.stringify([first, second]);
  await evaluate(cdp, `window.kiwi.workspace.add(${roots})`, true);
  // A project build must never inherit a selected JUnit/Maven/Gradle target.
  // Seed a JUnit configuration as the active first item before opening Beta.
  await evaluate(cdp, `window.kiwi.runConfigurations.save(${JSON.stringify(second)}, {
    name: "Aktueller JUnit-Test",
    type: "junit",
    target: "BrokenTest"
  })`, true);
  await evaluate(cdp, `window.kiwi.app.openEditor(${JSON.stringify(second)})`, true);
  const editorTarget = await waitForTarget("editor", 20_000);
  cdp.close();
  cdp = await createCdp(editorTarget.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  await waitFor(() => evaluate(cdp, "document.readyState === 'complete' && Boolean(window.kiwi)"), 15_000, "editor preload API");
  await waitFor(() => evaluate(cdp, "document.querySelectorAll('.workspace-project-tree').length === 1"), 20_000, "active project tree");
  assert.equal(await evaluate(cdp, "new URLSearchParams(location.search).get('window')"), "editor");
  await leftClickElement(cdp, ".toolbar-overflow > button");
  const multiRoot = await evaluate(cdp, `({
    projects: document.querySelectorAll('.workspace-project-tree').length,
    switcher: [...document.querySelectorAll('.overflow-project-select select option')].map(option => option.textContent),
    hasOldCreateButtons: [...document.querySelectorAll('.sidebar-header button')].some(button => /Neue Datei|Neuer Ordner/.test(button.title)),
    emptyLogo: Boolean(document.querySelector('.editor-empty-logo')),
    embeddedWelcome: Boolean(document.querySelector('.editor-container .welcome, .editor-container .project-hub')),
    compactToolbar: [...document.querySelectorAll('.main-toolbar > .toolbar-run > button')].length <= 3,
    layoutProfiles: [...document.querySelectorAll('.toolbar-overflow-menu button')].filter(button => /Profil: (Programmieren|Debuggen|Git-Review)/.test(button.textContent)).length,
    projectName: document.querySelector('.project-heading-copy strong')?.textContent || '',
    projectPath: document.querySelector('.project-heading-copy small')?.textContent || '',
    auxiliary: [...document.querySelectorAll('.explorer-auxiliary button')].map(button => button.textContent?.trim())
  })`);
  assert.equal(multiRoot.projects, 1);
  assert.deepEqual(multiRoot.switcher.sort(), ["alpha", "beta"]);
  assert.equal(multiRoot.hasOldCreateButtons, false);
  assert.equal(multiRoot.emptyLogo, true);
  assert.equal(multiRoot.embeddedWelcome, false);
  assert.equal(multiRoot.compactToolbar, true);
  assert.equal(multiRoot.layoutProfiles, 3);
  assert.equal(multiRoot.projectName, "beta");
  assert.equal(multiRoot.projectPath, second);
  assert.deepEqual(multiRoot.auxiliary, ["Externe Bibliotheken", "Scratches und Konsolen"]);
  await leftClickElement(cdp, ".toolbar-overflow > button");

  await waitFor(
    () => evaluate(cdp, "Boolean(document.querySelector('.build-tool .build-tree-root'))"),
    10_000,
    "hierarchical build tool",
  );
  const buildTree = await evaluate(cdp, `({
    root: document.querySelector('.build-tree-root strong')?.textContent || '',
    branches: [...document.querySelectorAll('.build-tree-branch span')].map(item => item.textContent),
    groups: [...document.querySelectorAll('.task-group-header span')].map(item => item.textContent),
    toolbarButtons: document.querySelectorAll('.build-tool-toolbar .icon-button').length
  })`);
  assert.equal(buildTree.root, "beta");
  assert.deepEqual(buildTree.branches.slice(0, 3), ["Tasks", "Dependencies", "Run-Konfigurationen"]);
  assert.ok(buildTree.groups.length > 0, "Build task groups were not loaded.");
  assert.ok(buildTree.toolbarButtons >= 5, "Build tool toolbar is incomplete.");

  // CodeToGetter is a proper right-hand tool window. It must remain reachable
  // beside Build and Dependencies and must never reappear as one of the lower
  // output tabs, which would steal vertical editor space and duplicate state.
  const collabRail = await evaluate(cdp, `(() => {
    const button = document.querySelector('.right-rail button[title="CodeToGetter"]');
    if (!button) return null;
    const box = button.getBoundingClientRect();
    return {
      visible: box.width > 0 && box.height > 0 && getComputedStyle(button).visibility !== 'hidden',
      label: button.textContent?.trim() || '',
    };
  })()`);
  assert.ok(collabRail?.visible, `CodeToGetter is missing from the right rail: ${JSON.stringify(collabRail)}`);
  assert.ok(collabRail.label.includes("CodeToGetter"), `CodeToGetter rail label is unclear: ${JSON.stringify(collabRail)}`);
  await leftClickElement(cdp, '.right-rail button[title="CodeToGetter"]');
  await waitFor(
    () => evaluate(cdp, "document.querySelector('.right-tool-window')?.dataset.rightTool === 'collab'"),
    8_000,
    "CodeToGetter right tool window",
  );
  const collabTool = await evaluate(cdp, `({
    hasPanel: Boolean(document.querySelector('.right-tool-window[data-right-tool="collab"] .codetogetter')),
    title: document.querySelector('.right-tool-window[data-right-tool="collab"] .right-tool-header')?.textContent || '',
    bottomTabs: [...document.querySelectorAll('.bottom-panel .panel-tabs button')]
      .map(button => (button.textContent || '').trim().toUpperCase()),
  })`);
  assert.equal(collabTool.hasPanel, true, "CodeToGetter did not render inside the right tool window.");
  assert.ok(collabTool.title.includes("CodeToGetter"), `The collaboration tool window has the wrong title: ${collabTool.title}`);
  assert.equal(
    collabTool.bottomTabs.some((label) => label.includes("CODETOGETTER")),
    false,
    `CodeToGetter must not be duplicated as a lower output tab: ${JSON.stringify(collabTool.bottomTabs)}`,
  );
  await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('.right-tool-window[data-right-tool="collab"] button')]
      .find(item => item.textContent?.includes('Projekt teilen'));
    if (!button) throw new Error('CodeToGetter host action is missing.');
    button.click();
  })()`);
  await waitFor(
    () => evaluate(cdp, `(() => {
      const value = document.querySelector('.right-tool-window[data-right-tool="collab"] .codetogetter-invite input')?.value || '';
      return value.startsWith('kiwi://codetogether/join?');
    })()`),
    8_000,
    "CodeToGetter host session and invite",
  );
  await leftClickElement(cdp, '.right-rail button[title="Build Tool"]');
  await waitFor(
    () => evaluate(cdp, "document.querySelector('.right-tool-window')?.dataset.rightTool === 'build' && Boolean(document.querySelector('.build-tool'))"),
    8_000,
    "build tool restored after CodeToGetter",
  );

  const externalFile = path.join(second, "ExternalWatcher.txt");
  await fs.writeFile(externalFile, "created outside Kiwi\n");
  try {
    await waitFor(
      () => evaluate(cdp, `[...document.querySelectorAll('.tree-row')].some(row => row.getAttribute('title') === ${JSON.stringify(externalFile)})`),
      5_000,
      "external file creation in Explorer",
    );
  } catch (error) {
    const watcherProbe = await evaluate(cdp, `Promise.all([
      window.kiwi.workspace.tree(${JSON.stringify(second)}),
      window.kiwi.settings.get()
    ]).then(([tree, settings]) => ({
      apiTree: tree.map(node => node.name),
      domTree: [...document.querySelectorAll('.tree-row')].map(row => ({ title: row.getAttribute('title'), text: row.textContent })),
      settings,
      status: document.querySelector('.statusbar')?.textContent || ''
    }))`, true);
    throw new Error(`${error.message} Diagnose: ${JSON.stringify(watcherProbe)}`);
  }
  await fs.rm(externalFile);
  await waitFor(
    () => evaluate(cdp, `![...document.querySelectorAll('.tree-row')].some(row => row.getAttribute('title') === ${JSON.stringify(externalFile)})`),
    5_000,
    "external file deletion in Explorer",
  );
  // A file can vanish under an open tab. What the workbench shows then has to
  // be a German sentence — not Node's syscall text with Electron's channel name
  // in front of it, which is what reached the user before.
  assert.equal(
    await evaluate(cdp, `window.kiwi.file.read(${JSON.stringify(externalFile)})
      .then(() => "", error => error.message)`, true),
    `„${path.basename(externalFile)}“ wurde nicht gefunden.`,
  );

  const hiddenDirectory = path.join(second, ".hidden-cache");
  await fs.mkdir(hiddenDirectory, { recursive: true });
  await fs.writeFile(path.join(hiddenDirectory, "Hidden.txt"), "hidden\n");
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(
    await evaluate(cdp, `[...document.querySelectorAll('.tree-row')].some(row => row.getAttribute('title') === ${JSON.stringify(hiddenDirectory)})`),
    false,
    "Dot-directories must stay hidden in the Explorer.",
  );

  await leftClickElement(cdp, '.tree-row[title$="drag-source"]');
  await waitFor(
    () => evaluate(cdp, `[...document.querySelectorAll('.tree-row')].some(row => row.title === ${JSON.stringify(dragSourceFile)})`),
    5_000,
    "drag source file in Explorer",
  );
  await evaluate(cdp, `(() => {
    const first = [...document.querySelectorAll('.tree-row')].find(row => row.title === ${JSON.stringify(dragSourceFile)});
    const second = [...document.querySelectorAll('.tree-row')].find(row => row.title === ${JSON.stringify(dragSourceFileTwo)});
    first?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    second?.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    return Boolean(first && second);
  })()`);
  assert.equal(
    await evaluate(cdp, "document.querySelectorAll('.tree-row.selected').length >= 2"),
    true,
    "Explorer Ctrl multi-selection failed.",
  );
  assert.equal(
    await evaluate(cdp, `(() => {
      const marker = [...document.querySelectorAll('.tree-row')].find(row => row.title === ${JSON.stringify(path.join(second, "src", "Marker.java"))});
      const mode = [...document.querySelectorAll('.tree-row')].find(row => row.title === ${JSON.stringify(path.join(second, "src", "Mode.java"))});
      return marker?.dataset.nodeKind === 'java-interface'
        && marker.querySelector('.java-interface-glyph')?.textContent === 'I'
        && mode?.dataset.nodeKind === 'java-enum'
        && mode.querySelector('.java-enum-glyph')?.textContent === 'E';
    })()`),
    true,
    "Java Interface/Enum icons are not distinct in the Explorer.",
  );
  const dragDispatched = await evaluate(cdp, `(() => {
    const source = [...document.querySelectorAll('.tree-row')].find(row => row.title === ${JSON.stringify(dragSourceFile)});
    const target = [...document.querySelectorAll('.tree-row')].find(row => row.title === ${JSON.stringify(dragTargetDirectory)});
    if (!source || !target) return false;
    const transfer = new DataTransfer();
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }));
    return true;
  })()`);
  assert.equal(dragDispatched, true, "Explorer drag events could not be dispatched.");
  /*
   * A move asks before it moves anything.
   *
   * Dropping a folder one row off its mark is a thing that happens, so the
   * question stands in the middle of the window and nothing has changed on
   * disk while it does. The gate answers it the way somebody would.
   */
  await waitFor(
    () => evaluate(cdp, "Boolean(document.querySelector('.confirm-dialog'))"),
    10_000,
    "Rückfrage vor dem Verschieben",
  );
  await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('.confirm-dialog .modal-footer button')]
      .find(item => /verschieben|move/i.test(item.textContent || ''));
    button?.click();
    return Boolean(button);
  })()`);
  await waitFor(
    async () => {
      const [sourceExists, targetExists] = await Promise.all([
        Promise.all([dragSourceFile, dragSourceFileTwo].map(file => fs.stat(file).then(() => true).catch(() => false)))
          .then(values => values.some(Boolean)),
        Promise.all([dragTargetFile, dragTargetFileTwo].map(file => fs.stat(file).then(() => true).catch(() => false)))
          .then(values => values.every(Boolean)),
      ]);
      return !sourceExists && targetExists;
    },
    5_000,
    "file moved by Explorer drag-and-drop",
  );
  await waitFor(
    () => evaluate(cdp, `[...document.querySelectorAll('.tree-row')].some(row => row.title === ${JSON.stringify(dragTargetFile)})`),
    5_000,
    "moved file visible in Explorer target",
  );
  assert.equal(
    await evaluate(cdp, `(() => {
      const source = [...document.querySelectorAll('.tree-row')].find(row => row.title === ${JSON.stringify(dragSourceDirectory)});
      const target = [...document.querySelectorAll('.tree-row')].find(row => row.title === ${JSON.stringify(dragTargetDirectory)});
      return source?.getAttribute('aria-expanded') === 'true'
        && target?.getAttribute('aria-expanded') === 'true';
    })()`),
    true,
    "Explorer expansion state collapsed after drag-and-drop.",
  );
  assert.equal(
    await fs.readFile(dragTargetFile, "utf8"),
    "moved by Explorer drag-and-drop\n",
    "Explorer drag-and-drop changed the file contents.",
  );
  assert.equal(await fs.readFile(dragTargetFileTwo, "utf8"), "second selected file\n");
  await evaluate(cdp, `(() => {
    const row = [...document.querySelectorAll('.tree-row')].find(item => item.title === ${JSON.stringify(dragTargetFile)});
    row?.focus();
    row?.click();
    return Boolean(row);
  })()`);
  // Opening the file lazy-mounts Monaco, whose initial focus intentionally
  // moves into the editor. Wait for that mount and then put keyboard focus
  // back on the already selected Explorer row before testing Explorer copy.
  await waitFor(
    () => evaluate(cdp, `[...document.querySelectorAll('.tabs .tab')]
      .some(tab => tab.title === ${JSON.stringify(dragTargetFile)})`),
    8_000,
    "Explorer clipboard source editor",
  );
  await afterFrames(cdp, `
    const row = [...document.querySelectorAll('.tree-row')].find(item => item.title === ${JSON.stringify(dragTargetFile)});
    row?.focus();
    return Boolean(row && document.activeElement === row);
  `).then((focused) => assert.equal(focused, true, "Explorer row did not regain keyboard focus."));
  await cdp.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown", key: "c", code: "KeyC", windowsVirtualKeyCode: 67, modifiers: 2,
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp", key: "c", code: "KeyC", windowsVirtualKeyCode: 67, modifiers: 2,
  });
  await leftClickElement(cdp, '.tree-row[title$="drag-source"]');
  // Trigger the action once. A wait predicate must only observe its result:
  // sending Ctrl+V from each poll can overlap the renderer's asynchronous
  // transfer and start a second copy of the same file.
  await cdp.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown", key: "v", code: "KeyV", windowsVirtualKeyCode: 86, modifiers: 2,
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp", key: "v", code: "KeyV", windowsVirtualKeyCode: 86, modifiers: 2,
  });
  await waitFor(
    () => fs.readFile(dragSourceFile, "utf8")
      .then((content) => content === "moved by Explorer drag-and-drop\n")
      .catch(() => false),
    15_000,
    "Explorer Ctrl+C and Ctrl+V",
  );
  await waitFor(
    () => evaluate(cdp, `[...document.querySelectorAll('.toast.success')]
      .some(item => item.textContent?.trim() === '1 Element kopiert')`),
    5_000,
    "single Explorer paste completion",
  );
  assert.equal(
    await evaluate(cdp, `[...document.querySelectorAll('.toast.error')]
      .some(item => item.textContent?.includes('Am Ziel existiert bereits'))`),
    false,
    "Explorer paste started a duplicate transfer.",
  );

  const languageStart = await evaluate(
    cdp,
    `window.kiwi.language.start(${JSON.stringify(second)})`,
    true,
  );
  assert.equal(languageStart.available, true, languageStart.reason || "Java language service unavailable");

  // Both of these were declared in the settings but never actually requested:
  // the server has to advertise them, or the providers have nothing to show.
  assert.ok(
    languageStart.capabilities?.semanticTokensProvider?.legend?.tokenTypes?.length > 0,
    `The language server advertised no semantic token legend: ${JSON.stringify(languageStart.capabilities?.semanticTokensProvider)}`,
  );
  assert.ok(
    languageStart.capabilities?.inlayHintProvider,
    "The language server advertised no inlay hint support.",
  );
  // Kiwi's Monaco provider asks for hints on an attached, open editor model.
  // Mirror that lifecycle here: resolving a cold, unopened compilation unit in
  // JDT's invisible project is legal, but can race its first reconciliation and
  // remain pending indefinitely in a freshly unpacked build.
  const inlayFile = path.join(second, "src", "Broken.java");
  const inlayOpen = await evaluate(cdp, `window.kiwi.language.open(${JSON.stringify({
    root: second,
    file: inlayFile,
    text: await fs.readFile(inlayFile, "utf8"),
    languageId: "java",
  })})`, true);
  assert.equal(inlayOpen.available, true, inlayOpen.reason || "Inlay-hint document was not opened in JDT LS.");
  const inlayHints = await evaluate(cdp, `window.kiwi.language.request(${JSON.stringify(second)}, "textDocument/inlayHint", {
    textDocument: { uri: ${JSON.stringify(pathToFileURL(inlayFile).toString())} },
    range: { start: { line: 0, character: 0 }, end: { line: 40, character: 0 } }
  }).then(hints => Array.isArray(hints) ? hints.length : -1)`, true);
  assert.ok(inlayHints >= 0, `Inlay hints were refused by the language server: ${inlayHints}`);
  assert.equal(
    await evaluate(cdp, `window.kiwi.language.close(${JSON.stringify({ root: second, file: inlayFile })})`, true),
    true,
    "The temporary inlay-hint document was not closed in JDT LS.",
  );

  await cdp.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: "B",
    code: "KeyB",
    windowsVirtualKeyCode: 66,
    modifiers: 2 | 8,
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "B",
    code: "KeyB",
    windowsVirtualKeyCode: 66,
    modifiers: 2 | 8,
  });
  try {
    await waitFor(
      () => evaluate(cdp, "Boolean(document.querySelector('.build-dashboard.failed .build-quick-fix'))"),
      20_000,
      "clean failed-build dashboard with quick fix",
    );
  } catch (error) {
    const buildProbe = await evaluate(cdp, `({
      panel: [...document.querySelectorAll('.panel-tabs button')].find(button => button.classList.contains('active'))?.textContent || '',
      dashboard: document.querySelector('.build-dashboard')?.className || '',
      title: document.querySelector('.build-result-copy')?.textContent || '',
      issues: [...document.querySelectorAll('.build-issue')].map(item => item.textContent),
      output: document.querySelector('.output-view')?.textContent || '',
      toasts: [...document.querySelectorAll('.toast')].map(item => item.textContent),
      operations: [...document.querySelectorAll('.operation-row')].map(item => item.textContent)
    })`);
    throw new Error(`${error.message} Diagnose: ${JSON.stringify(buildProbe)}`);
  }
  const failedBuild = await evaluate(cdp, `({
    title: document.querySelector('.build-result-copy strong')?.textContent || '',
    issue: document.querySelector('.build-issue-main')?.textContent || '',
    fix: document.querySelector('.build-quick-fix')?.textContent || '',
    rawHidden: !document.querySelector('.build-raw-output'),
    sidebarVisible: Boolean(document.querySelector('.sidebar'))
  })`);
  assert.match(failedBuild.title, /Compilerfehler/);
  assert.match(failedBuild.issue, /Worker.*Marker|Marker.*Worker/);
  assert.match(failedBuild.fix, /Marker implementieren/);
  assert.equal(failedBuild.rawHidden, true);
  assert.equal(failedBuild.sidebarVisible, true, "Ctrl+Shift+B toggled the sidebar instead of building.");
  const buildDirectory = path.join(second, "build");
  await waitFor(
    () => evaluate(cdp, `[...document.querySelectorAll('.tree-row')].some(row => row.getAttribute('title') === ${JSON.stringify(buildDirectory)})`),
    5_000,
    "visible build directory after compilation",
  );
  await leftClickElement(cdp, ".build-quick-fix");
  await waitFor(
    () => evaluate(
      cdp,
      `window.kiwi.file.read(${JSON.stringify(path.join(second, "src", "Worker.java"))})
        .then(source => source.includes("implements Marker"))`,
      true,
    ),
    8_000,
    "build quick fix application",
  );
  await leftClickElement(cdp, ".build-result-actions .primary-button");
  await waitFor(
    () => evaluate(cdp, "Boolean(document.querySelector('.build-dashboard.success'))"),
    20_000,
    "successful rebuild after quick fix",
  );

  await leftClickElement(cdp, '.workspace-project-tree.active .tree-row[title$="Beta.java"]');
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  const editorProbe = await evaluate(cdp, `({
    tabs: [...document.querySelectorAll('.tab')].map(item => item.textContent),
    toasts: [...document.querySelectorAll('.toast')].map(item => item.textContent),
    editors: document.querySelectorAll('.monaco-editor').length,
    selected: document.querySelector('.tree-row.selected')?.getAttribute('title')
  })`);
  assert.ok(editorProbe.editors > 0, `Java editor did not open: ${JSON.stringify(editorProbe)}`);
  await waitFor(() => evaluate(cdp, "Boolean(document.querySelector('.monaco-editor textarea'))"), 10_000, "Java editor");

  // The editor must come out of the bundle. It used to be fetched from a CDN
  // on every start, which meant no editor at all without a connection.
  const remoteResources = await evaluate(cdp, `performance.getEntriesByType('resource')
    .map(entry => entry.name)
    .filter(name => !name.startsWith('file:') && !name.startsWith('data:') && !name.startsWith('blob:'))`);
  assert.deepEqual(remoteResources, [], `The renderer loaded something over the network: ${JSON.stringify(remoteResources)}`);
  assert.equal(
    await evaluate(cdp, "Boolean(document.querySelector('.monaco-editor .view-lines'))"),
    true,
    "Monaco rendered no content, so the bundled copy did not take over.",
  );

  // Exercise the successful route through the real workbench: click Monaco's
  // gutter to create a breakpoint, start from the Java CodeLens, stop on the
  // executable line and continue to observable JVM output. Backend-only tests
  // cannot catch a disconnected gutter or a CodeLens bypassing renderer state.
  // The lens is produced from the model text alone, so it is there the moment
  // Monaco paints — and only then. During a release build the workbench sits
  // behind an installer being written, requestAnimationFrame is throttled for
  // the occluded window, and nothing reaches the DOM to be found. Asking for a
  // frame first is what the other steps that failed this way already do.
  await bringToFront(cdp);
  await afterFrames(cdp, "return true;");
  try {
    await waitFor(
      () => evaluate(cdp, "[...document.querySelectorAll('.codelens-decoration a')].some(item => item.textContent?.includes('Debug'))"),
      12_000,
      "Java Debug CodeLens for successful session",
    );
  } catch (error) {
    // "not available in time" says nothing about which of the three ways this
    // can fail happened: no main method in the model, a model that never
    // arrived, or a window that never painted.
    const lensProbe = await evaluate(cdp, `JSON.stringify((() => {
      const editor = document.querySelector('.monaco-editor');
      const box = editor?.getBoundingClientRect();
      return {
        lenses: [...document.querySelectorAll('.codelens-decoration a')].map(item => item.textContent),
        visibility: document.visibilityState,
        editorSize: box ? [Math.round(box.width), Math.round(box.height)] : null,
        lines: document.querySelectorAll('.monaco-editor .view-line').length,
        hasMain: (document.querySelector('.monaco-editor')?.textContent || '').includes('static void main'),
      };
    })())`);
    throw new Error(`${error.message} Zustand: ${lensProbe}`);
  }
  // The gutter is measured, clicked and verified as one retried step. A
  // measurement is only valid until the next layout pass, and a click a few
  // pixels off toggles nothing at all — so a failed attempt re-measures
  // instead of trusting a single snapshot taken seconds earlier.
  // Every plausible spot in the breakpoint gutter, best first. Monaco only
  // reports a glyph-margin click for a narrow band, and which band that is
  // depends on the decorations currently rendered — one computed coordinate
  // was a guess that silently hit the line numbers instead.
  const measureGutterPoints = () => evaluate(cdp, `(() => {
    const glyph = document.querySelector('.monaco-editor .glyph-margin');
    const margin = document.querySelector('.monaco-editor .margin');
    const line = [...document.querySelectorAll('.monaco-editor .line-numbers')]
      .find(item => item.textContent?.trim() === '3');
    if (!margin || !line) return JSON.stringify([]);
    const glyphBox = glyph?.getBoundingClientRect();
    const marginBox = margin.getBoundingClientRect();
    const lineBox = line.getBoundingClientRect();
    const y = lineBox.top + lineBox.height / 2;
    const candidates = [];
    if (glyphBox && glyphBox.width > 0) candidates.push(glyphBox.left + glyphBox.width / 2);
    candidates.push(lineBox.left - 6, marginBox.left + 7, marginBox.left + 3);
    return JSON.stringify(candidates
      .filter(x => x > marginBox.left - 1 && x < lineBox.right)
      .map(x => ({ x, y })));
  })()`).then((value) => JSON.parse(value));
  // The glyph is painted, not stored. With the workbench occluded behind an
  // installer being written, requestAnimationFrame is throttled and the
  // decoration never reaches the DOM although the breakpoint was set — the
  // diagnosis below reported exactly that, every gutter row without a class.
  // Asking for a frame first is what the other painted checks already do.
  const breakpointVisible = () => afterFrames(cdp, "return Boolean(document.querySelector('.debug-breakpoint-glyph'));");
  const clickPoint = async (point) => {
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1 });
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1 });
  };
  /** Clicks the gutter of line 3 until the breakpoint reaches the wanted state. */
  const toggleGutterBreakpoint = async (wanted, label) => {
  /**
   * The breakpoints the workbench holds, asked of the application rather than
   * read off the screen.
   *
   * Two probes before this one read the DEBUG tool window's list. That window is
   * not open at this point in the run, so the element does not exist and the
   * count is zero — indistinguishable from an empty list, and three attempts at
   * this bug were argued from that zero. Clicking the tab first did not help
   * either; the tab is not there to click.
   *
   * The workbench persists breakpoints whenever they change, so this reads what
   * was written for the active project. It can lag the in-memory state by a
   * moment, which is worth knowing and still tells the two cases apart.
   */
  const readHeldBreakpoints = () => evaluate(cdp, `
    window.kiwi.workspace.list()
      .then(state => Promise.all([state.activeRoot, window.kiwi.debug.listBreakpoints(state.activeRoot)]))
      .then(([root, list]) => JSON.stringify({
        projekt: String(root || "").slice(-24),
        anzahl: list.length,
        eintraege: list.slice(0, 4).map(item => item.className + ":" + item.line + (item.path ? " (mit Pfad)" : " (ohne Pfad)")),
        glyphen: document.querySelectorAll('.debug-breakpoint-glyph').length,
      }))
      .catch(error => JSON.stringify({ fehler: String((error && error.message) || error) }))
  `, true).catch((error) => `nicht gelesen: ${error.message}`);
    const heldBefore = await readHeldBreakpoints();
    let lastPoint = null;
    let workingPoint = null;
    // Clicks dispatched, and clicks the workbench answered. Both are reported
    // in the diagnosis: they separate a click Monaco never classified as a
    // gutter click from a breakpoint that was toggled and then not drawn.
    let clicks = 0;
    let landed = 0;
    const reached = () => breakpointVisible().then((visible) => visible === wanted);
    // The workbench answers a gutter click with a toast, which is the only
    // signal that does not depend on a decoration being painted first.
    const toastPresent = () => evaluate(
      cdp,
      "[...document.querySelectorAll('.toast')].some(item => (item.textContent || '').includes('Breakpoint'))",
    );
    await waitFor(async () => {
      if (await reached()) return true;
      // A gutter click toggles. Once one has been answered the breakpoint has
      // already moved, so clicking anywhere again would undo it — the sweep
      // waits for the decoration instead. Keying this off "the state changed"
      // is what made the old sweep undo its own work: when the decoration took
      // longer than the five seconds allowed, it moved to the next candidate
      // spot and clicked the breakpoint straight back on, over and over until
      // the attempt ran out. That is the failure that reached the release gate
      // with eight acknowledged clicks and the breakpoint still sitting there.
      if (landed > 0) return false;
      for (const point of workingPoint ? [workingPoint] : await measureGutterPoints()) {
        lastPoint = point;
        // A toast still standing from the previous toggle would be read as this
        // click's answer, and the sweep would then refuse to click at all.
        const quiet = await waitFor(async () => !(await toastPresent()), 8_000, label).catch(() => false);
        if (!quiet) return false;
        await clickPoint(point);
        clicks += 1;
        const acknowledged = await waitFor(toastPresent, 5_000, label).catch(() => false);
        if (!acknowledged) continue;
        landed += 1;
        workingPoint = point;
        return reached();
      }
      return false;
    }, 25_000, label).catch(async (error) => {
      const probe = await evaluate(cdp, `JSON.stringify({
        editors: document.querySelectorAll('.monaco-editor').length,
        lineNumbers: [...document.querySelectorAll('.monaco-editor .line-numbers')].map(item => item.textContent?.trim()).slice(0, 8),
        viewLines: document.querySelectorAll('.monaco-editor .view-line').length,
        margin: Boolean(document.querySelector('.monaco-editor .margin')),
        tab: document.querySelector('.tabs .tab.active')?.textContent || '',
        // Both boxes, because they answer different questions: a collapsed
        // host means the workbench layout is wrong, while a full-size host
        // with a tiny editor means Monaco kept a stale measurement.
        editorBox: (() => {
          const box = document.querySelector('.monaco-editor')?.getBoundingClientRect();
          return box ? [Math.round(box.width), Math.round(box.height)] : null;
        })(),
        hostBox: (() => {
          const box = document.querySelector('.monaco-editor-host')?.getBoundingClientRect();
          return box ? [Math.round(box.width), Math.round(box.height)] : null;
        })(),
        rowBox: (() => {
          const box = document.querySelector('.editor-row')?.getBoundingClientRect();
          return box ? [Math.round(box.width), Math.round(box.height)] : null;
        })(),
        panels: [...document.querySelectorAll('.bottom-panel')].map(item => item.dataset.panelDock),
        gutter: (() => {
          const box = selector => {
            const element = document.querySelector(selector);
            const rect = element?.getBoundingClientRect();
            return rect ? [Math.round(rect.left), Math.round(rect.width)] : null;
          };
          return { glyph: box('.monaco-editor .glyph-margin'), margin: box('.monaco-editor .margin') };
        })(),
        // The glyph margin is shared: Git hunk markers live there too, and a
        // gutter click only becomes a breakpoint for a Java model, so both are
        // worth seeing before blaming the coordinates.
        //
        // The language is read from the container, not from .monaco-editor:
        // Monaco puts data-mode-id on the element the application handed it and
        // the monaco-editor class on a node it creates inside, so the obvious
        // query reads an element that never carries the attribute and reports
        // every model as having no language at all. This decides whether
        // resolveJavaGutterAction() could have fired — it answers null for
        // anything that is not java, and it does so without a sound.
        modeId: document.querySelector('[data-mode-id]')?.getAttribute('data-mode-id') || '(kein Element mit data-mode-id)',
        toasts: [...document.querySelectorAll('.toast')].map(item => (item.textContent || '').slice(0, 40)),
        klicks: ${clicks},
        beantwortet: ${landed},
        breakpoints: document.querySelectorAll('.debug-breakpoint-glyph').length,
        // What the workbench holds, against what it drew. The glyph count alone
        // cannot tell "the toggle added nothing" from "it added one and the
        // gutter did not render it", and those need opposite fixes. The list
        // lives in the DEBUG panel, so it is read from there rather than from
        // any state this side cannot reach.
        // Zero here means nothing only if the list is actually mounted; an
        // unopened DEBUG panel counts zero just as convincingly.
        listeOffen: Boolean(document.querySelector('.breakpoint-list')),
        gehalten: document.querySelectorAll('.breakpoint-list .breakpoint-editor').length,
        gehaltenText: [...document.querySelectorAll('.breakpoint-list .breakpoint-editor')]
          .slice(0, 4).map(item => (item.textContent || '').replace(/\s+/g, ' ').slice(0, 60)),
        hunks: document.querySelectorAll('.kiwi-git-hunk-unstaged, .kiwi-git-hunk-staged').length,
        glyphContents: [...document.querySelectorAll('.monaco-editor .margin-view-overlays > div')]
          .slice(0, 8).map(row => row.className || '(ohne Klasse)'),
      })`);
      const atPoint = lastPoint
        ? await evaluate(cdp, `JSON.stringify(
          document.elementsFromPoint(${lastPoint ? lastPoint.x : 0}, ${lastPoint ? lastPoint.y : 0})
            .slice(0, 5).map(element => element.className || element.tagName)
        )`)
        : "nicht gemessen";
      const heldAfter = await readHeldBreakpoints();
      throw new Error(`${error.message} Vorher: ${heldBefore} Nachher: ${heldAfter} Diagnose: ${probe} Klickziel: ${atPoint}${rendererNote(typeof cdp === "undefined" ? null : cdp)}`);
    });
  };
  await toggleGutterBreakpoint(true, "breakpoint created from Java gutter");
  const successfulDebugLensPoint = JSON.parse(await evaluate(cdp, `(() => {
    const link = [...document.querySelectorAll('.codelens-decoration a')]
      .find(item => item.textContent?.includes('Debug'));
    if (!link) return JSON.stringify(null);
    const box = link.getBoundingClientRect();
    return JSON.stringify({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
  })()`));
  assert.ok(successfulDebugLensPoint, "The successful Java Debug CodeLens had no clickable bounds.");
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: successfulDebugLensPoint.x, y: successfulDebugLensPoint.y, button: "left", buttons: 1, clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: successfulDebugLensPoint.x, y: successfulDebugLensPoint.y, button: "left", buttons: 0, clickCount: 1 });
  await waitFor(
    () => evaluate(cdp, "document.querySelector('.debug-controls > span')?.textContent === 'paused'"),
    25_000,
    "Java breakpoint reached from CodeLens",
  ).catch(async (error) => {
    // This step compiles with javac, starts a JVM and attaches over JDWP, so
    // "not available in time" covers everything from a missing JDK to a
    // session that ran to completion without ever stopping. The state says
    // which: a status still "stopped" means nothing started, "running" means
    // the JVM came up but the breakpoint was not hit, and a toast or console
    // output usually names the reason outright.
    const probe = await evaluate(cdp, `JSON.stringify({
      status: document.querySelector('.debug-controls > span')?.textContent || '(kein Statusfeld)',
      controls: [...document.querySelectorAll('.debug-controls button')].map(item => item.title),
      breakpoints: document.querySelectorAll('.debug-breakpoint-glyph').length,
      toasts: [...document.querySelectorAll('.toast')].map(item => (item.textContent || '').slice(0, 120)),
      output: (document.querySelector('.debug-panel pre')?.textContent || '').slice(-400),
      console: (document.querySelector('.panel-content pre')?.textContent || '').slice(-400),
    })`);
    throw new Error(`${error.message} Zustand: ${probe}`);
  });
  await leftClickElement(cdp, '.debug-controls button[title="Continue"]');
  await waitFor(
    () => evaluate(cdp, `(() => {
      const output = document.querySelector('.debug-panel pre')?.textContent || '';
      const status = document.querySelector('.debug-controls > span')?.textContent || '';
      return output.includes('KIWI_E2E_DEBUG_OK:Beta:42') && status === 'stopped';
    })()`),
    20_000,
    "successful Java debug session",
  );
  // Clicking the same gutter line again removes the persisted point.
  await toggleGutterBreakpoint(false, "breakpoint removed from Java gutter");

  await cdp.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: "`",
    code: "Backquote",
    windowsVirtualKeyCode: 192,
    modifiers: 2,
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "`",
    code: "Backquote",
    windowsVirtualKeyCode: 192,
    modifiers: 2,
  });
  await waitFor(
    () => evaluate(cdp, `(() => {
      const button = [...document.querySelectorAll('.panel-tabs button')].find(item => item.textContent?.includes('TERMINAL'));
      return Boolean(button?.classList.contains('active') && document.querySelector('.terminal'));
    })()`),
    5_000,
    "Ctrl+` terminal shortcut",
  );
  // PowerShell can show a one-time publisher prompt while trying to load its
  // interactive line editor. A bare Enter accepts the safe default (do not
  // load it); at an ordinary prompt it is simply an empty command. Waiting for
  // the real `PS …>` prompt prevents an echoed command from being mistaken for
  // successfully executed terminal output.
  await evaluate(cdp, `window.kiwi.terminal.input(${JSON.stringify(second)}, "\\r", "1")`, true);
  await waitFor(
    () => evaluate(cdp, `window.kiwi.terminal.snapshot(${JSON.stringify(second)}, "1").then(snapshot =>
      /(?:^|[\\r\\n])PS\\s+[^>\\r\\n]+>/.test(snapshot.output.replace(/\\x1b\\[[0-?]*[ -\\/]*[@-~]/g, ""))
    )`, true),
    8_000,
    "interactive PowerShell prompt",
  );
  // A popped-out terminal joins the existing main-process session. Its own
  // BrowserWindow must have a unique identity per session, retain buffered
  // output and close without killing the shell it displays.
  const terminalMarker = `KIWI_POP_OUT_${Date.now()}`;
  const terminalMarkerCommand = `Write-Output '${terminalMarker}'`;
  await evaluate(cdp, `window.kiwi.terminal.execute({
    root: ${JSON.stringify(second)},
    sessionId: "1",
    command: ${JSON.stringify(terminalMarkerCommand)}
  })`, true);
  await waitFor(
    () => evaluate(cdp, `window.kiwi.terminal.snapshot(${JSON.stringify(second)}, "1")
      .then(snapshot => snapshot.output.split(${JSON.stringify(terminalMarker)}).length >= 3)`, true),
    8_000,
    "terminal output buffered before pop-out",
  );
  await leftClickElement(cdp, '.panel-actions button[aria-label*="eigenes Fenster"]');
  await waitFor(
    () => evaluate(cdp, `Boolean(
      document.querySelector('.bottom-panel .terminal-detached-placeholder')
      && document.querySelector('.bottom-panel .terminal-sessions')
    )`),
    8_000,
    "detached terminal placeholder without hiding the shared panel",
  );
  const terminalTarget = await waitForTarget("terminal", 10_000);
  const terminalCdp = await createCdp(terminalTarget.webSocketDebuggerUrl);
  await terminalCdp.send("Runtime.enable");
  await waitFor(() => evaluate(terminalCdp, "document.readyState === 'complete' && Boolean(window.kiwi)"), 10_000, "terminal preload API");
  await waitFor(() => evaluate(terminalCdp, "Boolean(document.querySelector('.terminal-window-terminal'))"), 10_000, "detached terminal UI");
  await waitFor(
    () => evaluate(terminalCdp, `document.querySelector('.xterm-rows')?.textContent?.includes(${JSON.stringify(terminalMarker)})`),
    8_000,
    "buffered output rendered in detached xterm",
  );
  // Type into xterm itself (not the optional quick-command field). This proves
  // the renderer, raw IPC and ConPTY path are connected end-to-end.
  const typedPtyPrefix = `KIWI_PTY_TYPED_${Date.now()}_`;
  const typedPtyMarker = `${typedPtyPrefix}42`;
  // Typed more than once if it has to be.
  //
  // A terminal answers the shell's Device-Attributes query by writing the
  // reply into the pty, and the shell reads it as input if it is sitting at a
  // prompt. Arriving mid-command it becomes part of it: PowerShell was handed
  // "[?1;2cWrite-Output (…)" and answered "Der Typname nach [ fehlt". Nothing
  // about that is wrong — it is what a terminal does — but it is a race with
  // whoever is typing, so the line is cleared first and the command is typed
  // again if the answer never arrives.
  await clickUntil(
    terminalCdp,
    async () => {
      await evaluate(terminalCdp, "document.querySelector('.xterm-helper-textarea')?.focus()");
      // Escape empties the PowerShell input line, along with anything the
      // terminal itself put there.
      await terminalCdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await terminalCdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await terminalCdp.send("Input.insertText", { text: `Write-Output ('${typedPtyPrefix}' + (40 + 2))` });
      // Chromium treats `keyDown` as an already translated text event on
      // Windows; xterm listens at the physical-key layer and therefore needs
      // rawKeyDown, exactly like a real Enter key from the keyboard.
      await terminalCdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      await terminalCdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    },
    () => evaluate(terminalCdp, `document.querySelector('.xterm-rows')?.textContent?.includes(${JSON.stringify(typedPtyMarker)})`),
    "raw xterm input executed through ConPTY",
    20_000,
  ).catch(async (error) => {
    const probe = await evaluate(terminalCdp, `Promise.all([
      window.kiwi.terminal.snapshot(${JSON.stringify(second)}, "1"),
      Promise.resolve((() => {
        const textarea = document.querySelector('.xterm-helper-textarea');
        return {
          active: document.activeElement === textarea,
          readOnly: Boolean(textarea?.readOnly),
          disabled: Boolean(textarea?.disabled),
          value: textarea?.value || '',
          rows: (document.querySelector('.xterm-rows')?.textContent || '').slice(-300),
        };
      })())
    ]).then(([snapshot, dom]) => JSON.stringify({ dom, output: snapshot.output.slice(-500), running: snapshot.running }))`, true);
    throw new Error(`${error.message} Diagnose: ${probe}${rendererNote(typeof cdp === "undefined" ? null : cdp)}`);
  });
  assert.deepEqual(
    await evaluate(terminalCdp, `Promise.all([
      window.kiwi.terminal.windowContext(),
      window.kiwi.terminal.snapshot(${JSON.stringify(second)}, "1")
    ]).then(([context, snapshot]) => ({
      root: context.projectRoot,
      sessionId: context.sessionId,
      buffered: snapshot.output.includes(${JSON.stringify(terminalMarker)}),
      running: snapshot.running,
      dragRegion: getComputedStyle(document.querySelector('.terminal-window-titlebar')).getPropertyValue('-webkit-app-region'),
      actionRegion: getComputedStyle(document.querySelector('.terminal-window-actions')).getPropertyValue('-webkit-app-region'),
      windowControls: document.querySelectorAll('.window-controls button').length,
      /* This bar is the only titlebar carrying controls of its own, and the
         crest's tinted band is anchored to the same end. When both were on,
         "Andocken" and "Stop" sat on the tint and read as switched on. What
         has to hold is not which of the two wins but that they never overlap,
         so this counts controls standing on the band rather than asserting
         the band away. The rule underneath is the part that must stay. */
      crestRule: getComputedStyle(document.querySelector('.terminal-window-titlebar'), '::after').height,
      controlsOnCrest: (() => {
        const bar = document.querySelector('.terminal-window-titlebar');
        const band = getComputedStyle(bar, '::before');
        if (band.display === 'none') return 0;
        const from = window.innerWidth - (parseFloat(band.right) || 0) - (parseFloat(band.width) || 0);
        const to = window.innerWidth - (parseFloat(band.right) || 0);
        return Array.from(bar.querySelectorAll('button'))
          .map((button) => button.getBoundingClientRect())
          .filter((box) => box.width > 0 && box.right > from + 1 && box.left < to - 1)
          .length;
      })()
    }))`, true),
    {
      root: second,
      sessionId: "1",
      buffered: true,
      running: true,
      dragRegion: "drag",
      actionRegion: "no-drag",
      windowControls: 3,
      crestRule: "2px",
      controlsOnCrest: 0,
    },
  );

  await evaluate(cdp, `window.kiwi.terminal.start(${JSON.stringify(second)}, "2")`, true);
  await evaluate(cdp, `window.kiwi.terminal.openWindow(${JSON.stringify(second)}, "2")`, true);
  const secondTerminalMarker = `KIWI_POP_OUT_SECOND_${Date.now()}`;
  const secondTerminalCommand = `Write-Output '${secondTerminalMarker}'`;
  await evaluate(cdp, `window.kiwi.terminal.execute({
    root: ${JSON.stringify(second)},
    sessionId: "2",
    command: ${JSON.stringify(secondTerminalCommand)}
  })`, true);
  await waitFor(
    () => evaluate(cdp, `window.kiwi.terminal.snapshot(${JSON.stringify(second)}, "2")
      .then(snapshot => snapshot.output.includes(${JSON.stringify(secondTerminalMarker)}))`, true),
    8_000,
    "second terminal output buffered before docking",
  );
  await waitFor(async () => {
    const targets = await listPageTargets();
    return targets.filter((item) => {
      try { return new URL(item.url).searchParams.get("window") === "terminal"; }
      catch { return false; }
    }).length === 2;
  }, 10_000, "unique terminal window per session");
  assert.equal(
    await evaluate(cdp, `window.kiwi.terminal.windowState(${JSON.stringify(second)}).then(items =>
      items.map(item => item.sessionId).sort().join(','))`, true),
    "1,2",
  );
  await evaluate(cdp, `window.kiwi.terminal.closeWindow(${JSON.stringify(second)}, "2")`, true);
  assert.equal(
    await evaluate(cdp, `window.kiwi.terminal.snapshot(${JSON.stringify(second)}, "2").then(snapshot => snapshot.running)`, true),
    true,
    "Closing a detached terminal window stopped its session.",
  );
  await waitFor(
    async () => {
      const state = await evaluate(cdp, `({
        active: document.querySelector('.terminal-sessions span.active button')?.textContent || '',
        tabs: [...document.querySelectorAll('.terminal-sessions span > button:first-child')].map(item => item.textContent),
        detached: document.querySelector('.terminal-detached-placeholder')?.textContent || '',
        panel: [...document.querySelectorAll('.panel-tabs button')].find(item => item.textContent?.includes('TERMINAL'))?.className || ''
      })`);
      if (state.active.includes('Terminal 2')) return true;
      throw new Error(JSON.stringify(state));
    },
    8_000,
    "inactive second terminal selected after docking",
  );
  await waitFor(
    // xterm paints, and .xterm-rows holds only the rows currently on screen.
    // Both matter here: a frame that never came and a marker that scrolled out
    // of view produce the same empty answer.
    () => afterFrames(cdp, `return document.querySelector('.xterm-rows')?.textContent?.includes(${JSON.stringify(secondTerminalMarker)}) || false;`),
    8_000,
    "inactive second terminal docked with its own visible buffer",
  ).catch(async (error) => {
    const probe = await evaluate(cdp, `JSON.stringify({
      rows: document.querySelectorAll('.xterm-rows > div').length,
      visible: (document.querySelector('.xterm-rows')?.textContent || '').slice(-200),
      // The session's whole buffer, against what is on screen: a marker that is
      // in the one and not the other scrolled away rather than never arrived.
      bufferHasMarker: (document.querySelector('.terminal-host')?.dataset.terminalBufferLength || '') !== '',
      terminalBox: (() => {
        const box = document.querySelector('.xterm-screen')?.getBoundingClientRect();
        return box ? [Math.round(box.width), Math.round(box.height)] : null;
      })(),
      // An added panel tab that wraps the strip onto a second line takes its
      // height out of the terminal below it.
      panelTabs: [...document.querySelectorAll('.panel-tabs button')].map(item => item.textContent),
      tabStripHeight: Math.round(document.querySelector('.panel-tabs')?.getBoundingClientRect().height || 0),
      active: document.querySelector('.terminal-sessions span.active button')?.textContent || '',
    })`);
    throw new Error(`${error.message} Diagnose: ${probe}${rendererNote(typeof cdp === "undefined" ? null : cdp)}`);
  });
  assert.equal(
    await evaluate(cdp, `document.querySelector('.xterm-rows')?.textContent?.includes(${JSON.stringify(terminalMarker)})`),
    false,
    "Docking terminal 2 left terminal 1's output on screen.",
  );

  await clickElementThatClosesWindow(terminalCdp, '.terminal-window-actions button[aria-label*="zurück"]');
  terminalCdp.close();
  await waitFor(
    () => evaluate(cdp, `(() => {
      const button = [...document.querySelectorAll('.panel-tabs button')].find(item => item.textContent?.includes('TERMINAL'));
      return Boolean(button?.classList.contains('active') && document.querySelector('.terminal'));
    })()`),
    8_000,
    "detached terminal docked back into editor",
  );
  assert.equal(
    await evaluate(cdp, `window.kiwi.terminal.snapshot(${JSON.stringify(second)}, "1").then(snapshot =>
      snapshot.running && snapshot.output.includes(${JSON.stringify(terminalMarker)}))`, true),
    true,
    "Docking the terminal back lost or stopped the shared session.",
  );
  await waitFor(
    () => evaluate(cdp, `Promise.all([
      window.kiwi.terminal.snapshot(${JSON.stringify(second)}, "1"),
      window.kiwi.terminal.snapshot(${JSON.stringify(second)}, "2")
    ]).then(([firstSnapshot, secondSnapshot]) => {
      const terminal = document.querySelector('.terminal');
      const active = document.querySelector('.terminal-sessions span.active button')?.textContent || '';
      return active.includes('Terminal 1')
        && terminal?.dataset.terminalSession === '1'
        // xterm virtualizes its scrollback, so an older marker is not required
        // to be one of the few rows currently present in the DOM. The rendered
        // component exposes only its buffer size, and holding that against the
        // main-process snapshot proves redocking hydrated terminal 1 without
        // leaking terminal content into a DOM attribute.
        //
        // Held against it, not equal to it: the shell is alive. PowerShell
        // answers device-attribute queries and redraws its prompt on its own,
        // so the main-process buffer keeps growing after the renderer has
        // hydrated. Equality could only hold if the shell happened to fall
        // silent at the right moment, and the itemised diagnosis showed this
        // was the single failing half while the five real claims all held. The
        // renderer may lag the live buffer; it must never lead it, and it must
        // carry something.
        && Number(terminal?.dataset.terminalBufferLength) > 0
        && Number(terminal?.dataset.terminalBufferLength) <= firstSnapshot.output.length
        && firstSnapshot.output.includes(${JSON.stringify(terminalMarker)})
        && firstSnapshot.output.includes(${JSON.stringify(typedPtyMarker)})
        && !firstSnapshot.output.includes(${JSON.stringify(secondTerminalMarker)})
        && secondSnapshot.output.includes(${JSON.stringify(secondTerminalMarker)});
    })`, true),
    // Two live PowerShell sessions have to be selected, hydrated and echoing
    // before this can hold. Eight seconds was enough on an idle machine and not
    // with the rest of the suite competing for it.
    20_000,
    "first terminal redocked after another session was active",
  ).catch(async (error) => {
    const probe = await evaluate(cdp, `Promise.all([
      window.kiwi.terminal.snapshot(${JSON.stringify(second)}, "1"),
      window.kiwi.terminal.snapshot(${JSON.stringify(second)}, "2"),
      Promise.resolve((() => ({
        active: document.querySelector('.terminal-sessions span.active button')?.textContent || '',
        tabs: [...document.querySelectorAll('.terminal-sessions span > button:first-child')].map(item => item.textContent),
        detached: document.querySelector('.terminal-detached-placeholder')?.textContent || '',
        session: document.querySelector('.terminal')?.dataset.terminalSession || '',
        bufferLength: Number(document.querySelector('.terminal')?.dataset.terminalBufferLength || 0),
        rows: (document.querySelector('.xterm-rows')?.textContent || '').slice(-400),
      }))())
    ]).then(([first, secondSnapshot, dom]) => JSON.stringify({
      dom,
      // The condition tests six things at once. Reporting four of them left the
      // failure unattributable, which is the one thing a diagnosis must not do.
      activeIsFirst: dom.active.includes('Terminal 1'),
      sessionIsFirst: dom.session === '1',
      bufferWithinSnapshot: dom.bufferLength > 0 && dom.bufferLength <= first.output.length,
      bufferLengths: [dom.bufferLength, first.output.length],
      buffered: first.output.includes(${JSON.stringify(terminalMarker)}),
      latestBuffered: first.output.includes(${JSON.stringify(typedPtyMarker)}),
      firstStayedClean: !first.output.includes(${JSON.stringify(secondTerminalMarker)}),
      secondHasItsOwn: secondSnapshot.output.includes(${JSON.stringify(secondTerminalMarker)}),
      running: first.running,
      output: first.output.slice(-400),
    }))`, true);
    throw new Error(`${error.message} Diagnose: ${probe}${rendererNote(typeof cdp === "undefined" ? null : cdp)}`);
  });

  // The shell processes live in the main process. A renderer reload must
  // rebuild every terminal tab and seed it from that shared output history.
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitFor(
    () => evaluate(cdp, "document.readyState === 'complete' && Boolean(window.kiwi) && Boolean(document.querySelector('.app-shell:not(.editor-bootstrap-shell)'))"),
    30_000,
    "workbench after renderer reload",
  );
  await waitFor(
    () => evaluate(cdp, `(() => {
      const labels = [...document.querySelectorAll('.terminal-sessions span > button:first-child')]
        .map(button => button.textContent?.trim());
      return labels.includes('Terminal 1') && labels.includes('Terminal 2');
    })()`),
    30_000,
    "terminal tabs restored after renderer reload",
  );
  await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('.terminal-sessions span > button:first-child')]
      .find(item => item.textContent?.includes('Terminal 2'));
    button?.click();
  })()`);
  await waitFor(
    () => evaluate(cdp, `document.querySelector('.xterm-rows')?.textContent?.includes(${JSON.stringify(secondTerminalMarker)})`),
    8_000,
    "second terminal buffer restored after renderer reload",
  );
  await evaluate(cdp, `window.kiwi.terminal.stop(${JSON.stringify(second)}, "2")`, true);
  await waitFor(
    () => evaluate(cdp, `Boolean(document.querySelector('.workspace-project-tree.active .tree-row[title$="Beta.java"]'))`),
    20_000,
    "Beta.java after renderer reload",
  );
  await leftClickElement(cdp, '.workspace-project-tree.active .tree-row[title$="Beta.java"]');
  await waitFor(
    () => evaluate(cdp, "Boolean(document.querySelector('.monaco-editor .view-lines'))"),
    10_000,
    "editor after renderer reload",
  );
  // Both the focus click and the typing can be swallowed while the workbench is
  // still settling. That used to surface far away from its cause: the language
  // server answered with zero completions because the text never arrived, not
  // because completion was broken. Both steps are now checked for their effect.
  await focusEditor(cdp);
  await waitFor(
    async () => {
      await cdp.send("Input.dispatchKeyEvent", {
        type: "rawKeyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2,
      });
      await cdp.send("Input.dispatchKeyEvent", {
        type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2,
      });
      await cdp.send("Input.insertText", { text: "public class Beta { void inspect() { System." });
      // Monaco renders some spaces as non-breaking ones, so the comparison
      // ignores whitespace entirely instead of guessing which ones survive.
      // The backslash is doubled on purpose: this is a template literal, and a
      // plain \s would reach the page as "s" and strip every letter s instead.
      return evaluate(cdp, `(document.querySelector('.monaco-editor .view-lines')?.textContent || '')
        .replace(/\\s/g, '').includes('voidinspect(){System.')`);
    },
    15_000,
    "Java source for the completion probe",
  );
  await cdp.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: " ",
    code: "Space",
    windowsVirtualKeyCode: 32,
    modifiers: 2,
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: " ",
    code: "Space",
    windowsVirtualKeyCode: 32,
    modifiers: 2,
  });
  try {
    // The status bar reports "Index bereit" before the language server can
    // actually answer for java.lang, so the first Ctrl+Space can come back
    // empty. Pressing it again is exactly what a user does, it is harmless to
    // repeat, and it re-syncs the document to the server on the way.
    await waitFor(
      async () => {
        if (await evaluate(cdp, "document.querySelectorAll('.suggest-widget.visible .monaco-list-row').length > 3")) {
          return true;
        }
        for (const type of ["rawKeyDown", "keyUp"]) {
          await cdp.send("Input.dispatchKeyEvent", {
            type, key: " ", code: "Space", windowsVirtualKeyCode: 32, modifiers: 2,
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 700));
        return evaluate(cdp, "document.querySelectorAll('.suggest-widget.visible .monaco-list-row').length > 3");
      },
      deployed ? 50_000 : 25_000,
      "Ctrl+Space Java member completion",
    );
  } catch (error) {
    const completionUri = pathToFileURL(path.join(second, "src", "Beta.java")).toString();
    const completionSource = "public class Beta { void inspect() { System.";
    const directCompletion = await evaluate(cdp, `window.kiwi.language.request(
      ${JSON.stringify(second)},
      "textDocument/completion",
      {
        textDocument: { uri: ${JSON.stringify(completionUri)} },
        position: { line: 0, character: ${completionSource.length} }
      }
    ).then(result => ({
      count: Array.isArray(result) ? result.length : result?.items?.length || 0,
      labels: (Array.isArray(result) ? result : result?.items || []).slice(0, 12).map(item => item.label)
    }), requestError => ({ error: requestError?.message || String(requestError) }))`, true);
    const completionProbe = await evaluate(cdp, `({
      activeElement: document.activeElement?.className || document.activeElement?.tagName,
      suggestClass: document.querySelector('.suggest-widget')?.className || '',
      suggestRows: document.querySelectorAll('.suggest-widget .monaco-list-row').length,
      tab: document.querySelector('.tab.active')?.textContent || '',
      status: document.querySelector('.statusbar')?.textContent || '',
      toasts: [...document.querySelectorAll('.toast')].map(item => item.textContent)
    })`);
    throw new Error(`${error.message} Diagnose: ${JSON.stringify({ directCompletion, completionProbe })}`);
  }
  const completionText = await evaluate(cdp, "document.querySelector('.suggest-widget.visible')?.textContent || ''");
  assert.equal(
    ["out", "getProperty", "currentTimeMillis"].some((member) => completionText.includes(member)),
    true,
    `System member completion missing: ${completionText.slice(0, 500)}`,
  );
  // The icon beside a proposal. Monaco numbers its completion kinds
  // differently from the protocol, and the conversion used to subtract one —
  // which drew System's fields as variables and its methods as functions.
  //
  // Read off one named member rather than off whatever rows happen to be
  // rendered. The list is virtualised and Kiwi fills the server's answer in
  // after painting its own, so sampling every visible icon once caught a
  // moment holding nothing but templates and keywords — a flake of this
  // probe's own making, which failed a release gate.
  const memberIcon = await waitFor(
    () => evaluate(cdp, `(() => {
      const rows = [...document.querySelectorAll('.suggest-widget.visible .monaco-list-row')];
      const row = rows.find(item => /getProperty|currentTimeMillis|lineSeparator/.test(item.textContent || ''));
      if (!row) return '';
      return [...(row.querySelector('.suggest-icon')?.classList || [])]
        .find(name => name.startsWith('codicon-symbol-')) || '';
    })()`),
    15_000,
    "Symbol eines Member-Vorschlags",
  );
  assert.equal(
    ["codicon-symbol-method", "codicon-symbol-field", "codicon-symbol-property"].includes(memberIcon),
    true,
    `Completion-Symbol falsch zugeordnet: ${memberIcon}`,
  );
  await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });


  // The templates a project brings with it. Written through the guarded IPC
  // rather than onto the disk directly, because the wiring is what this
  // checks: the file has to come back as it was written, and the workbench has
  // to be told rather than left with what it read when the project opened.
  const projectTemplates = JSON.stringify({
    version: 1,
    templates: [
      { key: "kiwilog", source: "live", detail: "Kiwi-Testvorlage", insertText: "log.debug(\"kiwi\");" },
      { key: "kiwiopt", source: "postfix", detail: "Kiwi-Testvorlage", insertText: "Optional.ofNullable($EXPR$)" },
    ],
  }, null, 2);
  const templateRoundTrip = await evaluate(cdp, `(async () => {
    const written = await window.kiwi.templates.write(${JSON.stringify(second)}, ${JSON.stringify(projectTemplates)});
    const read = await window.kiwi.templates.read(${JSON.stringify(second)});
    return { path: read.path, exists: read.exists, same: read.text === written.text };
  })()`, true);
  assert.equal(templateRoundTrip.exists, true, "Projekt-Templates wurden nicht gespeichert.");
  assert.equal(templateRoundTrip.same, true, "Projekt-Templates kamen anders zurück, als sie geschrieben wurden.");
  assert.equal(
    templateRoundTrip.path.replace(/\\/g, "/").endsWith("/.kiwi/templates.json"),
    true,
    `Projekt-Templates liegen an der falschen Stelle: ${templateRoundTrip.path}`,
  );

  // And they are offered. A live template is enough to prove the whole path:
  // the file is read, parsed, handed to the provider and shown in the list —
  // without the language server having to answer for any of it.
  await focusEditor(cdp);
  await selectAllInEditor(cdp);
  await cdp.send("Input.insertText", { text: "class Kiwilate {\n    void run() {\n        kiwilo" });
  await waitFor(
    async () => {
      if (await evaluate(cdp, "(document.querySelector('.suggest-widget.visible')?.textContent || '').includes('kiwilog')")) {
        return true;
      }
      for (const type of ["rawKeyDown", "keyUp"]) {
        await cdp.send("Input.dispatchKeyEvent", {
          type, key: " ", code: "Space", windowsVirtualKeyCode: 32, modifiers: 2,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
      return evaluate(cdp, "(document.querySelector('.suggest-widget.visible')?.textContent || '').includes('kiwilog')");
    },
    20_000,
    "Projekt-Template in der Completion",
  );
  await closeSuggestWidget(cdp);


  // Enter finishing a statement is the one change that takes a key away from
  // the editor, so it is checked from both sides: the line that must gain a
  // semicolon, and the block header that must not.
  await focusEditor(cdp);
  await selectAllInEditor(cdp);
  await cdp.send("Input.insertText", { text: "class Gamma {\n    void run() {\n        int a = 1" });
  // An open suggestion widget owns Enter, and Kiwi deliberately leaves it
  // alone; closing it first is what makes this measure the rule and not the
  // widget.
  await closeSuggestWidget(cdp);
  await pressEnter(cdp);
  await cdp.send("Input.insertText", { text: "if (a > 0)" });
  await closeSuggestWidget(cdp);
  await pressEnter(cdp);
  try {
    await waitFor(
      async () => {
        const text = await editorText(cdp);
        return text.includes("inta=1;") && !text.includes("if(a>0);");
      },
      10_000,
      "Enter finishing a statement",
    );
  } catch (error) {
    throw new Error(`${error.message} Puffer: ${(await editorText(cdp)).slice(0, 300)}`);
  }

  await leftClickElement(cdp, '.workspace-project-tree.active .tree-row[title$="Beta.java"]');
  await waitFor(
    () => evaluate(cdp, "[...document.querySelectorAll('.tabs .tab.active')].some(tab => tab.textContent?.includes('Beta.java'))"),
    10_000,
    "zurück in der Java-Datei nach der Einrückungsprobe",
  );

  // What the Tab key and the Enter key actually put into a Java file.
  //
  // "Tabben und das Zeilenverhalten buggen" is a report about typing, and
  // typing is the one thing Input.insertText does not exercise: it drops text
  // into the buffer past auto-indent, past auto-closing, past the Tab key. So
  // the keys are sent as keys, the buffer is written to disk, and the file is
  // read back — the file is the only account of what was typed that nothing
  // can render differently.
  await focusEditor(cdp);
  await selectAllInEditor(cdp);
  await typeKeys(cdp, "class Indent {");
  await closeSuggestWidget(cdp);
  await pressEnter(cdp);
  await typeKeys(cdp, "int a = 1;");
  await closeSuggestWidget(cdp);
  await pressEnter(cdp);
  await pressKey(cdp, "Tab", "Tab", 9);
  await typeKeys(cdp, "int b = 2;");
  await closeSuggestWidget(cdp);
  await pressChord(cdp, { key: "s", code: "KeyS", vk: 83, modifiers: 2 });
  const indentFile = path.join(second, "src", "Beta.java");
  const typed = await waitFor(
    () => evaluate(
      cdp,
      `window.kiwi.file.read(${JSON.stringify(indentFile)}).then(text => text.includes("int b = 2;") ? text : "")`,
      true,
    ),
    10_000,
    "getippte Java-Zeilen auf der Platte",
  );
  const typedLines = typed.split(/\r?\n/);
  const indentOf = (line) => (line.match(/^[ \t]*/) || [""])[0];
  const indents = {
    afterBrace: indentOf(typedLines.find((line) => line.includes("int a = 1;")) || ""),
    afterTab: indentOf(typedLines.find((line) => line.includes("int b = 2;")) || ""),
  };
  assert.deepEqual(
    indents,
    { afterBrace: "    ", afterTab: "        " },
    // Monaco guesses a file's indentation from its content unless it is told
    // not to, and the guess overrides the configured width. That is what made
    // this depend on which file was open.
    `Einrückung nach { und nach Tab weicht ab: ${JSON.stringify({ indents, typed: typed.slice(0, 200) })}`,
  );
  assert.equal(
    /\t/.test(typed),
    false,
    `Mit "Leerzeichen statt Tabs" darf kein Tabulator entstehen: ${JSON.stringify(typed.slice(0, 200))}`,
  );


  // Two files, edited in turn.
  //
  // Everything below is one question asked six ways: does a change made in one
  // file stay in that file. An editor that answers wrongly loses work without
  // ever reporting an error, which is the one failure a person cannot recover
  // from and cannot see coming.
  const stateA = path.join(second, "src", "StateA.java");
  const stateB = path.join(second, "src", "StateB.java");
  await fs.writeFile(stateA, "public class StateA {\n}\n");
  await fs.writeFile(stateB, "public class StateB {\n}\n");

  // Addressed by file name, never by full path: a Windows path inside a CSS
  // attribute selector is a string of escape sequences and matches nothing at
  // all, which reads exactly like a row that is not there.
  const openByTree = async (target) => {
    const name = path.basename(target);
    const row = `.workspace-project-tree.active .tree-row[title$=${JSON.stringify(name)}]`;
    await showExplorer(cdp);
    await waitFor(
      () => evaluate(cdp, `Boolean(document.querySelector(${JSON.stringify(row)}))`),
      10_000,
      `Zeile für ${name}`,
    );
    await clickUntil(
      cdp,
      () => leftClickElement(cdp, row),
      () => evaluate(cdp, `[...document.querySelectorAll('.tabs .tab.active .tab-label')].some(label => label.textContent === ${JSON.stringify(name)})`),
      `${name} im Editor`,
      15_000,
    );
  };
  const activeTabName = () => evaluate(cdp, "document.querySelector('.tabs .tab.active .tab-label')?.textContent || ''");
  const onDisk = (target) => evaluate(
    cdp,
    `window.kiwi.file.read(${JSON.stringify(target)})`,
    true,
  );
  const dirtyTabs = () => evaluate(
    cdp,
    "JSON.stringify([...document.querySelectorAll('.tabs .tab')].filter(tab => tab.querySelector('.tab-close.dirty')).map(tab => tab.querySelector('.tab-label')?.textContent || ''))",
  ).then(JSON.parse);

  // 1. A change in A survives a trip through B.
  await openByTree(stateA);
  await focusEditor(cdp);
  await pressChord(cdp, { key: "End", code: "End", vk: 35, modifiers: 2 });
  await typeKeys(cdp, "// Spur A");
  await closeSuggestWidget(cdp);
  await waitFor(async () => (await editorTextFromTop(cdp)).includes("//SpurA"), 8_000, "Änderung in StateA");
  await openByTree(stateB);
  await focusEditor(cdp);
  await pressChord(cdp, { key: "End", code: "End", vk: 35, modifiers: 2 });
  await typeKeys(cdp, "// Spur B");
  await closeSuggestWidget(cdp);
  await waitFor(async () => (await editorTextFromTop(cdp)).includes("//SpurB"), 8_000, "Änderung in StateB");
  await openByTree(stateA);
  const backInA = await waitFor(async () => (await editorTextFromTop(cdp)) || "", 8_000, "StateA nach der Rückkehr");
  assert.ok(
    backInA.includes("//SpurA") && !backInA.includes("//SpurB"),
    `Der Inhalt zweier Dateien darf sich nicht vermischen: ${backInA.slice(0, 200)}`,
  );

  // 2. Saving A saves A. B stays dirty and untouched on disk.
  await pressChord(cdp, { key: "s", code: "KeyS", vk: 83, modifiers: 2 });
  await waitFor(
    async () => (await onDisk(stateA)).includes("// Spur A"),
    10_000,
    "StateA auf der Platte",
  );
  assert.equal(
    (await onDisk(stateB)).includes("// Spur B"),
    false,
    "Das Speichern einer Datei darf keine zweite mitschreiben.",
  );
  assert.deepEqual(await dirtyTabs(), ["StateB.java"], "Nur die ungespeicherte Datei darf als geändert gelten.");

  // 3. Twenty switches in a row, each landing on the right buffer.
  for (let round = 0; round < 10; round += 1) {
    await openByTree(stateB);
    await openByTree(stateA);
  }
  // Back to the top before reading: Monaco paints only the lines in view, and
  // in a short editor a two-line file can sit scrolled past its first line.
  // Reading the painted lines then reports a file that looks truncated when
  // the buffer is perfectly intact.
  await focusEditor(cdp);
  await pressChord(cdp, { key: "Home", code: "Home", vk: 36, modifiers: 2 });
  const afterSwitching = await waitFor(
    async () => {
      const text = await editorText(cdp);
      return text.includes("classState") ? text : "";
    },
    8_000,
    "Inhalt nach dem schnellen Wechseln",
  );
  assert.ok(
    afterSwitching.includes("classStateA") && !afterSwitching.includes("classStateB"),
    `Nach schnellem Wechseln stand der falsche Inhalt im Editor: ${afterSwitching.slice(0, 200)}`,
  );
  assert.equal(await activeTabName(), "StateA.java");

  // Undo belongs to the file the typing happened in.
  //
  // Section 4 of the brief: "Undo/Redo muss zuverlässig und pro Datei
  // funktionieren." One undo stack shared between files would take a change
  // out of a file nobody was looking at, which is the quietest way an editor
  // can lose work.
  const typeMarker = async (target, marker) => {
    await openByTree(target);
    await focusEditor(cdp);
    await pressChord(cdp, { key: "End", code: "End", vk: 35, modifiers: 2 });
    await typeKeys(cdp, marker);
    await closeSuggestWidget(cdp);
    const stripped = marker.replace(/\s/g, "");
    await waitFor(async () => (await editorTextFromTop(cdp)).includes(stripped), 8_000, `${marker} in ${path.basename(target)}`);
  };
  await typeMarker(stateA, "// rueck A");
  await typeMarker(stateB, "// rueck B");

  await openByTree(stateA);
  await focusEditor(cdp);
  // Typing is grouped into undo stops by pauses and word boundaries, so the
  // marker takes several. Bounded, because "press undo until the text is what
  // I want" would pass even if undo did nothing at all.
  let undone = false;
  // Once, here: a cursor move is an undo stop, so moving inside the loop would
  // spend an undo on the move instead of on the edit being undone.
  await pressChord(cdp, { key: "Home", code: "Home", vk: 36, modifiers: 2 });
  for (let attempt = 0; attempt < 20 && !undone; attempt += 1) {
    // Checked every time rather than once before the loop. The editor was
    // reached through two tab switches, and a chord sent while focus is
    // elsewhere is spent for nothing — twenty of those look exactly like an
    // undo that does not work.
    await ensureEditorFocus(cdp);
    await pressChord(cdp, { key: "z", code: "KeyZ", vk: 90, modifiers: 2 });
    undone = !(await editorText(cdp)).includes("//rueckA");
  }
  if (!undone) {
    // Twenty undos doing nothing has two quite different causes: the keys went
    // somewhere other than the editor, or the editor had nothing to undo. This
    // has failed roughly one run in twenty-five and the message said neither.
    const undoProbe = await evaluate(cdp, `({
      focused: document.activeElement === document.querySelector('.monaco-editor textarea'),
      activeElement: document.activeElement?.className || document.activeElement?.tagName,
      activeTab: document.querySelector('.tabs .tab.active .tab-label')?.textContent || '',
      tabs: [...document.querySelectorAll('.tabs .tab-label')].map(item => item.textContent),
      dirty: [...document.querySelectorAll('.tabs .tab')].filter(tab => tab.className.includes('dirty')).length,
      suggest: Boolean(document.querySelector('.suggest-widget.visible')),
    })`);
    assert.fail(
      `Undo hat die Änderung in StateA nicht zurückgenommen: ${(await editorTextFromTop(cdp)).slice(0, 160)}`
      + ` Diagnose: ${JSON.stringify(undoProbe)}`,
    );
  }

  await openByTree(stateB);
  const untouchedB = await waitFor(async () => (await editorText(cdp)) || "", 8_000, "StateB nach dem Undo in StateA");
  assert.ok(
    untouchedB.includes("//rueckB"),
    `Undo in einer Datei darf keine zweite verändern: ${untouchedB.slice(0, 160)}`,
  );

  // And redo puts it back in the file it belongs to.
  await openByTree(stateA);
  await focusEditor(cdp);
  let redone = false;
  await pressChord(cdp, { key: "Home", code: "Home", vk: 36, modifiers: 2 });
  for (let attempt = 0; attempt < 20 && !redone; attempt += 1) {
    await ensureEditorFocus(cdp);
    await pressChord(cdp, { key: "z", code: "KeyZ", vk: 90, modifiers: 10 });
    redone = (await editorText(cdp)).includes("//rueckA");
  }
  if (!redone) {
    const redoProbe = await evaluate(cdp, `({
      focused: document.activeElement === document.querySelector('.monaco-editor textarea'),
      activeElement: document.activeElement?.className || document.activeElement?.tagName,
      activeTab: document.querySelector('.tabs .tab.active .tab-label')?.textContent || '',
      suggest: Boolean(document.querySelector('.suggest-widget.visible')),
    })`);
    assert.fail(
      `Redo hat die Änderung in StateA nicht wiederhergestellt: ${(await editorTextFromTop(cdp)).slice(0, 160)}`
      + ` Diagnose: ${JSON.stringify(redoProbe)}`,
    );
  }

  /**
   * The undo history across a tab switch.
   *
   * The editor is rendered keyed per file, so switching tabs remounts it, and
   * the Monaco React wrapper is documented as disposing the model it holds on
   * unmount unless told to keep it — which nothing here tells it. That reading
   * says the history should be gone after every switch. Measured, it is not:
   * three edits still offer three undo steps after going away and coming back.
   *
   * Since the reading and the behaviour disagree and the behaviour is the one
   * that matters, it is pinned here. Losing an undo history by switching tabs
   * is the quietest way an editor can lose work, and it would otherwise only
   * show up as somebody's afternoon.
   */
  await openByTree(stateA);
  await focusEditor(cdp);
  for (const marker of ["// eins", "// zwei", "// drei"]) {
    await pressChord(cdp, { key: "End", code: "End", vk: 35, modifiers: 2 });
    await typeKeys(cdp, marker);
    await closeSuggestWidget(cdp);
    // Typing is grouped into undo stops by pauses, so each marker needs one.
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  await waitFor(
    async () => (await editorText(cdp)).includes("//eins//zwei//drei"),
    8_000,
    "drei Bearbeitungen für die Undo-Historie",
  );
  await openByTree(stateB);
  await openByTree(stateA);
  await focusEditor(cdp);
  await pressChord(cdp, { key: "Home", code: "Home", vk: 36, modifiers: 2 });
  let undoSteps = 0;
  let previousText = await editorText(cdp);
  for (let step = 0; step < 12; step += 1) {
    await ensureEditorFocus(cdp);
    await pressChord(cdp, { key: "z", code: "KeyZ", vk: 90, modifiers: 2 });
    const now = await editorText(cdp);
    // Counted, not stopped at. An undo stop can restore only the cursor or the
    // selection, and the text is then the same as before — stopping at the
    // first of those counted one step where there were three, and failed a
    // release build for it.
    if (now === previousText) continue;
    undoSteps += 1;
    previousText = now;
  }
  assert.ok(
    undoSteps >= 3,
    `Ein Tabwechsel hat die Undo-Historie gekostet: nur ${undoSteps} Schritte, Text "${previousText.slice(0, 120)}"`,
  );

  // 4. A file deleted while it is open. The tab has to go, and nothing may
  //    write the vanished buffer back to disk afterwards.
  await openByTree(stateB);
  await pressChord(cdp, { key: "s", code: "KeyS", vk: 83, modifiers: 2 });
  await waitFor(async () => (await onDisk(stateB)).includes("// Spur B"), 10_000, "StateB auf der Platte");
  await evaluate(cdp, `window.kiwi.file.delete(${JSON.stringify(stateB)})`, true);
  // The tab stays — closing it is the one thing that would actually lose the
  // text — but it has to say so. An unmarked tab for a file that no longer
  // exists looks exactly like a saved one.
  await waitFor(
    () => evaluate(cdp, `(() => {
      const tab = [...document.querySelectorAll('.tabs .tab')]
        .find(item => item.querySelector('.tab-label')?.textContent === 'StateB.java');
      return Boolean(tab && tab.querySelector('.tab-close.dirty'));
    })()`),
    15_000,
    "Markierung der gelöschten Datei",
  );
  assert.equal(
    await evaluate(cdp, "Boolean(document.querySelector('.monaco-editor'))"),
    true,
    "Nach dem Löschen einer offenen Datei muss der Editor stehen bleiben.",
  );
  // And saving puts it back, which is why the buffer was worth keeping.
  assert.equal(await activeTabName(), "StateB.java", "Die gelöschte Datei muss der aktive Tab bleiben.");
  await focusEditor(cdp);
  await pressChord(cdp, { key: "s", code: "KeyS", vk: 83, modifiers: 2 });
  await waitFor(
    async () => {
      const text = await evaluate(
        cdp,
        `window.kiwi.file.read(${JSON.stringify(stateB)}).then(value => value, () => "")`,
        true,
      );
      return text.includes("// Spur B") ? text : "";
    },
    10_000,
    "wiederhergestellte StateB",
  ).catch(async (error) => {
    // What the application said when it tried, and whether writing the file is
    // possible at all from here. One of those two answers is the fault.
    const state = await evaluate(cdp, `JSON.stringify({
      toasts: [...document.querySelectorAll('.toast')].map(item => (item.textContent || '').slice(0, 120)),
      tab: document.querySelector('.tabs .tab.active .tab-label')?.textContent || '',
      dirty: Boolean(document.querySelector('.tabs .tab.active .tab-close.dirty')),
    })`);
    const direct = await evaluate(
      cdp,
      `window.kiwi.file.write(${JSON.stringify(stateB)}, "direkt").then(() => "geschrieben", reason => String(reason && reason.message || reason))`,
      true,
    );
    throw new Error(`${error.message} Zustand: ${state} Direkt geschrieben: ${JSON.stringify(direct)}`
      + `${rendererNote(cdp)}`);
  });

  // 5. A file changed underneath an open editor.
  //
  // Section 13 of the brief: Kiwi may not quietly write older text over newer.
  // Outside a sharing session it never looked — the save wrote whatever the
  // buffer held, and whoever changed the file had no reason to suspect it.
  await openByTree(stateA);
  await focusEditor(cdp);
  await pressChord(cdp, { key: "s", code: "KeyS", vk: 83, modifiers: 2 });
  await waitFor(
    () => evaluate(cdp, "!document.querySelector('.tabs .tab.active .tab-close.dirty')"),
    10_000,
    "StateA gespeichert vor der externen Änderung",
  );
  await fs.writeFile(stateA, ["public class StateA {", "}", "// von aussen", ""].join("\n"));
  await focusEditor(cdp);
  await pressChord(cdp, { key: "End", code: "End", vk: 35, modifiers: 2 });
  await typeKeys(cdp, "// im Editor");
  await closeSuggestWidget(cdp);
  await pressChord(cdp, { key: "s", code: "KeyS", vk: 83, modifiers: 2 });
  const afterExternal = await waitFor(
    async () => {
      const text = await evaluate(cdp, `window.kiwi.file.read(${JSON.stringify(stateA)})`, true);
      return text.includes("von aussen") || text.includes("im Editor") ? text : "";
    },
    10_000,
    "StateA nach dem Speichern über die externe Änderung",
  );
  assert.ok(
    afterExternal.includes("von aussen"),
    `Eine externe Änderung darf nicht stillschweigend überschrieben werden: ${JSON.stringify(afterExternal)}`,
  );

  // Put the tab strip back. These two files exist for this block alone, and
  // what follows counts tabs — a check that closes "everything to the right"
  // cannot be handed two extra ones it never opened.
  for (const target of [stateA, stateB]) {
    await openByTree(target);
    await focusEditor(cdp);
    await pressChord(cdp, { key: "s", code: "KeyS", vk: 83, modifiers: 2 });
    await waitFor(
      () => evaluate(cdp, "!document.querySelector('.tabs .tab.active .tab-close.dirty')"),
      10_000,
      `${path.basename(target)} gespeichert vor dem Schließen`,
    );
    await clickUntil(
      cdp,
      () => leftClickElement(cdp, ".tabs .tab.active .tab-close"),
      () => evaluate(cdp, `![...document.querySelectorAll('.tabs .tab .tab-label')].some(label => label.textContent === ${JSON.stringify(path.basename(target))})`),
      `${path.basename(target)} geschlossen`,
      10_000,
    );
  }

  // Whitespace a line was given, some seconds later.
  //
  // "Nach ein paar Sekunden löscht er die Tabs, Leerzeichen und
  // Zeilenumbrüche" is a report about time passing rather than about typing,
  // so the text is put on disk exactly as written and then simply opened and
  // left alone. Tabs, a line that is only whitespace, trailing spaces and two
  // consecutive blank lines are each something the editor might decide to
  // tidy away on its own.
  //
  // Typing the text in would prove nothing here: insertText runs every line
  // through auto-indent, so the buffer would differ from the file before any
  // time had passed at all.
  const keepFile = path.join(second, "src", "Whitespace.java");
  const keepSource = [
    "public class Whitespace {",
    "\tvoid keep() {",
    "\t\tint a = 1;   ",
    "\t\t",
    "",
    "",
    "\t\tint b = 2;",
    "\t}",
    "}",
    "",
  ].join("\n");
  await fs.writeFile(keepFile, keepSource);
  await openByTree(keepFile);
  // Long enough to outlast every debounce in the editor: the settled-content
  // pass is a quarter second and auto-save nine tenths of one.
  await new Promise((resolve) => setTimeout(resolve, 6_000));
  // One character at the very end, so the buffer is dirty and can be written.
  // Nothing above the last line is touched, so anything that differs there
  // was changed by the editor and not by this.
  await focusEditor(cdp);
  await pressChord(cdp, { key: "End", code: "End", vk: 35, modifiers: 2 });
  await typeKeys(cdp, "X");
  await closeSuggestWidget(cdp);
  await pressChord(cdp, { key: "s", code: "KeyS", vk: 83, modifiers: 2 });
  const kept = await waitFor(
    () => onDisk(keepFile).then((text) => (text.endsWith("X") ? text : "")),
    10_000,
    "Whitespace-Datei nach dem Speichern",
  );
  assert.equal(
    kept,
    `${keepSource}X`,
    `Der Editor hat den Whitespace verändert: ${JSON.stringify(kept)}`,
  );
  await clickUntil(
    cdp,
    () => leftClickElement(cdp, ".tabs .tab.active .tab-close"),
    () => evaluate(cdp, `![...document.querySelectorAll('.tabs .tab .tab-label')].some(label => label.textContent === ${JSON.stringify(path.basename(keepFile))})`),
    "Whitespace.java geschlossen",
    10_000,
  );

  // Saving with "Importe beim Speichern organisieren", which is on by default.
  //
  // This is the one save-time path the other whitespace probes never reach.
  // It runs only for Java, only on save, and it asks the language server for a
  // code action over the whole file and applies whatever comes back. If that
  // edit spans more than the imports, every whitespace decision the server
  // makes lands on the file — under the name "organise imports".
  //
  // The unused import is what proves the thing ran at all: without it a server
  // that answered nothing would leave the file alone and this would pass while
  // checking nothing.
  const importFile = path.join(second, "src", "Imports.java");
  const importSource = [
    "import java.util.List;",
    "",
    "public class Imports {",
    "\tvoid keep() {",
    "\t\tint a = 1;   ",
    "\t\t",
    "",
    "",
    "\t\tint b = 2;",
    "\t}",
    "}",
    "",
  ].join("\n");
  await fs.writeFile(importFile, importSource);
  await openByTree(importFile);
  await focusEditor(cdp);
  await pressChord(cdp, { key: "End", code: "End", vk: 35, modifiers: 2 });
  await typeKeys(cdp, "X");
  await closeSuggestWidget(cdp);
  await pressChord(cdp, { key: "s", code: "KeyS", vk: 83, modifiers: 2 });
  const organised = await waitFor(
    () => onDisk(importFile).then((text) => (text.endsWith("X") ? text : "")),
    15_000,
    "gespeicherte Datei mit Importen",
  );
  const importsRan = !organised.includes("import java.util.List;");
  trace(`Importe organisiert: ${importsRan} · Whitespace erhalten: ${organised.includes("\t\tint a = 1;   ")}`);
  // Whatever the server did with the imports, it may not have touched the rest.
  assert.ok(
    organised.includes("\t\tint a = 1;   "),
    `Beim Speichern wurden Tabs oder Leerzeichen entfernt: ${JSON.stringify(organised)}`,
  );
  // The class itself, byte for byte. Counting blank lines across the whole
  // file would count the import that organising deliberately removed, and the
  // blank line that belonged to it.
  assert.equal(
    organised,
    [
      "public class Imports {",
      "\tvoid keep() {",
      "\t\tint a = 1;   ",
      "\t\t",
      "",
      "",
      "\t\tint b = 2;",
      "\t}",
      "}",
      "X",
    ].join("\n"),
    `Beim Speichern wurde am Whitespace der Klasse etwas geändert: ${JSON.stringify(organised)}`,
  );
  await clickUntil(
    cdp,
    () => leftClickElement(cdp, ".tabs .tab.active .tab-close"),
    () => evaluate(cdp, `![...document.querySelectorAll('.tabs .tab .tab-label')].some(label => label.textContent === ${JSON.stringify(path.basename(importFile))})`),
    "Imports.java geschlossen",
    10_000,
  );

  // Whitespace that was typed, rather than whitespace that was in the file.
  //
  // The probe above opens a file that already has its tabs and blank lines and
  // shows they survive. That is not the same question: an editor trims the
  // line somebody is leaving, and only typing produces a line that is being
  // left. So the spaces at the end of a line are typed, the caret moves off
  // that line, and the file is read back.
  const typedFile = path.join(second, "src", "Typed.java");
  await fs.writeFile(typedFile, "public class Typed {\n}\n");
  await openByTree(typedFile);
  await focusEditor(cdp);
  await selectAllInEditor(cdp);
  await typeKeys(cdp, "class Typed {");
  await closeSuggestWidget(cdp);
  await pressEnter(cdp);
  await typeKeys(cdp, "int a = 1;   ");
  await closeSuggestWidget(cdp);
  // Leaving the line is the moment a trim would happen.
  await pressEnter(cdp);
  await typeKeys(cdp, "int b = 2;");
  await closeSuggestWidget(cdp);
  await pressChord(cdp, { key: "s", code: "KeyS", vk: 83, modifiers: 2 });
  const typedSaved = await waitFor(
    () => onDisk(typedFile).then((text) => (text.includes("int b = 2;") ? text : "")),
    10_000,
    "getippte Leerzeichen auf der Platte",
  );
  const trailingLine = typedSaved.split("\n").find((line) => line.includes("int a = 1;")) || "";
  trace(`Zeile mit getippten Leerzeichen: ${JSON.stringify(trailingLine)}`);
  assert.ok(
    /int a = 1;[ \t]+$/.test(trailingLine),
    `Die getippten Leerzeichen am Zeilenende wurden entfernt: ${JSON.stringify(typedSaved)}`,
  );
  await clickUntil(
    cdp,
    () => leftClickElement(cdp, ".tabs .tab.active .tab-close"),
    () => evaluate(cdp, `![...document.querySelectorAll('.tabs .tab .tab-label')].some(label => label.textContent === ${JSON.stringify(path.basename(typedFile))})`),
    "Typed.java geschlossen",
    10_000,
  );

  // Indentation somebody chose, once more lines are typed under it.
  //
  // "Das Einrücken von Zeilen resetet sich noch" is about typing rather than
  // about time: the probe above shows that a file left alone keeps what it
  // was given. So a line is pushed past where the editor would have put it,
  // and then the typing simply continues — a second line, a closing brace,
  // the things that make an editor re-decide what a line's indentation ought
  // to be.
  const indentFile2 = path.join(second, "src", "Deep.java");
  await fs.writeFile(indentFile2, "public class Deep {\n}\n");
  await openByTree(indentFile2);
  await focusEditor(cdp);
  await selectAllInEditor(cdp);
  await typeKeys(cdp, "class Deep {");
  await closeSuggestWidget(cdp);
  await pressEnter(cdp);
  // Two tabs past the one the editor supplies on its own.
  await pressKey(cdp, "Tab", "Tab", 9);
  await pressKey(cdp, "Tab", "Tab", 9);
  await typeKeys(cdp, "int deep = 1;");
  await closeSuggestWidget(cdp);
  const deepAfterTyping = await editorText(cdp);
  trace(`Tief eingerückt direkt nach dem Tippen: ${JSON.stringify(deepAfterTyping.slice(0, 120))}`);
  // Another line under it, then the brace that closes the class: both are
  // moments an editor may decide to re-indent what is already there.
  await pressEnter(cdp);
  await typeKeys(cdp, "int next = 2;");
  await closeSuggestWidget(cdp);
  await pressEnter(cdp);
  await typeKeys(cdp, "}");
  await closeSuggestWidget(cdp);
  await pressChord(cdp, { key: "s", code: "KeyS", vk: 83, modifiers: 2 });
  const deepSaved = await waitFor(
    () => onDisk(indentFile2).then((text) => (text.includes("int deep = 1;") ? text : "")),
    10_000,
    "tief eingerückte Datei auf der Platte",
  );
  const deepLine = deepSaved.split("\n").find((line) => line.includes("int deep = 1;")) || "";
  const nextLine = deepSaved.split("\n").find((line) => line.includes("int next = 2;")) || "";
  const indentOf2 = (line) => (line.match(/^[ \t]*/) || [""])[0].length;
  trace(`Einrückung: deep=${indentOf2(deepLine)} next=${indentOf2(nextLine)}`);
  assert.equal(
    indentOf2(deepLine),
    12,
    `Die selbst gewählte Einrückung wurde zurückgesetzt: ${JSON.stringify(deepSaved)}`,
  );
  assert.equal(
    indentOf2(nextLine),
    12,
    `Die nächste Zeile hat die Einrückung der vorigen nicht übernommen: ${JSON.stringify(deepSaved)}`,
  );
  await clickUntil(
    cdp,
    () => leftClickElement(cdp, ".tabs .tab.active .tab-close"),
    () => evaluate(cdp, `![...document.querySelectorAll('.tabs .tab .tab-label')].some(label => label.textContent === ${JSON.stringify(path.basename(indentFile2))})`),
    "Deep.java geschlossen",
    10_000,
  );

  // And the same file written with tabs, because the setting says tabs.
  //
  // "Der Zeilenspeicher soll auch Tabs speichern": the editor inserts spaces
  // by default, and the probe above proves a tab that was already in a file
  // survives. This is the other half — that choosing tabs actually produces
  // them, all the way onto the disk.
  await evaluate(cdp, "window.kiwi.settings.update({ insertSpaces: false })", true);
  await waitFor(
    () => evaluate(cdp, "window.kiwi.settings.get().then(s => String(s.insertSpaces))", true)
      .then((value) => value === "false"),
    10_000,
    "Tabs statt Leerzeichen eingeschaltet",
  );
  const tabFile = path.join(second, "src", "Tabs.java");
  await fs.writeFile(tabFile, "public class Tabs {\n}\n");
  await openByTree(tabFile);
  await focusEditor(cdp);
  await selectAllInEditor(cdp);
  await typeKeys(cdp, "class Tabs {");
  await closeSuggestWidget(cdp);
  await pressEnter(cdp);
  await typeKeys(cdp, "int a = 1;");
  await closeSuggestWidget(cdp);
  await pressChord(cdp, { key: "s", code: "KeyS", vk: 83, modifiers: 2 });
  const tabbed = await waitFor(
    () => onDisk(tabFile).then((text) => (text.includes("int a = 1;") ? text : "")),
    10_000,
    "mit Tabs geschriebene Datei",
  );
  assert.ok(
    tabbed.split("\n").some((line) => line.startsWith("\t") && line.includes("int a = 1;")),
    `Mit "Tabs statt Leerzeichen" muss die Einrückung ein Tabulator sein: ${JSON.stringify(tabbed)}`,
  );
  await evaluate(cdp, "window.kiwi.settings.update({ insertSpaces: true })", true);
  await clickUntil(
    cdp,
    () => leftClickElement(cdp, ".tabs .tab.active .tab-close"),
    () => evaluate(cdp, `![...document.querySelectorAll('.tabs .tab .tab-label')].some(label => label.textContent === ${JSON.stringify(path.basename(tabFile))})`),
    "Tabs.java geschlossen",
    10_000,
  );

  // Moving a tab, and reaching the ones the strip is too narrow to show.
  //
  // The drag is dispatched as the drag events themselves rather than as mouse
  // movement: HTML5 drag-and-drop is driven by the browser's own drag session,
  // which synthesised mouse events do not start. What is under test is what
  // the handlers do with a drop, and that is exactly what this delivers.
  const tabOrder = () => evaluate(
    cdp,
    "JSON.stringify([...document.querySelectorAll('.tabs .tab[data-file-path] .tab-label')].map(item => item.textContent))",
  ).then(JSON.parse);
  const beforeMove = await tabOrder();
  if (beforeMove.length >= 2) {
    const moved = await evaluate(cdp, `(() => {
      const tabs = [...document.querySelectorAll('.tabs .tab[data-file-path]')];
      const first = tabs[0];
      const second = tabs[1];
      const data = new DataTransfer();
      first.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: data }));
      second.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: data }));
      second.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: data }));
      first.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: data }));
      return 'ok';
    })()`);
    assert.equal(moved, "ok", "Der Tab-Drag konnte nicht ausgelöst werden.");
    const afterMove = await waitFor(
      async () => {
        const order = await tabOrder();
        return order[0] === beforeMove[1] && order[1] === beforeMove[0] ? order : null;
      },
      8_000,
      "Tab an die neue Stelle verschoben",
    );
    trace(`Tab-Reihenfolge vorher ${JSON.stringify(beforeMove.slice(0, 3))} nachher ${JSON.stringify(afterMove.slice(0, 3))}`);
  }

  // Narrow the strip until the tabs cannot all be shown, then the arrow.
  await evaluate(cdp, `(() => {
    const strip = document.querySelector('.tabs');
    if (strip) strip.style.maxWidth = '160px';
    return 'ok';
  })()`);
  const overflowCount = await waitFor(
    () => evaluate(cdp, "document.querySelector('.tab-overflow-count')?.textContent || ''"),
    8_000,
    "Pfeil für weitere Tabs",
  );
  assert.ok(Number(overflowCount) > 0, `Der Pfeil muss die Zahl der verdeckten Tabs nennen: ${overflowCount}`);
  await leftClickElement(cdp, ".tab-overflow-button");
  const overflowItems = await waitFor(
    () => evaluate(
      cdp,
      "JSON.stringify([...document.querySelectorAll('.tab-overflow-item')].map(item => ({ name: item.querySelector('.tab-overflow-name')?.textContent || '', schliessen: Boolean(item.querySelector('.tab-overflow-close')), anheften: Boolean(item.querySelector('.tab-overflow-pin')) })))",
    ).then((value) => (JSON.parse(value).length ? JSON.parse(value) : null)),
    8_000,
    "Dropdown mit den weiteren Tabs",
  );
  // Every entry carries the same handles the tab itself has, which is the
  // point of the list: nothing is out of reach because the strip is full.
  assert.ok(
    overflowItems.every((item) => item.name && item.schliessen && item.anheften),
    `Jeder Eintrag braucht Namen, Schließen und Anheften: ${JSON.stringify(overflowItems)}`,
  );
  // Opening one from the list makes it the active tab.
  const chosen = overflowItems[0].name;
  await leftClickElement(cdp, ".tab-overflow-item .tab-overflow-open");
  await waitFor(
    () => evaluate(cdp, `document.querySelector('.tabs .tab.active .tab-label')?.textContent === ${JSON.stringify(chosen)}`),
    8_000,
    "Tab aus dem Dropdown geöffnet",
  );
  await evaluate(cdp, `(() => {
    const strip = document.querySelector('.tabs');
    if (strip) strip.style.maxWidth = '';
    return 'ok';
  })()`);

  // The shortcuts, pressed the way a keyboard sends them.
  //
  // Every one of these is bound in the catalogue and has an effect that can be
  // seen from outside. Checking them one at a time is what turns "the hotkeys
  // do not work" into a list of which ones.
  // The sweep moves the sidebar and the panel around by design. What comes
  // after it expects the workbench it left, so the arrangement is written down
  // here and put back at the end.
  const layoutBeforeHotkeys = JSON.parse(await evaluate(cdp, `JSON.stringify({
    activity: document.querySelector('.activitybar button.active')?.getAttribute('aria-label') || '',
    panel: [...document.querySelectorAll('.panel-tabs button')].find(button => button.classList.contains('active'))?.textContent?.trim() || '',
    sidebar: Boolean(document.querySelector('.sidebar > .sidebar-views')),
  })`));
  const CTRL = 2;
  const CTRL_SHIFT = 10;
  const hotkeyChecks = [
    {
      label: "Ctrl+Shift+P Command Palette",
      chord: { key: "P", code: "KeyP", vk: 80, modifiers: CTRL_SHIFT },
      effect: "Boolean(document.querySelector('.palette'))",
      reset: { key: "Escape", code: "Escape", vk: 27 },
    },
    {
      label: "Ctrl+P Überall suchen",
      chord: { key: "p", code: "KeyP", vk: 80, modifiers: CTRL },
      effect: "Boolean(document.querySelector('.palette'))",
      reset: { key: "Escape", code: "Escape", vk: 27 },
    },
    {
      label: "Ctrl+E Zuletzt geöffnete Dateien",
      chord: { key: "e", code: "KeyE", vk: 69, modifiers: CTRL },
      effect: "Boolean(document.querySelector('.palette'))",
      reset: { key: "Escape", code: "Escape", vk: 27 },
    },
    {
      label: "Ctrl+B Seitenleiste umschalten",
      chord: { key: "b", code: "KeyB", vk: 66, modifiers: CTRL },
      effect: "!document.querySelector('.sidebar > .sidebar-views')",
      reset: { key: "b", code: "KeyB", vk: 66, modifiers: CTRL },
    },
    {
      label: "Ctrl+Shift+M Probleme anzeigen",
      chord: { key: "M", code: "KeyM", vk: 77, modifiers: CTRL_SHIFT },
      effect: "[...document.querySelectorAll('.panel-tabs button')].some(button => button.classList.contains('active') && button.textContent?.includes('PROBLEMS'))",
    },
    {
      label: "Ctrl+Backquote Terminal anzeigen",
      chord: { key: "`", code: "Backquote", vk: 192, modifiers: CTRL },
      effect: "[...document.querySelectorAll('.panel-tabs button')].some(button => button.classList.contains('active') && button.textContent?.includes('TERMINAL'))",
    },
    {
      label: "Ctrl+J Werkzeugfenster umschalten",
      chord: { key: "j", code: "KeyJ", vk: 74, modifiers: CTRL },
      effect: "!document.querySelector('.bottom-panel')",
      reset: { key: "j", code: "KeyJ", vk: 74, modifiers: CTRL },
    },
    {
      label: "Ctrl+N Klasse suchen",
      chord: { key: "n", code: "KeyN", vk: 78, modifiers: CTRL },
      effect: "Boolean(document.querySelector('.palette'))",
      reset: { key: "Escape", code: "Escape", vk: 27 },
    },
    {
      label: "Ctrl+Shift+N Datei suchen",
      chord: { key: "N", code: "KeyN", vk: 78, modifiers: CTRL_SHIFT },
      effect: "Boolean(document.querySelector('.palette'))",
      reset: { key: "Escape", code: "Escape", vk: 27 },
    },
    {
      label: "Ctrl+Shift+O Symbol suchen",
      chord: { key: "O", code: "KeyO", vk: 79, modifiers: CTRL_SHIFT },
      effect: "Boolean(document.querySelector('.palette'))",
      reset: { key: "Escape", code: "Escape", vk: 27 },
    },
    {
      label: "Ctrl+Shift+T TODOs anzeigen",
      chord: { key: "T", code: "KeyT", vk: 84, modifiers: CTRL_SHIFT },
      effect: "[...document.querySelectorAll('.panel-tabs button')].some(button => button.classList.contains('active') && button.textContent?.includes('TODO'))",
    },
    {
      label: "Ctrl+Shift+F In Dateien suchen",
      chord: { key: "F", code: "KeyF", vk: 70, modifiers: CTRL_SHIFT },
      // The label is translated, so the shortcut is measured against both
      // spellings rather than against whichever language the run happens to be in.
      effect: "['Suche', 'Search'].includes(document.querySelector('.activitybar button.active')?.getAttribute('aria-label') || '')",
    },
  ];
  const deadHotkeys = [];
  for (const check of hotkeyChecks) {
    await focusEditor(cdp);
    await closeSuggestWidget(cdp);
    await pressChord(cdp, check.chord);
    const worked = await waitFor(() => evaluate(cdp, check.effect), 3_000, check.label).catch(() => false);
    if (!worked) deadHotkeys.push(check.label);
    if (check.reset) await pressChord(cdp, check.reset);
    // Back to a known state before the next one is measured.
    await waitFor(
      () => evaluate(cdp, "!document.querySelector('.palette')"),
      3_000,
      `${check.label} zurückgesetzt`,
    ).catch(() => undefined);
  }
  if (deadHotkeys.length) {
    const probe = await evaluate(cdp, `JSON.stringify({
      focus: document.activeElement?.className || document.activeElement?.tagName,
      overlays: document.querySelectorAll('.overlay').length,
      sidebar: Boolean(document.querySelector('.sidebar > .sidebar-views')),
      panel: [...document.querySelectorAll('.panel-tabs button')].find(button => button.classList.contains('active'))?.textContent || '',
    })`);
    throw new Error(`Tastenkürzel ohne Wirkung: ${deadHotkeys.join(", ")}. Diagnose: ${probe}${rendererNote(typeof cdp === "undefined" ? null : cdp)}`);
  }

  // Ctrl+, opens the settings in a window of their own, so the effect is a
  // new page target rather than anything in this one.
  await focusEditor(cdp);
  await pressChord(cdp, { key: ",", code: "Comma", vk: 188, modifiers: CTRL });
  const settingsFromShortcut = await waitForTarget("settings", 8_000).catch(() => null);
  if (!settingsFromShortcut) {
    deadHotkeys.push("Ctrl+, Einstellungen");
  } else {
    // Closed again straight away: the settings section further down opens its
    // own window and expects to find none.
    const settingsCdp = await createCdp(settingsFromShortcut.webSocketDebuggerUrl);
    await settingsCdp.send("Runtime.enable");
    await evaluate(settingsCdp, "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    settingsCdp.close();
    await waitFor(async () => !(await listPageTargets()).some((target) => {
      try {
        return new URL(target.url).searchParams.get("window") === "settings";
      } catch {
        return false;
      }
    }), 8_000, "Einstellungsfenster nach der Tastenprobe wieder zu").catch(() => undefined);
  }

  // A Java-only command in a file that is not Java. Doing nothing there is
  // what makes a shortcut look broken: the key is pressed, nothing moves, and
  // the only conclusion available is that the binding is dead.
  // The sweep above left the sidebar on the search view, and a file cannot be
  // clicked in a tree that is not on screen.
  await showExplorer(cdp);
  const notePath = path.join(second, "hinweis.txt");
  // A Windows path inside a CSS attribute selector needs its backslashes
  // doubled, or "\h" is read as an escape and the selector matches nothing.
  const noteSelector = `.tree-row[title="${notePath.replace(/\\/g, "\\\\")}"]`;
  await fs.writeFile(notePath, "Diese Datei ist kein Java.\n", "utf8");
  await waitFor(
    () => evaluate(cdp, `[...document.querySelectorAll('.tree-row')].some(row => row.getAttribute('title') === ${JSON.stringify(notePath)})`),
    15_000,
    "Nicht-Java-Datei im Explorer",
  );
  await leftClickElement(cdp, noteSelector);
  await waitFor(
    () => evaluate(cdp, "[...document.querySelectorAll('.tabs .tab.active')].some(tab => tab.textContent?.includes('hinweis.txt'))"),
    10_000,
    "Nicht-Java-Datei geöffnet",
  );
  await focusEditor(cdp);
  await closeSuggestWidget(cdp);
  await pressChord(cdp, { key: "F7", code: "F7", vk: 118, modifiers: 1 });
  const explained = await waitFor(
    () => evaluate(cdp, "[...document.querySelectorAll('.toast')].some(toast => toast.textContent?.includes('nur in Java-Dateien'))"),
    5_000,
    "Hinweis statt stiller Wirkungslosigkeit",
  ).catch(() => false);
  if (!explained) deadHotkeys.push("Alt+F7 ohne Hinweis in einer Nicht-Java-Datei");
  await leftClickElement(cdp, '.workspace-project-tree.active .tree-row[title$="Beta.java"]');
  await waitFor(
    () => evaluate(cdp, "[...document.querySelectorAll('.tabs .tab.active')].some(tab => tab.textContent?.includes('Beta.java'))"),
    10_000,
    "zurück in der Java-Datei",
  );

  // Whether the caret is where it was left when a file is come back to.
  // Switching tabs and finding the caret at the very start of the file, every
  // time, is the difference between picking work up and looking for it again.
  //
  // Driven from the tab strip: two files are already open here, so the probe
  // needs no fixture of its own and leaves the workbench as it found it.
  const caretPlace = () => evaluate(cdp, `(() => {
    const cursor = document.querySelector('.monaco-editor .cursor');
    const lines = document.querySelector('.monaco-editor .view-lines');
    if (!cursor || !lines) return "";
    // The line the caret sits in, by the band it occupies rather than by its
    // top edge: the caret is repositioned before the line is repainted, and
    // the two edges do not line up during that moment.
    const caretBox = cursor.getBoundingClientRect();
    const middle = caretBox.top + caretBox.height / 2;
    const line = [...lines.querySelectorAll('.view-line')].find(candidate => {
      const box = candidate.getBoundingClientRect();
      return middle >= box.top && middle <= box.bottom;
    });
    return JSON.stringify({
      offsetPx: Math.round(caretBox.left - lines.getBoundingClientRect().left),
      text: (line?.textContent || '').replace(/\u00a0/g, '.'),
    });
  })()`);
  const clickTab = async (name) => {
    const clicked = await evaluate(cdp, `(() => {
      const tab = [...document.querySelectorAll('.tabs .tab')]
        .find(candidate => (candidate.querySelector('.tab-label')?.textContent || '') === ${JSON.stringify(name)});
      tab?.click();
      return Boolean(tab);
    })()`);
    if (!clicked) return false;
    return waitFor(
      () => evaluate(cdp, `[...document.querySelectorAll('.tabs .tab.active .tab-label')].some(label => label.textContent === ${JSON.stringify(name)})`),
      8_000,
      `Tab ${name}`,
    ).catch(() => false);
  };

  const openTabs = JSON.parse(await evaluate(cdp, "JSON.stringify([...document.querySelectorAll('.tabs .tab .tab-label')].map(label => label.textContent || ''))"));
  const otherTab = openTabs.find((name) => name && name !== "Beta.java");
  if (otherTab && await clickTab("Beta.java")) {
    await focusEditor(cdp);
    await selectAllInEditor(cdp);
    // No brackets in the fixture: typing one auto-closes it, and the buffer
    // that produces has several lines that look alike, which is the last thing
    // a measurement of "which line is the caret on" needs.
    await cdp.send("Input.insertText", { text: "// eins\n    // zwei\n        // drei am Ende" });
    // Where the caret settles, not where it is passing through. Inserting
    // three lines moves it twice, and a reading taken between the two is
    // readable, plausible and wrong — it names the line the caret was on a
    // frame ago. Two readings that agree is what "settled" means here.
    let previousReading = "";
    const caretBefore = await waitFor(
      async () => {
        const reading = await caretPlace();
        const parsed = reading ? JSON.parse(reading) : null;
        const usable = parsed && parsed.offsetPx > 0 && parsed.text ? reading : "";
        const settled = usable && usable === previousReading ? usable : "";
        previousReading = usable;
        return settled;
      },
      8_000,
      "Cursor vor dem Tabwechsel",
    );
    // And whether it stays there while nothing is touched. Reported as "after
    // about two seconds the caret goes right to the front": the language
    // server answers in that window, and anything that replaces the buffer
    // when it does would take the caret with it.
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    const caretAfterWaiting = await caretPlace();
    trace(`Cursor nach drei Sekunden Ruhe: ${caretAfterWaiting}`);
    assert.equal(
      JSON.parse(caretAfterWaiting || "{}").text,
      JSON.parse(caretBefore || "{}").text,
      `Der Cursor wanderte, ohne dass etwas passiert ist. Vorher: ${caretBefore} Nachher: ${caretAfterWaiting}`,
    );

    await clickTab(otherTab);
    await clickTab("Beta.java");
    const caretAfter = await waitFor(
      async () => {
        const reading = await caretPlace();
        return reading && JSON.parse(reading).text ? reading : "";
      },
      8_000,
      "Cursor nach dem Tabwechsel",
    );
    trace(`Cursor: ${caretBefore} -> ${caretAfter}`);
    const before = JSON.parse(caretBefore);
    const after = JSON.parse(caretAfter);
    // Coming back to a file used to put the caret at the very beginning of it,
    // so the place being worked at had to be found again on every switch.
    assert.equal(after.text, before.text,
      `Der Cursor stand nach dem Tabwechsel in einer anderen Zeile. Vorher: ${caretBefore} Nachher: ${caretAfter}`);
    assert.ok(after.offsetPx > 0,
      `Der Cursor sprang an den Zeilenanfang. Vorher: ${caretBefore} Nachher: ${caretAfter}`);
  }


  // The same shortcut, pressed while the Explorer has focus rather than the
  // editor. A workbench command that only answers inside the editor is half a
  // command.
  // The sweep above left the sidebar on the search view; the tree has to be
  // back on screen before anything in it can take focus.
  await showExplorer(cdp);
  await waitFor(
    () => evaluate(cdp, "Boolean(document.querySelector('.workspace-project-tree.active .project-heading'))"),
    8_000,
    "Explorer vor der Fokus-Probe",
  );
  // Focused rather than clicked: clicking the heading collapses the tree, and
  // this probe is about the key, not about the mouse.
  await evaluate(cdp, `(() => {
    const heading = document.querySelector('.workspace-project-tree.active .project-heading');
    heading?.focus();
    return document.activeElement === heading;
  })()`);
  await pressChord(cdp, { key: "p", code: "KeyP", vk: 80, modifiers: CTRL });
  const fromTree = await waitFor(
    () => evaluate(cdp, "Boolean(document.querySelector('.palette'))"),
    3_000,
    "Ctrl+P aus dem Explorer",
  ).catch(() => false);
  if (!fromTree) deadHotkeys.push("Ctrl+P mit Fokus im Explorer");
  await pressChord(cdp, { key: "Escape", code: "Escape", vk: 27 });
  // Back to the arrangement the sweep started from, clicked rather than
  // toggled: a toggle depends on where it started, and this must not.
  await evaluate(cdp, `(() => {
    const wanted = ${JSON.stringify(layoutBeforeHotkeys.activity)};
    const button = [...document.querySelectorAll('.activitybar button')]
      .find(item => item.getAttribute('aria-label') === wanted);
    if (button && !button.classList.contains('active')) button.click();
    return true;
  })()`);
  await evaluate(cdp, `(() => {
    const wanted = ${JSON.stringify(layoutBeforeHotkeys.panel)};
    const tab = [...document.querySelectorAll('.panel-tabs button')]
      .find(item => item.textContent?.trim() === wanted);
    if (tab && !tab.classList.contains('active')) tab.click();
    return true;
  })()`);
  await waitFor(
    () => evaluate(cdp, `JSON.stringify({
      activity: document.querySelector('.activitybar button.active')?.getAttribute('aria-label') || '',
      sidebar: Boolean(document.querySelector('.sidebar > .sidebar-views')),
    }) === ${JSON.stringify(JSON.stringify({ activity: layoutBeforeHotkeys.activity, sidebar: layoutBeforeHotkeys.sidebar }))}`),
    8_000,
    "Arbeitsfläche nach der Tastenprobe",
  );

  // The three that change the buffer, measured on a text whose shape is known.
  // Monaco owns Ctrl+D itself, which is exactly why these are worth pressing.
  await focusEditor(cdp);
  await selectAllInEditor(cdp);
  await cdp.send("Input.insertText", { text: "class Probe {\n    int wert = 1;\n}" });
  await closeSuggestWidget(cdp);
  const editorHotkeys = [
    {
      label: "Ctrl+D Zeile duplizieren",
      chord: { key: "d", code: "KeyD", vk: 68, modifiers: CTRL },
      // Counted against what was there a moment ago, not against a fixture
      // whose size was assumed: the buffer has been through several steps by
      // the time it gets here.
      lines: (before, after) => after === before + 1,
    },
    {
      label: "Ctrl+Y Zeile löschen",
      chord: { key: "y", code: "KeyY", vk: 89, modifiers: CTRL },
      lines: (before, after) => after === before - 1,
    },
    {
      label: "Ctrl+7 Kommentar umschalten",
      chord: { key: "7", code: "Digit7", vk: 55, modifiers: CTRL },
      effect: "(document.querySelector('.monaco-editor .view-lines')?.textContent || '').includes('//')",
    },
  ];
  const editorTrace = [];
  const countLines = () => evaluate(cdp, "document.querySelectorAll('.monaco-editor .view-line').length");
  for (const check of editorHotkeys) {
    await focusEditor(cdp);
    await closeSuggestWidget(cdp);
    const before = await countLines();
    await pressChord(cdp, check.chord);
    const worked = await waitFor(
      async () => (check.lines ? check.lines(before, await countLines()) : evaluate(cdp, check.effect)),
      3_000,
      check.label,
    ).catch(() => false);
    editorTrace.push(`${check.label}: ${before}->${await countLines()}${worked ? "" : " FEHLT"}`);
    if (!worked) deadHotkeys.push(check.label);
  }
  if (deadHotkeys.length) {
    // Does the key even arrive? A listener of the test's own, in front of
    // everything, separates "nobody claimed it" from "it never got here".
    await evaluate(cdp, `(() => {
      window.__kiwiKeys = [];
      window.addEventListener("keydown", (event) => {
        window.__kiwiKeys.push([event.key, event.code, event.ctrlKey, event.altKey, event.shiftKey, event.defaultPrevented].join("|"));
      }, true);
      return true;
    })()`);
    await focusEditor(cdp);
    await pressChord(cdp, { key: "d", code: "KeyD", vk: 68, modifiers: 2 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const seenKeys = await evaluate(cdp, "JSON.stringify(window.__kiwiKeys || [])");

    const bound = await evaluate(
      cdp,
      "window.kiwi.settings.get().then(settings => JSON.stringify({ deleteLine: settings.customKeybindings?.deleteLine, keymap: settings.keymap }), reason => String(reason))",
      true,
    );
    // Which side answered the key matters more than that nothing happened:
    // a second cursor means Monaco's own "add selection to next find match"
    // took Ctrl+D, and the workbench never got to claim it.
    const editorProbe = await evaluate(cdp, `JSON.stringify({
      lines: document.querySelectorAll('.monaco-editor .view-line').length,
      cursors: document.querySelectorAll('.monaco-editor .cursor').length,
      selections: document.querySelectorAll('.monaco-editor .selected-text').length,
      editors: document.querySelectorAll('.monaco-editor').length,
      focus: document.activeElement?.className || document.activeElement?.tagName,
    })`);
    throw new Error(`Tastenkürzel ohne Wirkung: ${deadHotkeys.join(", ")}. Puffer: ${(await editorText(cdp)).slice(0, 200)} Editor: ${editorProbe} Einstellung: ${bound} Tasten: ${seenKeys} Verlauf: ${editorTrace.join(" | ")}${rendererNote(typeof cdp === "undefined" ? null : cdp)}`);
  }

  await focusEditor(cdp);
  await cdp.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: "a",
    code: "KeyA",
    windowsVirtualKeyCode: 65,
    modifiers: 2,
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "a",
    code: "KeyA",
    windowsVirtualKeyCode: 65,
    modifiers: 2,
  });
  await cdp.send("Input.insertText", {
    text: "import java.util.List;\nimport java.util.Map;\npublic class Beta { List<String> values; }\n",
  });
  await leftClickElement(cdp, '.editor-actions button[title="Dateiaktionen"]');
  await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('.editor-actions-menu button')]
      .find(item => item.textContent.includes('Imports organisieren'));
    button?.click();
    return Boolean(button);
  })()`);
  await waitFor(
    () => evaluate(cdp, "!document.querySelector('.view-lines')?.textContent?.includes('java.util.Map')"),
    12_000,
    "automatic organize imports",
  );
  assert.equal(
    await evaluate(cdp, "Boolean(document.querySelector('.refactor-preview-document'))"),
    false,
    "Organize Imports unexpectedly opened a confirmation preview.",
  );
  await cdp.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: "s",
    code: "KeyS",
    windowsVirtualKeyCode: 83,
    modifiers: 2,
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "s",
    code: "KeyS",
    windowsVirtualKeyCode: 83,
    modifiers: 2,
  });
  await waitFor(
    () => evaluate(cdp, `window.kiwi.file.read(${JSON.stringify(path.join(second, "src", "Beta.java"))}).then(source =>
      source.includes("java.util.List") && !source.includes("java.util.Map"))`, true),
    8_000,
    "organized imports saved without confirmation",
  );

  await evaluate(cdp, "window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', ctrlKey: true, bubbles: true }))");
  const editorCdp = cdp;
  const settingsTarget = await waitForTarget("settings", 10_000);
  cdp = await createCdp(settingsTarget.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  await waitFor(() => evaluate(cdp, "Boolean(document.querySelector('.settings-window-shell .settings-document'))"), 10_000, "standalone settings window");
  assert.equal(await evaluate(cdp, "new URLSearchParams(location.search).get('window')"), "settings");
  assert.equal(await evaluate(cdp, `new URLSearchParams(location.search).get('projectRoot') === ${JSON.stringify(second)}`), true);
  assert.equal(await evaluate(editorCdp, "[...document.querySelectorAll('.workbench-tab')].every(tab => !tab.textContent.includes('Einstellungen'))"), true);
  assert.equal(await evaluate(cdp, "Boolean(document.querySelector('.settings-document .settings-modal'))"), true);
  assert.equal(await evaluate(cdp, "Boolean(document.querySelector('.settings-document .overlay, .settings-document .modal-backdrop'))"), false);
  await waitFor(
    () => evaluate(cdp, "document.querySelectorAll('.settings-sdk-picker')[1]?.querySelectorAll('option').length > 1"),
    8_000,
    "detected project JDK choices",
  );
  const availableJdks = await evaluate(cdp, `({
    global: document.querySelectorAll('.settings-sdk-picker')[0]?.querySelectorAll('option').length || 0,
    project: document.querySelectorAll('.settings-sdk-picker')[1]?.querySelectorAll('option').length || 0,
    effective: document.querySelector('.settings-sdk-effective')?.textContent || ''
  })`);
  assert.ok(availableJdks.global > 1, `No detected global JDK choices: ${JSON.stringify(availableJdks)}`);
  assert.ok(availableJdks.project > 1, `No detected project JDK choices: ${JSON.stringify(availableJdks)}`);
  assert.match(availableJdks.effective, /Effektiv:/);
  assert.equal(
    await evaluate(cdp, `(() => {
      const projectPicker = document.querySelectorAll('.settings-sdk-picker')[1];
      const add = projectPicker?.querySelector('.settings-sdk-add');
      const rect = add?.getBoundingClientRect();
      return Boolean(rect && rect.width >= 120 && rect.height <= 36)
        && getComputedStyle(add).whiteSpace === 'nowrap';
    })()`),
    true,
    "Project SDK add button is clipped or wrapped.",
  );
  await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('.settings-categories button')]
      .find(item => item.textContent.trim() === 'Editor');
    button?.click();
    return Boolean(button);
  })()`);
  await waitFor(
    () => evaluate(cdp, "document.querySelectorAll('.settings-font-picker select option').length >= 5"),
    8_000,
    "installed system-font dropdown",
  );
  const fontPicker = await evaluate(cdp, `(() => {
    const picker = document.querySelector('.settings-font-picker');
    const select = picker?.querySelector('select');
    return {
      select: Boolean(select),
      freeText: Boolean(picker?.querySelector('input[type="text"]')),
      options: [...(select?.options || [])].map(option => option.value),
      fallbacks: picker?.querySelector('small')?.textContent || '',
    };
  })()`);
  assert.equal(fontPicker.select, true, "Editor font must be selected from a dropdown.");
  assert.equal(fontPicker.freeText, false, "The old comma-separated free-text font field is still visible.");
  assert.ok(fontPicker.options.includes("Consolas"), `System font list misses Consolas: ${JSON.stringify(fontPicker)}`);
  assert.match(fontPicker.fallbacks, /Fallbacks:/);
  await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('.settings-categories button')]
      .find(item => item.textContent.trim() === 'Java & SDKs');
    button?.click();
    return Boolean(button);
  })()`);
  // Every part this check reads has to be on screen; without saying which one
  // is missing, a null here surfaces as a bare "Uncaught" from the renderer.
  const backgroundParts = JSON.parse(await evaluate(editorCdp, `JSON.stringify(
    Object.fromEntries(['.app-shell', '.editor-container', '.monaco-editor', '.terminal', '.virtual-tree-viewport', '.workspace-project-tree .project-heading']
      .map(selector => [selector, Boolean(document.querySelector(selector))])))`));
  const missingParts = Object.entries(backgroundParts).filter(([, present]) => !present).map(([selector]) => selector);
  assert.equal(missingParts.length, 0, `Für die Hintergrundprüfung fehlt: ${missingParts.join(", ")}`);
  assert.equal(
    await evaluate(editorCdp, `(() => {
      const shell = document.querySelector('.app-shell');
      const layer = getComputedStyle(shell, '::before');
      const editorBackground = getComputedStyle(document.querySelector('.editor-container')).backgroundColor;
      const monacoBackground = getComputedStyle(document.querySelector('.monaco-editor')).backgroundColor;
      const terminalBackground = getComputedStyle(document.querySelector('.terminal')).backgroundColor;
      const explorerBackground = getComputedStyle(document.querySelector('.virtual-tree-viewport')).backgroundColor;
      const projectHeadingBackground = getComputedStyle(document.querySelector('.workspace-project-tree .project-heading')).backgroundColor;
      const isTransparent = color => color === 'transparent' || color === 'rgba(0, 0, 0, 0)';
      return shell.classList.contains('has-workspace-background')
        && shell.style.getPropertyValue('--workspace-background-image').includes('data:image/png;base64')
        && layer.backgroundImage !== 'none'
        // The picture scales with the window rather than being cropped to fill
        // it, so a window that is not full screen shows the whole image.
        && layer.backgroundSize === 'contain'
        && layer.zIndex === '0'
        && Number(layer.opacity) === .4
        && isTransparent(editorBackground)
        && isTransparent(monacoBackground)
        && isTransparent(terminalBackground)
        && isTransparent(explorerBackground)
        && isTransparent(projectHeadingBackground);
    })()`),
    true,
    "Workspace background layer is not visible through editor, terminal and Explorer surfaces.",
  );
  await evaluate(editorCdp, `(() => {
    const fileButton = [...document.querySelectorAll('.menu-nav > .menu-item-wrap > button')]
      .find(button => button.textContent.trim() === 'Datei');
    fileButton?.click();
    return Boolean(fileButton);
  })()`);
  await waitFor(
    () => evaluate(editorCdp, "Boolean(document.querySelector('.menu-dropdown'))"),
    3_000,
    "main menu dropdown",
  );
  assert.equal(
    await evaluate(editorCdp, `(() => {
      const menu = document.querySelector('.menu-dropdown');
      const rect = menu.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + Math.min(12, rect.height / 2));
      const titlebarZ = Number(getComputedStyle(document.querySelector('.titlebar')).zIndex);
      const workspaceZ = Number(getComputedStyle(document.querySelector('.workspace')).zIndex);
      return rect.width > 0
        && rect.height > 0
        && menu.contains(hit)
        && titlebarZ > workspaceZ;
    })()`),
    true,
    "Main menu dropdown is painted behind the toolbar, Explorer or editor.",
  );
  await evaluate(editorCdp, "document.querySelector('.menu-nav > .menu-item-wrap > button')?.click()");
  await evaluate(cdp, `(() => {
    const row = [...document.querySelectorAll('.setting-row')]
      .find(item => item.querySelector('strong')?.textContent === 'Java Language Level');
    const select = row?.querySelector('select');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(select, '17');
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return Boolean(select);
  })()`);
  await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('.settings-categories button')]
      .find(item => item.textContent.trim() === 'Explorer');
    button?.click();
    return Boolean(button);
  })()`);
  await evaluate(cdp, `(() => {
    const row = [...document.querySelectorAll('.setting-row')]
      .find(item => item.querySelector('strong')?.textContent === 'Darstellung');
    const select = row?.querySelector('select');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(select, 'packages');
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return Boolean(select);
  })()`);
  const stagedSettings = await evaluate(cdp, `Promise.all([
    window.kiwi.project.getSettings(${JSON.stringify(second)}),
    window.kiwi.settings.get()
  ]).then(([project, global]) => ({
    projectLanguage: project.languageLevel,
    explorerView: global.explorerView,
    applyEnabled: !document.querySelector('.settings-apply-bar .primary-button')?.disabled
  }))`, true);
  assert.deepEqual(stagedSettings, { projectLanguage: "21", explorerView: "folders", applyEnabled: true });
  await leftClickElement(cdp, ".settings-apply-bar .primary-button");
  await waitFor(
    () => evaluate(cdp, `Promise.all([
      window.kiwi.project.getSettings(${JSON.stringify(second)}),
      window.kiwi.settings.get()
    ]).then(([project, global]) => project.languageLevel === "17" && global.explorerView === "packages")`, true),
    20_000,
    "applied global and project settings",
  );
  await waitFor(
    () => evaluate(cdp, "document.querySelector('.settings-apply-bar > span')?.textContent.trim() === 'Alle Einstellungen sind gespeichert'"),
    30_000,
    "settings apply completion",
  );
  await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('.settings-categories button')]
      .find(item => item.textContent.trim() === 'Darstellung');
    button?.click();
    return Boolean(button);
  })()`);
  await evaluate(cdp, `(() => {
    const row = [...document.querySelectorAll('.setting-row')]
      .find(item => item.querySelector('strong')?.textContent === 'Theme');
    const select = row?.querySelector('select');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(select, 'kiwi-light');
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return Boolean(select);
  })()`);
  await leftClickElement(cdp, ".settings-apply-bar .primary-button");
  // The theme drives the whole palette through the data-theme attribute, so
  // assert on the attribute and on a colour that actually has to invert.
  await waitFor(
    () => evaluate(cdp, `(() => {
      if (document.documentElement.getAttribute('data-theme') !== 'kiwi-light') return false;
      // Read as a painted colour, not as the text of the variable: the anchors
      // are a colour-mix now so a theme can be nudged, and an unregistered
      // custom property keeps its expression rather than resolving to a hex.
      const probe = document.createElement('div');
      probe.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;background:var(--panel-base)';
      document.body.appendChild(probe);
      const painted = getComputedStyle(probe).backgroundColor;
      probe.remove();
      // A colour-mix result is serialised in the mixing space, so this can
      // come back as color(srgb 1 1 1) rather than rgb(255, 255, 255). The
      // numbers are compared instead of the spelling.
      const parts = painted.split(/[^0-9.]+/).filter(Boolean).slice(0, 3).map(Number);
      if (parts.length < 3) return false;
      const scale = painted.startsWith('color(') ? 1 : 255;
      return parts.every((value) => value >= scale * 0.98);
    })()`),
    8_000,
    "light theme applied",
  ).catch(async (error) => {
    const probe = await evaluate(cdp, `JSON.stringify((() => {
      const node = document.createElement('div');
      node.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;background:var(--panel-base)';
      document.body.appendChild(node);
      const painted = getComputedStyle(node).backgroundColor;
      node.remove();
      const root = getComputedStyle(document.documentElement);
      return {
        theme: document.documentElement.getAttribute('data-theme'),
        painted,
        panelBase: root.getPropertyValue('--panel-base').trim().slice(0, 120),
        panelBaseSource: root.getPropertyValue('--panel-base-source').trim(),
        shade: root.getPropertyValue('--theme-shade').trim(),
        tint: root.getPropertyValue('--theme-tint').trim(),
        accent: root.getPropertyValue('--accent').trim(),
      };
    })())`);
    throw new Error(`${error.message} Diagnose: ${probe}${rendererNote(typeof cdp === "undefined" ? null : cdp)}`);
  });
  // Derived colours resolve to color(srgb …) rather than rgb(…), so measure the
  // luminance instead of comparing against literals that can no longer occur.
  const lightSurface = await evaluate(cdp, `(() => {
    const color = getComputedStyle(document.querySelector('.settings-window-content')).backgroundColor;
    const srgb = color.match(/color\\(srgb ([\\d.]+) ([\\d.]+) ([\\d.]+)/);
    const rgb = color.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
    const channels = srgb
      ? [srgb[1], srgb[2], srgb[3]].map(Number)
      : rgb ? [rgb[1], rgb[2], rgb[3]].map((value) => Number(value) / 255) : null;
    if (!channels) return { color, luminance: null };
    return { color, luminance: 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2] };
  })()`);
  assert.notEqual(lightSurface.luminance, null, `Unparsable surface colour: ${lightSurface.color}`);
  assert.ok(
    lightSurface.luminance > 0.6,
    `Light theme still uses a dark surface: ${lightSurface.color} (luminance ${lightSurface.luminance})`,
  );
  await evaluate(cdp, `(() => {
    const row = [...document.querySelectorAll('.setting-row')]
      .find(item => item.querySelector('strong')?.textContent === 'Theme');
    const select = row?.querySelector('select');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(select, 'kiwi-new-dark');
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return Boolean(select);
  })()`);
  await leftClickElement(cdp, ".settings-apply-bar .primary-button");
  await waitFor(
    () => evaluate(cdp, "document.documentElement.getAttribute('data-theme') === 'kiwi-new-dark'"),
    8_000,
    "dark theme restored",
  );
  const settingsCategories = await evaluate(cdp, "[...document.querySelectorAll('.settings-categories button')].map(button => button.textContent.trim())");
  assert.deepEqual(settingsCategories, [
    "Java & SDKs",
    "Sprachen & Sprachserver",
    "Editor",
    "Autocomplete",
    "Darstellung",
    "Build Tools",
    "Explorer",
    "Run & Debug",
    "Terminal & Keymap",
    // Accounts used to hang off a bare icon at the foot of the activity bar.
    "Konten",
    "Updates & Datenschutz",
  ]);
  for (const category of settingsCategories) {
    await evaluate(cdp, `(() => {
      const button = [...document.querySelectorAll('.settings-categories button')]
        .find(item => item.textContent.trim() === ${JSON.stringify(category)});
      button?.click();
      return Boolean(button);
    })()`);
    await waitFor(
      () => evaluate(cdp, `document.querySelector('.settings-categories button.active')?.textContent.trim() === ${JSON.stringify(category)}
        && document.querySelectorAll('.settings-content section .setting-row, .settings-content section .settings-section').length > 0`),
      3_000,
      `settings category ${category}`,
    );
  }
  // Which version is running has to be readable without leaving the settings:
  // it is the first thing a bug report asks for.
  await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('.settings-categories button')]
      .find(item => item.textContent.trim() === 'Updates & Datenschutz');
    button?.click();
    return Boolean(button);
  })()`);
  const shownVersion = await waitFor(
    () => evaluate(cdp, "document.querySelector('.settings-version strong')?.textContent || ''"),
    5_000,
    "version in the settings",
  );
  assert.match(shownVersion, /^Kiwi IDE \d+\.\d+\.\d+/);
  const shownRuntime = await evaluate(cdp, "[...document.querySelectorAll('.settings-version span')].map(item => item.textContent).join(' | ')");
  assert.match(shownRuntime, /Electron/);

  await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('.settings-categories button')]
      .find(item => item.textContent.trim() === 'Terminal & Keymap');
    button?.click();
    return Boolean(button);
  })()`);
  await waitFor(
    () => evaluate(cdp, "document.querySelector('.settings-categories button.active')?.textContent.trim() === 'Terminal & Keymap'"),
    3_000,
    "keymap settings category",
  );
  // Shortcuts are recorded by pressing them, so the capture button has to be
  // focused first and then receive the real key event.
  const captureStarted = await evaluate(cdp, `(() => {
    const label = [...document.querySelectorAll('.keybinding-grid label')]
      .find(item => item.querySelector('span')?.textContent === 'Java-Code generieren');
    const capture = label?.querySelector('.keybinding-capture');
    capture?.click();
    return Boolean(capture);
  })()`);
  assert.equal(captureStarted, true, "Keybinding capture button was not found.");
  await waitFor(
    () => evaluate(cdp, "Boolean(document.querySelector('.keybinding-capture.recording'))"),
    3_000,
    "keybinding capture mode",
  );
  await evaluate(cdp, `(() => {
    const capture = document.querySelector('.keybinding-capture.recording');
    capture?.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'g', code: 'KeyG', ctrlKey: true, altKey: true, bubbles: true,
    }));
    return Boolean(capture);
  })()`);
  await waitFor(
    () => evaluate(cdp, `[...document.querySelectorAll('.keybinding-capture')]
      .some(button => button.textContent.trim() === 'Ctrl+Alt+G')`),
    3_000,
    "recorded shortcut shown in the settings",
  );
  await leftClickElement(cdp, ".settings-apply-bar .primary-button");
  // Asked of the editor window, not of the settings window that was just told
  // to apply. Settings are global, so either window can answer — but only one
  // of them is at risk of closing while the question is in flight, and the
  // answer then reads as "the DevTools target was closed" rather than as
  // anything about the setting.
  await waitFor(
    () => evaluate(editorCdp, "window.kiwi.settings.get().then(settings => settings.customKeybindings.generate === 'Ctrl+Alt+G')", true),
    8_000,
    "custom Java generation shortcut applied",
  );
  assert.equal(
    await evaluate(cdp, "document.querySelector('.settings-apply-error')?.textContent || ''"),
    "",
    "Settings apply reported an error.",
  );
  await evaluate(cdp, "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  await waitFor(async () => !(await listPageTargets()).some((target) => {
    try {
      return new URL(target.url).searchParams.get("window") === "settings";
    } catch {
      return false;
    }
  }), 5_000, "Escape closes settings window");
  cdp.close();
  cdp = editorCdp;
  assert.equal(await evaluate(cdp, "[...document.querySelectorAll('.workbench-tab')].every(tab => !tab.textContent.includes('Einstellungen'))"), true);
  await focusEditor(cdp);
  await cdp.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: "g",
    code: "KeyG",
    windowsVirtualKeyCode: 71,
    modifiers: 1 | 2,
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "g",
    code: "KeyG",
    windowsVirtualKeyCode: 71,
    modifiers: 1 | 2,
  });
  await waitFor(
    () => evaluate(cdp, "document.querySelector('.palette-input input')?.value === 'generieren'"),
    5_000,
    "custom Java generation shortcut",
  );
  await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  for (const directory of [
    path.join(second, "src"),
    path.join(second, "src", "main"),
    path.join(second, "src", "main", "java"),
  ]) {
    await waitFor(
      () => evaluate(cdp, `Boolean([...document.querySelectorAll('.tree-row')].find(row => row.title === ${JSON.stringify(directory)}))`),
      5_000,
      `Explorer directory ${directory}`,
    );
    await evaluate(cdp, `(() => {
      const row = [...document.querySelectorAll('.tree-row')].find(item => item.title === ${JSON.stringify(directory)});
      if (row?.getAttribute('aria-expanded') !== 'true') row?.click();
      return Boolean(row);
    })()`);
  }
  const firstPackageDirectory = path.join(second, "src", "main", "java", "de");
  await waitFor(
    () => evaluate(cdp, `Boolean([...document.querySelectorAll('.tree-row')].find(row => row.title === ${JSON.stringify(firstPackageDirectory)}))`),
    5_000,
    "first compact package node",
  );
  await evaluate(cdp, `(() => {
    const row = [...document.querySelectorAll('.tree-row')].find(item => item.title === ${JSON.stringify(firstPackageDirectory)});
    row?.click();
    return Boolean(row);
  })()`);
  await waitFor(
    () => evaluate(cdp, `(() => {
      const row = [...document.querySelectorAll('.tree-row')]
        .find(item => item.title === ${JSON.stringify(compactPackage)});
      const file = [...document.querySelectorAll('.tree-row')]
        .find(item => item.title === ${JSON.stringify(path.join(compactPackage, "CoreAPI.java"))});
      return row?.getAttribute('aria-expanded') === 'true'
        && row?.querySelector('.tree-label')?.textContent === 'de.rauchigesetwas.player.spigot'
        && Boolean(file);
    })()`),
    8_000,
    "stable expanded compact package chain",
  );

  for (const fileName of ["Marker.java", "Worker.java"]) {
    await evaluate(cdp, `(() => {
      const row = [...document.querySelectorAll('.tree-row')].find(item => item.title?.endsWith(${JSON.stringify(fileName)}));
      row?.click();
      row?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      return Boolean(row);
    })()`);
    await waitFor(
      () => evaluate(cdp, `[...document.querySelectorAll('.tabs .tab')].some(tab => tab.title?.endsWith(${JSON.stringify(fileName)}))`),
      5_000,
      `open tab ${fileName}`,
    );
  }
  const tabsBeforeCloseRight = await evaluate(cdp, "[...document.querySelectorAll('.tabs .tab')].map(tab => tab.dataset.filePath)");
  assert.ok(tabsBeforeCloseRight.length >= 2, `Not enough tabs for close-right test: ${JSON.stringify(tabsBeforeCloseRight)}`);
  await rightClickElement(cdp, ".tabs .tab");
  await waitFor(() => evaluate(cdp, "Boolean(document.querySelector('.tab-context-menu'))"), 3_000, "tab context menu");
  const contextTabPath = await evaluate(cdp, "document.querySelector('.tab-context-menu')?.dataset.contextPath");
  const targetTabIndex = tabsBeforeCloseRight.indexOf(contextTabPath);
  assert.ok(targetTabIndex >= 0, `Context menu target is not an open tab: ${contextTabPath}`);
  const tabMenuLabels = await evaluate(cdp, "[...document.querySelectorAll('.tab-context-menu button')].map(button => button.textContent.trim())");
  assert.deepEqual(tabMenuLabels, [
    "Fenster schließenCtrl+F4",
    "Alle anderen Fenster schließen",
    "Alle linken Fenster schließen",
    "Alle rechten Fenster schließen",
    "Alle Fenster schließen",
  ]);
  // Assert against the path carried by the menu itself instead of assuming the
  // first CSS match remained the first tab throughout an asynchronous open.
  // Double-click file opening is deduplicated in the UI, so a late duplicate
  // file read cannot resurrect one of the tabs after this action.
  await clickUntil(
    cdp,
    async () => {
      const clicked = await evaluate(cdp, `(() => {
        const button = [...document.querySelectorAll('.tab-context-menu button')]
          .find(item => item.textContent.includes('Alle rechten Fenster schließen'));
        button?.click();
        return Boolean(button);
      })()`);
      if (!clicked) {
        // The menu was opened from the first tab; after closing tabs to its
        // right that same tab remains first, so this selector is path-safe on
        // Windows as well (backslashes need special escaping in CSS values).
        await rightClickElement(cdp, ".tabs .tab");
      }
    },
    () => evaluate(cdp, `${JSON.stringify(tabsBeforeCloseRight.slice(targetTabIndex + 1))}.every(path =>
      ![...document.querySelectorAll('.tabs .tab')].some(tab => tab.dataset.filePath === path))`),
    "close all tabs to the right",
  );

  await leftClickElement(cdp, ".toolbar-overflow > button");
  await waitFor(() => evaluate(cdp, "Boolean(document.querySelector('.toolbar-overflow-menu'))"), 3_000, "toolbar overflow menu");
  assert.equal(
    await evaluate(cdp, `(() => {
      const menu = document.querySelector('.toolbar-overflow-menu');
      const rect = menu.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + Math.min(12, rect.height / 2));
      const toolbarZ = Number(getComputedStyle(document.querySelector('.main-toolbar')).zIndex);
      const workspaceZ = Number(getComputedStyle(document.querySelector('.workspace')).zIndex);
      return menu.contains(hit) && toolbarZ > workspaceZ;
    })()`),
    true,
    "Toolbar menu is painted behind the Explorer or editor.",
  );
  await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('.toolbar-overflow-menu button')].find(item => item.textContent.includes('Neues Projekt'));
    button?.click();
    return Boolean(button);
  })()`);
  const wizardTarget = await waitForTarget("wizard", 5_000).catch(() => null);
  if (wizardTarget) {
    const wizardCdp = await createCdp(wizardTarget.webSocketDebuggerUrl);
    await wizardCdp.send("Runtime.enable");
    await waitFor(() => evaluate(wizardCdp, "document.readyState === 'complete' && Boolean(document.querySelector('.project-wizard'))"), 5_000, "project wizard standalone window");
    await evaluate(wizardCdp, "window.kiwi?.app.close(); true");
    wizardCdp.close();
  } else {
    await waitFor(() => evaluate(cdp, "Boolean(document.querySelector('.assistant-side-panel .project-wizard'))"), 3_000, "project wizard side panel");
    await evaluate(cdp, "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    await waitFor(() => evaluate(cdp, "!document.querySelector('.assistant-side-panel')"), 3_000, "Escape closes assistant side panel");
  }

  await rightClickElement(cdp, '.workspace-project-tree.active .tree-row[title$="src"]');
  await waitFor(() => evaluate(cdp, "Boolean(document.querySelector('.explorer-context-menu'))"), 5_000, "Explorer context menu");
  const menuText = await evaluate(cdp, "document.querySelector('.explorer-context-menu').textContent");
  for (const item of ["Neu", "Ausschneiden", "Kopieren", "Einfügen", "Refactor", "Pfad kopieren", "Git", "Weitere Aktionen"]) {
    assert.match(menuText, new RegExp(item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  const menuLayout = await evaluate(cdp, `(() => {
    const menu = document.querySelector('.explorer-context-menu');
    const rect = menu.getBoundingClientRect();
    return {
      visible: getComputedStyle(menu).display !== 'none' && rect.width > 0 && rect.height > 0,
      insideViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth + 0.5 && rect.bottom <= innerHeight + 0.5,
      target: menu.dataset.contextNode
    };
  })()`);
  assert.equal(menuLayout.visible, true);
  assert.equal(menuLayout.insideViewport, true);
  assert.match(menuLayout.target, /[\\/]src$/);

  await leftClickElement(cdp, '[data-explorer-submenu="new"]');
  await waitFor(
    () => evaluate(cdp, "Boolean(document.querySelector('.explorer-submenu-portal[data-submenu=\"new\"]'))"),
    3_000,
    "Explorer new submenu",
  );
  const newMenuText = await evaluate(cdp, "document.querySelector('.explorer-submenu-portal').textContent");
  for (const item of ["Java Class", "Package", "Datei", "Verzeichnis", "module-info.java", "Modul"]) {
    assert.match(newMenuText, new RegExp(item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  // Creating a class is the common case, so it has to lead the submenu.
  const newMenuOrder = await evaluate(cdp, "[...document.querySelectorAll('.explorer-submenu-portal button')].map(item => item.querySelector('span')?.textContent || '')");
  assert.deepEqual(newMenuOrder.slice(0, 4), ["Java Class", "Package", "Datei", "Verzeichnis"]);
  const submenuLayout = await evaluate(cdp, `(() => {
    const submenu = document.querySelector('.explorer-submenu-portal');
    const rect = submenu.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.top >= 0
      && rect.right <= innerWidth + 0.5 && rect.bottom <= innerHeight + 0.5;
  })()`);
  assert.equal(submenuLayout, true);

  await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('.explorer-submenu-portal button')]
      .find(item => item.textContent.includes('Java Class'));
    button?.click();
    return Boolean(button);
  })()`);
  await waitFor(() => evaluate(cdp, "Boolean(document.querySelector('.java-type-dialog'))"), 3_000, "Java type dialog");
  const javaTypeDialog = await evaluate(cdp, `({
    choices: [...document.querySelectorAll('.java-quick-kinds button > span:nth-child(2)')].map(item => item.textContent),
    hasNameInput: Boolean(document.querySelector('.java-quick-name input')),
    advancedInitiallyHidden: !document.querySelector('.java-quick-options'),
    width: document.querySelector('.java-type-dialog')?.getBoundingClientRect().width || 0
  })`);
  assert.deepEqual(javaTypeDialog.choices, ["Klasse", "Interface", "Record", "Enum", "Annotation", "Exception", "JUnit-Test"]);
  assert.equal(javaTypeDialog.hasNameInput, true);
  assert.equal(javaTypeDialog.advancedInitiallyHidden, true);
  assert.ok(javaTypeDialog.width <= 380, `Java type popup is too wide: ${javaTypeDialog.width}`);
  await leftClickElement(cdp, ".java-advanced-toggle");
  const javaAdvancedOptions = await evaluate(cdp, `({
    hasBaseClass: Boolean(document.querySelector('.java-quick-options input[placeholder*="BaseService"]')),
    hasInterfaces: Boolean(document.querySelector('.java-quick-options input[placeholder*="Runnable"]'))
  })`);
  assert.equal(javaAdvancedOptions.hasBaseClass, true);
  assert.equal(javaAdvancedOptions.hasInterfaces, true);
  const createdType = await evaluate(cdp, `(() => {
    const input = document.querySelector('.java-quick-name input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'SmokeGenerated');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.java-type-dialog .primary-button').click();
    return true;
  })()`);
  assert.equal(createdType, true);
  await waitFor(() => evaluate(cdp, "!document.querySelector('.java-type-dialog')"), 5_000, "Java type creation");
  await waitFor(
    () => evaluate(cdp, "Boolean(document.querySelector('.workspace-project-tree.active .tree-row[title$=\"SmokeGenerated.java\"]'))"),
    5_000,
    "created Java type in Explorer",
  );
  const sourceTreeStayedOpen = await evaluate(cdp, `(() => {
    const file = document.querySelector('.workspace-project-tree.active .tree-row[title$="SmokeGenerated.java"]');
    const source = [...document.querySelectorAll('.workspace-project-tree.active .tree-row')]
      .find(item => /[\\\\/]src$/.test(item.getAttribute('title') || ''));
    return Boolean(file && source && source.getAttribute('aria-expanded') === 'true');
  })()`);
  assert.equal(sourceTreeStayedOpen, true, "Explorer source branch collapsed after Java type creation");

  await rightClickElement(cdp, '.workspace-project-tree.active .tree-row[title$="src"]');
  await waitFor(() => evaluate(cdp, "Boolean(document.querySelector('.explorer-context-menu'))"), 3_000, "Explorer context menu for package");
  await leftClickElement(cdp, '[data-explorer-submenu="new"]');
  await waitFor(
    () => evaluate(cdp, "Boolean(document.querySelector('.explorer-submenu-portal[data-submenu=\"new\"]'))"),
    3_000,
    "Explorer new submenu for package",
  );
  await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('.explorer-submenu-portal button')]
      .find(item => item.textContent.trim() === 'Package');
    button?.click();
    return Boolean(button);
  })()`);
  await waitFor(() => evaluate(cdp, "Boolean(document.querySelector('.quick-input-popover'))"), 3_000, "compact package popup");
  const packagePopup = await evaluate(cdp, `({
    title: document.querySelector('.quick-input-header')?.textContent?.trim() || '',
    width: document.querySelector('.quick-input-popover')?.getBoundingClientRect().width || 0,
    centerDelta: Math.abs(
      (document.querySelector('.quick-input-popover')?.getBoundingClientRect().top || 0)
      + (document.querySelector('.quick-input-popover')?.getBoundingClientRect().height || 0) / 2
      - window.innerHeight / 2
    ),
    hasInput: Boolean(document.querySelector('.quick-input-popover input')),
    hasDialogFooter: Boolean(document.querySelector('.quick-input-popover .modal-footer'))
  })`);
  assert.match(packagePopup.title, /Neues Package/);
  assert.ok(packagePopup.width <= 380, `Package popup is too wide: ${packagePopup.width}`);
  assert.ok(packagePopup.centerDelta <= 4, `Package popup is not vertically centered: ${packagePopup.centerDelta}`);
  assert.equal(packagePopup.hasInput, true);
  assert.equal(packagePopup.hasDialogFooter, false);
  await evaluate(cdp, "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  await waitFor(() => evaluate(cdp, "!document.querySelector('.quick-input-popover')"), 3_000, "package popup close");

  await rightClickElement(cdp, ".workspace-project-tree.active .tree-row");
  await waitFor(() => evaluate(cdp, "Boolean(document.querySelector('.explorer-context-menu'))"), 3_000, "Explorer context menu reopen");
  const keyboardFocus = await evaluate(cdp, `(() => {
    const menu = document.querySelector('.explorer-context-menu');
    menu.focus();
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    return document.activeElement?.tagName;
  })()`);
  assert.equal(keyboardFocus, "BUTTON");
  await evaluate(cdp, "document.querySelector('.explorer-context-menu').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  await waitFor(() => evaluate(cdp, "!document.querySelector('.explorer-context-menu')"), 3_000, "context menu close");

  await rightClickElement(cdp, '.workspace-project-tree.active .tree-row[title$=".java"]');
  await waitFor(() => evaluate(cdp, "Boolean(document.querySelector('.explorer-context-menu'))"), 3_000, "file context menu");
  assert.match(await evaluate(cdp, "document.querySelector('.explorer-context-menu').dataset.contextNode"), /\.java$/);
  await leftClickElement(cdp, '[data-explorer-submenu="clipboard"]');
  await waitFor(
    () => evaluate(cdp, "Boolean(document.querySelector('.explorer-submenu-portal[data-submenu=\"clipboard\"]'))"),
    3_000,
    "copy path submenu",
  );
  assert.match(await evaluate(cdp, "document.querySelector('.explorer-submenu-portal').textContent"), /Absoluten Pfad kopieren/);
  await leftClickElement(cdp, ".sidebar-header");
  await waitFor(() => evaluate(cdp, "!document.querySelector('.explorer-context-menu')"), 3_000, "outside click closes context menu");

  await rightClickElement(cdp, ".multi-root-tree", "bottom-right");
  await waitFor(() => evaluate(cdp, "Boolean(document.querySelector('.explorer-context-menu'))"), 3_000, "empty Explorer context menu");
  const blankContextIsProject = await evaluate(cdp, `(() => {
    const menuPath = document.querySelector('.explorer-context-menu').dataset.contextNode;
    const activeProject = document.querySelector('.workspace-project-tree.active .project-heading-copy strong')?.textContent?.toLowerCase();
    return menuPath.toLowerCase().endsWith(activeProject);
  })()`);
  assert.equal(blankContextIsProject, true);
  await evaluate(cdp, "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  await waitFor(() => evaluate(cdp, "!document.querySelector('.explorer-context-menu')"), 3_000, "empty context menu close");

  await evaluate(cdp, "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true }))");
  await waitFor(() => evaluate(cdp, "Boolean(document.querySelector('.explorer-context-menu'))"), 3_000, "keyboard context menu");
  await evaluate(cdp, "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  await waitFor(() => evaluate(cdp, "!document.querySelector('.explorer-context-menu')"), 3_000, "keyboard context menu close");

  const deleteFixture = path.join(second, "src", "DeleteMe.txt");
  await evaluate(cdp, `window.kiwi.file.create(${JSON.stringify(path.dirname(deleteFixture))}, "DeleteMe.txt", false)`, true);
  await waitFor(
    () => evaluate(cdp, "Boolean(document.querySelector('.workspace-project-tree.active .tree-row[title$=\"DeleteMe.txt\"]'))"),
    5_000,
    "delete fixture in Explorer",
  );
  await rightClickElement(cdp, '.workspace-project-tree.active .tree-row[title$="DeleteMe.txt"]');
  await waitFor(() => evaluate(cdp, "Boolean(document.querySelector('.explorer-context-menu'))"), 3_000, "delete context menu");
  const deleteInvoked = await evaluate(cdp, `(() => {
    const button = document.querySelector('.explorer-context-menu button.danger');
    button?.click();
    return Boolean(button);
  })()`);
  assert.equal(deleteInvoked, true);
  await waitFor(
    () => fs.stat(deleteFixture).then(() => false).catch(() => true),
    5_000,
    "direct Explorer delete",
  );
  await waitFor(
    () => evaluate(cdp, "!document.querySelector('.workspace-project-tree.active .tree-row[title$=\"DeleteMe.txt\"]')"),
    5_000,
    "deleted entry removed from Explorer",
  );
  assert.equal(await evaluate(cdp, "Boolean(document.querySelector('.input-dialog'))"), false);

  await evaluate(cdp, "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', ctrlKey: true, altKey: true, bubbles: true }))");
  await waitFor(() => evaluate(cdp, "Boolean(document.querySelector('.input-dialog'))"), 3_000, "custom create shortcut dialog");
  await evaluate(cdp, "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");

  await leftClickElement(cdp, '.workspace-project-tree.active .tree-row[title$="zz-large-folder"]');
  await waitFor(
    () => evaluate(cdp, "Number.parseFloat(document.querySelector('.virtual-tree-canvas')?.style.height || '0') > 20000"),
    8_000,
    "large virtualized Explorer folder",
  );
  const virtualization = await evaluate(cdp, `({
    renderedRows: document.querySelectorAll('.workspace-project-tree.active .tree-row').length,
    virtualHeight: Number.parseFloat(document.querySelector('.virtual-tree-canvas')?.style.height || '0'),
    viewportHeight: document.querySelector('.virtual-tree-viewport')?.clientHeight || 0,
    rowHeight: Number.parseFloat(getComputedStyle(document.querySelector('.workspace-project-tree.active .tree-row')).height || '0')
  })`);
  assert.ok(virtualization.virtualHeight >= 1200 * virtualization.rowHeight, `Virtual canvas is too small: ${JSON.stringify(virtualization)}`);
  assert.ok(virtualization.renderedRows < 160, `Explorer rendered too many DOM rows: ${JSON.stringify(virtualization)}`);
  assert.ok(virtualization.viewportHeight > 0, `Virtual Explorer has no viewport: ${JSON.stringify(virtualization)}`);
  await leftClickElement(cdp, '.workspace-project-tree.active .tree-row[title$="zz-large-folder"]');

  // The TODO tool window has to see markers in files that are not open, which
  // is the whole point of collecting them across classes.
  await evaluate(cdp, "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'T', code: 'KeyT', ctrlKey: true, shiftKey: true, bubbles: true }))");
  await waitFor(
    () => evaluate(cdp, `Boolean([...document.querySelectorAll('.todo-list button')]
      .find(row => row.textContent?.includes('split this class')))`),
    8_000,
    "project-wide TODO entry",
  );
  const todoKinds = await evaluate(cdp, "[...document.querySelectorAll('.todo-kind')].map(node => node.textContent)");
  assert.ok(todoKinds.includes("TODO"), `TODO marker missing: ${JSON.stringify(todoKinds)}`);
  await evaluate(cdp, `(() => {
    const row = [...document.querySelectorAll('.todo-list button')]
      .find(item => item.textContent?.includes('split this class'));
    row?.click();
    return Boolean(row);
  })()`);
  await waitFor(
    () => evaluate(cdp, "[...document.querySelectorAll('.tabs .tab')].some(tab => tab.title?.endsWith('Chores.java'))"),
    8_000,
    "jump from the TODO list into the file",
  );

  // The syntax pass has to report a broken file on its own, without waiting
  // for the language server to answer. The source is written only now: the
  // build assertions further up compile this very tree.
  await fs.writeFile(path.join(second, "src", "Unbalanced.java"), "public class Unbalanced {\n    void run() {\n}\n");
  // The file watcher has to surface it, and its directory has to be open for
  // the row to exist at all.
  await evaluate(cdp, `(() => {
    const row = [...document.querySelectorAll('.tree-row')].find(item => item.title === ${JSON.stringify(path.join(second, "src"))});
    if (row?.getAttribute('aria-expanded') !== 'true') row?.click();
    return Boolean(row);
  })()`);
  await waitFor(
    () => evaluate(cdp, "Boolean([...document.querySelectorAll('.tree-row')].find(row => row.title?.endsWith('Unbalanced.java')))"),
    15_000,
    "the new source appears in the Explorer",
  );
  await evaluate(cdp, `(() => {
    const row = [...document.querySelectorAll('.tree-row')].find(item => item.title?.endsWith('Unbalanced.java'));
    row?.click();
    row?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    return Boolean(row);
  })()`);
  await waitFor(
    () => evaluate(cdp, "[...document.querySelectorAll('.tabs .tab')].some(tab => tab.title?.endsWith('Unbalanced.java'))"),
    8_000,
    "open the unbalanced source",
  );
  await evaluate(cdp, "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'M', code: 'KeyM', ctrlKey: true, shiftKey: true, bubbles: true }))");
  await waitFor(
    () => evaluate(cdp, `(() => {
      const rows = [...document.querySelectorAll('.problem-group > button')];
      return rows.some(row => row.textContent?.includes('wird nie geschlossen')
        && row.querySelector('.problem-source')?.textContent === 'Syntax');
    })()`),
    10_000,
    "instant syntax diagnostic",
  );

  // Clicking a problem has to land on the offending token, not merely on the
  // line. Monaco only renders .selected-text for a non-empty selection, so its
  // appearance is the proof that the jump highlighted the range.
  const selectionBefore = await evaluate(cdp, "document.querySelectorAll('.monaco-editor .selected-text').length");
  assert.equal(selectionBefore, 0, "The editor already had a selection before the problem was clicked.");
  await clickUntil(
    cdp,
    () => evaluate(cdp, `(() => {
      const row = [...document.querySelectorAll('.problem-group > button')]
        .find(item => item.textContent?.includes('wird nie geschlossen'));
      row?.click();
      return Boolean(row);
    })()`).then((found) => assert.equal(found, true, "The syntax problem row disappeared.")),
    // `.selected-text` is painted, not stored: with the workbench occluded
    // behind an installer being written, requestAnimationFrame is throttled and
    // the node never appears although the selection was set — the diagnosis
    // below reported exactly that, a caret on the right line with nothing
    // drawn. Asking for a frame first is what the other painted checks do.
    () => afterFrames(cdp, "return document.querySelectorAll('.monaco-editor .selected-text').length > 0;"),
    "problem click selects the offending range",
  ).catch(async (error) => {
    const probe = await evaluate(cdp, `JSON.stringify({
      tab: document.querySelector('.tab.active')?.textContent || '',
      editors: document.querySelectorAll('.monaco-editor').length,
      selected: document.querySelectorAll('.monaco-editor .selected-text').length,
      lines: document.querySelectorAll('.monaco-editor .view-line').length,
      editorBox: (() => {
        const box = document.querySelector('.monaco-editor')?.getBoundingClientRect();
        return box ? [Math.round(box.width), Math.round(box.height)] : null;
      })(),
      panelBox: (() => {
        const box = document.querySelector('.bottom-panel')?.getBoundingClientRect();
        return box ? [Math.round(box.width), Math.round(box.height)] : null;
      })(),
      // The jump waits for the model that belongs to the clicked problem, so
      // the model actually on screen is the first thing worth knowing.
      model: document.querySelector('.tabs .tab.active')?.title || '',
      // Which line the caret sits on says where the click landed. It does
      // not say whether anything was selected: the element this finds may
      // be the margin overlay, which is drawn either way. The two counts
      // below are what answer that.
      caret: (() => {
        const line = document.querySelector('.monaco-editor .current-line');
        const rows = [...document.querySelectorAll('.monaco-editor .view-line')];
        if (!line) return "keine aktive Zeile";
        const top = line.getBoundingClientRect().top;
        const index = rows.findIndex((row) => Math.abs(row.getBoundingClientRect().top - top) < 2);
        return index < 0 ? "aktive Zeile ohne Treffer" : "Zeile " + (index + 1);
      })(),
      selectionNodes: document.querySelectorAll('.monaco-editor .view-overlays .selected-text').length,
      // Where the caret sits across the line, which is the one thing that tells
      // the two remaining faults apart. The jump selects [1,25]-[1,26], so a
      // caret still at the left edge means applySelection() never ran, and a
      // caret out at the brace means it ran and something took the selection
      // away afterwards. Every reading so far was equally true of both.
      caretOffset: (() => {
        const caret = document.querySelector('.monaco-editor .cursor');
        const content = document.querySelector('.monaco-editor .view-lines');
        if (!caret || !content) return null;
        return [
          Math.round(caret.getBoundingClientRect().left - content.getBoundingClientRect().left),
          Math.round(content.getBoundingClientRect().width),
        ];
      })(),
      firstLine: (document.querySelector('.monaco-editor .view-line')?.textContent || '').slice(0, 40),
      // Two overlays are both called .current-line, and the first probe read
      // whichever came first in the DOM, so it could not say anything at all.
      // Monaco draws the one in the content only while the selection is empty
      // (currentLineHighlight.js: _shouldRenderInContent checks _selectionIsEmpty);
      // the one in the margin is drawn unconditionally. Both come out of the
      // same overlay pass as .selected-text, which separates the two faults
      // that looked identical here: a content line present means the pass ran
      // and the selection really is empty — the jump is broken; both counts at
      // zero means nothing painted at all — the frame was throttled.
      currentLineInContent: document.querySelectorAll('.monaco-editor .view-overlays .current-line').length,
      currentLineInMargin: document.querySelectorAll('.monaco-editor .margin-view-overlays .current-line').length,
      window: [window.innerWidth, window.innerHeight],
      rows: [...document.querySelectorAll('.problem-group > button')].map(item => item.textContent?.slice(0, 60)),
      panel: [...document.querySelectorAll('.panel-tabs button')].find(item => item.classList.contains('active'))?.textContent || '',
    })`);
    throw new Error(`${error.message} Diagnose: ${probe}${rendererNote(typeof cdp === "undefined" ? null : cdp)}`);
  });

  // A broken pom.xml has to be reported without anyone opening it, and the
  // aggregator rule is the one that used to produce a silent empty build.
  // Keep this fixture below the large validation folder rather than at the
  // project root: a root pom changes the active project to Maven and starts an
  // automatic Maven import. Leaving that import running made the later
  // CodeLens error-path test measure Maven/auto-sync latency instead of the
  // renderer's debug reset. validateProject() deliberately scans nested build
  // files, so this still exercises the project-wide validation contract.
  const invalidValidationPom = path.join(largeFolder, "pom.xml");
  await fs.writeFile(invalidValidationPom, [
    "<project>",
    "  <modelVersion>4.0.0</modelVersion>",
    "  <groupId>de.demo</groupId><artifactId>beta</artifactId><version>1.0</version>",
    "  <modules><module>core</module></modules>",
    "</project>",
  ].join("\n"));
  try {
    await evaluate(cdp, `window.kiwi.workspace.validateProject(${JSON.stringify(second)})
      .then(found => JSON.stringify(found.map(item => item.message)))`, true)
      .then((found) => assert.ok(
        String(found).includes("packaging"),
        `Maven aggregator packaging was not reported: ${found}`,
      ));
  } finally {
    await fs.rm(invalidValidationPom, { force: true });
  }
  await waitFor(
    () => evaluate(cdp, `window.kiwi.project.detect(${JSON.stringify(second)}).then(project => project.type === 'Java')`, true),
    8_000,
    "plain Java project restored after POM validation",
  );

  // The editor context menu is grouped and filtered by language. Monaco renders
  // it into a shadow root, so it has to be read through the host — querying the
  // document alone finds nothing and reads exactly like a menu that never opened.
  await focusEditor(cdp);
  await waitFor(
    () => evaluate(cdp, "document.querySelectorAll('.monaco-editor .view-line').length > 0"),
    10_000,
    "rendered editor lines before the context menu",
  );
  await rightClickElement(cdp, ".monaco-editor .view-line");
  const menuJson = await waitFor(() => evaluate(cdp, `(() => {
    for (const node of document.querySelectorAll('*')) {
      const labels = [...(node.shadowRoot?.querySelectorAll('.action-label') || [])]
        .map(item => item.textContent?.trim()).filter(Boolean);
      if (labels.length) return JSON.stringify(labels);
    }
    return null;
  })()`), 8_000, "editor context menu");
  const menuLabels = JSON.parse(menuJson);
  assert.ok(menuLabels.includes("Generieren …"), `Generate entry missing: ${menuJson}`);
  assert.equal(
    menuLabels.filter((label) => label.endsWith("generieren")).length,
    0,
    `The four separate generate entries should be gone: ${menuJson}`,
  );
  assert.ok(!menuLabels.includes("Basic Code Completion"), `Completion belongs on the keyboard, not here: ${menuJson}`);
  assert.ok(!menuLabels.includes("Symbol umbenennen"), `Duplicate of Monaco's own rename: ${menuJson}`);
  assert.ok(menuLabels.includes("Methode extrahieren"), `Refactoring missing: ${menuJson}`);
  assert.ok(!menuLabels.includes("HTTP-Anfrage senden"), `HTTP entry must stay hidden in a Java file: ${menuJson}`);
  // The refactorings form their own block, after the editing commands.
  assert.ok(
    menuLabels.indexOf("Methode extrahieren") > menuLabels.indexOf("Quick Fix und Intentionen"),
    `Menu order is wrong: ${menuJson}`,
  );
  for (const type of ["rawKeyDown", "keyUp"]) {
    await cdp.send("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  }

  // Ctrl+- shrinks and Ctrl++ has to bring it back. Chromium's own zoom is
  // bound to the US layout's keys, so on a German keyboard only shrinking
  // worked and the window stayed small. Both spellings of the keys are tried.
  const scaleNow = () => evaluate(cdp, "Number(document.body.style.zoom) || 1");
  const pressZoom = async (code, key) => {
    for (const type of ["rawKeyDown", "keyUp"]) {
      await cdp.send("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: key === "-" ? 189 : 187, modifiers: 2 });
    }
  };
  const startScale = await scaleNow();
  await pressZoom("Minus", "-");
  const shrunk = await waitFor(async () => {
    const value = await scaleNow();
    return value < startScale ? value : null;
  }, 6_000, "Ctrl+- shrinks the interface");

  // The German layout puts "+" on a different physical key than the US one.
  await pressZoom("BracketRight", "+");
  await waitFor(async () => (await scaleNow()) > shrunk, 6_000, "Ctrl++ enlarges it again");

  await pressZoom("Digit0", "0");
  await waitFor(async () => (await scaleNow()) === 1, 6_000, "Ctrl+0 returns to 100 percent");

  // The debug toolbar: Hot Replace is the only control with an icon and a
  // label, and it used to wrap and stand taller than its neighbours, with the
  // pickers two pixels off the row on top of that.
  await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('.panel-tabs button')].find(item => item.textContent?.includes('DEBUG'));
    button?.click();
    return Boolean(button);
  })()`);
  await waitFor(() => evaluate(cdp, "Boolean(document.querySelector('.debug-hot-replace'))"), 8_000, "debug toolbar");
  const toolbar = JSON.parse(await evaluate(cdp, `(() => {
    const controls = [...document.querySelectorAll('.debug-controls button, .debug-controls select')];
    const heights = controls.map(item => Math.round(item.getBoundingClientRect().height));
    const hot = document.querySelector('.debug-hot-replace');
    // The button has a fixed height, so its box says nothing about wrapping.
    // A range over the label reports one rectangle per rendered line.
    const label = [...hot.childNodes].find(node => node.nodeType === 3 && node.textContent.trim());
    const range = document.createRange();
    range.selectNodeContents(label);
    return JSON.stringify({
      distinctHeights: [...new Set(heights)],
      labelLines: range.getClientRects().length,
      wrapping: getComputedStyle(hot).whiteSpace,
      overflows: hot.scrollWidth > hot.clientWidth + 1,
    });
  })()`));
  assert.equal(toolbar.distinctHeights.length, 1, `Debug controls have mismatched heights: ${JSON.stringify(toolbar)}`);
  assert.equal(toolbar.labelLines, 1, `The Hot Replace label wraps: ${JSON.stringify(toolbar)}`);
  assert.equal(toolbar.overflows, false, "The label must fit inside its button.");
  assert.equal(toolbar.wrapping, "nowrap");

  // The Java Debug CodeLens used to invoke the preload API directly. A compile
  // failure therefore produced an unhandled promise, left no durable message in
  // the Debug panel and could strand the renderer in "starting". Exercise the
  // real Monaco click so this cannot regress to a second, invisible start path.
  const debugFailureFile = path.join(second, "src", "DebugFailure.java");
  const languageProcessBeforeNewClass = await waitFor(
    async () => {
      const process = await evaluate(cdp, `window.kiwi.app.health().then(health =>
        health.language.processes
          .find(process => process.root.toLowerCase() === ${JSON.stringify(second.toLowerCase())}) || null
      )`, true);
      return process?.ready && process.pid > 0 ? process : null;
    },
    45_000,
    "ready JDT process before adding DebugFailure.java",
  );
  await fs.writeFile(debugFailureFile, [
    "public class DebugFailure {",
    "  public static void main(String[] args) {",
    "    MissingDebugType value = new MissingDebugType();",
    "  }",
    "}",
    "",
  ].join("\n"));
  await waitFor(
    () => evaluate(cdp, `[...document.querySelectorAll('.tree-row')].some(row => row.title === ${JSON.stringify(debugFailureFile)})`),
    8_000,
    "debug failure fixture in Explorer",
  );
  await clickUntil(
    cdp,
    () => doubleClickElement(cdp, '.tree-row[title$="DebugFailure.java"]'),
    () => evaluate(cdp, `document.querySelector('.tabs .tab.active')?.title === ${JSON.stringify(debugFailureFile)}`),
    "DebugFailure.java active editor tab",
  );
  await waitFor(
    () => evaluate(cdp, `[...document.querySelectorAll('.monaco-editor .view-line')]
      .some(line => line.textContent?.includes('MissingDebugType'))`),
    10_000,
    "DebugFailure.java active Monaco model",
  );
  await waitFor(
    () => evaluate(cdp, "[...document.querySelectorAll('.codelens-decoration a')].some(item => item.textContent?.includes('Debug'))"),
    20_000,
    "Java Debug CodeLens",
  );
  const languageProcessAfterNewClass = await waitFor(
    async () => {
      const process = await evaluate(cdp, `window.kiwi.app.health().then(health =>
        health.language.processes
          .find(process => process.root.toLowerCase() === ${JSON.stringify(second.toLowerCase())}) || null
      )`, true);
      return process?.ready && process.pid > 0 ? process : null;
    },
    45_000,
    "ready JDT process after adding DebugFailure.java",
  );
  assert.equal(
    languageProcessAfterNewClass?.pid,
    languageProcessBeforeNewClass.pid,
    "Adding a Java file inside an indexed source root restarted JDT LS.",
  );
  // Monaco can relayout CodeLens decorations between measuring a rectangle and
  // dispatching the mouse event. Re-measure and retry only until the workbench
  // has actually entered the debug path; startDebug's single-flight guard
  // prevents a second session if React has not painted `starting` yet.
  await clickUntil(
    cdp,
    async () => {
      // Where the lens is, and whether a click at that point would reach it.
      // Monaco lays the text out over the decoration often enough that the
      // centre of the lens belongs to `.view-lines`: the rectangle is right,
      // and a mouse event sent to it lands on the file instead. Re-measuring
      // does not help, because nothing about the measurement is wrong.
      const debugLensPoint = JSON.parse(await evaluate(cdp, `(() => {
        const link = [...document.querySelectorAll('.codelens-decoration a')]
          .find(item => item.textContent?.includes('Debug'));
        if (!link) return JSON.stringify(null);
        const box = link.getBoundingClientRect();
        const x = box.left + box.width / 2;
        const y = box.top + box.height / 2;
        const atPoint = document.elementFromPoint(x, y);
        return JSON.stringify({ x, y, reachable: Boolean(atPoint && link.contains(atPoint)) || atPoint === link });
      })()`));
      assert.ok(debugLensPoint, "The Java Debug CodeLens had no clickable bounds.");
      if (debugLensPoint.reachable) {
        await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: debugLensPoint.x, y: debugLensPoint.y, button: "left", buttons: 1, clickCount: 1 });
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: debugLensPoint.x, y: debugLensPoint.y, button: "left", buttons: 0, clickCount: 1 });
        return;
      }
      // Covered: activate the lens itself. This still runs the command the
      // lens carries — which is the thing under test — rather than asserting
      // that Monaco happened to leave it on top.
      await evaluate(cdp, `(() => {
        const link = [...document.querySelectorAll('.codelens-decoration a')]
          .find(item => item.textContent?.includes('Debug'));
        link?.click();
        return Boolean(link);
      })()`);
    },
    () => evaluate(cdp, `(() => {
      const output = document.querySelector('.debug-panel pre')?.textContent || '';
      const status = document.querySelector('.debug-controls > span')?.textContent || '';
      return status !== 'stopped' || output.includes('Debug-Start fehlgeschlagen:');
    })()`),
    "Java Debug CodeLens entered the workbench debug path",
    // Behind this click sits a compiler. Eight seconds was the budget for a
    // warm machine; a release build runs it right after packaging, where a
    // cold javac takes longer than that on its own. Once the debug path is
    // entered the effect holds, so a longer budget costs no extra clicks.
    25_000,
  ).catch(async (error) => {
    // Whether the lens was hit at all is the question here, and the answer is
    // on screen: a missed click leaves the workbench untouched, a slow one
    // leaves it starting.
    const probe = await evaluate(cdp, `JSON.stringify((() => {
      const link = [...document.querySelectorAll('.codelens-decoration a')]
        .find(item => item.textContent?.includes('Debug'));
      const box = link?.getBoundingClientRect();
      const centre = box ? document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) : null;
      return {
        lens: link ? (link.textContent || '').trim() : "nicht vorhanden",
        lensBox: box ? [Math.round(box.left), Math.round(box.top), Math.round(box.width), Math.round(box.height)] : null,
        atLens: centre ? (centre.className || centre.tagName) : "nichts",
        status: document.querySelector('.debug-controls > span')?.textContent || '',
        output: (document.querySelector('.debug-panel pre')?.textContent || '').slice(-200),
        running: Boolean(document.querySelector('.background-progress')),
        tab: document.querySelector('.tabs .tab.active')?.title || '',
      };
    })())`);
    throw new Error(`${error.message} Diagnose: ${probe}${rendererNote(typeof cdp === "undefined" ? null : cdp)}`);
  });
  await waitFor(
    () => evaluate(cdp, `(() => {
      const output = document.querySelector('.debug-panel pre')?.textContent || '';
      const status = document.querySelector('.debug-controls > span')?.textContent || '';
      const activePanel = [...document.querySelectorAll('.panel-tabs button')]
        .find(item => item.textContent?.includes('DEBUG'))?.classList.contains('active');
      const pending = [...document.querySelectorAll('.operation-row')]
        .some(item => item.textContent?.includes('Debug-Sitzung'));
      return output.includes('Debug-Start fehlgeschlagen:')
        && status === 'stopped'
        && activePanel
        && !pending;
    })()`),
    // Same compiler, same reason: this waits for it to finish and for the
    // workbench to settle back afterwards.
    45_000,
    "visible and fully reset Debug CodeLens failure",
  );
  await fs.rm(debugFailureFile);
  await waitFor(
    () => evaluate(cdp, `![...document.querySelectorAll('.tree-row')].some(row => row.title === ${JSON.stringify(debugFailureFile)})`),
    8_000,
    "debug failure fixture removed from Explorer",
  );

  await doubleClickElement(cdp, '.workspace-project-tree.active .tree-row[title$="Beta.java"]');

  // Dragging the panel's tab strip to an edge docks it there. The drag has to
  // start on the strip itself: a press on a tab still switches tabs.
  await waitFor(() => evaluate(cdp, "Boolean(document.querySelector('.panel-drag-handle'))"), 8_000, "panel drag handle");
  assert.deepEqual(
    await evaluate(cdp, "[...document.querySelectorAll('.panel-dock-picker select option')].map(option => option.textContent)"),
    [
      "Unten links", "Unten", "Unten rechts",
      "Schwebend über der Werkbank", "Eigenes Fenster (zweiter Monitor)",
    ],
    "The list reads left to right along the bottom, and holds no placement the workbench cannot give.",
  );
  // Dragging the window itself moves the whole block: every tab of that edge
  // goes along, instead of one drag per tab. That is also how the arrangement
  // is reset between the checks below.
  const dragHandleTo = async (fromDock, x, y) => {
    // The drop before this one is applied by React and laid out by the
    // browser, and the handle of the new placement exists only once both have
    // happened. Measuring straight away found nothing and read as a tool
    // window that had gone missing.
    await waitFor(
      () => evaluate(cdp, `Boolean(document.querySelector('.bottom-panel.panel-dock-${fromDock} .panel-drag-handle'))`),
      8_000,
      `Griff des Werkzeugfensters an ${fromDock}`,
    );
    const grip = await elementPoint(cdp, `.bottom-panel.panel-dock-${fromDock} .panel-drag-handle`);
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: grip.x, y: grip.y, button: "left", buttons: 1, clickCount: 1 });
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 });
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
  };
  const dockedWindows = () => evaluate(cdp, `JSON.stringify(
    [...document.querySelectorAll('.bottom-panel')].map(item => item.dataset.panelDock).sort()
  )`).then((value) => JSON.parse(value));
  const collectWindowsAtBottom = async () => {
    const room = JSON.parse(await evaluate(cdp, "JSON.stringify({ width: window.innerWidth, height: window.innerHeight })"));
    for (const dock of ["floating", "bottom-left", "bottom-right"]) {
      if (!(await dockedWindows()).includes(dock)) continue;
      const target = { x: Math.round(room.width / 2), y: room.height - 20 };
      await dragHandleTo(dock, target.x, target.y);
      await waitFor(
        () => dockedWindows().then((docks) => !docks.includes(dock)),
        8_000,
        `${dock} window moved to the bottom as a block`,
      ).catch(async (error) => {
        // A drag that changes nothing means the press missed the handle or the
        // drop was read as another placement; both are visible from here.
        const probe = await evaluate(cdp, `JSON.stringify((() => {
          const handle = document.querySelector('.bottom-panel.panel-dock-${dock} .panel-drag-handle');
          const box = handle?.getBoundingClientRect();
          const centre = box ? document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) : null;
          const dropped = document.elementFromPoint(${target.x}, ${target.y});
          return {
            docks: [...document.querySelectorAll('.bottom-panel')].map(item => item.dataset.panelDock),
            handleBox: box ? [Math.round(box.left), Math.round(box.top), Math.round(box.width), Math.round(box.height)] : null,
            atHandle: centre ? (centre.className || centre.tagName) : "nichts",
            stack: box ? document.elementsFromPoint(box.left + box.width / 2, box.top + box.height / 2)
              .slice(0, 4).map(item => item.className || item.tagName) : [],
            strip: (() => {
              const strip = handle?.parentElement;
              const stripBox = strip?.getBoundingClientRect();
              return strip ? {
                scrollLeft: Math.round(strip.scrollLeft),
                box: [Math.round(stripBox.left), Math.round(stripBox.width)],
                owner: strip.parentElement?.className || "",
              } : null;
            })(),
            atDrop: dropped ? (dropped.className || dropped.tagName) : "nichts",
            room: [window.innerWidth, window.innerHeight],
          };
        })())`);
        throw new Error(`${error.message} Diagnose: ${probe}${rendererNote(typeof cdp === "undefined" ? null : cdp)}`);
      });
    }
  };

  // Several tool windows can be open, so the picker always belongs to the
  // focused one — the window the drag, keyboard and picker paths all act on.
  const dockFocusedPanel = async (target) => {
    // At a side the controls live behind the header's actions menu, because a
    // three-hundred-pixel header has no room for them in the open. Opening it
    // is what a person does there too — and the menu appears on React's next
    // render, not in the same breath as the click.
    //
    // Opened once per attempt and then waited for. This used to click on every
    // hundred-millisecond poll, and the button is a toggle
    // (`setSideMenuEdge(current => current === edge ? "" : edge)`): when a
    // render took longer than the gap between polls, the next poll shut the
    // menu it was waiting for, and the two never met again. On a quiet machine
    // it never showed; under the load of a release build it cost one.
    trace("dock picker reachable");
    const pickerShowing = () => evaluate(cdp, "Boolean(document.querySelector('.panel-dock-picker select'))");
    const openTheMenu = () => evaluate(cdp, `(() => {
      if (document.querySelector('.panel-dock-picker select')) return true;
      const opener = document.querySelector('.bottom-panel.panel-focused .panel-side-header .icon-button')
        || document.querySelector('.panel-side-header .icon-button');
      opener?.click();
      return Boolean(opener);
    })()`);
    const settleFor = async (ms) => {
      const deadline = Date.now() + ms * patience;
      while (Date.now() < deadline) {
        if (await pickerShowing()) return true;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return false;
    };
    let pickerOpen = await pickerShowing();
    for (let attempt = 0; attempt < 3 && !pickerOpen; attempt += 1) {
      await openTheMenu();
      pickerOpen = await settleFor(3_000);
    }
    if (!pickerOpen) throw new Error("dock picker reachable nicht rechtzeitig verfügbar.");
    return evaluate(cdp, `(() => {
      const picker = document.querySelector('.bottom-panel.panel-focused .panel-dock-picker select')
        || document.querySelector('.panel-dock-picker select');
      if (!picker) return false;
      picker.value = ${JSON.stringify(target)};
      picker.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
  };
  await dockFocusedPanel("bottom-right");
  await waitFor(
    () => evaluate(cdp, "Boolean(document.querySelector('.bottom-panel.panel-dock-bottom-right'))"),
    8_000,
    "visible dock picker moves output panel to the right",
  );
  await dockFocusedPanel("bottom");
  await waitFor(
    () => evaluate(cdp, "Boolean(document.querySelector('.bottom-panel.panel-dock-bottom'))"),
    8_000,
    "visible dock picker moves output panel back to the bottom",
  );
  const strip = await elementPoint(cdp, ".bottom-panel.panel-dock-bottom .panel-drag-handle");
  const lowerExplorerEdge = JSON.parse(await evaluate(cdp, `JSON.stringify((() => {
    const sidebar = document.querySelector('.sidebar')?.getBoundingClientRect();
    return {
      x: Math.max(4, Math.round((sidebar?.right || window.innerWidth * 0.2) - 4)),
      y: window.innerHeight - 14,
    };
  })())`));
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: strip.x, y: strip.y, button: "left", buttons: 1, clickCount: 1 });
  // This is the exact ambiguous spot from the regression: the lower visible
  // edge of the Explorer. It must be the foot of the Explorer's column.
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: lowerExplorerEdge.x, y: lowerExplorerEdge.y, button: "left", buttons: 1 });
  // Checked while the button is still down, and after React has rendered.
  await waitFor(
    () => evaluate(cdp, "Boolean(document.querySelector('.panel-drop-bottom-left'))"),
    5_000,
    "drop hint for the lower left corner",
  ).catch(async (error) => {
    const probe = await evaluate(cdp, `JSON.stringify((() => {
      const handle = document.querySelector('.bottom-panel.panel-dock-bottom .panel-drag-handle');
      const box = handle?.getBoundingClientRect();
      return {
        pressed: [${JSON.stringify(strip)}.x, ${JSON.stringify(strip)}.y],
        handleBox: box ? [Math.round(box.left), Math.round(box.top), Math.round(box.width), Math.round(box.height)] : null,
        stack: box ? document.elementsFromPoint(box.left + box.width / 2, box.top + box.height / 2)
          .slice(0, 3).map(item => item.className || item.tagName) : [],
        hints: [...document.querySelectorAll('.panel-drop-hint')].map(item => item.className),
        dragging: Boolean(document.querySelector('.bottom-panel.panel-dragging')),
      };
    })())`);
    throw new Error(`${error.message} Diagnose: ${probe}${rendererNote(typeof cdp === "undefined" ? null : cdp)}`);
  });
  // The band that accepts the window is exactly the band the preview lights up.
  // These were two different numbers: the highlight showed how wide the docked
  // window would be, the drop was accepted only inside a fixed share of the
  // viewport. Releasing just inside the highlight therefore fell through to the
  // middle, which is what made docking to the sides look broken.
  const leftHintWidth = Math.round(Number(await evaluate(
    cdp,
    "document.querySelector('.panel-drop-bottom-left')?.getBoundingClientRect().width || 0",
  )));
  assert.ok(leftHintWidth > 40, `The lower left drop preview has no width: ${leftHintWidth}`);
  const insideHint = leftHintWidth - 8;
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: insideHint, y: lowerExplorerEdge.y, button: "left", buttons: 1 });
  await waitFor(
    () => evaluate(cdp, "Boolean(document.querySelector('.panel-drop-bottom-left'))"),
    5_000,
    "lower left drop hint still shown at the inner edge of its own preview",
  );
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: insideHint, y: lowerExplorerEdge.y, button: "left", buttons: 0, clickCount: 1 });
  await waitFor(
    () => evaluate(cdp, `(() => {
      const panel = document.querySelector('.bottom-panel.panel-dock-bottom-left');
      // It has to land at the foot of the Explorer's column, not in a column
      // of its own between the Explorer and the editor.
      return Boolean(panel && panel.parentElement?.classList.contains('sidebar'));
    })()`),
    8_000,
    "panel dropped at the foot of the Explorer column",
  );

  assert.equal(
    await evaluate(cdp, "document.querySelector('.panel-drag-handle')?.getAttribute('aria-keyshortcuts')"),
    "ArrowLeft ArrowRight ArrowDown ArrowUp",
    "The panel drag handle must announce every keyboard placement, the window of its own included.",
  );
  const dockPanelWithKeyboard = async (key, dock) => {
    await evaluate(cdp, `(() => {
      const handle = document.querySelector('.bottom-panel.panel-focused .panel-drag-handle')
        || document.querySelector('.panel-drag-handle');
      handle?.focus();
      handle?.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }));
      return document.activeElement === handle;
    })()`);
    await waitFor(
      () => evaluate(cdp, `Boolean(document.querySelector('.bottom-panel.panel-dock-${dock}'))`),
      8_000,
      `panel keyboard-docked to ${dock}`,
    );
  };
  await dockPanelWithKeyboard("ArrowRight", "bottom-right");
  await dockPanelWithKeyboard("ArrowDown", "bottom");
  await dockPanelWithKeyboard("ArrowLeft", "bottom-left");

  // Cancellation must tear down the global drag listeners as well as the
  // visual drop target. A later mouse-up must not finish a cancelled drag.
  const cancelledStrip = await elementPoint(cdp, ".bottom-panel.panel-focused .panel-drag-handle");
  const viewportWidth = Number(await evaluate(cdp, "window.innerWidth"));
  // Low enough to be inside the band that docks, so the cancelled drag has a
  // real drop target to tear down rather than the window placement.
  const cancelledDropY = Number(await evaluate(cdp, "window.innerHeight")) - 20;
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: cancelledStrip.x, y: cancelledStrip.y, button: "left", buttons: 1, clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: viewportWidth - 40, y: cancelledDropY, button: "left", buttons: 1 });
  await waitFor(
    () => evaluate(cdp, "Boolean(document.querySelector('.panel-drop-bottom-right'))"),
    5_000,
    "drop hint before pointer cancellation",
  );
  await evaluate(cdp, "window.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }))");
  await waitFor(
    () => evaluate(cdp, "!document.querySelector('.panel-drop-hint') && !document.querySelector('.bottom-panel.panel-dragging')"),
    5_000,
    "pointer cancellation clears panel drag state",
  );
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: viewportWidth - 40, y: cancelledDropY, button: "left", buttons: 0, clickCount: 1 });
  assert.equal(
    await evaluate(cdp, "Boolean(document.querySelector('.bottom-panel.panel-dock-bottom-left'))"),
    true,
    "A mouse-up after pointer cancellation must not dock the panel.",
  );

  const blurredStrip = await elementPoint(cdp, ".bottom-panel.panel-focused .panel-drag-handle");
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: blurredStrip.x, y: blurredStrip.y, button: "left", buttons: 1, clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: viewportWidth - 40, y: cancelledDropY, button: "left", buttons: 1 });
  await waitFor(
    () => evaluate(cdp, "Boolean(document.querySelector('.panel-drop-bottom-right'))"),
    5_000,
    "drop hint before window blur",
  );
  await evaluate(cdp, "window.dispatchEvent(new Event('blur'))");
  await waitFor(
    () => evaluate(cdp, "!document.querySelector('.panel-drop-hint') && !document.querySelector('.bottom-panel.panel-dragging')"),
    5_000,
    "window blur clears panel drag state",
  );
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: viewportWidth - 40, y: cancelledDropY, button: "left", buttons: 0, clickCount: 1 });
  assert.equal(
    await evaluate(cdp, "Boolean(document.querySelector('.bottom-panel.panel-dock-bottom-left'))"),
    true,
    "A mouse-up after window blur must not dock the panel.",
  );

  // Each tool window keeps its own edge, the way IntelliJ places them: the
  // panel follows whichever tab is showing. Only the class and the applied
  // width prove the setting reached the layout; the setting alone would not.
  await dockFocusedPanel("bottom-right");
  await waitFor(
    () => evaluate(cdp, "Boolean(document.querySelector('.bottom-panel.panel-dock-bottom-right'))"),
    8_000,
    "output panel docked to the right",
  );
  // Docked to a side the panel is a tool window beside the editor, not a slab
  // cut out of it: it sits in the editor row next to the editor column, while
  // the main area keeps stacking that row over the bottom tool window.
  // At a side it is a tool window with a header naming what it shows, not a
  // column of tabs: the controls belong to that header, where three hundred
  // pixels of width still have room for them.
  const sideHeader = JSON.parse(await waitFor(
    async () => {
      const state = await evaluate(cdp, `JSON.stringify((() => {
        const header = document.querySelector('.bottom-panel.panel-dock-bottom-right > .panel-side-header');
        if (!header) return null;
        const title = header.querySelector('strong > span')?.textContent || '';
        return {
          title,
          hasIcon: Boolean(header.querySelector('strong svg')),
          // Two buttons in the header, the rest one click away: at three
          // hundred pixels the controls and the title cannot both be shown.
          headerButtons: header.querySelectorAll('.panel-side-actions button').length,
          gripInHeader: Boolean(header.querySelector('.panel-drag-handle')),
          actionsInTabs: Boolean(document.querySelector('.bottom-panel.panel-dock-bottom-right > .panel-tabs > .panel-actions')),
          pickerHidden: !header.querySelector('.panel-dock-picker'),
        };
      })())`);
      return state === "null" ? "" : state;
    },
    8_000,
    "header of the side-docked tool window",
  ));
  assert.deepEqual(
    { ...sideHeader, title: sideHeader.title.length > 0 },
    { title: true, hasIcon: true, headerButtons: 2, gripInHeader: true, actionsInTabs: false, pickerHidden: true },
    `A side-docked tool window needs its own header: ${JSON.stringify(sideHeader)}`,
  );
  // And the controls are still reachable from it.
  await waitFor(
    () => evaluate(cdp, `(() => {
      if (document.querySelector('.panel-side-menu .panel-dock-picker')) return true;
      document.querySelector('.bottom-panel.panel-dock-bottom-right .panel-side-header .icon-button')?.click();
      return false;
    })()`),
    8_000,
    "side header actions menu opens",
  );
  await evaluate(cdp, "document.querySelector('.bottom-panel.panel-dock-bottom-right .panel-side-header .icon-button')?.click()");

  // Docked right it belongs to the build tool window's column, not to a second
  // narrow column beside it: two columns doing the same job took the width for
  // both out of the file being edited.
  assert.equal(
    await evaluate(cdp, "document.querySelector('.bottom-panel.panel-dock-bottom-right')?.parentElement?.classList.contains('right-tool-window')"),
    true,
    "A window docked right has to sit in the build tool window's column.",
  );
  assert.equal(
    await evaluate(cdp, "getComputedStyle(document.querySelector('.main-area')).flexDirection"),
    "column",
    "The editor column must keep its own layout when the panel moves out of it.",
  );

  // The keyboard and drag checks above move whole windows, so the arrangement
  // is collected again before the per-tab checks below.
  await collectWindowsAtBottom();

  // The whole point of per-window docks: Debug on the right, Terminal on the
  // left and Problems at the bottom, all on screen at once. Side outputs use
  // their host column's shared tab strip; bottom outputs keep their own.
  const selectPanelTab = (label) => evaluate(cdp, `(() => {
    const tab = [...document.querySelectorAll('.panel-tabs button')].find(item => item.textContent?.includes(${JSON.stringify(label)}));
    tab?.click();
    return Boolean(tab);
  })()`);
  await selectPanelTab("DEBUG");
  await dockFocusedPanel("bottom-right");
  await waitFor(
    () => evaluate(cdp, "document.querySelector('.bottom-panel.panel-dock-bottom-right')?.dataset.panelView === 'debug'"),
    8_000,
    "debug window docked to the right",
  );
  await selectPanelTab("TERMINAL");
  await dockFocusedPanel("bottom-left");
  await waitFor(
    () => evaluate(cdp, "document.querySelector('.bottom-panel.panel-dock-bottom-left')?.dataset.panelView === 'terminal'"),
    8_000,
    "terminal on the left while the other tools stay where they were",
  );
  const simultaneousDocks = JSON.parse(await evaluate(cdp, `JSON.stringify((() => {
    const windows = [...document.querySelectorAll('.bottom-panel')];
    const left = document.querySelector('.bottom-panel.panel-dock-bottom-left');
    const bottom = document.querySelector('.bottom-panel.panel-dock-bottom');
    const editor = document.querySelector('.editor-stack').getBoundingClientRect();
    const leftBox = left.getBoundingClientRect();
    return {
      docks: windows.map(item => item.dataset.panelDock).sort(),
      leftView: left.dataset.panelView,
      bottomView: bottom.dataset.panelView,
      bottomHasTerminalTab: [...bottom.querySelectorAll('.panel-tabs button')].some(item => item.textContent?.includes('TERMINAL')),
      leftHasTerminalTab: [...left.querySelectorAll('.panel-tabs button')].some(item => item.textContent?.includes('TERMINAL')),
      leftBesideEditor: leftBox.right <= editor.left + 2,
      leftHasWidth: leftBox.width > 150,
      // The left foot sits in the Explorer's column rather than opening one of
      // its own between the Explorer and the editor.
      leftInExplorerColumn: Boolean(left.parentElement?.classList.contains('sidebar')),
      // And it shares that column: the Explorer is still above it.
      explorerStillVisible: Boolean(document.querySelector('.sidebar > .sidebar-views')),
    };
  })())`));
  assert.deepEqual(simultaneousDocks, {
    docks: ["bottom", "bottom-left", "bottom-right"],
    leftView: "terminal",
    bottomView: "problems",
    bottomHasTerminalTab: false,
    leftHasTerminalTab: true,
    leftBesideEditor: true,
    leftHasWidth: true,
    leftInExplorerColumn: true,
    explorerStillVisible: true,
  }, "All three feet must be usable at once, each with its own tabs.");

  // Closing one window leaves the other open and moves the focus to it.
  await evaluate(cdp, "document.querySelector('.bottom-panel.panel-dock-bottom-left .panel-close-action')?.click()");
  await waitFor(
    () => evaluate(cdp, "!document.querySelector('.bottom-panel.panel-dock-bottom-left') && Boolean(document.querySelector('.bottom-panel.panel-dock-bottom'))"),
    8_000,
    "closing one tool window keeps the others",
  );
  // A closed window took its tab with it, so it has to be summonable by name.
  // Ctrl+` is the shortcut for exactly that, and it must reopen the edge the
  // terminal was closed at rather than dragging it back to the bottom.
  assert.equal(
    await evaluate(cdp, "[...document.querySelectorAll('.panel-tabs button')].some(item => item.textContent?.includes('TERMINAL'))"),
    false,
    "Closing the terminal window must remove its tab, not leave a dead one behind.",
  );
  await cdp.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown", key: "`", code: "Backquote", windowsVirtualKeyCode: 192, modifiers: 2,
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp", key: "`", code: "Backquote", windowsVirtualKeyCode: 192, modifiers: 2,
  });
  await waitFor(
    () => evaluate(cdp, "Boolean(document.querySelector('.bottom-panel.panel-dock-bottom-left'))"),
    8_000,
    "Ctrl+` reopens the closed terminal window at its own edge",
  );
  await dockFocusedPanel("bottom-right");
  await waitFor(
    () => evaluate(cdp, "Boolean(document.querySelector('.bottom-panel.panel-dock-bottom-right'))"),
    8_000,
    "terminal back on the right edge",
  );

  const viewport = JSON.parse(await evaluate(cdp, "JSON.stringify({ width: window.innerWidth, height: window.innerHeight })"));
  assert.ok((await dockedWindows()).length > 1, "The block move needs more than one tool window to prove anything.");
  await collectWindowsAtBottom();
  const merged = JSON.parse(await evaluate(cdp, `JSON.stringify({
    docks: [...document.querySelectorAll('.bottom-panel')].map(item => item.dataset.panelDock),
    tabs: [...document.querySelectorAll('.bottom-panel .panel-tabs button')].map(item => item.textContent).filter(Boolean),
  })`));
  assert.deepEqual(merged.docks, ["bottom"], "Dragging a window has to take all of its tabs to the same place.");
  for (const label of ["PROBLEMS", "TERMINAL", "DEBUG"]) {
    assert.ok(
      merged.tabs.some((tab) => tab.includes(label)),
      `${label} is missing after the block move: ${JSON.stringify(merged.tabs)}`,
    );
  }

  // The left corner is exactly as wide as the Explorer column it sits under,
  // so the middle of the preview is the middle of the corner. Drag the whole
  // bottom block there so the following split starts with exactly two windows.
  const lowerLeftCornerX = Math.round(leftHintWidth / 2);
  await dragHandleTo("bottom", lowerLeftCornerX, viewport.height - 12);
  await waitFor(
    () => evaluate(cdp, "Boolean(document.querySelector('.bottom-panel.panel-dock-bottom-left'))"),
    8_000,
    "tool window docked into the lower left corner",
  );
  await selectPanelTab("TERMINAL");
  await dockFocusedPanel("bottom-right");
  await waitFor(
    () => evaluate(cdp, "document.querySelector('.bottom-panel.panel-dock-bottom-right')?.dataset.panelView === 'terminal'"),
    8_000,
    "terminal docked into the lower right corner",
  );
  const corners = JSON.parse(await evaluate(cdp, `JSON.stringify((() => {
    const box = selector => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { left: Math.round(rect.left), right: Math.round(rect.right), top: Math.round(rect.top), width: Math.round(rect.width) };
    };
    const left = box('.bottom-panel.panel-dock-bottom-left');
    const right = box('.bottom-panel.panel-dock-bottom-right');
    return {
      sideBySide: left.right <= right.left + 2,
      sameRow: Math.abs(left.top - right.top) <= 2,
      bothUsable: left.width > 150 && right.width > 150,
      // A corner belongs to the column it sits under, not to the row under the
      // editor: that is what keeps the editor's width out of the bargain.
      leftInExplorerColumn: Boolean(document.querySelector('.sidebar > .bottom-panel.panel-dock-bottom-left')),
      rightInBuildColumn: Boolean(document.querySelector('.right-tool-window > .bottom-panel.panel-dock-bottom-right')),
      inBottomRow: document.querySelectorAll('.bottom-row .bottom-panel').length,
    };
  })())`));
  assert.deepEqual(corners, {
    sideBySide: true,
    sameRow: true,
    bothUsable: true,
    leftInExplorerColumn: true,
    rightInBuildColumn: true,
    inBottomRow: 0,
  }, "Each lower corner belongs to its own column, and only the middle uses the row under the editor.");

  // Dropping into a corner has to look different from dropping in the middle,
  // which is the whole point of there being three places. The corner takes the
  // width of the column it lands under and leaves the editor alone; the middle
  // spans the editor. A single window used to stretch over the full width
  // whichever place it was in, so the corners appeared to do nothing.
  await collectWindowsAtBottom();
  // The whole block goes into the corner, not one tab out of it: a single tab
  // would leave the rest of them behind.
  // The right corner is only as wide as the build tool's column, so a drop at
  // three quarters of the width still lands in the middle. Aim at the column.
  await dragHandleTo("bottom", viewport.width - 40, viewport.height - 20);
  const loneCorner = JSON.parse(await waitFor(
    async () => {
      const state = await evaluate(cdp, `JSON.stringify((() => {
        const corner = document.querySelector('.right-tool-window > .bottom-panel.panel-dock-bottom-right');
        const column = document.querySelector('.right-tool-window');
        const editor = document.querySelector('.editor-stack');
        if (!corner || !column || !editor) return null;
        const cornerBox = corner.getBoundingClientRect();
        const columnBox = column.getBoundingClientRect();
        return {
          asWideAsItsColumn: Math.abs(cornerBox.width - columnBox.width) <= 2,
          clearOfTheEditor: cornerBox.left >= Math.round(editor.getBoundingClientRect().right) - 2,
          nothingInTheBottomRow: document.querySelectorAll('.bottom-row .bottom-panel').length,
        };
      })())`);
      return state === "null" ? "" : state;
    },
    8_000,
    "a lone corner window keeps to its column",
  ).catch(async (error) => {
    const probe = await evaluate(cdp, `JSON.stringify({
      docks: [...document.querySelectorAll('.bottom-panel')].map(item => item.dataset.panelDock),
      hasColumn: Boolean(document.querySelector('.right-tool-window')),
    })`);
    throw new Error(`${error.message} Zustand: ${probe}`);
  }));
  assert.deepEqual(
    loneCorner,
    { asWideAsItsColumn: true, clearOfTheEditor: true, nothingInTheBottomRow: 0 },
    `A corner must stay inside its column: ${JSON.stringify(loneCorner)}`,
  );
  await collectWindowsAtBottom();

  // Dropped in the middle, the whole block leaves Kiwi's window and becomes a
  // window of the operating system — the only placement that reaches a second
  // monitor. It used to land in the floating panel instead, which stays inside
  // the program however far it is dragged.
  await collectWindowsAtBottom();
  // The drag ends itself on blur, so it has to begin with the workbench in
  // front. Earlier steps open and close windows of their own, and focus does
  // not always come back by the time this one starts pressing.
  await cdp.send("Page.bringToFront").catch(() => {});
  await waitFor(() => evaluate(cdp, "document.hasFocus()"), 8_000, "workbench in front before the drag");
  const middleStrip = await elementPoint(cdp, ".bottom-panel.panel-dock-bottom .panel-drag-handle");
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: middleStrip.x, y: middleStrip.y, button: "left", buttons: 1, clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: Math.round(viewport.width / 2),
    y: Math.round(viewport.height / 2),
    button: "left",
    buttons: 1,
  });
  // The middle had no preview at all before: the hint was rendered with a class
  // no rule matched, so the drag looked dead right up to the drop.
  assert.equal(
    await waitFor(
      () => evaluate(cdp, `(() => {
        const node = document.querySelector('.panel-drop-window');
        if (!node) return "";
        const box = node.getBoundingClientRect();
        return box.width > 200 && box.height > 100 ? (node.textContent || "").trim() : "";
      })()`),
      5_000,
      "drop hint for a window of its own",
    ),
    "Eigenes Fenster",
  );
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: Math.round(viewport.width / 2),
    y: Math.round(viewport.height / 2),
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
  const droppedPanelTarget = await waitForTarget("panel", 20_000).catch(async (error) => {
    // A drag cancels itself when the window loses focus. That is right for a
    // person and invisible to a synthetic release, which then lands on nobody
    // at all: the hint was still up a moment earlier, so the failure reads as
    // a window that never opened. Say which of the two it was.
    const probe = await evaluate(cdp, `JSON.stringify({
      focused: document.hasFocus(),
      dragging: Boolean(document.querySelector('.bottom-panel.panel-dragging')),
      hint: Boolean(document.querySelector('.panel-drop-window')),
      docks: [...document.querySelectorAll('.bottom-panel')].map(item => item.dataset.panelDock),
    })`);
    const targets = (await listPageTargets()).map((item) => item.url);
    throw new Error(`${error.message} Zustand: ${probe} Fenster: ${JSON.stringify(targets)}`);
  });
  assert.ok(droppedPanelTarget, "Dropping in the middle has to open a window of the operating system.");
  await waitFor(
    () => evaluate(cdp, "!document.querySelector('.bottom-panel')"),
    10_000,
    "workbench keeps no strip behind while its tool window is elsewhere",
  );
  // Asking a second time must bring that window forward instead of opening
  // another one drawing the same tool window.
  await evaluate(cdp, `window.kiwi.panel.openWindow(${JSON.stringify(second)})`, true);
  assert.equal(
    (await listPageTargets()).filter((item) => {
      try { return new URL(item.url).searchParams.get("window") === "panel"; }
      catch { return false; }
    }).length,
    1,
    "A second request must not leave two windows drawing the same tool window.",
  );
  await evaluate(cdp, "window.kiwi.panel.closeWindow()", true);
  await waitFor(
    () => evaluate(cdp, "Boolean(document.querySelector('.bottom-panel'))"),
    10_000,
    "tool window back in the workbench after its own window closed",
  );

  // The floating placement inside the workbench stays reachable from the picker.
  await dockFocusedPanel("floating");
  await waitFor(
    () => evaluate(cdp, "Boolean(document.querySelector('.bottom-panel.panel-dock-floating'))"),
    8_000,
    "tool window floating above the workbench",
  );
  const floatingBox = () => evaluate(cdp, `JSON.stringify((() => {
    const box = document.querySelector('.bottom-panel.panel-dock-floating').getBoundingClientRect();
    return { x: Math.round(box.left), y: Math.round(box.top), width: Math.round(box.width), height: Math.round(box.height) };
  })())`).then((value) => JSON.parse(value));
  const placed = await floatingBox();
  assert.ok(
    placed.width > 200 && placed.height > 120 && placed.x >= -1 && placed.y >= -1,
    `The floating window has no usable geometry: ${JSON.stringify(placed)}`,
  );

  const handle = await elementPoint(cdp, ".bottom-panel.panel-dock-floating .panel-drag-handle");
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: handle.x, y: handle.y, button: "left", buttons: 1, clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: handle.x + 90, y: handle.y - 60, button: "left", buttons: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: handle.x + 90, y: handle.y - 60, button: "left", buttons: 0, clickCount: 1 });
  const moved = await floatingBox();
  assert.ok(
    Math.abs(moved.x - (placed.x + 90)) <= 3 && Math.abs(moved.y - (placed.y - 60)) <= 3,
    `The floating window did not follow the pointer: ${JSON.stringify({ placed, moved })}`,
  );

  const corner = await elementPoint(cdp, ".panel-float-resizer");
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: corner.x, y: corner.y, button: "left", buttons: 1, clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: corner.x + 70, y: corner.y + 50, button: "left", buttons: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: corner.x + 70, y: corner.y + 50, button: "left", buttons: 0, clickCount: 1 });
  const resized = await floatingBox();
  assert.ok(
    resized.width > moved.width + 40 && resized.height > moved.height + 20,
    `The floating window did not resize from its corner: ${JSON.stringify({ moved, resized })}`,
  );

  // Dropping it back on an edge docks it again, with all of its tabs.
  await dragHandleTo("floating", Math.round(viewport.width / 2), viewport.height - 20);
  await waitFor(
    () => evaluate(cdp, `Boolean(document.querySelector('.bottom-panel.panel-dock-bottom'))
      && !document.querySelector('.bottom-panel.panel-dock-floating')`),
    8_000,
    "floating window docked back to the bottom",
  );
  await dockFocusedPanel("bottom-right");
  await waitFor(
    () => evaluate(cdp, "Boolean(document.querySelector('.bottom-panel.panel-dock-bottom-right'))"),
    8_000,
    "a tab moved out of the merged window again",
  );

  // Tool windows scattered over four edges, resized, one of them closed: the
  // way back used to be one control at a time, so there is a single action
  // that undoes all of it. It is checked from a genuinely tangled state.
  await dockFocusedPanel("bottom-left");
  await waitFor(
    () => evaluate(cdp, "Boolean(document.querySelector('.bottom-panel.panel-dock-bottom-left'))"),
    8_000,
    "a tool window parked on the left before the reset",
  );
  await selectPanelTab("TERMINAL");
  await dockFocusedPanel("bottom-right");
  await waitFor(
    () => evaluate(cdp, "Boolean(document.querySelector('.bottom-panel.panel-dock-bottom-right'))"),
    8_000,
    "a second tool window parked in a corner before the reset",
  );
  await evaluate(cdp, `(() => {
    localStorage.setItem("kiwi.workbench.panelHeight", "480");
    return true;
  })()`);
  const tangled = JSON.parse(await evaluate(cdp, `JSON.stringify(
    [...document.querySelectorAll('.bottom-panel')].map(item => item.dataset.panelDock).sort()
  )`));
  assert.ok(
    tangled.length > 1 && tangled.some((dock) => dock !== "bottom"),
    `The reset has to start from a scattered arrangement: ${JSON.stringify(tangled)}`,
  );
  assert.equal(
    await evaluate(cdp, `(() => {
      const picker = document.querySelector('.layout-profile-switcher');
      if (!picker) return false;
      picker.value = "kiwi-reset";
      picker.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`),
    true,
    "Die Statusleiste muss die Standardansicht anbieten.",
  );
  await waitFor(
    async () => {
      const state = JSON.parse(await evaluate(cdp, `JSON.stringify({
        docks: [...document.querySelectorAll('.bottom-panel')].map(item => item.dataset.panelDock),
        height: localStorage.getItem("kiwi.workbench.panelHeight"),
        detached: !document.querySelector('.bottom-panel'),
      })`));
      if (state.docks.length !== 1) throw new Error(JSON.stringify(state));
      if (state.docks[0] !== "bottom") throw new Error(JSON.stringify(state));
      if (state.height !== "215") throw new Error(JSON.stringify(state));
      if (state.detached) throw new Error(JSON.stringify(state));
      return true;
    },
    10_000,
    "every tool window back at the bottom after the reset",
  );
  // Every tab is down there again, BUILD included — the one the reset is for.
  const resetTabs = JSON.parse(await evaluate(cdp, `JSON.stringify(
    [...document.querySelectorAll('.bottom-panel.panel-dock-bottom .panel-tabs button')].map(item => item.textContent)
  )`));
  for (const label of ["BUILD", "TERMINAL", "PROBLEMS", "DEBUG"]) {
    assert.ok(
      resetTabs.some((tab) => (tab || "").includes(label)),
      `${label} is missing from the reset bottom window: ${JSON.stringify(resetTabs)}`,
    );
  }

  // The tool window as a window of the operating system: it is what makes a
  // second monitor possible, so it is checked as a real second window with its
  // own DevTools target — data flowing out of the workbench, clicks flowing
  // back into it.
  await collectWindowsAtBottom();
  await selectPanelTab("PROBLEMS");
  await evaluate(cdp, `document.querySelector('.panel-detach-action')?.click()`);
  const panelTarget = await waitForTarget("panel", 20_000);
  const panelCdp = await createCdp(panelTarget.webSocketDebuggerUrl);
  await panelCdp.send("Runtime.enable");
  await waitFor(
    () => evaluate(panelCdp, "document.readyState === 'complete' && Boolean(window.kiwi)"),
    15_000,
    "detached tool window preload",
  );
  // The workbench publishes; the window draws what it receives.
  const detachedTabs = JSON.parse(await waitFor(
    () => evaluate(panelCdp, `(() => {
      const tabs = [...document.querySelectorAll('.panel-dock-window .panel-tabs button')]
        .map(item => item.textContent).filter(Boolean);
      return tabs.length >= 6 ? JSON.stringify(tabs) : "";
    })()`),
    20_000,
    "tabs in the detached tool window",
  ));
  for (const label of ["PROBLEMS", "DEBUG", "TERMINAL"]) {
    assert.ok(
      detachedTabs.some((tab) => tab.includes(label)),
      `${label} missing in the detached window: ${JSON.stringify(detachedTabs)}`,
    );
  }
  // It is a Kiwi window like the others, so it opens the way they do: the same
  // title bar and the same document header, not a workbench strip on its own.
  assert.equal(
    await evaluate(panelCdp, `Boolean(
      document.querySelector('.standalone-window-titlebar')
      && document.querySelector('.panel-window-document > .standalone-document-header')
      && document.querySelector('.standalone-document-header .panel-window-attach')
    )`),
    true,
    "The detached tool window must look like every other Kiwi window.",
  );
  assert.equal(
    await evaluate(cdp, "!document.querySelector('.bottom-panel')"),
    true,
    "The workbench has to give up the room while its tool window is elsewhere.",
  );

  // A click over there acts on the workbench, which is the only place the
  // state lives. While the window is out the workbench draws nothing, so the
  // proof of that is what comes back when it docks again — checked below.
  await evaluate(panelCdp, `(() => {
    const tab = [...document.querySelectorAll('.panel-dock-window .panel-tabs button')]
      .find(item => item.textContent?.includes('DEBUG'));
    tab?.click();
    return Boolean(tab);
  })()`);
  await waitFor(
    () => evaluate(panelCdp, "Boolean(document.querySelector('.panel-dock-window .debug-panel'))"),
    10_000,
    "debug view rendered in the detached window",
  );

  // And docking it back brings the content home. The click is deferred so the
  // answer leaves before the window it closes does.
  assert.equal(
    await evaluate(panelCdp, `setTimeout(() => document.querySelector('.panel-window-attach')?.click(), 50);
      Boolean(document.querySelector('.panel-window-attach'))`),
    true,
    "Das abgetrennte Werkzeugfenster hat keinen Knopf zum Zurückdocken.",
  );
  await waitFor(
    () => evaluate(cdp, "Boolean(document.querySelector('.bottom-panel'))"),
    15_000,
    "tool window back in the workbench",
  );
  // The tab picked in the detached window is the one the workbench comes back
  // showing: the click really did reach the session, not just the other window.
  await waitFor(
    () => evaluate(cdp, `[...document.querySelectorAll('.bottom-panel .panel-tabs button')]
      .some(item => item.textContent?.includes('DEBUG') && item.classList.contains('active'))`),
    10_000,
    "workbench returns showing the tab the detached window selected",
  );
  panelCdp.close();

  // A side output window plus a bottom-docked Maven/Gradle window used to hit
  // CSS Grid auto-placement and overlap or create an empty track. Exercise the
  // real geometry, not merely the class names. The checks above end with
  // everything collected at the bottom, so the side window is set up again.
  await dockFocusedPanel("bottom-right");
  await waitFor(
    () => evaluate(cdp, "Boolean(document.querySelector('.bottom-panel.panel-dock-bottom-right'))"),
    8_000,
    "side window for the bottom-docked build tool",
  );
  await evaluate(cdp, `(() => {
    // A selected output also owns the right-tool-window now. Select the build
    // host whenever its actual header is absent instead of mistaking the
    // shared column itself for an already visible Gradle/Maven tool.
    if (!document.querySelector('.right-tool-header')) {
      document.querySelector('.right-rail button[title="Build Tool"]')?.click();
    }
  })()`);
  await waitFor(() => evaluate(cdp, "Boolean(document.querySelector('.right-tool-window .right-tool-header'))"), 8_000, "build tool window before bottom docking");
  await evaluate(cdp, `(() => {
    const header = document.querySelector('.right-tool-header');
    header.dispatchEvent(new DragEvent('dragend', {
      bubbles: true,
      clientX: window.innerWidth / 2,
      clientY: window.innerHeight - 2,
    }));
  })()`);
  await waitFor(
    () => evaluate(cdp, "document.querySelector('.workspace')?.classList.contains('tool-dock-bottom')"),
    8_000,
    "build tool docked below editor with side output",
  );
  // The right corner is the foot of the build tool's column, so it goes where
  // that column goes. Moved below the editor, the two stack inside it — build
  // content above, the tool window at its foot — instead of overlapping or
  // leaving one of them stranded on an edge that no longer has a column.
  const dockGeometry = JSON.parse(await evaluate(cdp, `JSON.stringify((() => {
    const box = selector => document.querySelector(selector).getBoundingClientRect();
    const editor = box('.editor-stack');
    const output = box('.bottom-panel.panel-dock-bottom-right');
    const column = box('.right-tool-window');
    const header = document.querySelector('.right-tool-window > .right-tool-header')?.getBoundingClientRect();
    const tolerance = 2;
    return {
      columnBelowEditor: column.top >= editor.bottom - tolerance,
      outputInsideColumn: Boolean(document.querySelector('.right-tool-window > .bottom-panel.panel-dock-bottom-right')),
      outputAtTheFoot: header ? output.top >= header.bottom - tolerance : false,
      outputWithinColumn: output.left >= column.left - tolerance && output.right <= column.right + tolerance,
      outputHasRoom: output.width > 150 && output.height > 60,
    };
  })())`));
  assert.deepEqual(dockGeometry, {
    columnBelowEditor: true,
    outputInsideColumn: true,
    outputAtTheFoot: true,
    outputWithinColumn: true,
    outputHasRoom: true,
  }, "A corner follows the column it belongs to, and stacks inside it without overlapping.");

  await evaluate(cdp, `(() => {
    const picker = document.querySelector('.bottom-panel.panel-focused .panel-dock-picker select')
      || document.querySelector('.panel-dock-picker select');
    picker.value = 'bottom';
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    const header = document.querySelector('.right-tool-header');
    header?.dispatchEvent(new DragEvent('dragend', {
      bubbles: true,
      clientX: window.innerWidth - 80,
      clientY: 120,
    }));
  })()`);
  await waitFor(
    () => evaluate(cdp, "Boolean(document.querySelector('.bottom-panel.panel-dock-bottom'))"),
    8_000,
    "output panel back at the bottom",
  );

  // Project structure opens as its own window, like the settings do.
  await evaluate(cdp, `document.querySelector('.activity-bottom button[title="Projektstruktur"]')?.click()`);
  const structureTarget = await waitForTarget("structure", 15_000);
  const structureCdp = await createCdp(structureTarget.webSocketDebuggerUrl);
  await structureCdp.send("Runtime.enable");
  await waitFor(
    () => evaluate(structureCdp, "document.readyState === 'complete' && Boolean(document.querySelector('.structure-window-shell'))"),
    15_000,
    "project structure window",
  );
  // The shell is on screen before its navigation is, so reading the sections in
  // the same instant returned an empty list — and an assertion that failed
  // while reporting nothing missing. The list is waited for, not sampled.
  const structureSections = await waitFor(
    async () => {
      const sections = await evaluate(structureCdp, `JSON.stringify(
        [...document.querySelectorAll('.project-structure-nav button')].map(item => item.textContent?.trim())
      )`);
      return String(sections).includes("Module") ? sections : "";
    },
    15_000,
    "sections of the project structure window",
  ).catch(async (error) => {
    const probe = await evaluate(structureCdp, `JSON.stringify({
      sections: [...document.querySelectorAll('.project-structure-nav button')].map(item => item.textContent?.trim()),
      hasNav: Boolean(document.querySelector('.project-structure-nav')),
      shell: Boolean(document.querySelector('.structure-window-shell')),
    })`);
    throw new Error(`${error.message} Zustand: ${probe}`);
  });
  // Nothing is written until it is confirmed, so no apply bar before a change.
  assert.equal(
    await evaluate(structureCdp, "Boolean(document.querySelector('.structure-apply-bar'))"),
    false,
    "The apply bar must only appear once something was changed.",
  );
  // Deferred like the workbench close below: closing the window this command
  // runs in takes its DevTools target away, so the answer has to leave first.
  await evaluate(structureCdp, "setTimeout(() => window.kiwi.app.close(), 50); true");
  structureCdp.close();

  // Follow a real project log through the main-process IPC handler and draw
  // both its existing tail and a later append in the actual tool window.
  const tailerLog = path.join(second, "tailer-smoke.log");
  await fs.writeFile(tailerLog, "INFO existing tailer line\n");
  await evaluate(cdp, `(() => {
    [...document.querySelectorAll('.menu-nav .menu-item-wrap > button')]
      .find(button => button.textContent?.trim() === 'Ansicht')?.click();
    return true;
  })()`);
  await waitFor(
    () => evaluate(cdp, `[...document.querySelectorAll('.menu-dropdown button')]
      .some(button => button.textContent?.includes('Werkzeugfenster: Tailer'))`),
    5_000,
    "Tailer menu entry",
  );
  await evaluate(cdp, `(() => {
    [...document.querySelectorAll('.menu-dropdown button')]
      .find(button => button.textContent?.includes('Werkzeugfenster: Tailer'))?.click();
    return true;
  })()`);
  await waitFor(() => evaluate(cdp, "Boolean(document.querySelector('.tailer'))"), 5_000, "Tailer tool window");
  assert.equal(await evaluate(cdp, "document.querySelector('[data-panel-view=tailer] .panel-detach-action')?.disabled"), true,
    "The Tailer must not offer a detached window that cannot display its log.");
  await evaluate(cdp, `window.kiwi.tailer.open(${JSON.stringify(tailerLog)}, { lastLines: 10 })`, true);
  await waitFor(
    () => evaluate(cdp, "document.querySelector('.tailer-surface')?.textContent?.includes('INFO existing tailer line')"),
    5_000,
    "initial log lines through Tailer IPC",
  );
  await fs.appendFile(tailerLog, "WARN appended tailer line\n");
  await waitFor(
    () => evaluate(cdp, "document.querySelector('.tailer-surface')?.textContent?.includes('WARN appended tailer line')"),
    5_000,
    "appended log lines in Tailer",
  );
  assert.equal(await evaluate(cdp, "window.kiwi.tailer.close()", true), true, "Tailer IPC must stop following the log.");

  // A .http file is executed with one click, so the whole path is exercised
  // against a real server: the grammar, the code lens, the IPC bridge and the
  // response view. A local server keeps the check offline and deterministic.
  const httpCalls = [];
  const httpServer = http.createServer((request, response) => {
    httpCalls.push({ method: request.method, url: request.url, auth: request.headers.authorization });
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"item":"Kiwi","ok":true}');
  });
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const httpPort = httpServer.address().port;
  const requestFile = path.join(second, "requests.http");
  await fs.writeFile(requestFile, [
    `@host = http://127.0.0.1:${httpPort}`,
    "@token = e2e-secret",
    "",
    "### Bestellungen laden",
    "GET {{host}}/orders",
    "Authorization: Bearer {{token}}",
    "",
  ].join("\n"));

  try {
    await waitFor(
      () => evaluate(cdp, `[...document.querySelectorAll('.tree-row')].some(row => row.title === ${JSON.stringify(requestFile)})`),
      12_000,
      "requests.http in the Explorer",
    );
    await doubleClickElement(cdp, '.tree-row[title$="requests.http"]');
    await waitFor(
      () => evaluate(cdp, `[...document.querySelectorAll('.tabs .tab')].some(tab => tab.textContent?.includes('requests.http'))`),
      10_000,
      "requests.http tab",
    );

    // The code lens is the only affordance on the request line; if the grammar
    // is not registered Monaco never asks the provider and nothing appears.
    await waitFor(
      () => evaluate(cdp, "[...document.querySelectorAll('.codelens-decoration')].some(item => item.textContent?.includes('Bestellungen laden'))"),
      10_000,
      "code lens above the request",
    );

    // Monaco resolves a code lens on the editor's own mouse-up, not on a DOM
    // click event, so this has to be a real synthetic mouse press.
    await leftClickElement(cdp, ".codelens-decoration a");

    const httpResult = await waitFor(() => evaluate(cdp, `(() => {
      const view = document.querySelector('.http-view');
      if (!view) return null;
      const status = view.querySelector('.http-status')?.textContent;
      if (!status) return null;
      return JSON.stringify({
        status,
        ok: Boolean(view.querySelector('.http-status-ok')),
        body: view.querySelector('.http-detail pre')?.textContent || '',
        headers: view.querySelector('.http-headers')?.textContent || '',
      });
    })()`), 20_000, "HTTP response in the bottom panel");
    const parsed = JSON.parse(httpResult);
    assert.equal(parsed.status, "200", `Unexpected HTTP status in the panel: ${httpResult}`);
    assert.equal(parsed.ok, true);
    // The body is pretty-printed, so the raw one-line JSON must not appear.
    assert.ok(parsed.body.includes('"item": "Kiwi"'), `Response body was not formatted: ${parsed.body}`);
    assert.equal(httpCalls.length, 1, "The request did not reach the server exactly once.");
    assert.equal(httpCalls[0].url, "/orders", "The {{host}} variable was not resolved.");
    assert.equal(httpCalls[0].auth, "Bearer e2e-secret", "The header variable was not resolved.");
  } finally {
    await new Promise((resolve) => httpServer.close(resolve));
  }

  // The chosen accent has to reach every surface that carries it. The
  // workbench used to override one of the four accent tokens while the
  // stylesheet wrote most of its rules against another, so two accents showed
  // up side by side in the same window.
  const accentSurfaces = async (color) => {
    await evaluate(cdp, `window.kiwi.settings.update({ accentColor: ${JSON.stringify(color)} })`, true);
    return JSON.parse(await waitFor(
      async () => {
        const state = await evaluate(cdp, `JSON.stringify((() => {
          const read = (selector, property) => {
            const node = document.querySelector(selector);
            return node ? getComputedStyle(node).getPropertyValue(property).trim() : "";
          };
          const shell = document.querySelector('.app-shell');
          if (!shell) return null;
          const styles = getComputedStyle(shell);
          return {
            accent: styles.getPropertyValue('--accent').trim(),
            green: styles.getPropertyValue('--green').trim(),
            resizer: read('.workbench-resizer', 'background-color'),
          };
        })())`);
        return state === "null" ? "" : state;
      },
      8_000,
      `accent surfaces for ${color}`,
    ));
  };
  const blueAccent = await accentSurfaces("#3b6ef5");
  assert.equal(blueAccent.accent, "#3b6ef5", `The chosen accent did not reach --accent: ${JSON.stringify(blueAccent)}`);
  // --green is derived from --accent in the stylesheet, so the two can no
  // longer drift apart the way they did.
  assert.equal(blueAccent.green, blueAccent.accent, `--green and --accent disagree: ${JSON.stringify(blueAccent)}`);
  await evaluate(cdp, `window.kiwi.settings.update({ accentColor: "#7ad83b" })`, true);

  // Every designed corner is a share of one setting, so the setting has to
  // reach the pixels: a theme that says "square" must produce square corners
  // and not merely store a number.
  // Waiting for a number is not the same as waiting for the setting to arrive:
  // the first reading is whatever the corner was before, and the check then
  // compared a value against itself. Each measurement waits for the reading to
  // change from the one before it.
  const readCorner = () => evaluate(cdp, `(() => {
    const search = document.querySelector('.toolbar-search');
    if (!search) return "";
    return getComputedStyle(search).borderTopLeftRadius || "";
  })()`);
  const cornerAt = async (roundness, previous) => {
    await evaluate(cdp, `window.kiwi.settings.update({ uiRoundness: ${roundness} })`, true);
    return waitFor(
      async () => {
        const pixels = Number.parseFloat(await readCorner());
        if (!Number.isFinite(pixels)) return "";
        if (previous !== undefined && pixels === previous) return "";
        return JSON.stringify(pixels);
      },
      8_000,
      `corner radius at ${roundness}%`,
    ).then((value) => JSON.parse(value));
  };
  const startingCorner = Number.parseFloat(await readCorner());
  const roundCorner = await cornerAt(200, Number.isFinite(startingCorner) ? startingCorner : undefined);
  const squareCorner = await cornerAt(0, roundCorner);
  const defaultCorner = await cornerAt(100, squareCorner);
  assert.ok(
    squareCorner === 0 && defaultCorner > 0 && roundCorner > defaultCorner,
    `The roundness setting did not reach the corners: ${JSON.stringify({ squareCorner, defaultCorner, roundCorner })}`,
  );

  // UI scaling is applied as zoom, and a media query keeps reporting the
  // unscaled window: at 150 % the breakpoints never fired even though only two
  // thirds of the width was left. Container queries measure what is really
  // there, so the same layout has to collapse at 150 % as at a narrow window.
  const layoutAt = async (scale, width) => {
    await evaluate(cdp, `window.kiwi.settings.update({ uiScale: ${scale} })`, true);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width, height: 900, deviceScaleFactor: 1, mobile: false,
    });
    await waitFor(() => evaluate(cdp, `Math.abs(window.innerWidth - ${width}) < 4`), 5_000, `viewport ${width}px`);
    // The setting travels through the main process, so the zoom lands a moment
    // later; asserting before it does would measure the previous scale.
    await waitFor(
      () => evaluate(cdp, `(Number(document.body.style.zoom) || 1) === ${scale}`),
      5_000,
      `UI scaling ${scale}`,
    );
    // One frame for the container query to settle.
    await afterFrames(cdp, "return true;");
    return evaluate(cdp, `(() => {
      const shell = document.querySelector('.app-shell');
      const search = document.querySelector('.toolbar-search');
      return {
        // The width the layout reasons in, which is what a container query sees.
        layoutWidth: Math.round(shell?.getBoundingClientRect().width / (Number(document.body.style.zoom) || 1)),
        searchHidden: !search || getComputedStyle(search).display === 'none',
        overflows: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      };
    })()`);
  };

  const wide = await layoutAt(1, 1600);
  assert.equal(wide.searchHidden, false, "The toolbar search should be visible on a wide window.");
  assert.equal(wide.overflows, false, "The workbench overflowed horizontally at 100 %.");

  const narrow = await layoutAt(1, 900);
  assert.equal(narrow.searchHidden, true, "A narrow window must collapse the toolbar search.");
  assert.equal(narrow.overflows, false, "The workbench overflowed horizontally on a narrow window.");

  // 1600 physical pixels at 150 % leaves about 1066 — below the same
  // breakpoint, so the layout has to react exactly as it did at 900.
  const scaled = await layoutAt(1.5, 1500);
  assert.equal(scaled.searchHidden, true, `150 % scaling did not collapse the toolbar: ${JSON.stringify(scaled)}`);
  assert.equal(scaled.overflows, false, `The workbench overflowed horizontally at 150 %: ${JSON.stringify(scaled)}`);

  await evaluate(cdp, "window.kiwi.settings.update({ uiScale: 1 })", true);
  await cdp.send("Emulation.clearDeviceMetricsOverride");

  // Adding a dependency used to mean editing pom.xml by hand. The search needs
  // the network, so only the part that writes the file is exercised here.
  await fs.writeFile(path.join(second, "pom.xml"), [
    "<project>",
    "  <modelVersion>4.0.0</modelVersion>",
    "  <groupId>de.demo</groupId><artifactId>beta</artifactId><version>1.0</version>",
    "  <dependencies>",
    "  </dependencies>",
    "</project>",
  ].join("\n"));
  const added = await evaluate(cdp, `window.kiwi.project.addDependency(${JSON.stringify(second)},
    { groupId: "com.google.guava", artifactId: "guava", version: "33.0.0-jre" }, "test")
    .then(result => JSON.stringify(result))`, true);
  assert.ok(String(added).includes('"added":true'), `Dependency was not written: ${added}`);
  const pom = await fs.readFile(path.join(second, "pom.xml"), "utf8");
  assert.ok(pom.includes("<artifactId>guava</artifactId>"), `pom.xml has no guava entry: ${pom}`);
  assert.ok(pom.includes("<scope>test</scope>"), "The chosen scope was not written.");
  const repeated = await evaluate(cdp, `window.kiwi.project.addDependency(${JSON.stringify(second)},
    { groupId: "com.google.guava", artifactId: "guava", version: "33.0.0-jre" }, "test")
    .then(result => JSON.stringify(result))`, true);
  assert.ok(String(repeated).includes('"added":false'), `A duplicate entry was written: ${repeated}`);

  // Adding a library from the file it belongs in.
  //
  // The dialog offers every build file of the project and used to start on the
  // first, which in a multi-project build is the root — a file that governs no
  // source. The library was written correctly and nothing about the project
  // changed, which from the outside is exactly what "it does not work" looks
  // like. Right-clicking in a build file says which one is meant.
  // Monaco puts its context menu in a shadow root, so the document alone finds
  // nothing and reads exactly like a menu that never opened.
  const dependencyMenuText = async () => evaluate(cdp, `(() => {
    for (const node of document.querySelectorAll('*')) {
      const labels = [...(node.shadowRoot?.querySelectorAll('.action-label') || [])]
        .map(item => item.textContent?.trim()).filter(Boolean);
      if (labels.length) return labels.join(' | ');
    }
    return '';
  })()`);
  // A right-click only opens a menu on an editor that is focused and has
  // painted its lines. Without both, the click lands on a surface that is
  // still arriving and nothing opens — which reads as a missing menu entry.
  const openEditorMenu = async (label) => {
    await focusEditor(cdp);
    await waitFor(
      () => evaluate(cdp, "document.querySelectorAll('.monaco-editor .view-line').length > 0"),
      10_000,
      `gezeichnete Zeilen vor ${label}`,
    );
    await rightClickElement(cdp, ".monaco-editor .view-line");
    return waitFor(async () => (await dependencyMenuText()) || "", 8_000, label);
  };
  const closeEditorMenu = async () => {
    await pressKey(cdp, "Escape", "Escape", 27);
    await waitFor(async () => !(await dependencyMenuText()), 5_000, "Editor-Kontextmenü geschlossen").catch(() => undefined);
  };
  // The tree is virtualised and keeps wherever it was last scrolled to, so a
  // row that exists need not be mounted. Back to the top, wait for the row,
  // and click until the tab is actually the active one.
  await showExplorer(cdp);
  await evaluate(cdp, `(() => {
    const viewport = document.querySelector('.workspace-project-tree.active .virtual-tree-viewport');
    if (!viewport) return false;
    viewport.scrollTop = 0;
    viewport.dispatchEvent(new Event('scroll', { bubbles: true }));
    return true;
  })()`);
  await waitFor(
    () => evaluate(cdp, `Boolean(document.querySelector('.workspace-project-tree.active .tree-row[title$="pom.xml"]'))`),
    10_000,
    "Zeile für pom.xml",
  );
  await clickUntil(
    cdp,
    () => leftClickElement(cdp, '.workspace-project-tree.active .tree-row[title$="pom.xml"]'),
    () => evaluate(cdp, "[...document.querySelectorAll('.tabs .tab.active')].some(tab => tab.textContent?.includes('pom.xml'))"),
    "pom.xml im Editor",
    15_000,
  );
  const buildFileMenu = await openEditorMenu("Kontextmenü in der pom.xml");
  assert.match(
    buildFileMenu,
    /Abhängigkeit hinzufügen/,
    `Das Kontextmenü einer pom.xml muss die Abhängigkeit anbieten: ${buildFileMenu}`,
  );

  // And that choosing it opens the dialog on that file.
  //
  // Chosen with the keyboard. The menu lives in a shadow root, and a mouse
  // event dispatched at the entry's own coordinates never reaches it — the
  // element at that point is the entry, and the menu stays open regardless.
  // Arrow keys and Enter are a path a person really uses and one the menu
  // really answers.
  const menuEntries = JSON.parse(await evaluate(cdp, `JSON.stringify((() => {
    for (const node of document.querySelectorAll('*')) {
      const labels = [...(node.shadowRoot?.querySelectorAll('.action-label') || [])]
        .map(item => (item.textContent || '').trim()).filter(Boolean);
      if (labels.length) return labels;
    }
    return [];
  })())`));
  const entryIndex = menuEntries.findIndex((label) => label.includes("Abhängigkeit hinzufügen"));
  assert.ok(entryIndex >= 0, `Der Menüeintrag fehlt: ${JSON.stringify(menuEntries)}`);
  for (let step = 0; step <= entryIndex; step += 1) {
    await pressKey(cdp, "ArrowDown", "ArrowDown", 40);
  }
  await pressEnter(cdp);
  await waitFor(
    () => evaluate(cdp, "Boolean(document.querySelector('.dependency-dialog'))"),
    10_000,
    "Dependency-Dialog aus dem Editor-Kontextmenü",
  ).catch(async (error) => {
    const state = await evaluate(cdp, `JSON.stringify({
      eintraege: ${JSON.stringify(menuEntries)},
      index: ${entryIndex},
      menuNochOffen: (() => {
        for (const node of document.querySelectorAll('*')) {
          if ((node.shadowRoot?.querySelectorAll('.action-label') || []).length) return true;
        }
        return false;
      })(),
      tab: document.querySelector('.tabs .tab.active')?.textContent || '',
    })`);
    throw new Error(`${error.message} Zustand: ${state}`);
  });
  const menuTarget = await evaluate(cdp, "document.querySelector('.dependency-dialog header small')?.textContent || ''");
  assert.match(menuTarget, /pom\.xml/, `Der Dialog muss auf die geöffnete Datei zeigen: ${menuTarget}`);

  /**
   * The crest is a list of selectors, not something a new dialog inherits, and
   * three dialogs that wrote their own `header` went without it unnoticed. This
   * one is already open here, so it is the cheap place to notice the next time
   * the list and the markup drift apart.
   */
  assert.equal(
    await evaluate(cdp, "getComputedStyle(document.querySelector('.dependency-dialog > header'), '::after').height"),
    "2px",
    "Ein Dialog-Kopf ohne die grüne Linie ist aus dem Wappen herausgefallen.",
  );
  await leftClickElement(cdp, '.dependency-dialog header button[aria-label="Schließen"]');
  await waitFor(
    () => evaluate(cdp, "!document.querySelector('.dependency-dialog')"),
    8_000,
    "Dependency-Dialog wieder zu",
  );

  // The dialog itself, driven the way a person drives it.
  //
  // Everything around it was covered — the entry that opens it, the service
  // that writes, the result that comes out — and the part in the middle,
  // typing a coordinate and pressing the button, had never been opened by a
  // test at all. Which is exactly where it broke.
  //
  // Opened from the Dependencies tool window rather than the editor's context
  // menu: that menu lives in a shadow root and a synthetic click on it is a
  // test of the harness, not of the dialog. That the entry is offered there is
  // checked above.
  const dependencyDialogShown = () => evaluate(cdp, "Boolean(document.querySelector('.dependency-dialog'))");
  await clickUntil(
    cdp,
    () => leftClickElement(cdp, '.right-rail button[title="Dependencies"]'),
    () => evaluate(cdp, "Boolean(document.querySelector('.dependency-tool'))"),
    "Dependency-Werkzeugfenster für den Dialog",
    20_000,
  );
  await clickUntil(
    cdp,
    () => leftClickElement(cdp, ".dependency-tool .dependency-add"),
    dependencyDialogShown,
    "Dependency-Dialog",
    15_000,
  );

  // A whole coordinate needs no network: the dialog recognises it as pasted
  // and the button becomes usable without a single search.
  await leftClickElement(cdp, ".dependency-dialog .dependency-search input");
  await cdp.send("Input.insertText", { text: "org.apache.commons:commons-lang3:3.14.0" });
  await waitFor(
    () => evaluate(cdp, "Boolean(document.querySelector('.dependency-dialog .primary-button:not([disabled])'))"),
    8_000,
    "aktive Schaltfläche im Dependency-Dialog",
  );

  await leftClickElement(cdp, ".dependency-dialog .primary-button");
  await waitFor(async () => !(await dependencyDialogShown()), 20_000, "Dependency-Dialog nach dem Hinzufügen")
    .catch(async (error) => {
      // A dialog that stays open has either failed or is still working, and
      // the two look identical from outside. Its own error line says which.
      const state = await evaluate(cdp, `JSON.stringify({
        fehler: document.querySelector('.dependency-dialog .dependency-error')?.textContent || '',
        knopf: document.querySelector('.dependency-dialog .primary-button')?.textContent || '',
        ziel: document.querySelector('.dependency-dialog header small')?.textContent || '',
        toasts: [...document.querySelectorAll('.toast')].map(item => (item.textContent || '').slice(0, 90)),
      })`);
      throw new Error(`${error.message} Zustand: ${state}`);
    });
  const dialogWritten = await waitFor(
    () => evaluate(
      cdp,
      `window.kiwi.file.read(${JSON.stringify(path.join(second, "pom.xml"))}).then(text => text.includes("commons-lang3") ? text : "")`,
      true,
    ),
    10_000,
    "über den Dialog eingetragene Abhängigkeit",
  );
  assert.match(dialogWritten, /<artifactId>commons-lang3<\/artifactId>/);

  // The dependency tool is an editor now, not just the resolved command
  // output. Exercise its read/update/remove path through the real preload API
  // and verify that refreshing the visible tool follows each disk change.
  await evaluate(cdp, `(() => {
    const button = document.querySelector('.right-rail button[title="Dependencies"]');
    if (button && !button.classList.contains('active')) button.click();
    return Boolean(button);
  })()`);
  await waitFor(() => evaluate(cdp, "Boolean(document.querySelector('.dependency-editor'))"), 8_000, "Dependency editor tool window");
  await evaluate(cdp, "document.querySelector('.dependency-editor-toolbar button[title=\"Neu laden\"]')?.click(); true");
  await waitFor(
    () => evaluate(cdp, "[...document.querySelectorAll('.dependency-editor-row')].some(row => row.textContent.includes('guava'))"),
    10_000,
    "Dependency editor declaration",
  );
  const editableDependencies = await evaluate(cdp, `window.kiwi.project.listDependencies(${JSON.stringify(second)})`, true);
  const guava = editableDependencies.dependencies.find((dependency) => dependency.artifactId === "guava");
  assert.ok(guava?.id, `Dependency editor did not return guava: ${JSON.stringify(editableDependencies)}`);
  const updatedDependency = await evaluate(cdp, `window.kiwi.project.updateDependency(
    ${JSON.stringify(second)},
    { id: ${JSON.stringify(guava.id)} },
    "33.1.0-jre"
  )`, true);
  assert.equal(updatedDependency.updated, true, `Dependency version was not updated: ${JSON.stringify(updatedDependency)}`);
  assert.ok((await fs.readFile(path.join(second, "pom.xml"), "utf8")).includes("<version>33.1.0-jre</version>"));
  await evaluate(cdp, "document.querySelector('.dependency-editor-toolbar button[title=\"Neu laden\"]')?.click(); true");
  await waitFor(
    () => evaluate(cdp, "[...document.querySelectorAll('.dependency-editor-row input')].some(input => input.value === '33.1.0-jre')"),
    10_000,
    "Dependency editor updated version",
  );
  const removedDependency = await evaluate(cdp, `window.kiwi.project.removeDependency(
    ${JSON.stringify(second)},
    { id: ${JSON.stringify(guava.id)} }
  )`, true);
  assert.equal(removedDependency.removed, true, `Dependency was not removed: ${JSON.stringify(removedDependency)}`);
  assert.equal((await fs.readFile(path.join(second, "pom.xml"), "utf8")).includes("<artifactId>guava</artifactId>"), false);
  await evaluate(cdp, "document.querySelector('.dependency-editor-toolbar button[title=\"Neu laden\"]')?.click(); true");
  await waitFor(
    () => evaluate(cdp, "![...document.querySelectorAll('.dependency-editor-row')].some(row => row.textContent.includes('guava'))"),
    10_000,
    "Dependency editor removed declaration",
  );


  /**
   * Where a jump to a definition lands.
   *
   * Monaco asks whoever registered an editor opener to open the file the
   * definition is in, and its documented behaviour without one is to do
   * nothing at all. Nobody had registered one, so every jump out of the
   * current file was dropped in silence.
   *
   * Placed here on purpose: until the pom.xml above exists the project has no
   * source root, and the language server answers no definition for anything
   * outside the file being edited. The two classes below sit in the source
   * root the pom declares.
   */
  const spigotPackage = path.join(second, "src", "main", "java", "de", "rauchigesetwas", "player", "spigot");
  await fs.writeFile(path.join(spigotPackage, "CoreUser.java"), [
    "package de.rauchigesetwas.player.spigot;",
    "public class CoreUser {",
    "    CoreAPI api;",
    // Something from the JDK to jump into: it has no file on disk, so
    // the way there is entirely different from the line above.
    "    String name;",
    "}",
    "",
  ].join("\n"), "utf8");
  await evaluate(cdp, `window.kiwi.language.refresh(${JSON.stringify(second)})`, true).catch(() => undefined);
  // Opened through the file palette, because the file is four folders deep and
  // the Explorer would have to be expanded the whole way first.
  await focusEditor(cdp);
  await closeSuggestWidget(cdp);
  await pressChord(cdp, { key: "N", code: "KeyN", vk: 78, modifiers: 10 });
  await waitFor(
    () => evaluate(cdp, "Boolean(document.querySelector('.palette'))"),
    8_000,
    "Dateipalette für den Definitionssprung",
  );
  await cdp.send("Input.insertText", { text: "CoreUser" });
  await waitFor(
    () => evaluate(cdp, "[...document.querySelectorAll('.palette .palette-row, .palette li, .palette button')].some(row => (row.textContent || '').includes('CoreUser'))"),
    10_000,
    "CoreUser.java in der Dateipalette",
  );
  await pressEnter(cdp);
  await waitFor(
    () => evaluate(cdp, "(document.querySelector('.tabs .tab.active .tab-label')?.textContent || '') === 'CoreUser.java'"),
    15_000,
    "CoreUser.java im Editor",
  );
  // The language server has to be able to answer before the jump can be
  // blamed on the opener. Without this the probe would report a missing jump
  // for a definition that was never resolved.
  const coreUserUri = pathToFileURL(path.join(spigotPackage, "CoreUser.java")).toString();
  await waitFor(
    async () => {
      const found = await evaluate(cdp, `window.kiwi.language.request(
        ${JSON.stringify(second)},
        "textDocument/definition",
        { textDocument: { uri: ${JSON.stringify(coreUserUri)} }, position: { line: 2, character: 8 } }
      ).then(result => (Array.isArray(result) ? result.length : result ? 1 : 0), () => 0)`, true);
      return Number(found) > 0;
    },
    60_000,
    "Definition von CoreAPI durch den Sprachserver",
  );
  // The caret onto the type name: home, two lines down, into the word.
  await focusEditor(cdp);
  await pressChord(cdp, { key: "Home", code: "Home", vk: 36, modifiers: 2 });
  await pressKey(cdp, "ArrowDown", "ArrowDown", 40);
  await pressKey(cdp, "ArrowDown", "ArrowDown", 40);
  for (let step = 0; step < 6; step += 1) await pressKey(cdp, "ArrowRight", "ArrowRight", 39);
  await closeSuggestWidget(cdp);
  await pressKey(cdp, "F12", "F12", 123);
  await waitFor(
    () => evaluate(cdp, "(document.querySelector('.tabs .tab.active .tab-label')?.textContent || '') === 'CoreAPI.java'"),
    20_000,
    "Sprung zur Definition in einer anderen Datei",
  );

  /*
   * And a jump that leaves the project altogether.
   *
   * A class from the JDK has no file on disk: the language server addresses it
   * with `jdt://` and hands back the source it has. Three separate things had
   * to be right for this and none of them was — the client never told JDT it
   * could open such an address, so JDT dropped the location and answered "no
   * definition" for every library type; the method that reads the source was
   * not on the allowed list; and the address was wrapped into a file URL a
   * second time on the way to the editor. Any one of them alone makes
   * Ctrl+Click do nothing at all.
   */
  await evaluate(cdp, `(() => {
    const tab = [...document.querySelectorAll(".tabs .tab")].find((item) => (item.textContent || "").includes("CoreUser"));
    tab?.click();
    return Boolean(tab);
  })()`);
  await waitFor(
    () => evaluate(cdp, "(document.querySelector('.tabs .tab.active .tab-label')?.textContent || '') === 'CoreUser.java'"),
    10_000,
    "CoreUser.java für den Bibliothekssprung",
  );
  const libraryWord = await waitFor(
    () => evaluate(cdp, `(() => {
      for (const line of document.querySelectorAll(".view-line")) {
        for (const part of line.querySelectorAll("span span")) {
          if (part.textContent.trim() !== "String") continue;
          const box = part.getBoundingClientRect();
          if (!box.width) continue;
          return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
        }
      }
      return null;
    })()`),
    10_000,
    "das Wort String im Editor",
  );
  for (const type of ["mousePressed", "mouseReleased"]) {
    await cdp.send("Input.dispatchMouseEvent", {
      type,
      x: libraryWord.x,
      y: libraryWord.y,
      button: "left",
      buttons: type === "mousePressed" ? 1 : 0,
      clickCount: 1,
    });
  }
  await closeSuggestWidget(cdp);
  await pressKey(cdp, "F12", "F12", 123);
  // Named for what the language server had: `String.java` where the JDK ships
  // its sources, `String.class` where it does not and the body is decompiled.
  // Both are the same jump; only the runtime on the machine differs.
  await waitFor(
    () => evaluate(cdp, `["String.java", "String.class"].includes(
      (document.querySelector(".tabs .tab.active .tab-label")?.textContent || "").trim()
    )`),
    45_000,
    "Sprung in eine Klasse aus dem JDK",
  );
  // A tab is worth nothing while the pane behind it is blank, and it must not
  // be writable: there is no file to save into.
  // That the pane is not blank is the whole point: the tab used to open with
  // the source in its model and nothing painted behind it. The class line
  // itself is far below the fold in java.lang.String, so what is checked is
  // that lines are rendered and carry text.
  await waitFor(
    () => evaluate(cdp, `[...document.querySelectorAll(".view-line")].filter((line) => line.textContent.trim()).length > 3`),
    20_000,
    "Quelltext der Bibliotheksklasse",
  );
  assert.equal(
    await evaluate(cdp, 'Boolean(document.querySelector(".editor-pane-read-only"))'),
    true,
    "A class out of a jar must open read-only.",
  );
  // Back to where the workbench was, so the steps after this find it there.
  await evaluate(cdp, `(() => {
    const tab = [...document.querySelectorAll(".tabs .tab")].find((item) => (item.textContent || "").includes("CoreAPI"));
    tab?.click();
    return Boolean(tab);
  })()`);
  await waitFor(
    () => evaluate(cdp, "(document.querySelector('.tabs .tab.active .tab-label')?.textContent || '') === 'CoreAPI.java'"),
    10_000,
    "zurück auf CoreAPI.java",
  );

  // Advanced Git workflows stay inside Kiwi and must also work without a
  // network connection. The local repository above is sufficient for the PR
  // signed-out state, visual rebase, commit checks and editor hunk staging.
  await leftClickElement(cdp, '.activitybar button[aria-label="Source Control"]');
  await waitFor(() => evaluate(cdp, "Boolean(document.querySelector('.source-branch'))"), 8_000, "Source Control tool window");

  await leftClickElement(cdp, '.sidebar-header button[title="Weitere Aktionen"]');
  // The menu is queried immediately afterwards, so it has to be there first.
  // Re-clicking is not an option: the button toggles, and a second click would
  // close what the first one opened.
  await waitFor(
    () => evaluate(cdp, "document.querySelectorAll('.git-hamburger-menu button').length > 0"),
    8_000,
    "Git actions menu",
  );
  await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('.git-hamburger-menu button')]
      .find(item => item.textContent?.includes('Pull Requests'));
    button?.click();
    return Boolean(button);
  })()`).then((found) => assert.equal(found, true, "Pull Requests action is missing."));
  await waitFor(() => evaluate(cdp, "Boolean(document.querySelector('.git-pr-view .git-login-card'))"), 8_000, "Pull Request signed-out view");
  assert.equal(await evaluate(cdp, "Boolean(document.querySelector('.git-pr-view input[type=password]'))"), true, "PR token login is missing.");
  await leftClickElement(cdp, ".workbench-tab .tab-close");

  await leftClickElement(cdp, '.sidebar-header button[title="Weitere Aktionen"]');
  // The menu is queried immediately afterwards, so it has to be there first.
  // Re-clicking is not an option: the button toggles, and a second click would
  // close what the first one opened.
  await waitFor(
    () => evaluate(cdp, "document.querySelectorAll('.git-hamburger-menu button').length > 0"),
    8_000,
    "Git actions menu",
  );
  await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('.git-hamburger-menu button')]
      .find(item => item.textContent?.includes('Interaktives Rebase'));
    button?.click();
    return Boolean(button);
  })()`).then((found) => assert.equal(found, true, "Interactive rebase action is missing."));
  await waitFor(() => evaluate(cdp, "document.querySelectorAll('.git-rebase-row').length === 2"), 8_000, "visual rebase plan");
  const rebaseSubjects = await evaluate(cdp, "[...document.querySelectorAll('.git-rebase-subject strong')].map(item => item.textContent)");
  assert.deepEqual(rebaseSubjects, ["Rebase one", "Rebase two"]);
  await leftClickElement(cdp, '.git-rebase-row:first-child button[aria-label="Nach unten"]');
  assert.deepEqual(
    await evaluate(cdp, "[...document.querySelectorAll('.git-rebase-subject strong')].map(item => item.textContent)"),
    ["Rebase two", "Rebase one"],
    "Rebase commits could not be reordered visually.",
  );
  await leftClickElement(cdp, ".workbench-tab .tab-close");

  await leftClickElement(cdp, '.sidebar-header button[title="Commit im Editor öffnen"]');
  await waitFor(() => evaluate(cdp, "Boolean(document.querySelector('.git-commit-document .git-commit-checks'))"), 8_000, "commit checks editor");
  await leftClickElement(cdp, ".git-check-options label:first-child input");
  await waitFor(
    () => evaluate(cdp, `window.kiwi.git.commitChecks(${JSON.stringify(second)}).then(settings => settings.build)`, true),
    5_000,
    "persisted commit check",
  );
  await leftClickElement(cdp, ".git-check-options label:first-child input");
  await waitFor(
    () => evaluate(cdp, `window.kiwi.git.commitChecks(${JSON.stringify(second)}).then(settings => !settings.build)`, true),
    5_000,
    "reset commit check",
  );
  await leftClickElement(cdp, ".workbench-tab .tab-close");

  // Open two changed Java files in sequence. Staging from the second editor is
  // intentionally checked against both files: a stale Monaco listener used to
  // stage the hunk belonging to the previously active model.
  // This view switch happens immediately after an asynchronous merge editor
  // unmount. Its first synthetic click can land on the outgoing layout during
  // a slow frame, so verify the actual activity state and repeat the same user
  // action when necessary instead of merely waiting for a lost click.
  await clickUntil(
    cdp,
    () => leftClickElement(cdp, '.activitybar button[aria-label="Explorer"]'),
    () => evaluate(cdp, `Boolean(
      document.querySelector('.activitybar button[aria-label="Explorer"][aria-pressed="true"]')
    )`),
    "Explorer activity after returning from Git",
    8_000,
  );
  await evaluate(cdp, `(() => {
    const row = [...document.querySelectorAll('.workspace-project-tree.active .tree-row')]
      .find(item => item.title === ${JSON.stringify(path.join(second, "src"))});
    if (row?.getAttribute('aria-expanded') !== 'true') row?.click();
    return Boolean(row);
  })()`).then((found) => assert.equal(found, true, "Git hunk source directory is missing."));
  await waitFor(
    () => evaluate(cdp, `[...document.querySelectorAll('.workspace-project-tree.active .tree-row')]
      .some(item => item.title === ${JSON.stringify(gitHunkFirst)})`),
    8_000,
    "first Git hunk file",
  );
  for (const file of [gitHunkFirst, gitHunkSecond]) {
    // The row click can land while the Explorer is still re-rendering after the
    // previous file, and nothing announces that the open was swallowed. Under
    // load — the release build runs this three times right after a Vite build —
    // that lost click showed up as a missing hunk marker. Re-clicking until the
    // decoration appears exercises the same path instead of waiting longer.
    await clickUntil(
      cdp,
      () => evaluate(cdp, `(() => {
        const row = [...document.querySelectorAll('.workspace-project-tree.active .tree-row')]
          .find(item => item.title === ${JSON.stringify(file)});
        row?.click();
        return Boolean(row);
      })()`).then((found) => assert.equal(found, true, `Explorer could not open ${file}.`)),
      () => evaluate(cdp, `Boolean(document.querySelector('.kiwi-git-hunk-unstaged'))
        && [...document.querySelectorAll('.tabs .tab.active')].some(tab => tab.textContent?.includes(${JSON.stringify(path.basename(file))}))`),
      `Git hunk marker ${file}`,
      30_000,
    ).catch(async (error) => {
      // Two things have to come together here: the file has to be the open tab
      // and Git has to have answered with its hunks. Saying which one is
      // missing separates a swallowed click from a slow Git call.
      const probe = await evaluate(cdp, `JSON.stringify({
        activeTab: document.querySelector('.tabs .tab.active')?.textContent || '',
        markers: document.querySelectorAll('.kiwi-git-hunk-unstaged').length,
        editors: document.querySelectorAll('.monaco-editor').length,
      })`);
      const hunks = await evaluate(
        cdp,
        `window.kiwi.git.hunks(${JSON.stringify(second)}, ${JSON.stringify(file)}).then(list => list.length).catch(reason => String(reason))`,
        true,
      );
      throw new Error(`${error.message} Diagnose: ${probe} Git-Hunks: ${hunks}${rendererNote(typeof cdp === "undefined" ? null : cdp)}`);
    });
  }
  await leftClickElement(cdp, ".kiwi-git-hunk-unstaged");
  await waitFor(
    () => evaluate(cdp, `window.kiwi.git.diff(${JSON.stringify(second)}, ${JSON.stringify(gitHunkSecond)}, true)
      .then(diff => diff.includes('value = 20'))`, true),
    8_000,
    "current editor hunk staging",
  );
  assert.equal(
    await evaluate(cdp, `window.kiwi.git.diff(${JSON.stringify(second)}, ${JSON.stringify(gitHunkFirst)}, true)
      .then(diff => diff.includes('value = 2'))`, true),
    false,
    "Hunk staging used the previous editor model.",
  );
  await evaluate(cdp, `window.kiwi.git.unstage(${JSON.stringify(second)}, [${JSON.stringify(gitHunkSecond)}])`, true);

  // Turn a dedicated tracked file into a real conflict only after rebase and
  // hunk staging were exercised. Keeping the fixture in the active project
  // isolates this visual merge assertion from the separate project-switching
  // smoke above.
  runGit(second, ["stash", "push", "--include-untracked", "-m", "Kiwi E2E merge setup"]);
  runGit(second, ["switch", "-c", "e2e-incoming"]);
  await fs.writeFile(gitMergeFile, "public class MergeVisual {\n    String source = \"incoming\";\n}\n");
  runGit(second, ["add", "src/MergeVisual.java"]);
  runGit(second, ["commit", "-m", "Incoming merge change"]);
  runGit(second, ["switch", "feature/e2e"]);
  await fs.writeFile(gitMergeFile, "public class MergeVisual {\n    String source = \"local\";\n}\n");
  runGit(second, ["add", "src/MergeVisual.java"]);
  runGit(second, ["commit", "-m", "Local merge change"]);
  try { runGit(second, ["merge", "e2e-incoming"]); } catch { /* expected conflict */ }

  await leftClickElement(cdp, '.activitybar button[aria-label="Source Control"]');
  await evaluate(cdp, "document.querySelector('.sidebar-header button[title=\"Aktualisieren\"]')?.click(); true");
  await waitFor(() => evaluate(cdp, "Boolean(document.querySelector('.change-row.conflict .change-file'))"), 8_000, "merge conflict in Source Control");
  await leftClickElement(cdp, ".change-row.conflict .change-file");
  await waitFor(() => evaluate(cdp, "Boolean(document.querySelector('.git-merge-view .git-merge-conflict'))"), 8_000, "three-way merge editor");
  assert.equal(await evaluate(cdp, "document.querySelectorAll('.git-merge-columns .git-merge-code').length"), 3, "Merge editor does not show all three versions.");
  await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('.git-merge-actions button')]
      .find(item => item.textContent?.includes('Deine übernehmen'));
    button?.click();
    return Boolean(button);
  })()`).then((found) => assert.equal(found, true, "Ours merge action is missing."));
  await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('.git-workflow-toolbar button')]
      .find(item => item.textContent?.includes('Auflösen und stagen'));
    button?.click();
    return Boolean(button);
  })()`).then((found) => assert.equal(found, true, "Merge apply action is missing."));
  await waitFor(
    () => evaluate(cdp, `window.kiwi.git.status(${JSON.stringify(second)}).then(status => !status.files.some(file => file.conflict))`, true),
    8_000,
    "resolved and staged merge conflict",
  );
  // Same story as the switch after the diff editor above: this click lands
  // while the merge editor is unmounting, and the activity bar can relayout
  // between measuring the button and hitting it. Twice the click ended up on a
  // neighbouring tool window instead — once Source Control stayed, once
  // Modules came up. Repeat the user's action until the activity is actually
  // Explorer rather than trusting a single measured coordinate.
  await clickUntil(
    cdp,
    () => leftClickElement(cdp, '.activitybar button[aria-label="Explorer"]'),
    () => evaluate(cdp, `Boolean(
      document.querySelector('.activitybar button[aria-label="Explorer"][aria-pressed="true"]')
    )`),
    "Explorer activity after resolving the merge",
    8_000,
  );

  // The Explorer is virtualized and deliberately preserves its scroll offset
  // while another tool window is active. After the large-folder check above,
  // `src` can therefore be outside the mounted DOM even though the project
  // tree is healthy. Return the viewport to its first rows before addressing
  // ancestor folders by DOM path; also reopen the project heading if a prior
  // pointer action happened to leave it collapsed.
  await waitFor(
    () => evaluate(cdp, "Boolean(document.querySelector('.workspace-project-tree.active .project-heading'))"),
    8_000,
    "Explorer view after returning from Git",
  ).catch(async (error) => {
    // Three different things end here: the Explorer button did not switch the
    // activity, the sidebar is hidden, or the tree is there but no project is
    // the active one. Without saying which, the next reader starts from the
    // same three guesses this one did.
    const probe = await evaluate(cdp, `JSON.stringify({
      activity: document.querySelector('.activitybar button.active')?.getAttribute('aria-label') || '',
      sidebar: Boolean(document.querySelector('.sidebar')),
      trees: document.querySelectorAll('.workspace-project-tree').length,
      activeTrees: document.querySelectorAll('.workspace-project-tree.active').length,
      headings: document.querySelectorAll('.workspace-project-tree .project-heading').length,
      classes: [...document.querySelectorAll('.workspace-project-tree')].map(node => node.className),
      toasts: [...document.querySelectorAll('.toast')].map(node => node.textContent),
    })`);
    const workspace = await evaluate(
      cdp,
      "window.kiwi.workspace.list().then(state => JSON.stringify({ active: state.activeRoot, roots: (state.roots || []).length }), reason => String(reason))",
      true,
    );
    throw new Error(`${error.message} Diagnose: ${probe} Workspace: ${workspace}${rendererNote(typeof cdp === "undefined" ? null : cdp)}`);
  });
  await evaluate(cdp, `(() => {
    const heading = document.querySelector('.workspace-project-tree.active .project-heading');
    if (heading?.getAttribute('aria-expanded') !== 'true') heading?.click();
    return true;
  })()`);
  await afterFrames(cdp, "return true;");
  await waitFor(
    () => evaluate(cdp, "Boolean(document.querySelector('.workspace-project-tree.active .virtual-tree-viewport'))"),
    8_000,
    "Explorer viewport after reopening the project root",
  );
  await evaluate(cdp, `(() => {
    const viewport = document.querySelector('.workspace-project-tree.active .virtual-tree-viewport');
    viewport.scrollTop = 0;
    viewport.dispatchEvent(new Event('scroll', { bubbles: true }));
  })()`);

  // Creating a package must not close the branch it is created in. A compacted
  // chain regroups when a package gains a sibling — de.rauchigesetwas.player
  // .spigot splits into two rows with different keys — and the expansion was
  // remembered under the old key only, so the whole branch silently collapsed.
  for (const directory of [
    path.join(second, "src"),
    path.join(second, "src", "main"),
    path.join(second, "src", "main", "java"),
    compactPackage,
  ]) {
    await clickUntil(
      cdp,
      () => evaluate(cdp, `(() => {
        const row = [...document.querySelectorAll('.workspace-project-tree.active .tree-row')]
          .find(item => item.title === ${JSON.stringify(directory)});
        if (row?.getAttribute('aria-expanded') !== 'true') row?.click();
        return Boolean(row);
      })()`),
      () => evaluate(cdp, `[...document.querySelectorAll('.workspace-project-tree.active .tree-row')]
        .find(row => row.title === ${JSON.stringify(directory)})?.getAttribute('aria-expanded') === 'true'`),
      `expanded package ${directory}`,
    );
  }
  const packageFile = path.join(compactPackage, "CoreAPI.java");
  assert.equal(
    await evaluate(cdp, `[...document.querySelectorAll('.workspace-project-tree.active .tree-row')]
      .some(row => row.title === ${JSON.stringify(packageFile)})`),
    true,
    "The class inside the compacted package was not visible before the new package was created.",
  );

  const siblingPackage = path.join(second, "src", "main", "java", "de", "werkzeuge");
  await evaluate(cdp, `window.kiwi.file.create(
    ${JSON.stringify(path.join(second, "src", "main", "java", "de"))}, "werkzeuge", true)`, true);
  await waitFor(
    () => evaluate(cdp, `[...document.querySelectorAll('.workspace-project-tree.active .tree-row')]
      .some(row => row.title === ${JSON.stringify(siblingPackage)})`),
    10_000,
    "new package in the Explorer",
  );
  assert.equal(
    await evaluate(cdp, `[...document.querySelectorAll('.workspace-project-tree.active .tree-row')]
      .some(row => row.title === ${JSON.stringify(packageFile)})`),
    true,
    "Creating a package collapsed the branch it was created next to.",
  );

  // Session restore: expanded packages and open editors have to survive a
  // restart. A reload runs the same code path a cold start does — the state
  // lives in localStorage, which Electron keeps in the user-data directory.
  //
  // Re-open the package chain first; earlier steps collapsed parts of it.
  for (const directory of [
    path.join(second, "src"),
    path.join(second, "src", "main"),
    path.join(second, "src", "main", "java"),
    compactPackage,
  ]) {
    await waitFor(
      () => evaluate(cdp, `Boolean([...document.querySelectorAll('.workspace-project-tree.active .tree-row')]
        .find(row => row.title === ${JSON.stringify(directory)}))`),
      8_000,
      `Explorer directory before restore ${directory}`,
    );
    await evaluate(cdp, `(() => {
      const row = [...document.querySelectorAll('.workspace-project-tree.active .tree-row')]
        .find(item => item.title === ${JSON.stringify(directory)});
      if (row?.getAttribute('aria-expanded') !== 'true') row?.click();
      return Boolean(row);
    })()`);
    await waitFor(
      () => evaluate(cdp, `[...document.querySelectorAll('.workspace-project-tree.active .tree-row')]
        .find(row => row.title === ${JSON.stringify(directory)})?.getAttribute('aria-expanded') === 'true'`),
      8_000,
      `expanded directory before restore ${directory}`,
    );
  }

  const beforeReload = await evaluate(cdp, `(() => {
    const rows = [...document.querySelectorAll('.workspace-project-tree.active .tree-row')];
    return {
      expanded: rows.filter(row => row.getAttribute('aria-expanded') === 'true').map(row => row.title).sort(),
      tabs: [...document.querySelectorAll('.tabs .tab')].map(tab => tab.title).sort(),
      stored: JSON.parse(localStorage.getItem('kiwi.explorer.expanded.v1:' + ${JSON.stringify(second)}) || 'null'),
      session: JSON.parse(localStorage.getItem('kiwi.session.v2:' + ${JSON.stringify(second)}) || 'null')
    };
  })()`);
  assert.ok(beforeReload.expanded.length > 0, "No expanded Explorer directories to restore.");
  assert.ok(beforeReload.tabs.length > 0, "No open editor tabs to restore.");
  assert.ok(
    Array.isArray(beforeReload.stored) && beforeReload.stored.length > 0,
    `Explorer expansion was never persisted: ${JSON.stringify(beforeReload.stored)}`,
  );
  assert.ok(
    beforeReload.session && Array.isArray(beforeReload.session.files) && beforeReload.session.files.length > 0,
    `Editor session was never persisted: ${JSON.stringify(beforeReload.session)}`,
  );

  const persistedTabs = beforeReload.session.files.map((file) => file.path).sort();
  // The navigation can tear down the execution context before this call gets
  // its response; that rejection is expected and says nothing about the reload.
  await evaluate(cdp, "setTimeout(() => location.reload(), 25); true").catch(() => undefined);
  await waitFor(() => evaluate(cdp, "document.readyState === 'complete' && Boolean(window.kiwi)"), 20_000, "editor preload after reload");
  await waitFor(
    () => evaluate(cdp, `(() => {
      const tabs = [...document.querySelectorAll('.tabs .tab')].map(tab => tab.title);
      return ${JSON.stringify(persistedTabs)}.every(title => tabs.includes(title));
    })()`),
    30_000,
    "restored editor tabs",
  );
  await waitFor(
    () => evaluate(cdp, `(() => {
      const open = [...document.querySelectorAll('.workspace-project-tree.active .tree-row')]
        .filter(row => row.getAttribute('aria-expanded') === 'true')
        .map(row => row.title);
      return ${JSON.stringify(beforeReload.expanded)}.every(title => open.includes(title));
    })()`),
    30_000,
    "restored Explorer expansion",
  );
  // An expanded directory whose children were never fetched renders as an open
  // but empty node, which is how the restore looked broken before.
  await waitFor(
    () => evaluate(cdp, `(() => {
      const rows = [...document.querySelectorAll('.workspace-project-tree.active .tree-row')];
      const parent = rows.find(row => row.title === ${JSON.stringify(compactPackage)});
      const child = rows.find(row => row.title === ${JSON.stringify(path.join(compactPackage, "CoreAPI.java"))});
      return parent?.getAttribute('aria-expanded') === 'true' && Boolean(child);
    })()`),
    30_000,
    "restored package with its children loaded",
  );

  await evaluate(cdp, `(() => {
    document.querySelector('button[title="Modules"]')?.click();
    return true;
  })()`);
  await waitFor(() => evaluate(cdp, "document.querySelector('.sidebar-header')?.textContent.includes('MODULES')"), 5_000, "Modules tool window");

  // Closing the workspace tears down this very window, so the call can lose its
  // execution context before it answers. Waiting for that answer used to hold
  // up the whole poll loop; the welcome target is the only success signal, so
  // the call is fired and its outcome only kept for the failure message.
  let lastCloseAttempt = 0;
  let lastCloseError = null;
  let attempts = 0;
  const closeWorkspace = () => {
    lastCloseAttempt = Date.now();
    attempts += 1;
    // The first attempt goes through the real path, chained the way the
    // workbench does it. Later ones ask for the welcome window on its own,
    // because that chain waits for something the welcome window never needed:
    // workspace:closeAll awaits language.stop(), and a JDT server that was
    // unpacked minutes earlier by fetch:toolchain takes its time about dying.
    // That is why this failed inside dist:win twice and in none of the five
    // runs outside it — the release build is the only place the toolchain is
    // freshly fetched right before the first run.
    // Chained on the first attempt, and it has to stay that way: closeAll()
    // is what clears the active project, and showing the welcome window
    // before it finished left a project still active — which the Hub check
    // further down catches. Firing the two independently traded one failure
    // for another rather than removing either.
    //
    // Later attempts ask for the window alone, which is all that is missing
    // by then.
    const call = attempts === 1
      ? "window.kiwi.workspace.closeAll().then(() => window.kiwi.app.showWelcome())"
      : "window.kiwi.app.showWelcome()";
    void evaluate(cdp, call, true).catch((error) => { lastCloseError = error; });
  };
  closeWorkspace();
  const reopenedWelcomeTarget = await waitFor(async () => {
    const target = (await listPageTargets()).find((item) => item.url.includes("window=welcome"));
    if (target) return target;
    if (Date.now() - lastCloseAttempt > 3_000) closeWorkspace();
    // The rejection is kept, never thrown. Closing the workspace tears down
    // the window the call was made in, so losing the execution context is what
    // success looks like from here — throwing it aborted the wait a moment
    // before the welcome target appeared, and only on the runs that lost that
    // race. The welcome target stays the only signal that counts.
    return null;
  }, 30_000, "welcome window after closing the workspace").catch(async (error) => {
    // Which windows exist at that moment. Without this the message says only
    // that no welcome target appeared, which is equally true of "the app has
    // no window at all" and "there is one and its URL is not what we match
    // on" — and those are opposite faults.
    const targets = await listPageTargets().catch(() => []);
    const seen = targets.map((item) => String(item.url || "").replace(/^file:\/\/.*?\/dist\//, "")).slice(0, 6);
    // An empty list has two opposite readings: the application has ended, or
    // it is running and its debugging endpoint did not answer. Whether the
    // process is still alive settles it, and its last output says why.
    const appProcess = { exitCode: child.exitCode, signal: child.signalCode, killed: child.killed };
    const tail = logs.split(/\r?\n/).filter(Boolean).slice(-8).join(" ⏎ ").slice(-600);
    throw new Error(`${error.message} Fenster: ${JSON.stringify(seen)} Versuche: ${attempts}`
      + `${lastCloseError ? ` Letzter Schließversuch: ${lastCloseError.message}` : ""}`
      + ` Prozess: ${JSON.stringify(appProcess)} Zuletzt ausgegeben: ${JSON.stringify(tail)}`);
  });
  cdp.close();
  cdp = await createCdp(reopenedWelcomeTarget.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  await waitFor(() => evaluate(cdp, "document.readyState === 'complete' && Boolean(window.kiwi)"), 15_000, "welcome preload after closing workspace");
  await waitFor(() => evaluate(cdp, "Boolean(document.querySelector('.project-hub'))"), 10_000, "project hub after close");
  await waitFor(async () => (await listPageTargets()).filter((target) => target.url.includes("window=editor")).length === 0, 10_000, "editor window close");
  // The Hub wears the splash screen's design: the name is set rather than
  // drawn, so what stands for the logo is the lockup and the maker's mark.
  const hub = await evaluate(cdp, `({
    lockup: document.querySelector('.hub-lockup')?.textContent?.startsWith('KiwiIDE'),
    maker: Boolean(document.querySelector('.hub-maker .kiwi-logo-image')),
    art: document.querySelectorAll('.hub-art i').length,
    rule: Boolean(document.querySelector('.project-hub > footer .hub-rule b')),
    title: document.querySelector('.hub-recents h2')?.textContent,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    kind: new URLSearchParams(location.search).get('window')
  })`);
  assert.deepEqual(hub, { lockup: true, maker: true, art: 3, rule: true, title: "Projekte", overflow: false, kind: "welcome" });
  assert.equal(
    await evaluate(cdp, "window.kiwi.collab.hostState().then(state => state.hosting === false)", true),
    true,
    "Closing the editor must stop the previous project's CodeToGetter host session.",
  );

  // A guest can join straight from the standalone Hub without first creating
  // or opening a local project. The Hub therefore exposes only the guest half
  // of CodeToGetter, and Escape must dismiss it like every other Kiwi popup.
  const hubCollabButton = await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('.hub-actions button')]
      .find(item => item.textContent?.includes('CodeToGetter'));
    if (!button) return null;
    const box = button.getBoundingClientRect();
    button.click();
    return { visible: box.width > 0 && box.height > 0, label: button.textContent?.trim() || '' };
  })()`);
  assert.ok(hubCollabButton?.visible, `The Project Hub has no usable CodeToGetter action: ${JSON.stringify(hubCollabButton)}`);
  await waitFor(
    () => evaluate(cdp, "Boolean(document.querySelector('.codetogetter-hub-dialog .codetogetter.guest-only'))"),
    8_000,
    "guest-only CodeToGetter dialog in Project Hub",
  );
  const hubCollab = await evaluate(cdp, `(() => {
    const dialog = document.querySelector('.codetogetter-hub-dialog');
    const guest = dialog?.querySelector('.codetogetter.guest-only');
    const sections = [...(guest?.querySelectorAll('.codetogetter-side') || [])];
    return {
      modal: dialog?.getAttribute('aria-modal') === 'true',
      sections: sections.length,
      sectionTitle: sections[0]?.querySelector('header strong')?.textContent || '',
      hasHostControls: [...(dialog?.querySelectorAll('button') || [])]
        .some(button => /Projekt teilen|Teilen beenden/.test(button.textContent || '')),
      hasLocalTree: Boolean(dialog?.querySelector('.workspace-project-tree')),
    };
  })()`);
  assert.deepEqual(hubCollab, {
    modal: true,
    sections: 1,
    sectionTitle: "Gast",
    hasHostControls: false,
    hasLocalTree: false,
  }, "The Hub must open the guest-only collaboration flow without a local project.");
  assert.equal(
    await evaluate(cdp, "window.kiwi.workspace.list().then(state => state.activeRoot === null)", true),
    true,
    "Opening CodeToGetter from the Hub must not activate a local project.",
  );
  await evaluate(cdp, "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))");
  await waitFor(
    () => evaluate(cdp, "!document.querySelector('.codetogetter-hub-dialog') && Boolean(document.querySelector('.project-hub'))"),
    5_000,
    "Escape closes Hub CodeToGetter dialog",
  );

  const pinClicked = await evaluate(cdp, `(() => {
    const main = [...document.querySelectorAll('.hub-project-main')]
      .find(item => item.dataset.projectRoot === ${JSON.stringify(second)});
    const button = main?.closest('.hub-project')?.querySelector('[data-project-action="pin"]');
    button?.click();
    return Boolean(button);
  })()`);
  assert.equal(pinClicked, true, "Pin button for recent project was not found.");
  await waitFor(() => evaluate(cdp, `(() => {
    const main = [...document.querySelectorAll('.hub-project-main')]
      .find(item => item.dataset.projectRoot === ${JSON.stringify(second)});
    return main?.closest('.hub-project')?.querySelector('[data-project-action="pin"]')?.getAttribute('aria-pressed') === 'true';
  })()`), 5_000, "recent project pin action");
  assert.equal(await evaluate(cdp, `window.kiwi.workspace.list().then(state =>
    state.resumableProjects.some(project => project.root === ${JSON.stringify(second)} && project.pinned)
  )`, true), true);

  // A name of one's own for a project. It is a label on the row, not a move:
  // the folder underneath has to be exactly where it was.
  const renameOpened = await evaluate(cdp, `(() => {
    const main = [...document.querySelectorAll('.hub-project-main')]
      .find(item => item.dataset.projectRoot === ${JSON.stringify(second)});
    const button = main?.closest('.hub-project')?.querySelector('[data-project-action="rename"]');
    button?.click();
    return Boolean(button);
  })()`);
  assert.equal(renameOpened, true, "Rename button for recent project was not found.");
  await waitFor(() => evaluate(cdp, "Boolean(document.querySelector('.input-dialog input'))"), 5_000, "rename dialog in the Hub");
  const renameSubmitted = await evaluate(cdp, `(() => {
    const input = document.querySelector('.input-dialog input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'Zweites Projekt');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.input-dialog .modal-footer .primary-button').click();
    return true;
  })()`);
  assert.equal(renameSubmitted, true);
  await waitFor(() => evaluate(cdp, `(() => {
    const main = [...document.querySelectorAll('.hub-project-main')]
      .find(item => item.dataset.projectRoot === ${JSON.stringify(second)});
    return main?.querySelector('strong')?.textContent?.trim() === 'Zweites Projekt';
  })()`), 5_000, "renamed project in the Hub");
  assert.equal(await evaluate(cdp, `window.kiwi.workspace.list().then(state =>
    state.resumableProjects.some(project => project.root === ${JSON.stringify(second)} && project.label === "Zweites Projekt")
  )`, true), true, "The chosen name must be stored with the project.");
  await fs.access(second);  // Renaming names the row; the folder has to still be there.

  const removeClicked = await evaluate(cdp, `(() => {
    const main = [...document.querySelectorAll('.hub-project-main')]
      .find(item => item.dataset.projectRoot === ${JSON.stringify(first)});
    const button = main?.closest('.hub-project')?.querySelector('[data-project-action="remove"]');
    button?.click();
    return Boolean(button);
  })()`);
  assert.equal(removeClicked, true, "Remove button for recent project was not found.");
  await waitFor(() => evaluate(cdp, `![...document.querySelectorAll('.hub-project-main')]
    .some(item => item.dataset.projectRoot === ${JSON.stringify(first)})`), 5_000, "recent project remove action");
  assert.equal(await evaluate(cdp, `window.kiwi.workspace.list().then(state =>
    !state.resumableProjects.some(project => project.root === ${JSON.stringify(first)})
  )`, true), true);

  await evaluate(cdp, "setTimeout(() => window.kiwi.app.close(), 50); true");
  cdp.close();
  if (child.exitCode === null) {
    // Shutting down this session ends the language server, a debug JVM and two
    // ConPTY sessions, and the portable build clears its extracted copy off
    // the disk afterwards. That it happens on its own is the point; how many
    // seconds a loaded machine needs for it is not — which is why the budget
    // says so instead of holding a number that suits a quiet one.
    await waitForProcessExit(child, 180_000 * patience);
  }
  if (child.exitCode === null) {
    // What is being checked is that Kiwi ends its own background processes —
    // the language server, a debug JVM, two terminals. A numeric exit code was
    // standing in for that and is not the same thing: a process ended by a
    // signal reports none, and this check then failed a shutdown that had
    // demonstrably happened, with the diagnosis "Noch aktiv: keine" printed
    // right next to it. Survivors are the evidence; the status code is not.
    const survivors = await describeSurvivingProcesses(child.pid);
    if (survivors !== "keine") {
      assert.fail(`Kiwi did not finish its graceful background-process shutdown. Noch aktiv: ${survivors}`);
    }
    console.log(`Hinweis: Kiwi war beendet, meldete aber keinen Exit-Code (Signal: ${child.signalCode ?? "keins"}).`);
  }
  console.log("Electron E2E passed: Welcome, Explorer, Ctrl+Space, Debugger, Modules, Dependencies and advanced Git workflows.");
} finally {
  if (child.exitCode === null) {
    if (process.platform === "win32") await terminateWindowsProcessTree(child.pid);
    else child.kill();
    if (child.exitCode === null) {
      await waitForProcessExit(child, 5_000);
    }
  }
  if (process.platform === "win32" && portable) {
    await terminateWindowsProcessesUsingUserData(userData, portable ? electron : "");
  }
  if (path.resolve(fixture).startsWith(path.resolve(os.tmpdir()))) {
    /*
     * Tidying up must not overturn a result.
     *
     * Windows releases a handle some time after the process holding it is
     * gone, and a language server working on one of these files can hold one
     * for a moment longer than the wait below. A run that passed every check
     * and then failed to delete a temporary folder is a run that passed — the
     * folder is worth a line of output, not an exit code.
     */
    await fs.rm(fixture, { recursive: true, force: true, maxRetries: 20, retryDelay: 400 })
      .catch((error) => {
        console.log(`Hinweis: Der Testordner konnte nicht geräumt werden (${error?.code || error?.message}): ${fixture}`);
      });
  }
  if (child.exitCode && child.exitCode !== 0) process.stderr.write(logs);
}

async function createProject(directory, className) {
  const source = path.join(directory, "src");
  await fs.mkdir(source, { recursive: true });
  await fs.writeFile(path.join(source, `${className}.java`), [
    `public class ${className} {`,
    "  public static void main(String[] args) {",
    "    int value = 41;",
    `    System.out.println("KIWI_E2E_DEBUG_OK:${className}:" + (value + 1));`,
    "  }",
    "}",
    "",
  ].join("\n"), "utf8");
}

function runGit(directory, args) {
  return execFileSync("git", args, {
    cwd: directory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" },
  });
}

async function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const selected = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(selected));
    });
  });
}

/**
 * The processes still alive under a pid, for a shutdown that did not finish.
 *
 * Best effort on purpose: this only ever runs while reporting another failure,
 * so it must never become the thing that fails.
 */
async function describeSurvivingProcesses(pid) {
  if (process.platform !== "win32" || !pid) return "unbekannt";
  const script = [
    "$ids = @(" + String(pid) + ")",
    "for ($i = 0; $i -lt 4; $i++) {",
    "  $ids += (Get-CimInstance Win32_Process | Where-Object { $ids -contains $_.ParentProcessId }).ProcessId",
    "  $ids = $ids | Sort-Object -Unique",
    "}",
    "Get-CimInstance Win32_Process | Where-Object { $ids -contains $_.ProcessId } |",
    "  ForEach-Object { $_.ProcessId.ToString() + ':' + $_.Name }",
  ].join("; ");
  return new Promise((resolve) => {
    const probe = spawn("powershell.exe", ["-NoProfile", "-Command", script], { windowsHide: true });
    let output = "";
    probe.stdout?.on("data", (chunk) => { output += chunk.toString(); });
    probe.once("error", () => resolve("nicht ermittelbar"));
    probe.once("exit", () => resolve(output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join(", ") || "keine"));
    setTimeout(() => resolve(output.trim() || "Zeitüberschreitung"), 10_000).unref?.();
  });
}

async function terminateWindowsProcessTree(pid) {
  if (!pid) return;
  await new Promise((resolve) => {
    const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    killer.once("error", resolve);
    killer.once("exit", resolve);
  });
}

/**
 * Terminates the run's own Electron processes.
 *
 * A portable build runs through a launcher named after the artifact, which then
 * unpacks and starts "Kiwi IDE.exe" elsewhere. Matching only the latter left the
 * launcher alive holding an open handle on release/…-portable.exe, which made
 * the next electron-builder run block on "output file is locked for writing".
 */
async function terminateWindowsProcessesUsingUserData(userDataPath, launcherPath = "") {
  const escapedTarget = path.resolve(userDataPath).replaceAll("'", "''");
  const escapedLauncher = launcherPath ? path.resolve(launcherPath).replaceAll("'", "''") : "";
  const command = `$target = '${escapedTarget}'; $launcher = '${escapedLauncher}'; `
    + "Get-CimInstance Win32_Process "
    + "| Where-Object { ($_.Name -eq 'Kiwi IDE.exe' -and $_.CommandLine -like ('*' + $target + '*')) "
    + "-or ($launcher -and $_.ExecutablePath -eq $launcher) } "
    + "| ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }";
  await new Promise((resolve) => {
    const killer = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
      windowsHide: true,
      stdio: "ignore",
    });
    killer.once("error", resolve);
    killer.once("exit", resolve);
  });
}

async function listPageTargets() {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`).catch(() => null);
  if (!response?.ok) return [];
  const targets = await response.json();
  return targets.filter((item) => item.type === "page" && item.webSocketDebuggerUrl);
}

async function waitForTarget(kind, timeout) {
  return waitFor(async () => {
    const targets = await listPageTargets();
    return targets.find((item) => {
      try {
        return new URL(item.url).searchParams.get("window") === kind;
      } catch {
        return item.url.includes(`window=${kind}`);
      }
    });
  }, timeout, `${kind} Electron DevTools target`);
}

/**
 * Coordinates for a synthetic mouse event.
 *
 * Measuring and dispatching are separate round-trips, so a virtualised list
 * that re-renders or scrolls in between would move a different row under the
 * point. The element at the resulting coordinates is therefore verified to be
 * the intended one, and the measurement is repeated while it is not.
 */
/**
 * Where to aim a synthetic mouse event, once the target has stopped moving.
 *
 * The point is measured in the page and the event is dispatched afterwards, so
 * a layout that shifts in between — a panel opening, a list re-rendering, a
 * transition finishing — sends the click somewhere else entirely. That was the
 * single cause behind most of the flaky steps, and it showed up far from its
 * origin: a lost click surfaced as a missing menu, an unopened file, or a
 * language server that "returned no completions". Requiring the same rectangle
 * twice in a row costs one extra measurement and removes the whole class.
 */
async function elementPoint(cdp, selector, anchor = "center") {
  let last = null;
  let previousPoint = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const result = await evaluate(cdp, `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return { point: null, reason: "not-found" };
      element.scrollIntoView({ block: "nearest", inline: "nearest" });
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return { point: null, reason: "no-box" };
      const point = ${JSON.stringify(anchor)} === 'bottom-right'
        ? { x: rect.right - 10, y: rect.bottom - 10 }
        : { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      const hit = document.elementFromPoint(point.x, point.y);
      return { point, covered: Boolean(hit && (element === hit || element.contains(hit) || hit.contains(element))) };
    })()`);
    last = result;
    if (result?.point && result.covered) {
      const settled = previousPoint
        && Math.abs(previousPoint.x - result.point.x) < 1
        && Math.abs(previousPoint.y - result.point.y) < 1;
      if (settled) return result.point;
      previousPoint = result.point;
    } else {
      previousPoint = null;
    }
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  assert.ok(last?.point, `Element für Mauseingabe nicht gefunden: ${selector}`);
  // Some targets are legitimately behind another layer — Monaco's input textarea
  // sits under its view layer, for instance. Coverage is a tie-breaker for
  // moving rows, not a requirement, so fall back to the measured point.
  return last.point;
}

async function rightClickElement(cdp, selector, anchor = "center") {
  const point = await elementPoint(cdp, selector, anchor);
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "right",
    buttons: 2,
    clickCount: 1,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "right",
    buttons: 0,
    clickCount: 1,
  });
}

// Docking a detached window back closes it. Clicking the control with a real
// mouse is the point of that step, so the answer to the click is allowed to be
// lost — what the window did is asserted afterwards in the workbench.
async function clickElementThatClosesWindow(cdp, selector) {
  const point = await elementPoint(cdp, selector);
  for (const [type, buttons] of [["mousePressed", 1], ["mouseReleased", 0]]) {
    await cdp.send("Input.dispatchMouseEvent", {
      type,
      x: point.x,
      y: point.y,
      button: "left",
      buttons,
      clickCount: 1,
    }, { timeout: 8_000, tolerateClose: true });
  }
}

async function leftClickElement(cdp, selector) {
  const point = await elementPoint(cdp, selector);
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
}

/** Opens something the Explorer only opens on a double click. */
async function doubleClickElement(cdp, selector) {
  const point = await elementPoint(cdp, selector);
  for (const clickCount of [1, 2]) {
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount,
    });
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount,
    });
  }
}

/**
 * Repeats a click until it has the effect the test is actually waiting for.
 *
 * A single synthetic click is regularly swallowed while the workbench is still
 * laying out — the row moves, a panel opens under the pointer, React re-renders
 * between the query and the dispatch. Waiting longer does not help, because the
 * click that was lost is never delivered late. Repeating it does, and it stays
 * an honest test of the same path: the assertion is still the effect, never the
 * click itself.
 */
async function clickUntil(cdp, click, effect, label, timeout = 15_000) {
  await waitFor(
    async () => {
      // The effect is checked before clicking again, and given a moment after.
      // Several of these effects land on a short timer, and a retry that fired
      // straight away kept restarting them so they never got to finish.
      if (await effect()) return true;
      await click();
      await new Promise((resolve) => setTimeout(resolve, 300));
      return effect();
    },
    timeout,
    label,
  );
}

/**
 * Puts the caret in the editor and proves it landed there.
 *
 * A synthetic click is aimed at the centre of the textarea as it was measured,
 * and the workbench can relayout underneath it — after Ctrl+` opens the panel
 * the editor shrinks, so the click lands on the panel and focus stays on the
 * body. Every keystroke after that goes nowhere, which then surfaces as a
 * completely unrelated failure further down.
 *
 * The click comes first because it is what a user does, but focus here is only
 * setup for the assertions that follow — it is not what any of them test — so
 * when the click does not take, the textarea is focused directly instead.
 */
/** The editor's visible text with every space taken out, as Monaco renders some as non-breaking. */
/** One key, pressed and released. */
async function pressKey(cdp, key, code, virtualKey) {
  await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode: virtualKey });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: virtualKey });
}

/**
 * Types the way a keyboard types.
 *
 * Input.insertText puts text into the editor without any of the handling that
 * makes typing feel the way it does — auto-indent, auto-closing, the Tab key.
 * Anything that measures those has to send the keys themselves.
 */
async function typeKeys(cdp, text) {
  for (const character of text) {
    if (character === "\n") {
      await pressEnter(cdp);
      continue;
    }
    if (character === "\t") {
      await pressKey(cdp, "Tab", "Tab", 9);
      continue;
    }
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      text: character,
      unmodifiedText: character,
      key: character,
    });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: character });
  }
}

/**
 * The editor's text, read from the top.
 *
 * editorText reports the lines Monaco has painted, and Monaco paints only the
 * ones in view — so an editor sitting scrolled past its first line reports a
 * file that looks truncated or reordered while the buffer is perfectly intact.
 * Every check of what a buffer contains has to start from the top, or it is
 * testing the scroll position.
 */
async function editorTextFromTop(cdp) {
  await pressChord(cdp, { key: "Home", code: "Home", vk: 36, modifiers: 2 });
  return editorText(cdp);
}

async function editorText(cdp) {
  // The backslash is doubled because this is a template literal: a plain
  // \s would reach the page as "s" and strip every letter s instead.
  return evaluate(cdp, `(document.querySelector('.monaco-editor .view-lines')?.textContent || '').replace(/\\s/g, '')`);
}

/** Presses one chord, the way a keyboard sends it. */
/**
 * Brings the Explorer up without toggling it away.
 *
 * The activity buttons are toggles: clicking the one that is already active
 * hides the sidebar. Anything that just wants the tree on screen has to look
 * first.
 */
async function showExplorer(cdp) {
  const pressed = await evaluate(cdp, "Boolean(document.querySelector('.activitybar button[aria-label=\"Explorer\"][aria-pressed=\"true\"]'))");
  if (!pressed) await leftClickElement(cdp, '.activitybar button[aria-label="Explorer"]');
  await waitFor(
    () => evaluate(cdp, "Boolean(document.querySelector('.workspace-project-tree.active .project-heading'))"),
    8_000,
    "Explorer auf dem Bildschirm",
  );
}

async function pressChord(cdp, chord) {
  for (const type of ["rawKeyDown", "keyUp"]) {
    await cdp.send("Input.dispatchKeyEvent", {
      type,
      key: chord.key,
      code: chord.code,
      windowsVirtualKeyCode: chord.vk,
      modifiers: chord.modifiers || 0,
    });
  }
}

async function closeSuggestWidget(cdp) {
  if (!await evaluate(cdp, "Boolean(document.querySelector('.suggest-widget.visible'))")) return;
  for (const type of ["rawKeyDown", "keyUp"]) {
    await cdp.send("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  }
}

/**
 * Enter, sent the way a keyboard sends it.
 *
 * With "rawKeyDown" the key arrives but no text does, and Monaco inserts the
 * line break from the text input rather than from the key. Pressed that way,
 * Enter looked completely dead in this harness while working perfectly in the
 * application — a measurement failure that reads exactly like a defect.
 */
async function pressEnter(cdp) {
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r",
  });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
}

async function selectAllInEditor(cdp) {
  for (const type of ["rawKeyDown", "keyUp"]) {
    await cdp.send("Input.dispatchKeyEvent", {
      type, key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2,
    });
  }
}

/**
 * Focus, put back if it has wandered.
 *
 * focusEditor waits up to fifteen seconds and is the right thing before a
 * step. Inside a loop that presses a chord twenty times it is the wrong
 * shape: what is needed is a cheap check every iteration, because a chord
 * sent while focus is elsewhere is spent for nothing and twenty of those
 * look exactly like a command that does not work.
 */
async function ensureEditorFocus(cdp) {
  const focused = await evaluate(
    cdp,
    "document.activeElement === document.querySelector('.monaco-editor textarea')",
  );
  if (focused) return;
  await focusEditor(cdp);
}

async function focusEditor(cdp) {
  await waitFor(
    async () => {
      await leftClickElement(cdp, ".monaco-editor textarea").catch(() => undefined);
      if (await evaluate(cdp, "document.activeElement === document.querySelector('.monaco-editor textarea')")) {
        return true;
      }
      return evaluate(cdp, `(() => {
        const input = document.querySelector('.monaco-editor textarea');
        input?.focus();
        return document.activeElement === input;
      })()`);
    },
    15_000,
    "editor focus",
  );
}

async function moveMouseToElement(cdp, selector) {
  const point = await elementPoint(cdp, selector);
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: point.x,
    y: point.y,
    button: "none",
    buttons: 0,
  });
}

// The run used to print a single line at the very end. A command that never
// answered therefore failed without saying where the run stood, and the log of
// a release build showed nothing but the timeout. Each checkpoint is announced
// once, so the last line of the log is the step that hung.
function trace(label) {
  if (!label || label === lastTrace) return;
  lastTrace = label;
  console.log(`  ... ${label}`);
}

// The method alone rarely identifies the command; the expression does.
function describeParams(params) {
  const detail = typeof params?.expression === "string"
    ? params.expression.replace(/\s+/g, " ").trim().slice(0, 140)
    : [params?.type, params?.key, params?.text].filter(Boolean).join(" ");
  return detail ? ` (${detail})` : "";
}

/**
 * What the renderer complained about, for a failure message.
 *
 * An exception inside a click handler leaves the workbench looking idle: the
 * click is delivered, nothing happens, and every reading taken from outside
 * then describes the thing that did not happen instead of the reason. These
 * events arrive over DevTools without an id, which the message handler drops,
 * so they were being collected nowhere and shown nowhere.
 */
function rendererNote(client) {
  const complaints = client?.rendererProblems?.() || [];
  return complaints.length ? ` Renderer: ${JSON.stringify(complaints.slice(-4))}` : " Renderer: nichts gemeldet";
}

function createCdp(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    let id = 0;
    // Everything the renderer complained about, kept so a failing step can
    // say so. Runtime.enable is already on, but every event arrives without
    // an id and the handler below drops those, so an exception thrown inside
    // a click handler used to leave no trace anywhere: the workbench swallowed
    // it, the run saw only a thing that did not happen, and the obvious
    // conclusion — that the click never arrived — was wrong.
    const problems = [];
    socket.addEventListener("open", () => resolve({
      send(method, params = {}, options = {}) {
        const command = new Promise((resolveCommand, rejectCommand) => {
          const commandId = ++id;
          // A control that closes its own window may or may not get its answer
          // out first. The step that clicks such a control says so, and only
          // there is a missing answer the expected outcome instead of a defect.
          const settle = (error) => {
            if (options.tolerateClose) resolveCommand(undefined);
            else rejectCommand(error);
          };
          // A DevTools command that never answers used to stop the whole run
          // silently: `waitFor` only checks its deadline between polls, so it
          // waited forever instead of failing. Input dispatch in particular
          // does not answer while the renderer is not processing events.
          const timer = setTimeout(() => {
            if (!pending.delete(commandId)) return;
            settle(new Error(
              `DevTools-Befehl ${method} hat nicht geantwortet.`
              + `${describeParams(params)} Zuletzt erreicht: ${lastTrace || "noch kein Schritt"}.`,
            ));
          }, (options.timeout ?? 45_000) * patience);
          pending.set(commandId, {
            resolve: (value) => { clearTimeout(timer); resolveCommand(value); },
            // A protocol error is a defect either way; only the closed target
            // is what the caller may have asked to tolerate.
            reject: (error) => {
              clearTimeout(timer);
              if (error.targetClosed) settle(error);
              else rejectCommand(error);
            },
          });
          socket.send(JSON.stringify({ id: commandId, method, params }));
        });
        // Closing a window rejects whatever it still owed an answer for. Some
        // of those commands are deliberately not awaited — the step that
        // closes the window has already moved on — and an unobserved rejection
        // would take the whole run down. Observing it here changes nothing for
        // a caller that does await the command.
        command.catch(() => undefined);
        return command;
      },
      close: () => socket.close(),
      /** What the renderer complained about, newest last. */
      rendererProblems: () => [...problems],
    }));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.method === "Runtime.exceptionThrown") {
        const details = message.params?.exceptionDetails;
        const text = details?.exception?.description || details?.text || "unbekannte Ausnahme";
        problems.push("Ausnahme: " + String(text).replace(/\s+/g, " ").slice(0, 200));
      }
      // The editor's own breadcrumbs. Kept beside the problems so a failure can
      // show what the editor thought it was doing, not only that it failed.
      if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "info") {
        const text = (message.params.args || [])
          .map((argument) => argument.value || argument.description || "")
          .join(" ");
        if (text.startsWith("[Editor]")) problems.push(text.slice(0, 200));
      }
      if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") {
        const text = (message.params.args || [])
          .map((argument) => argument.description || argument.value || argument.type)
          .join(" ");
        problems.push(`console.error: ${String(text).slice(0, 200)}`);
      }
      if (problems.length > 12) problems.splice(0, problems.length - 12);
      if (!message.id || !pending.has(message.id)) return;
      const item = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) item.reject(new Error(message.error.message));
      else item.resolve(message.result);
    });
    // A closing window takes its DevTools target with it. Without this the
    // commands still in flight were never settled at all, so a step that
    // deliberately closes a window waited for an answer that could not come.
    socket.addEventListener("close", () => {
      for (const [commandId, item] of [...pending]) {
        pending.delete(commandId);
        // Whether Kiwi closed the window or died is the whole question when
        // this appears, and the two are indistinguishable from the socket
        // alone. The exit code separates them: a window that was closed on
        // purpose leaves the process running, and 3221225477 is an access
        // violation, not a shutdown.
        const state = child.exitCode === null && !child.killed
          ? "Prozess läuft noch"
          : `Prozess beendet mit ${child.exitCode}${child.exitCode === 3221225477 ? " (Zugriffsverletzung)" : ""}`;
        const error = new Error(
          `Das DevTools-Ziel wurde geschlossen. Zuletzt erreicht: ${lastTrace || "noch kein Schritt"}. ${state}.`,
        );
        error.targetClosed = true;
        item.reject(error);
      }
    });
    socket.addEventListener("error", () => reject(new Error("DevTools WebSocket konnte nicht geöffnet werden.")));
  });
}

/** Waits for a child without leaving the losing timeout alive in Node. */
function waitForProcessExit(processHandle, timeout) {
  if (processHandle.exitCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      processHandle.removeListener("exit", onExit);
      resolve(false);
    }, timeout);
    processHandle.once("exit", onExit);
    if (processHandle.exitCode !== null) {
      processHandle.removeListener("exit", onExit);
      clearTimeout(timer);
      resolve(true);
    }
  });
}

async function evaluate(cdp, expression, awaitPromise = false) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Renderer-Auswertung fehlgeschlagen.");
  return result.result.value;
}

/**
 * Reads something after the renderer has had two frames to paint.
 *
 * requestAnimationFrame is suspended outright while a window is occluded or in
 * the background, and a release build runs three of these one after another
 * while other Kiwi windows open and close over them. A command that waited for
 * frames alone could therefore never answer: the run died on a DevTools
 * timeout. A timer settles it in that case — a frame is preferred, never
 * required.
 */
/**
 * Puts a window in front, for the checks that read something painted.
 *
 * An occluded window is not merely slow to paint: Electron stops rendering it,
 * and Monaco's own providers — CodeLens among them — do not run at all. The
 * step then waits for a decoration that was never going to be produced, and
 * says only that it did not appear in time. Twice in this session the probe
 * reported visibility "hidden" with an empty lens list, which is that and
 * nothing else.
 *
 * Asking for a frame does not help there: afterFrames() races a timer against
 * requestAnimationFrame precisely so an occluded window cannot hang the run,
 * so it returns having painted nothing.
 *
 * Failure is tolerated. A window that cannot be fronted is a condition for the
 * check that follows to report on, not something to abort the run over.
 */
async function bringToFront(client) {
  await client.send("Page.bringToFront").catch(() => undefined);
}

function afterFrames(cdp, body) {
  return evaluate(cdp, `new Promise(resolve => {
    const read = () => { ${body} };
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve(read());
    };
    requestAnimationFrame(() => requestAnimationFrame(finish));
    setTimeout(finish, 1500);
  })`, true);
}

async function waitFor(read, timeout, label) {
  trace(label);
  const deadline = Date.now() + timeout * patience;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label} nicht rechtzeitig verfügbar.${lastError ? ` ${lastError.message}` : ""}`);
}

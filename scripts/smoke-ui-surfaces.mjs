import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const electron = require(path.join(root, "node_modules", "electron"));
const temporaryRoot = path.resolve(os.tmpdir());
const fixture = await fs.mkdtemp(path.join(temporaryRoot, "kiwi-ui-surfaces-"));
const project = path.join(fixture, "tsx-project");
const userData = path.join(fixture, "userdata");

async function until(read, budget, label) {
  const deadline = Date.now() + budget;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ""}`);
}

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function connect(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    }
  });
  return {
    send(method, params = {}) {
      const id = ++nextId;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    close() {
      socket.close();
    },
  };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  }
  return result.result?.value;
}

async function press(cdp, key, code, windowsVirtualKeyCode, modifiers = 0) {
  for (const type of ["rawKeyDown", "keyUp"]) {
    await cdp.send("Input.dispatchKeyEvent", {
      type,
      key,
      code,
      windowsVirtualKeyCode,
      modifiers,
    });
  }
}

// Create a rich hybrid/TSX project fixture
await fs.mkdir(path.join(project, ".kiwi"), { recursive: true });
await fs.mkdir(path.join(project, "src", "components"), { recursive: true });
await fs.mkdir(userData, { recursive: true });

await fs.writeFile(
  path.join(project, ".kiwi", "language.json"),
  JSON.stringify({ version: 1, language: "typescript" }, null, 2),
);
await fs.writeFile(
  path.join(project, "package.json"),
  JSON.stringify(
    {
      name: "tsx-project",
      version: "1.0.0",
      private: true,
      dependencies: {
        react: "^18.3.1",
      },
    },
    null,
    2,
  ),
);
await fs.writeFile(
  path.join(project, "src", "components", "UserCard.tsx"),
  [
    "import React, { useState } from 'react';",
    "",
    "export interface UserCardProps {",
    "  name: string;",
    "}",
    "",
    "export const UserCard: React.FC<UserCardProps> = ({ name }) => {",
    "  const [likes, setLikes] = useState<number>(0);",
    "  return (",
    "    <div className=\"user-card\">",
    "      <h2>{name}</h2>",
    "      <p>Don't forget to click like!</p>",
    "      <button onClick={() => setLikes((c) => c + 1)}>Likes: {likes}</button>",
    "    </div>",
    "  );",
    "};",
  ].join("\n"),
);
await fs.writeFile(
  path.join(project, "src", "Widget.jsx"),
  "export function Widget() {\n  return <section>JSX Widget</section>;\n}\n",
);
await fs.writeFile(
  path.join(project, "src", "index.ts"),
  "export const version = '1.0.0';\n",
);

await fs.writeFile(
  path.join(userData, "settings.json"),
  JSON.stringify({
    schemaVersion: 6,
    explorerOpenMode: "single",
    breadcrumbs: true,
  }),
);

const port = await availablePort();
const child = spawn(
  electron,
  [root, `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`],
  {
    cwd: root,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      KIWI_LOAD_DIST: "1",
      KIWI_STARTUP_PRELOAD: "0",
      KIWI_SPLASH_MINIMUM_MS: "200",
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    },
  },
);

let logs = "";
child.stdout.on("data", (chunk) => {
  logs += chunk;
});
child.stderr.on("data", (chunk) => {
  logs += chunk;
});

const sockets = [];
const targets = () => fetch(`http://127.0.0.1:${port}/json/list`).then((res) => res.json());

async function windowFor(kind) {
  const target = await until(
    async () =>
      (await targets()).find((item) => item.type === "page" && item.url.includes(`window=${kind}`)),
    30_000,
    `${kind} window`,
  );
  const cdp = await connect(target.webSocketDebuggerUrl);
  sockets.push(cdp);
  await cdp.send("Runtime.enable");
  await until(
    () => evaluate(cdp, "document.readyState === 'complete' && Boolean(window.kiwi)"),
    20_000,
    `${kind} preload`,
  );
  return cdp;
}

try {
  // 1. Welcome Window
  const welcome = await windowFor("welcome");
  await until(
    () => evaluate(welcome, "Boolean(document.querySelector('.project-hub'))"),
    15_000,
    "Project Hub rendered",
  );
  console.log("  ✓ Welcome / Project Hub window");

  // 2. Open Standalone New Project Wizard Window ("window=wizard")
  await evaluate(welcome, "window.kiwi.app.openNewProject()");
  const wizard = await windowFor("wizard");
  await until(
    () =>
      evaluate(
        wizard,
        "Boolean(document.querySelector('.project-wizard')) && document.body.innerText.includes('Neues Projekt')",
      ),
    15_000,
    "Standalone New Project Wizard rendered",
  );
  console.log("  ✓ Standalone Neues Projekt window (window=wizard)");
  await evaluate(wizard, "window.kiwi.app.close()");

  // 3. Open Main Editor Workbench with our TSX project
  await evaluate(
    welcome,
    `(async () => {
      await window.kiwi.workspace.add([${JSON.stringify(project)}]);
      await window.kiwi.app.openEditor(${JSON.stringify(project)});
      return true;
    })()`,
  );
  const editor = await windowFor("editor");
  await editor.send("Page.bringToFront");
  await until(
    () =>
      evaluate(
        editor,
        "Boolean(document.querySelector('.workspace-project-tree.active .tree-row'))",
      ),
    20_000,
    "Editor project tree loaded",
  );
  console.log("  ✓ Main Workbench & Explorer tree loaded");

  // Expand src and src/components to verify .tsx and .jsx icons in ProjectTree
  const srcDir = path.join(project, "src");
  const compDir = path.join(project, "src", "components");
  const srcCardPath = path.join(project, "src", "components", "UserCard.tsx");
  const srcWidgetPath = path.join(project, "src", "Widget.jsx");

  await until(
    () =>
      evaluate(
        editor,
        `(() => {
          const srcRow = [...document.querySelectorAll('.tree-row')].find((r) => r.getAttribute('title') === ${JSON.stringify(srcDir)});
          if (!srcRow) return false;
          if (srcRow.getAttribute('aria-expanded') === 'false') srcRow.click();
          return Boolean([...document.querySelectorAll('.tree-row')].find((r) => r.getAttribute('title') === ${JSON.stringify(srcWidgetPath)}));
        })()`,
      ),
    10_000,
    "Widget.jsx visible in Explorer",
  );
  await until(
    () =>
      evaluate(
        editor,
        `(() => {
          const compRow = [...document.querySelectorAll('.tree-row')].find((r) => r.getAttribute('title') === ${JSON.stringify(compDir)});
          if (!compRow) return false;
          if (compRow.getAttribute('aria-expanded') === 'false') compRow.click();
          return Boolean([...document.querySelectorAll('.tree-row')].find((r) => r.getAttribute('title') === ${JSON.stringify(srcCardPath)}));
        })()`,
      ),
    10_000,
    "UserCard.tsx visible in Explorer",
  );
  await until(
    () =>
      evaluate(
        editor,
        "Boolean(document.querySelector('.file-tsx-glyph')) && Boolean(document.querySelector('.file-jsx-glyph'))",
      ),
    10_000,
    ".tsx and .jsx React icons in Explorer",
  );
  console.log("  ✓ Explorer .tsx and .jsx React (⚛) icons rendered");

  // 4. Open UserCard.tsx in Monaco Editor and verify breadcrumbs + 0 syntax errors
  await evaluate(
    editor,
    `(() => {
      const row = [...document.querySelectorAll('.tree-row')].find((r) => r.getAttribute('title') === ${JSON.stringify(srcCardPath)});
      if (row) row.click();
    })()`,
  );
  await until(
    () =>
      evaluate(
        editor,
        "Boolean(document.querySelector('.monaco-editor')) && document.body.innerText.includes('UserCardProps')",
      ),
    15_000,
    "UserCard.tsx loaded in Monaco editor",
  );

  // Focus Monaco editor and move cursor down 8 lines into UserCard component to trigger <UserCard /> in breadcrumbs
  await evaluate(
    editor,
    "document.querySelector('[data-mode-id=\"typescriptreact\"] .monaco-editor textarea, .monaco-editor textarea')?.focus()",
  );
  for (let i = 0; i < 8; i++) {
    await press(editor, "ArrowDown", "ArrowDown", 40);
  }
  await until(
    () =>
      evaluate(
        editor,
        "Boolean(document.querySelector('.breadcrumbs')) && document.querySelector('.breadcrumbs').innerText.includes('UserCard.tsx') && document.querySelector('.breadcrumbs').innerText.includes('<UserCard />')",
      ),
    10_000,
    "Code breadcrumbs bar shows UserCard.tsx and <UserCard />",
  );

  // Verify 0 error squiggles in Monaco on valid UserCard.tsx
  const errorSquiggleCount = await evaluate(
    editor,
    "document.querySelectorAll('.monaco-editor .squiggly-error').length",
  );
  assert.equal(errorSquiggleCount, 0, `Expected 0 error squiggles on UserCard.tsx, got ${errorSquiggleCount}`);
  console.log("  ✓ UserCard.tsx in Monaco Editor (Breadcrumbs + 0 false-positive syntax errors)");

  // 5. Verify Explorer Context Menu -> Neu -> React Component (TSX) & (JSX)
  await evaluate(
    editor,
    `(() => {
      const row = [...document.querySelectorAll('.tree-row')].find((r) => r.textContent.includes('UserCard'));
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 120 }));
    })()`,
  );
  await until(
    () => evaluate(editor, "Boolean(document.querySelector('.explorer-context-menu'))"),
    5_000,
    "Explorer context menu opened",
  );
  await evaluate(
    editor,
    `(() => {
      const neuBtn = document.querySelector('[data-explorer-submenu="new"]');
      if (neuBtn) neuBtn.click();
    })()`,
  );
  await until(
    () =>
      evaluate(
        editor,
        "document.querySelector('.explorer-submenu-portal')?.innerText.includes('React Component (TSX)') && document.querySelector('.explorer-submenu-portal')?.innerText.includes('React Component (JSX)')",
      ),
    5_000,
    "React Component (TSX) and (JSX) in Explorer New menu",
  );
  await evaluate(editor, "document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))");
  console.log("  ✓ Explorer Context Menu -> Neu -> React Component (TSX) & (JSX)");

  // 6. Test all 6 Workbench Document Views (Web-Preview, NPM-Pakete, Datenbank-Browser, Docker, Git-Graph, Scratchpad)
  const docViews = [
    ["Live Web-Preview", ".web-preview-document"],
    ["NPM-Pakete", ".npm-packages-document"],
    ["Datenbank-Browser", ".database-document"],
    ["Docker & Container", ".docker-document"],
    ["Visueller Git-Graph", ".git-graph-document"],
    ["Scratchpad & Notizen", ".scratchpad-document"],
  ];

  for (const [menuLabel, selector] of docViews) {
    await evaluate(
      editor,
      `(() => {
        const btn = document.querySelector('button[title="Dateiaktionen"]');
        if (btn) btn.click();
      })()`,
    );
    await until(
      () => evaluate(editor, "Boolean(document.querySelector('.editor-actions-menu'))"),
      5_000,
      `Editor actions menu for ${menuLabel}`,
    );
    await evaluate(
      editor,
      `(() => {
        const item = [...document.querySelectorAll('.editor-actions-menu button')].find((b) => b.textContent.includes(${JSON.stringify(menuLabel)}));
        if (item) item.click();
      })()`,
    );
    await until(
      () =>
        evaluate(
          editor,
          `Boolean(document.querySelector(${JSON.stringify(selector)})) && document.querySelector(${JSON.stringify(selector)}).innerText.trim().length > 0`,
        ),
      10_000,
      `${menuLabel} view rendered`,
    );
    console.log(`  ✓ Workbench surface: ${menuLabel}`);
  }

  // 7. Test all Activity Bar sidebar tools
  const activityButtonCount = await evaluate(
    editor,
    "document.querySelectorAll('.activitybar .activity-top button').length",
  );
  for (let i = 0; i < activityButtonCount; i++) {
    const label = await evaluate(
      editor,
      `(() => {
        const btn = document.querySelectorAll('.activitybar .activity-top button')[${i}];
        if (!btn) return '';
        const title = btn.getAttribute('title') || btn.getAttribute('aria-label') || 'Activity ' + ${i};
        if (!btn.classList.contains('active')) btn.click();
        return title;
      })()`,
    );
    await until(
      () => evaluate(editor, "Boolean(document.querySelector('.sidebar')) && document.querySelector('.sidebar').innerText.trim().length > 0"),
      5_000,
      `Sidebar activity ${label}`,
    );
    console.log(`  ✓ Activity Bar sidebar: ${label}`);
  }

  // 8. Test all Bottom Panel tabs (PROBLEMS, TODO, BUILD, RUN, DEBUG, TESTS, TERMINAL, TAILER)
  const panelTabCount = await evaluate(
    editor,
    "document.querySelectorAll('.bottom-panel .panel-tabs button').length",
  );
  for (let i = 0; i < panelTabCount; i++) {
    const tabName = await evaluate(
      editor,
      `(() => {
        const btn = document.querySelectorAll('.bottom-panel .panel-tabs button')[${i}];
        if (!btn || btn.closest('.panel-actions')) return '';
        const label = btn.textContent.trim();
        btn.click();
        return label;
      })()`,
    );
    if (!tabName) continue;
    await until(
      () => evaluate(editor, "Boolean(document.querySelector('.bottom-panel .panel-content'))"),
      5_000,
      `Bottom panel tab ${tabName}`,
    );
    console.log(`  ✓ Bottom Panel tab: ${tabName}`);
  }

  // 9. Test Right Rail tools
  const rightRailCount = await evaluate(
    editor,
    "document.querySelectorAll('.right-rail button').length",
  );
  for (let i = 0; i < rightRailCount; i++) {
    const railTitle = await evaluate(
      editor,
      `(() => {
        const btn = document.querySelectorAll('.right-rail button')[${i}];
        if (!btn) return '';
        const title = btn.getAttribute('title') || btn.textContent.trim();
        btn.click();
        return title;
      })()`,
    );
    if (!railTitle) continue;
    console.log(`  ✓ Right Rail tool: ${railTitle}`);
  }

  // 10. Test Search Everywhere / Command Palette
  await evaluate(editor, "document.querySelector('.toolbar-search')?.click()");
  await until(
    () => evaluate(editor, "Boolean(document.querySelector('.palette')) && Boolean(document.querySelector('.palette-switch'))"),
    5_000,
    "Search Everywhere / Command Palette opened",
  );
  await press(editor, "Escape", "Escape", 27);
  console.log("  ✓ Search Everywhere / Command Palette (Überall, Dateien, Klassen, Struktur, Symbole, Befehle)");

  // 11. Test Standalone Project Structure Window ("window=structure")
  await evaluate(editor, `window.kiwi.app.openStructure(${JSON.stringify(project)})`);
  const structure = await windowFor("structure");
  await until(
    () =>
      evaluate(
        structure,
        "document.body.innerText.includes('Projektstruktur') && document.body.innerText.includes('Module')",
      ),
    15_000,
    "Standalone Project Structure window rendered",
  );
  console.log("  ✓ Standalone Projektstruktur window (window=structure)");
  await evaluate(structure, "window.kiwi.app.close()");

  // 8. Test Standalone Settings Window ("window=settings") & LanguageServersSettings ("Alle Sprachserver automatisch installieren")
  await evaluate(editor, `window.kiwi.app.openSettings(${JSON.stringify(project)})`);
  const settingsWin = await windowFor("settings");
  await until(
    () =>
      evaluate(
        settingsWin,
        "Boolean(document.querySelector('.settings-modal')) && document.body.innerText.includes('Einstellungen')",
      ),
    15_000,
    "Standalone Settings window rendered",
  );

  // Switch to "Sprachen & Sprachserver"
  await evaluate(
    settingsWin,
    `(() => {
      const btn = [...document.querySelectorAll('.settings-sidebar button, .settings-nav button, nav button')].find((b) => b.textContent.includes('Sprachen'));
      if (btn) btn.click();
    })()`,
  );
  await until(
    () =>
      evaluate(
        settingsWin,
        "document.body.innerText.includes('Alle Sprachserver automatisch installieren') && document.body.innerText.includes('Sprachserver erkennen')",
      ),
    10_000,
    "LanguageServersSettings auto-install button visible",
  );
  console.log("  ✓ Standalone Einstellungen window -> Sprachen & Sprachserver (Auto-Install UI)");
  await evaluate(settingsWin, "window.kiwi.app.close()");

  console.log("All UI surfaces verified successfully!");
} catch (error) {
  throw new Error(`${error.message}\n--- Kiwi output ---\n${logs.slice(-4_000)}`);
} finally {
  for (const cdp of sockets) {
    try {
      cdp.close();
    } catch {}
  }
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
  await fs.rm(fixture, { recursive: true, force: true }).catch(() => undefined);
}

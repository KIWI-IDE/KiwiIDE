import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "kiwi-icon-smoke-"));
try {
  const child = spawn(require("electron"), [path.join(import.meta.dirname, "smoke-application-icon.cjs")], {
    windowsHide: true, stdio: "inherit", env: { ...process.env, KIWI_ICON_SMOKE_DIRECTORY: directory },
  });
  process.exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject); child.once("exit", code => resolve(code ?? 1));
  });
} finally {
  if (path.dirname(path.resolve(directory)) === path.resolve(os.tmpdir()) && path.basename(directory).startsWith("kiwi-icon-smoke-")) await fs.rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}

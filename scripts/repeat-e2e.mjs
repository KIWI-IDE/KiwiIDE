import { spawnSync } from "node:child_process";

export function normalizeRepeatCount(value, fallback = 3) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(2, Math.min(10, parsed));
}

export function resolveNpmRunner(env = process.env, platform = process.platform) {
  if (env.npm_execpath) {
    return { command: process.execPath, prefixArgs: [env.npm_execpath] };
  }
  if (platform === "win32") {
    return {
      command: env.ComSpec || "C:\\Windows\\System32\\cmd.exe",
      prefixArgs: ["/d", "/s", "/c", "npm.cmd"],
    };
  }
  return { command: "npm", prefixArgs: [] };
}

export function runRepeatedE2E({
  repeats = normalizeRepeatCount(process.env.KIWI_E2E_REPEATS),
  command,
  prefixArgs,
  spawn = spawnSync,
} = {}) {
  const runner = command
    ? { command, prefixArgs: prefixArgs || [] }
    : resolveNpmRunner();
  for (let attempt = 1; attempt <= repeats; attempt += 1) {
    process.stdout.write(`\n=== Electron E2E ${attempt}/${repeats} ===\n`);
    const result = spawn(runner.command, [...runner.prefixArgs, "run", "test:e2e"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        KIWI_E2E_ATTEMPT: String(attempt),
        KIWI_E2E_REPEATS: String(repeats),
        // The release gate reaches these runs on a machine that has just
        // finished a Vite build and is about to write two 290 MB installers
        // past a virus scanner. The checks are the same; they are given more
        // room to be answered. A developer running the suite on its own keeps
        // the tight timings, where a slow step is worth knowing about.
        KIWI_E2E_PATIENCE: process.env.KIWI_E2E_PATIENCE || "2.5",
      },
      stdio: "inherit",
      shell: false,
    });
    if (result.error) throw result.error;
    if ((result.status ?? 1) !== 0) {
      throw new Error(`Electron-E2E-Durchlauf ${attempt}/${repeats} ist mit Code ${result.status ?? 1} fehlgeschlagen.`);
    }
  }
  return repeats;
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`).href) {
  try {
    const repeats = runRepeatedE2E();
    process.stdout.write(`\nAlle ${repeats} Electron-E2E-Durchläufe waren erfolgreich.\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

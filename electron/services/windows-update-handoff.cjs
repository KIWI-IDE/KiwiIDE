const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

function quoteWindowsArgument(value) {
  const text = String(value);
  return '"' + text.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1') + '"';
}

/** Start and acknowledge the updater while Electron's process/event loop is
 * still alive. Helpers run from userData, never from a portable extraction or
 * an installation directory which the update is about to replace. */
async function startWindowsUpdateHandoff({ userData, helperPath, buildArguments, parentPid = process.pid, spawnImpl = spawn, timeoutMs = 15_000, powershellPath }) {
  const requestId = crypto.randomUUID();
  const directory = path.join(path.resolve(userData), "updates", "helpers", requestId);
  await fs.mkdir(directory, { recursive: true });
  const script = path.join(directory, path.basename(helperPath));
  await fs.copyFile(helperPath, script);
  await fs.copyFile(path.join(path.dirname(helperPath), "windows-handoff.ps1"), path.join(directory, "windows-handoff.ps1"));
  const readyPath = path.join(directory, "ready.json"), commitPath = path.join(directory, "commit"), cancelPath = path.join(directory, "cancel");
  const resultPath = path.join(path.resolve(userData), "updates", "last-update-result.json");
  const stderr = await fs.open(path.join(directory, "helper-stderr.log"), "a");
  let child, spawnError, exitCode = null;
  try {
    const command = powershellPath || path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const args = [...buildArguments(script), "-KiwiParentProcessId", String(parentPid), "-KiwiReadyPath", readyPath, "-KiwiCommitPath", commitPath, "-KiwiCancelPath", cancelPath, "-KiwiResultPath", resultPath, "-KiwiRequestId", requestId];
    // DETACHED_PROCESS makes Windows PowerShell exit without running scripts;
    // attaching it to Electron's console instead kills it on Electron exit.
    // A short bootstrap uses ShellExecute to give the real helper an independent
    // hidden console. Only the real helper's ready file authorizes quitting.
    const payload = Buffer.from(JSON.stringify({ command, arguments: args.map(quoteWindowsArgument).join(" "), directory }), "utf8").toString("base64");
    const bootstrap = `$ErrorActionPreference='Stop'; $p=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))); Start-Process -FilePath $p.command -ArgumentList $p.arguments -WorkingDirectory $p.directory -WindowStyle Hidden`;
    const launchArgs = ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(bootstrap, "utf16le").toString("base64")];
    child = spawnImpl(command, launchArgs, { cwd: directory, detached: false, stdio: ["ignore", "ignore", stderr.fd], windowsHide: true, shell: false });
    child.once("error", error => { spawnError = error; });
    child.once("exit", code => { exitCode = code ?? -1; });
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (spawnError) throw new Error("Der Windows-Updatehelfer konnte nicht gestartet werden. Kiwi bleibt geöffnet.");
      if (exitCode !== null && exitCode !== 0) throw new Error(`Der Windows-Updatestart wurde vorzeitig beendet (Code ${exitCode}). Protokoll: ${path.join(directory, "helper-stderr.log")}`);
      const ready = await fs.readFile(readyPath, "utf8").then(text => JSON.parse(text.replace(/^\uFEFF/, ""))).catch(() => null);
      if (ready?.requestId === requestId && ready.parentPid === parentPid && ready.phase === "waiting-for-parent") break;
      if (Date.now() >= deadline) throw new Error(`Der Windows-Updatehelfer hat seinen Start nicht bestätigt. Kiwi bleibt geöffnet. Protokoll: ${path.join(directory, "helper-stderr.log")}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await fs.writeFile(commitPath, requestId, { flag: "wx" });
    const ready = JSON.parse((await fs.readFile(readyPath, "utf8")).replace(/^\uFEFF/, ""));
    child.unref();
    return { requestId, directory, readyPath, resultPath, pid: ready.helperPid, cancel: async () => { await fs.writeFile(cancelPath, requestId).catch(() => undefined); child.kill(); } };
  } catch (error) {
    await fs.writeFile(cancelPath, requestId).catch(() => undefined);
    child?.kill(); throw error;
  } finally { await stderr.close(); }
}
module.exports = { startWindowsUpdateHandoff };

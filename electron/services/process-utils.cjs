const { spawn } = require("node:child_process");

function spawnCapture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const prepared = prepareCommand(command, args);
    const child = spawn(prepared.command, prepared.args, {
      cwd: options.cwd,
      env: options.env || process.env,
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: prepared.verbatim,
    });
    let timeout;
    let timedOut = false;
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (data) => { stdout += data.toString(); });
    child.stderr?.on("data", (data) => { stderr += data.toString(); });
    child.on("error", (error) => {
      if (timeout) clearTimeout(timeout);
      reject(error);
    });
    if (options.input !== undefined) child.stdin?.end(String(options.input));
    else child.stdin?.end();
    if (Number(options.timeoutMs) > 0) {
      timeout = setTimeout(() => {
        timedOut = true;
        void terminateProcessTree(child);
      }, Number(options.timeoutMs));
      timeout.unref?.();
    }
    child.on("close", (code) => {
      if (timeout) clearTimeout(timeout);
      const result = { code: code ?? 1, stdout, stderr, output: stdout || stderr };
      if (timedOut) {
        reject(new Error(`${command} wurde nach ${options.timeoutMs} ms beendet.`));
      } else if (options.rejectOnError && result.code !== 0) {
        reject(new Error((stderr || stdout || `${command} exited with ${result.code}`).trim()));
      } else {
        resolve(result);
      }
    });
  });
}

function streamProcess(command, args, options) {
  const prepared = prepareCommand(command, args);
  const child = spawn(prepared.command, prepared.args, {
    cwd: options.cwd,
    env: options.env || process.env,
    shell: false,
    windowsHide: true,
    windowsVerbatimArguments: prepared.verbatim,
  });
  const send = (stream, data) => options.onOutput?.({ stream, text: data.toString() });
  child.stdout?.on("data", (data) => send("stdout", data));
  child.stderr?.on("data", (data) => send("stderr", data));
  child.on("error", (error) => send("stderr", `${error.message}\n`));
  child.on("close", (code) => options.onExit?.({ code: code ?? 1 }));
  return child;
}

function terminateProcessTree(child) {
  if (!child?.pid || child.exitCode !== null) return Promise.resolve(false);
  if (process.platform !== "win32") {
    try { return Promise.resolve(child.kill("SIGTERM")); } catch { return Promise.resolve(false); }
  }
  return new Promise((resolve) => {
    const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
      shell: false,
    });
    killer.once("error", () => {
      try { child.kill(); } catch {}
      resolve(false);
    });
    killer.once("exit", (code) => resolve(code === 0));
  });
}

/** Quotes one argument for cmd.exe, which splits on spaces and little else. */
function quoteForCmd(value) {
  const text = String(value);
  if (!text) return '""';
  if (!/[\s"&|<>^()]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * How a batch file is started on Windows.
 *
 * A .bat cannot be executed directly, so it goes through cmd.exe — and cmd's
 * /s rule is a trap: it strips the first and the last quote of everything
 * after /c. Handing it a quoted path followed by unquoted arguments meant the
 * closing quote of the path was the last quote in the line, so cmd removed
 * exactly the two that were holding the path together. On an installed Kiwi
 * that path is "…\Programs\Kiwi IDE\resources\toolchain\…\gradle.bat", and
 * every build died with "The command …\Programs\Kiwi is misspelled or could
 * not be found" — the path cut at its space.
 *
 * The whole line is therefore quoted once more around the outside. cmd strips
 * that pair, and the quoting inside it survives intact. Node must not add its
 * own quoting on top, which is what windowsVerbatimArguments turns off.
 */
function prepareCommand(command, args) {
  if (process.platform === "win32" && /\.(?:cmd|bat)$/i.test(String(command))) {
    const line = [command, ...args].map(quoteForCmd).join(" ");
    return {
      command: process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", `"${line}"`],
      verbatim: true,
    };
  }
  return { command, args, verbatim: false };
}

module.exports = { prepareCommand, quoteForCmd, spawnCapture, streamProcess, terminateProcessTree };

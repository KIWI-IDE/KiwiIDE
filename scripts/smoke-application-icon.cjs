const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const run = promisify(execFile);
const { app, BrowserWindow, nativeImage } = require("electron");
const { ApplicationIconService } = require("../electron/services/application-icon.cjs");
const root = path.resolve(__dirname, "..");
const directory = process.env.KIWI_ICON_SMOKE_DIRECTORY || fs.mkdtempSync(path.join(os.tmpdir(), "kiwi-icon-smoke-"));
app.setPath("userData", path.join(directory, "profile"));
const captureScript = path.join(directory, "capture.ps1");
fs.writeFileSync(captureScript, `param([long]$Window, [string]$Output)
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class KiwiWindowIcon {
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
}
'@
$handle = [KiwiWindowIcon]::SendMessage([IntPtr]$Window, 0x007F, [IntPtr]1, [IntPtr]::Zero)
if ($handle -eq [IntPtr]::Zero) { throw "The window has no large native icon" }
$icon = [System.Drawing.Icon]::FromHandle($handle)
$bitmap = $icon.ToBitmap()
$bitmap.Save($Output, [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()
`);

function hue(bitmap) {
  let red = 0, blue = 0;
  for (let index = 0; index < bitmap.length; index += 4) { red += bitmap[index + 2]; blue += bitmap[index]; }
  return red - blue;
}
async function actualIcon(window) {
  const buffer = window.getNativeWindowHandle();
  const handle = buffer.length === 8 ? buffer.readBigUInt64LE() : BigInt(buffer.readUInt32LE());
  const output = path.join(directory, `window-${window.id}.png`);
  await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", captureScript, "-Window", String(handle), "-Output", output], { windowsHide: true, timeout: 20_000 });
  return nativeImage.createFromPath(output).toBitmap();
}

app.whenReady().then(async () => {
  try {
    const service = new ApplicationIconService(nativeImage, app, BrowserWindow, path.join(root, "assets", "icons", "kiwi-512.png"), path.join(directory, "icons"));
    const windows = [new BrowserWindow({ show: false }), new BrowserWindow({ show: false })];
    service.apply("#ff0000");
    for (const window of windows) {
      const data = process.platform === "win32" ? await actualIcon(window) : service.get("#ff0000").toBitmap();
      assert(hue(data) > 0, "The native icon did not become red");
    }
    service.apply("#0000ff");
    const extra = new BrowserWindow({ show: false, icon: service.get("#0000ff") });
    windows.push(extra); service.apply("#0000ff");
    for (const window of windows) {
      const data = process.platform === "win32" ? await actualIcon(window) : service.get("#0000ff").toBitmap();
      assert(hue(data) < 0, "An existing or new window kept the previous icon color");
    }
    const red = path.join(directory, "icons", "kiwi-ff0000.ico");
    if (process.platform === "win32") assert.equal(nativeImage.createFromPath(red).isEmpty(), false, "The Windows taskbar icon resource was invalid");
    const listeners = windows[0].listenerCount("closed");
    for (let index = 0; index < 15; index++) service.apply(index % 2 ? "#ff0000" : "#0000ff");
    assert.equal(windows[0].listenerCount("closed"), listeners, "Color changes accumulated window listeners");
    console.log("Application icons passed: real native window icons changed from red to blue, including existing and new windows; Windows icon resources decoded.");
    windows.forEach(window => window.destroy());
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally {
    BrowserWindow.getAllWindows().forEach(window => window.destroy());
    app.exit(process.exitCode || 0);
  }
});

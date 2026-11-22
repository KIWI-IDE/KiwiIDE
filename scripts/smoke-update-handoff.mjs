import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url), run = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
if (process.platform !== "win32") { console.log("Windows updater handoff smoke skipped on this platform."); process.exit(0); }
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "kiwi updater handoff "));
try {
  const compiler = path.join(process.env.SystemRoot || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
  const source = path.join(directory, "Fixture.cs");
  const payload = path.join(directory, "new app.exe"), oldApp = path.join(directory, "old app.exe");
  const program = version => `using System; using System.IO; using System.Reflection;
[assembly: AssemblyFileVersion("${version}.0")]
[assembly: AssemblyInformationalVersion("${version}")]
class Fixture { static int Main(string[] args) {
  if(args.Length>0 && args[0]=="--install") {File.Copy(args[1],args[2],true);File.WriteAllText(args[3],"installed");return 0;}
  if(args.Length>0 && args[0]=="--noop") return 0;
  if(args.Length>0) File.WriteAllText(args[0],String.Join("|",args)); return 0;
} }`;
  for (const [version, file] of [["1.0.3", oldApp], ["1.0.5", payload]]) {
    await fs.writeFile(source, program(version));
    await run(compiler, ["/nologo", "/target:winexe", `/out:${file}`, source], { windowsHide: true });
  }
  for (const kind of ["setup", "portable", "setup-noop"]) {
    const fixture = path.join(directory, kind); await fs.mkdir(fixture);
    const volatile = path.join(fixture, "volatile helpers"); await fs.mkdir(volatile);
    for (const name of ["setup-update.ps1", "portable-update.ps1", "windows-handoff.ps1"]) await fs.copyFile(path.join(root, "resources/update-helper", name), path.join(volatile, name));
    const target = path.join(fixture, "Kiwi IDE.exe"); await fs.copyFile(oldApp, target);
    const launcher = path.join(fixture, "main.cjs");
    const launchMarker = path.join(fixture, "relaunched.txt"), failureMarker = path.join(fixture, "failed.txt"), installedMarker = path.join(fixture, "installed.txt");
    await fs.writeFile(launcher, `
const {app,BrowserWindow}=require('electron');const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {startWindowsUpdateHandoff}=require(${JSON.stringify(path.join(root,"electron/services/windows-update-handoff.cjs"))});
const {portableHelperArguments,setupHelperArguments,stagePortableUpdate}=require(${JSON.stringify(path.join(root,"electron/services/portable-update-service.cjs"))});
app.setPath('userData',${JSON.stringify(path.join(fixture,"profile"))});let window;
app.whenReady().then(async()=>{try{
 window=new BrowserWindow({show:false});await window.loadURL('data:text/html,update-test');
 const payload=${JSON.stringify(payload)},target=${JSON.stringify(target)},kind=${JSON.stringify(kind)};
 const bytes=fs.readFileSync(payload);const verification={bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
 const stage=kind==='portable'?await stagePortableUpdate({path:payload,version:'1.0.5',...verification},target):null;
 const handoff=await startWindowsUpdateHandoff({userData:app.getPath('userData'),helperPath:path.join(${JSON.stringify(volatile)},kind==='portable'?'portable-update.ps1':'setup-update.ps1'),buildArguments:helper=>[
  ...(stage?portableHelperArguments(helper,stage,${JSON.stringify(path.join(fixture,"update.log"))},[${JSON.stringify(launchMarker)},'--updated']):setupHelperArguments(helper,payload,target,${JSON.stringify(path.join(fixture,"update.log"))},kind==='setup-noop'?['--noop']:['--install',payload,target,${JSON.stringify(installedMarker)}],verification,[${JSON.stringify(launchMarker)},'--updated'],[${JSON.stringify(failureMarker)},'--update-failed'])),
  '-ExpectedVersion','1.0.5']});
 if(!fs.existsSync(handoff.readyPath))throw Error('No helper acknowledgement');
 await new Promise(resolve=>setTimeout(resolve,500));
 if(fs.existsSync(${JSON.stringify(launchMarker)})||fs.existsSync(${JSON.stringify(installedMarker)}))throw Error('Installed or relaunched while old process was alive');
 if(fs.readFileSync(target).equals(bytes))throw Error('Replaced the target before parent exit');
 fs.writeFileSync(${JSON.stringify(path.join(fixture,"parent-ready.json"))},JSON.stringify({pid:process.pid,helperPid:handoff.pid}));
 // Reproduce portable extraction cleanup: the original scripts disappear.
 app.on('will-quit',()=>{for(const name of ['setup-update.ps1','portable-update.ps1','windows-handoff.ps1'])fs.unlinkSync(path.join(${JSON.stringify(volatile)},name));});
 app.quit();
}catch(error){console.error(error);app.exit(1);}});
`);
    const child = spawn(require("electron"), [launcher], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; child.stderr.on("data", data => output += data); child.stdout.on("data", data => output += data);
    const timer = setTimeout(() => child.kill(), 30_000);
    const code = await new Promise(resolve => child.once("exit", resolve)); clearTimeout(timer);
    assert.equal(code, 0, output);
    const resultPath = path.join(fixture, "profile", "updates", "last-update-result.json");
    await until(async () => {
      const report = await fs.readFile(resultPath, "utf8").then(JSON.parse).catch(() => null);
      const marker = kind === "setup-noop" ? failureMarker : launchMarker;
      return report && await fs.stat(marker).then(() => true).catch(() => false) ? report : null;
    }, 20_000);
    const result = JSON.parse(await fs.readFile(resultPath, "utf8"));
    if (kind === "setup-noop") {
      assert.equal(result.phase, "failed"); assert(result.message.includes("1.0.3"));
      assert.equal(await fs.stat(launchMarker).then(() => true).catch(() => false), false);
    } else {
      assert.equal(result.phase, "installed"); assert.equal(result.version, "1.0.5");
      assert((await fs.readFile(launchMarker,"utf8")).includes("--updated"));
      assert((await fs.readFile(target)).equals(await fs.readFile(payload)));
    }
    console.log(`${kind}: acknowledged helper survived Electron exit and removed source scripts; ${result.phase}.`);
  }
  console.log("Windows update handoff passed: setup installation, portable replacement, restart, and detection of an installer that did not update.");
} finally {
  if (process.env.KIWI_KEEP_UPDATE_FIXTURE === "1") console.log(`Retained updater fixture: ${directory}`);
  else if (path.dirname(path.resolve(directory)) === path.resolve(os.tmpdir()) && path.basename(directory).startsWith("kiwi updater handoff ")) await fs.rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 150 });
}
async function until(read, timeout) { const deadline=Date.now()+timeout; while(Date.now()<deadline){const value=await read();if(value)return value;await new Promise(resolve=>setTimeout(resolve,100));}throw Error("Updater did not finish or relaunch after parent exit"); }

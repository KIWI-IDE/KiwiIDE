import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "kiwi-actions-ui-"));
const port = await new Promise(resolve => { const server = net.createServer(); server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolve(port)); }); });
let child, socket; let output = "";
try {
  await require("esbuild").build({ stdin: { resolveDir: root, loader: "tsx", contents: `
    import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
    import {GitHubActionsView} from './src/git/GitHubActionsView'; import './src/styles.css';
    window.reruns=[]; window.reads=[]; window.pendingLogs=[]; window.pendingDetails=[]; window.accounts=0;
    const run=(id)=>({id,name:'Desktop build',title:id===12?'Compile release':'Check tests',number:id,attempt:1,status:'completed',conclusion:id===12?'failure':'success',branch:'main',sha:'abc123456',event:'push',actor:'developer',createdAt:'2026-11-22T12:00:00Z',updatedAt:'2026-11-22T12:01:00Z',url:'https://github.com/team/repo/actions/runs/'+id,workflowId:4});
    const detail=(id)=>({run:run(id),totalJobs:1,jobs:[{id:100+id,name:'Compile',status:'completed',conclusion:id===12?'failure':'success',steps:[{number:1,name:'Build sources',status:'completed',conclusion:id===12?'failure':'success'}]}]});
    window.detail=detail;
    window.kiwi={git:{
      actionsList:async(root,options)=>{window.reads.push({root,options});if(window.failList)throw Error('Actions read permission required (403)');return {repository:root==='second'?'team/second':'team/first',page:1,total:2,runs:[run(12),run(13)],workflows:[{id:4,name:'Desktop build'}]};},
      actionsDetails:async(root,id)=>window.holdDetails?new Promise(resolve=>window.pendingDetails.push({root,id,resolve})):detail(id),
      actionsLogs:(root,runId,jobId)=>new Promise(resolve=>window.pendingLogs.push({root,runId,jobId,resolve})),
      actionsRerunFailed:async(root,id)=>{window.reruns.push({root,id});return {requested:true,id};}
    },app:{openUpdate:async(url)=>{window.opened=url;}}};
    function Fixture(){const [root,setRoot]=useState('first');window.switchProject=setRoot;return <GitHubActionsView root={root} onConnect={()=>window.accounts++} onClose={()=>{}}/>;}
    createRoot(document.getElementById('root')).render(<Fixture/>);
  ` }, bundle: true, outfile: path.join(directory, "fixture.js"), define: { "process.env.NODE_ENV": '"development"' } });
  await fs.writeFile(path.join(directory, "index.html"), '<html><head><link rel="stylesheet" href="fixture.css"><style>html,body,#root{height:100%;margin:0}</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
  await fs.writeFile(path.join(directory, "main.cjs"), `const {app,BrowserWindow}=require('electron');app.commandLine.appendSwitch('remote-debugging-port',${JSON.stringify(String(port))});app.whenReady().then(()=>{const window=new BrowserWindow({show:false,width:1100,height:820,webPreferences:{offscreen:true}});window.loadFile(${JSON.stringify(path.join(directory,"index.html"))});});app.on('window-all-closed',()=>app.quit());`);
  child = spawn(require("electron"), [path.join(directory, "main.cjs"), `--user-data-dir=${path.join(directory, "profile")}`], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stderr.on("data", data => output += data); child.stdout.on("data", data => output += data);
  const target = await until(async () => (await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json())).find(item => item.type === "page"), "fixture window");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve => socket.addEventListener("open", resolve, { once: true }));
  const pending = new Map(); let sequence = 0;
  socket.addEventListener("message", event => { const message = JSON.parse(event.data); const entry = pending.get(message.id); if (!entry) return; pending.delete(message.id); clearTimeout(entry.timer); if (message.error) entry.reject(Error(message.error.message)); else entry.resolve(message.result); });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; const timer = setTimeout(() => { pending.delete(id); reject(Error(`${method} timed out`)); }, 10_000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({id,method,params})); });
  const evaluate = async expression => { const result = await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true}); if(result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; };
  const click = async text => { const found = await evaluate(`(() => {const button=[...document.querySelectorAll('button')].find(button=>button.textContent.trim()===${JSON.stringify(text)});button?.click();return Boolean(button);})()`); assert(found, `Missing button ${text}`); };
  const select = async title => { await evaluate(`document.querySelectorAll('.actions-layout > nav > button')[${title === 'Compile release' ? 0 : 1}].click()`); await until(() => evaluate(`document.querySelector('.actions-details h3')?.textContent===${JSON.stringify(title)}`), `selected ${title}`); };
  await until(() => evaluate('document.querySelectorAll(".actions-layout > nav > button").length===2'), 'workflow run list');
  await select('Compile release'); await click('View log');
  await until(() => evaluate('window.pendingLogs.length===1'), 'job log request');
  await select('Check tests');
  await evaluate('window.pendingLogs[0].resolve({text:"STALE LOG MUST NOT APPEAR",truncated:false})');
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(await evaluate('document.body.textContent.includes("STALE LOG MUST NOT APPEAR")'), false);
  await select('Compile release'); await click('Re-run failed jobs');
  assert.equal(await evaluate('window.reruns.length'), 0, 'Opening confirmation started a run');
  assert(await evaluate('document.querySelector(".feature-confirm").textContent.includes("#12")'));
  await click('Cancel'); assert.equal(await evaluate('window.reruns.length'), 0);
  await click('Re-run failed jobs'); await click('Confirm re-run');
  await until(() => evaluate('window.reruns.length===1'), 'explicit re-run');
  await until(() => evaluate('Boolean(document.querySelector(".actions-details h3"))'), 'refreshed run');
  await click('View log'); await until(() => evaluate('window.pendingLogs.length===2'), 'second log request');
  await evaluate(`window.pendingLogs[1].resolve(${JSON.stringify({text:'Build failed\n<script>window.logExecuted=true</script>',truncated:true})})`);
  await until(() => evaluate('document.querySelector(".action-log pre")?.textContent.includes("Build failed")'), 'visible job log');
  assert.equal(await evaluate('Boolean(window.logExecuted)'), false);
  assert(await evaluate('document.querySelector(".action-log").textContent.includes("2 MB")'));
  const shot = await send('Page.captureScreenshot',{format:'png'}); await fs.writeFile(path.join(root,'.kiwi','github-actions.png'),Buffer.from(shot.data,'base64'));
  await evaluate('window.holdDetails=true');
  await evaluate('document.querySelectorAll(".actions-layout > nav > button")[1].click()');
  await until(() => evaluate('window.pendingDetails.length===1'), 'deferred old-project details');
  await evaluate('window.switchProject("second")');
  await until(() => evaluate('document.querySelector(".actions-view > header p")?.textContent==="team/second"'), 'new project');
  await evaluate('window.pendingDetails[0].resolve({...window.detail(13),run:{...window.detail(13).run,title:"STALE OLD PROJECT"}})');
  await new Promise(resolve => setTimeout(resolve,50));
  assert.equal(await evaluate('document.body.textContent.includes("STALE OLD PROJECT")'),false);
  await evaluate('window.failList=true'); await click('Refresh');
  await until(() => evaluate('document.querySelector("[role=alert]")?.textContent.includes("403")'), 'permission error');
  await click('GitHub account'); assert.equal(await evaluate('window.accounts'),1);
  await evaluate('window.failList=false'); await click('Refresh');
  await until(() => evaluate('!document.querySelector("[role=alert]")'), 'error recovery');
  console.log('GitHub Actions UI passed: runs, jobs, logs, permission recovery, explicit re-run, stale log/project responses and safe log rendering.');
} catch (error) { throw Error(`${error.message}\n${output.slice(-1500)}`); }
finally {
  socket?.close();
  if (child && child.exitCode === null) { child.kill(); await new Promise(resolve => child.once('exit', resolve)); }
  if (path.dirname(path.resolve(directory)) === path.resolve(os.tmpdir()) && path.basename(directory).startsWith('kiwi-actions-ui-')) await fs.rm(directory,{recursive:true,force:true,maxRetries:12,retryDelay:100});
}
async function until(read, label) { const deadline=Date.now()+15_000; while(Date.now()<deadline){try {const value=await read();if(value)return value;} catch {} await new Promise(resolve=>setTimeout(resolve,100));}throw Error(`${label} timed out`); }

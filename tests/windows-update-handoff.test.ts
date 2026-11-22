import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
const { startWindowsUpdateHandoff } = require("../electron/services/windows-update-handoff.cjs");
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
async function fixture() { const root=await fs.mkdtemp(path.join(os.tmpdir(),'kiwi-handoff-'));roots.push(root);return root; }
describe('Windows updater launch acknowledgement', () => {
  it('uses durable helpers and waits for the matching acknowledgement before committing', async () => {
    const root=await fixture();const child=Object.assign(new EventEmitter(),{pid:42,unref:vi.fn(),kill:vi.fn()});
    const spawn=vi.fn((_command: string,args: string[],options: any)=>{
      expect(options.windowsHide).toBe(true);expect(options.detached).toBe(false);
      expect(args).toContain('-EncodedCommand');
      setTimeout(()=>{void fs.writeFile(path.join(options.cwd,'ready.json'),JSON.stringify({requestId:path.basename(options.cwd),parentPid:123,helperPid:456,phase:'waiting-for-parent'}));child.emit('exit',0);},20);
      return child;
    });
    const handoff=await startWindowsUpdateHandoff({userData:root,helperPath:path.resolve('resources/update-helper/setup-update.ps1'),buildArguments:(file:string)=>{expect(file).toContain(path.join(root,'updates','helpers'));return ['-File',file];},parentPid:123,spawnImpl:spawn,timeoutMs:1000});
    expect(handoff.pid).toBe(456);
    expect(child.unref).toHaveBeenCalledOnce();expect(await fs.readFile(path.join(handoff.directory,'commit'),'utf8')).toBe(handoff.requestId);
    expect(await fs.readFile(path.join(handoff.directory,'windows-handoff.ps1'),'utf8')).toContain('Wait-KiwiParentExit');
  });
  it('refuses an unacknowledged helper and cancels it while keeping the caller alive', async () => {
    const root=await fixture();const child=Object.assign(new EventEmitter(),{pid:42,unref:vi.fn(),kill:vi.fn()});
    await expect(startWindowsUpdateHandoff({userData:root,helperPath:path.resolve('resources/update-helper/setup-update.ps1'),buildArguments:()=>[],spawnImpl:()=>child,timeoutMs:50})).rejects.toThrow('Kiwi bleibt geöffnet');
    expect(child.kill).toHaveBeenCalledOnce();expect(child.unref).not.toHaveBeenCalled();
    const folders=await fs.readdir(path.join(root,'updates','helpers'));expect(await fs.stat(path.join(root,'updates','helpers',folders[0],'commit')).then(()=>true).catch(()=>false)).toBe(false);
  });
  it('reports a bootstrap launch failure without committing an update', async () => {
    const root=await fixture();const child=Object.assign(new EventEmitter(),{pid:42,unref:vi.fn(),kill:vi.fn()});
    await expect(startWindowsUpdateHandoff({userData:root,helperPath:path.resolve('resources/update-helper/setup-update.ps1'),buildArguments:()=>[],spawnImpl:()=>{setTimeout(()=>child.emit('error',new Error('spawn denied')),0);return child;},timeoutMs:1000})).rejects.toThrow('Kiwi bleibt geöffnet');
    expect(child.kill).toHaveBeenCalledOnce();expect(child.unref).not.toHaveBeenCalled();
  });
});

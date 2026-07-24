import { spawn, type ChildProcess } from 'node:child_process';
import { app, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

export let agentProcess: ChildProcess | null = null;

export async function startAgent(): Promise<void> {
  const binName = process.platform === 'win32' ? 'pi.exe' : `pi-${process.platform}-${process.arch}`;
  const binPath = app.isPackaged
    ? path.join(process.resourcesPath, 'bin', binName)
    : path.join(app.getAppPath(), 'resources', 'bin', binName);

  if (!fs.existsSync(binPath)) {
    console.warn(`Agent binary not found at ${binPath}, running in stub mode.`);
    return;
  }

  agentProcess = spawn(binPath, ['server'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: app.getPath('userData'),
  });

  agentProcess.stdout.on('data', (data: Buffer) => {
    console.log(`[agent] ${data.toString().trim()}`);
  });

  agentProcess.stderr.on('data', (data: Buffer) => {
    console.error(`[agent err] ${data.toString().trim()}`);
  });

  agentProcess.on('exit', (code) => {
    console.log(`[agent] exited with code ${code}`);
    agentProcess = null;
  });
}

export function stopAgent(): void {
  if (agentProcess) {
    agentProcess.kill();
    agentProcess = null;
  }
}

export function registerAgentIpc(): void {
  ipcMain.handle('agent:invoke', async (_event, command: string, args: unknown[]) => {
    if (!agentProcess) {
      return { ok: false, error: 'Agent binary not found or not started' };
    }
    // TODO: wire to Pi stdin/stdout or HTTP/gRPC protocol
    return { ok: true, command, args, note: 'Pi protocol not yet implemented' };
  });
}

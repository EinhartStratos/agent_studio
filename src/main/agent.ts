import { spawn, type ChildProcess } from 'node:child_process';
import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

export let agentProcess: ChildProcess | null = null;

interface PendingRequest {
  resolve: (value: RpcMessage) => void;
  reject: (err: Error) => void;
  timeout: NodeJS.Timeout;
}

const pendingRequests = new Map<string, PendingRequest>();
let stdoutBuffer = '';
let agentLastMessage = '';

interface AgentStatus {
  binaryExists: boolean;
  processPid: number | null;
  transport: string;
  connected: boolean;
  state?: unknown;
  lastMessage: string;
  error?: string;
}

interface RpcMessage {
  id?: string;
  type?: string;
  command?: string;
  success?: boolean;
  data?: unknown;
  error?: string;
}

function getAgentBinaryPath(): string {
  const binName = process.platform === 'win32' ? 'pi.exe' : `pi-${process.platform}-${process.arch}`;
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin', binName)
    : path.join(app.getAppPath(), 'resources', 'bin', binName);
}

export async function startAgent(): Promise<void> {
  const binPath = getAgentBinaryPath();

  if (!fs.existsSync(binPath)) {
    console.warn(`Agent binary not found at ${binPath}, running in stub mode.`);
    return;
  }

  stdoutBuffer = '';
  pendingRequests.clear();

  agentProcess = spawn(binPath, ['--mode', 'rpc'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: app.getPath('userData'),
  });

  agentProcess.stdout.on('data', (data: Buffer) => {
    const text = data.toString();
    agentLastMessage = text.trim();
    stdoutBuffer += text;
    let newlineIndex: number;
    while ((newlineIndex = stdoutBuffer.indexOf('\n')) !== -1) {
      const line = stdoutBuffer.slice(0, newlineIndex).trim();
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      if (line) handleAgentLine(line);
    }
  });

  agentProcess.stderr.on('data', (data: Buffer) => {
    const text = data.toString().trim();
    agentLastMessage = text;
    console.error(`[agent err] ${text}`);
  });

  agentProcess.on('error', (err) => {
    console.error('[agent] process error:', err);
    rejectAllPending(err);
  });

  agentProcess.on('exit', (code) => {
    console.log(`[agent] exited with code ${code}`);
    rejectAllPending(new Error(`Agent exited with code ${code}`));
    agentProcess = null;
  });
}

export function stopAgent(): void {
  if (agentProcess) {
    agentProcess.kill();
    agentProcess = null;
  }
}

function handleAgentLine(line: string): void {
  try {
    const msg = JSON.parse(line) as RpcMessage;
    if (msg.id && pendingRequests.has(msg.id)) {
      const req = pendingRequests.get(msg.id)!;
      clearTimeout(req.timeout);
      pendingRequests.delete(msg.id);
      if (msg.type === 'response' && msg.success === false) {
        req.reject(new Error(msg.error || 'RPC error'));
      } else {
        req.resolve(msg);
      }
      return;
    }

    console.log('[agent event]', line);
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send('agent:message', line);
      }
    });
  } catch (err) {
    console.error('[agent] invalid JSON line:', line, err);
  }
}

function rejectAllPending(err: Error): void {
  for (const req of pendingRequests.values()) {
    clearTimeout(req.timeout);
    req.reject(err);
  }
  pendingRequests.clear();
}

function rpcRequest(payload: object, timeoutMs = 10000): Promise<RpcMessage> {
  return new Promise((resolve, reject) => {
    if (!agentProcess || agentProcess.killed || !agentProcess.stdin) {
      reject(new Error('Agent not running'));
      return;
    }

    const stdin = agentProcess.stdin;
    const id = randomUUID();
    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error('RPC timeout'));
    }, timeoutMs);

    pendingRequests.set(id, { resolve, reject, timeout });
    stdin.write(`${JSON.stringify({ ...payload, id })}\n`);
  });
}

export async function getAgentStatus(): Promise<AgentStatus> {
  const status: AgentStatus = {
    binaryExists: fs.existsSync(getAgentBinaryPath()),
    processPid: agentProcess?.pid ?? null,
    transport: 'stdio JSON-RPC',
    connected: false,
    lastMessage: agentLastMessage,
  };

  if (!agentProcess) {
    return status;
  }

  try {
    const response = await rpcRequest({ type: 'get_state' }, 3000);
    if (response.type === 'response' && response.success) {
      return { ...status, connected: true, state: response.data };
    }
    return { ...status, connected: false, error: 'Unexpected response' };
  } catch (err) {
    return { ...status, connected: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function buildRpcCommand(command: string, args: unknown[]): object {
  if (command === 'prompt' && typeof args[0] === 'string') {
    return { type: 'prompt', message: args[0] };
  }
  if (command === 'bash' && typeof args[0] === 'string') {
    return { type: 'bash', command: args[0] };
  }
  return { type: command };
}

export function registerAgentIpc(): void {
  ipcMain.handle('agent:invoke', async (_event, command: string, args: unknown[]) => {
    if (!agentProcess) {
      return { ok: false, error: 'Agent not running' };
    }
    try {
      const response = await rpcRequest(buildRpcCommand(command, args), 30000);
      return { ok: true, response };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('agent:get-status', async () => getAgentStatus());
}

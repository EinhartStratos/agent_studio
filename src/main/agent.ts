import { spawn, type ChildProcess } from 'node:child_process';
import { app, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { loadConfig } from './config';
import { broadcastToAllViews } from './utils/broadcast';
import { PiSdkDriver, resolvePiBinaryPath } from './pi-sdk-driver';

export let agentProcess: ChildProcess | null = null;

interface PendingRequest {
  resolve: (value: RpcMessage) => void;
  reject: (err: Error) => void;
  timeout: NodeJS.Timeout;
}

const pendingRequests = new Map<string, PendingRequest>();
let stdoutBuffer = '';
let agentLastMessage = '';
let lastExitCode: number | null = null;

/** 获取 Pi 运行日志文件路径 */
function getAgentLogPath(): string {
  return path.join(app.getPath('userData'), 'agent.log');
}

/** 写一条带时间戳的日志 */
function writeAgentLog(line: string): void {
  try {
    const logPath = getAgentLogPath();
    const time = new Date().toISOString();
    fs.appendFileSync(logPath, `[${time}] ${line}\n`);
  } catch (err) {
    console.error('[agent] failed to write log:', err);
  }
}

/** 把 Windows 退出码翻译成可读原因 */
function getExitReason(code: number | null): string | undefined {
  if (code === null) return undefined;
  const unsigned = code >>> 0;
  switch (unsigned) {
    case 0xc000001d:
      return 'CPU 不支持 Pi 程序需要的指令集（如 AVX2），请使用更新的 CPU，或让 Pi 使用 baseline/x64-baseline 目标重新编译';
    case 0xc0000135:
      return '缺少必要的运行库 DLL';
    case 0xc0000005:
      return '程序访问冲突/崩溃 (Access Violation)';
    case 0xc0000409:
      return '程序发生堆栈缓冲区溢出 (Stack Buffer Overrun)';
    case 0xc0000142:
      return '程序初始化失败 (DLL 初始化失败)';
    default:
      return undefined;
  }
}

interface AgentStatus {
  binaryExists: boolean;
  assetsReady: boolean;
  processPid: number | null;
  transport: string;
  connected: boolean;
  state?: unknown;
  lastMessage: string;
  logFile: string;
  lastExitCode: number | null;
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

function getPackagedAgentDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(app.getAppPath(), 'resources', 'bin');
}

function getUserAgentDir(): string {
  return path.join(app.getPath('userData'), 'agent-bin');
}

function getAgentBinCandidates(): string[] {
  if (process.platform === 'win32') return ['pi-win.exe', 'pi.exe'];
  return [`pi-${process.platform}-${process.arch}`];
}

export function getAgentDir(): string {
  const userDir = getUserAgentDir();
  for (const name of getAgentBinCandidates()) {
    if (fs.existsSync(path.join(userDir, name))) {
      return userDir;
    }
  }
  return getPackagedAgentDir();
}

export function getAgentBinaryPath(): string {
  const dir = getAgentDir();
  for (const name of getAgentBinCandidates()) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  return path.join(dir, getAgentBinCandidates()[0]);
}

function getAgentToolsDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'agent-tools')
    : path.join(app.getAppPath(), 'resources', 'agent-tools');
}

function buildAgentEnv(): NodeJS.ProcessEnv {
  const toolsDir = getAgentToolsDir();
  const sep = process.platform === 'win32' ? ';' : ':';
  const existingPath = process.env.PATH || process.env.Path || '';
  const envPath = `${toolsDir}${sep}${existingPath}`;
  return {
    ...process.env,
    PATH: envPath,
    Path: envPath,
  };
}

export async function startAgent(): Promise<void> {
  const binPath = getAgentBinaryPath();
  const config = loadConfig();

  if (!fs.existsSync(binPath)) {
    const msg = `Agent binary not found at ${binPath}, running in stub mode.`;
    console.warn(msg);
    writeAgentLog(msg);
    return;
  }

  stdoutBuffer = '';
  agentLastMessage = '';
  lastExitCode = null;
  pendingRequests.clear();

  const args = config.pi.args && config.pi.args.length > 0 ? config.pi.args : ['--mode', 'rpc'];
  writeAgentLog(`starting agent: ${binPath} ${args.join(' ')} (cwd: ${app.getPath('userData')})`);

  const proc = spawn(binPath, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: app.getPath('userData'),
    env: buildAgentEnv(),
  });
  agentProcess = proc;
  writeAgentLog(`agent spawned, pid=${proc.pid}`);

  proc.stdout.on('data', (data: Buffer) => {
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

  proc.stderr.on('data', (data: Buffer) => {
    const text = data.toString().trim();
    agentLastMessage = text;
    writeAgentLog(`stderr: ${text}`);
    console.error(`[agent err] ${text}`);
  });

  proc.on('error', (err) => {
    const msg = `process error: ${err.message}`;
    writeAgentLog(msg);
    console.error('[agent] process error:', err);
    rejectAllPending(err);
  });

  proc.on('exit', (code) => {
    lastExitCode = code ?? null;
    const reason = getExitReason(code);
    const msg = reason ? `exited with code ${code}, reason: ${reason}` : `exited with code ${code}`;
    writeAgentLog(msg);
    console.log(`[agent] ${msg}`);
    rejectAllPending(new Error(reason ?? `Agent exited with code ${code}`));
    if (agentProcess === proc) {
      agentProcess = null;
    }
  });
}

export function stopAgent(): void {
  if (agentProcess) {
    agentProcess.kill();
    agentProcess = null;
  }
}

export async function restartAgent(): Promise<void> {
  stopAgent();
  await startAgent();
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
    broadcastToAllViews('agent:message', line);
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
  const piBin = resolvePiBinaryPath();
  const legacyBinPath = getAgentBinaryPath();
  const binaryExists = fs.existsSync(legacyBinPath) || fs.existsSync(piBin) || /[/\\]/.test(piBin);

  const status: AgentStatus = {
    binaryExists,
    assetsReady: fs.existsSync(path.join(path.dirname(piBin), 'theme')) || true,
    processPid: agentProcess?.pid ?? null,
    transport: 'stdio JSON-RPC (legacy)',
    connected: false,
    lastMessage: agentLastMessage,
    logFile: getAgentLogPath(),
    lastExitCode,
  };

  const sdkDriver = PiSdkDriver.getLastCreatedDriver();
  const agentMode = loadConfig().agent?.driverMode ?? 'sdk';

  if (sdkDriver) {
    const health = sdkDriver.getHealth();
    status.transport = agentMode === 'acp' ? 'ACP over pi-acp (in-memory bridge)' : 'SDK @earendil-works/pi-coding-agent';
    status.connected = !!health.ok && !!health.runtimeReady;
    if (health.error) status.error = health.error;
    if (health.currentModel) status.state = { currentModel: health.currentModel };
    if (!agentProcess) return status;
  }

  if (!agentProcess) {
    if (lastExitCode !== null && !status.error) {
      status.error = getExitReason(lastExitCode);
    }
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

  ipcMain.handle('agent:restart', async () => {
    try {
      await restartAgent();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

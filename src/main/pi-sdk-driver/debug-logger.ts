/**
 * Pi / ACP 诊断日志镜像写入器。
 *
 * 问题背景：Terminal（npm run dev）输出有长度限制，pi stdout/stderr 每一行 JSON
 * 都很长，导致关键 errorMessage / response payload 被截断无法定位根因。
 *
 * 本 Logger 把 console.log 的 "[PiSdkDriver] / [AcpDriverBridge] / [pi stdout] /
 * [pi stderr] / [pi-acp session.prompt ERROR] / [syncAgentModelConfig]" 前缀的日志
 * 同时以「带毫秒时间戳 + 分类前缀」的追加写入到：
 *   {app.getPath('userData')}/logs/acp-debug-YYYYMMDD-HHmmss-SSS.log
 * （如果无法获取 app，则 fallback 到 os.tmpdir()/agent-studio-acp-debug-*.log）
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

type UserDataResolver = () => string | undefined;

let _resolver: UserDataResolver | null = null;
let _logPath: string | null = null;
let _stream: fs.WriteStream | null = null;
let _createdPid = -1;

const PREFIXES_TO_CAPTURE_RE = /^\[(PiSdkDriver|AcpDriverBridge|syncAgentModelConfig|pi stdout|pi stderr|pi-acp session\.prompt ERROR|DEBUG-ACP)\]/;

export function setUserDataResolver(resolver: UserDataResolver): void {
  _resolver = resolver;
}

function pad2(n: number): string { return n < 10 ? '0' + n : String(n); }
function pad3(n: number): string { return n < 10 ? '00' + n : n < 100 ? '0' + n : String(n); }

function stamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${pad3(d.getMilliseconds())}`;
}

function baseLogName(): string {
  const d = new Date();
  return `acp-debug-${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}-${pad3(d.getMilliseconds())}.log`;
}

function lazyOpen(): fs.WriteStream | null {
  if (_stream && _createdPid === process.pid) return _stream;
  try {
    let userDir: string | undefined;
    try { userDir = _resolver ? _resolver() : undefined; } catch {}
    let rootDir: string;
    if (userDir) {
      rootDir = path.join(userDir, 'logs');
    } else {
      rootDir = path.join(os.tmpdir(), 'agent-studio-logs');
    }
    fs.mkdirSync(rootDir, { recursive: true });
    const logPath = path.join(rootDir, baseLogName());
    const stream = fs.createWriteStream(logPath, { flags: 'a', encoding: 'utf8' });
    stream.once('error', () => { _stream = null; });
    _stream = stream;
    _logPath = logPath;
    _createdPid = process.pid;
    return stream;
  } catch {
    return null;
  }
}

export function getDebugLogPath(): string | null {
  lazyOpen();
  return _logPath;
}

/**
 * 同时向 Terminal 写日志（保持 console.log）并镜像写入诊断文件。
 * 只有匹配前缀的日志才会写文件，避免把应用其它不相关控制台输出打进来。
 */
export function diagLog(tag: string, message: string, ...rest: unknown[]): void {
  const tagStr = tag.startsWith('[') ? tag : `[${tag}]`;
  const shouldCapture = PREFIXES_TO_CAPTURE_RE.test(tagStr);
  // Always write to stdout so dev can see inline.
  if (rest.length === 0) {
    console.log(`${tagStr} ${message}`);
  } else {
    console.log(`${tagStr} ${message}`, ...rest);
  }
  if (!shouldCapture) return;
  const stream = lazyOpen();
  if (!stream) return;
  try {
    let line = `${stamp()} ${process.pid} ${tagStr} ${message}`;
    if (rest.length > 0) {
      const tail = rest.map(v => {
        try {
          if (typeof v === 'string') return v;
          return JSON.stringify(v);
        } catch {
          return String(v);
        }
      }).join(' ');
      line += ' ' + tail;
    }
    // Limit each line to 512KB so single giant NDJSON doesn't OOM the log tail reader.
    if (line.length > 512 * 1024) line = line.slice(0, 512 * 1024) + ` ... <truncated, original_len=${line.length}>`;
    stream.write(line + '\n');
  } catch {
    // Never throw because of logging.
  }
}

/** Convenience short-hands. Used by pi-acp patches where we don't want long strings. */
export const logPiStdout = (pid: number | string, line: string) => diagLog('pi stdout', `pid=${pid} ${line}`);
export const logPiStderr = (pid: number | string, line: string) => diagLog('pi stderr', `pid=${pid} ${line}`);
export const logPiProcess = (pid: number | string, detail: string) => diagLog('pi stderr', `pid=${pid} ${detail}`);

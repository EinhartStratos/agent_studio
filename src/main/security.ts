import { ipcMain } from 'electron';
import { spawn } from 'node:child_process';

const ALLOWED_COMMANDS = new Set([
  'git',
  'python3',
  'python',
  'node',
  'pi',
]);

interface CommandResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

ipcMain.handle('shell:execute', async (_event, command: string, args: string[]): Promise<CommandResult> => {
  if (!ALLOWED_COMMANDS.has(command)) {
    throw new Error(`Command not allowed: ${command}`);
  }

  console.log(`[AUDIT] ${command} ${args.join(' ')}`);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('error', reject);

    child.on('close', (code) => {
      resolve({ stdout, stderr, code });
    });
  });
});

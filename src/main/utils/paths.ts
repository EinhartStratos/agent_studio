import { app } from 'electron';
import path from 'node:path';

export function getUserDataPath(...segments: string[]): string {
  return path.join(app.getPath('userData'), ...segments);
}

export function getDefaultContentPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'default-content', 'index.html')
    : path.join(app.getAppPath(), 'resources/default-content/index.html');
}

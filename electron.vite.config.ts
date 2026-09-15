import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const piAcpDir = path.resolve(__dirname, 'third_party/pi-acp/src').replace(/\\/g, '/');

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: [
        { find: /^pi-acp\//, replacement: `${piAcpDir}/` },
      ],
    },
    build: {
      lib: {
        entry: path.resolve('src/main/index.ts'),
        fileName: () => 'index.mjs',
        formats: ['es'],
      },
      outDir: 'out/main',
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: path.resolve('src/preload/index.ts'),
        fileName: () => 'index.cjs',
        formats: ['cjs'],
      },
      outDir: 'out/preload',
    },
  },
  renderer: {
    root: path.resolve('src/renderer'),
    plugins: [react()],
    build: {
      outDir: path.resolve('out/renderer'),
      rollupOptions: {
        input: path.resolve('src/renderer/index.html'),
      },
    },
  },
});

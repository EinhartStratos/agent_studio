import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
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

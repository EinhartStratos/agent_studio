import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import path from 'node:path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: path.resolve('src/main/index.ts'),
        fileName: () => 'index.js',
        formats: ['es'],
      },
      outDir: 'out/main',
      rollupOptions: {
        output: {
          dir: 'out/main',
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: path.resolve('src/preload/index.ts'),
        fileName: () => 'index.js',
        formats: ['es'],
      },
      outDir: 'out/preload',
      rollupOptions: {
        output: {
          dir: 'out/preload',
        },
      },
    },
  },
  renderer: {
    root: path.resolve('src/renderer'),
    build: {
      outDir: path.resolve('out/renderer'),
      rollupOptions: {
        input: path.resolve('src/renderer/index.html'),
      },
    },
  },
});

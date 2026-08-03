import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        'pi-acp': path.resolve(__dirname, 'third_party/pi-acp/src/lib.ts'),
        'pi-acp/': path.resolve(__dirname, 'third_party/pi-acp/src/'),
      },
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
    plugins: [vue()],
    build: {
      outDir: path.resolve('out/renderer'),
      rollupOptions: {
        input: path.resolve('src/renderer/index.html'),
      },
    },
  },
});

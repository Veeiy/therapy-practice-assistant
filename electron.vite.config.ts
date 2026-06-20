import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

// electron-vite gives a clean main / preload / renderer split with one config.
// The path aliases mirror tsconfig.json so @main @shared etc. resolve in all
// three build targets.
const alias = {
  '@main': resolve('src/main'),
  '@renderer': resolve('src/renderer'),
  '@shared': resolve('src/shared'),
  '@modules': resolve('src/modules'),
};

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      outDir: 'dist/main',
      rollupOptions: {
        // Native modules and the SDK must stay external (not bundled) so the
        // asar-unpack rule can place the real binaries on disk.
        external: [
          'better-sqlite3-multiple-ciphers',
          '@anthropic-ai/claude-agent-sdk',
          'electron',
        ],
        input: { index: resolve('src/main/index.ts') },
      },
    },
  },
  preload: {
    resolve: { alias },
    build: {
      outDir: 'dist/preload',
      rollupOptions: { input: { index: resolve('src/preload/index.ts') } },
    },
  },
  renderer: {
    resolve: { alias },
    plugins: [react()],
    build: {
      outDir: 'dist/renderer',
      rollupOptions: { input: { index: resolve('src/renderer/index.html') } },
    },
  },
});

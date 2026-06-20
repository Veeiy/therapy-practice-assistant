import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// The testable core (data layer, services, EgressGuard, providers) is deliberately
// decoupled from Electron so it runs under plain Node + vitest with no GUI. The
// Electron-only pieces (safeStorage, BrowserWindow) are behind interfaces and are
// not imported by tests.
export default defineConfig({
  resolve: {
    alias: {
      '@main': resolve('src/main'),
      '@renderer': resolve('src/renderer'),
      '@shared': resolve('src/shared'),
      '@modules': resolve('src/modules'),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Each test file opens its own temp DB; keep them in separate processes so a
    // native better-sqlite3 handle from one file never leaks into another.
    pool: 'forks',
    testTimeout: 20000,
  },
});

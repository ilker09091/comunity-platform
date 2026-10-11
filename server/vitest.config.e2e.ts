import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Integration tests run against the dedicated `<DB_NAME>_test` database (see test/setup).
    setupFiles: ['./test/setup/test-env.ts'],
    globalSetup: ['./test/setup/global-setup.ts'],
    // Test files share one database and truncate it, so they must not run concurrently.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});

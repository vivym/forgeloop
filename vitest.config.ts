import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const explicitE2eSelected = process.argv.some((argument) => /(?:^|[\\/])tests[\\/]e2e(?:$|[\\/])/.test(argument));

export default defineConfig({
  resolve: {
    alias: {
      '@forgeloop/codex-runtime': resolve(rootDir, 'packages/codex-runtime/src/index.ts'),
      '@forgeloop/codex-worker-runtime': resolve(rootDir, 'packages/codex-worker-runtime/src/index.ts'),
      '@forgeloop/contracts': resolve(rootDir, 'packages/contracts/src/index.ts'),
      '@forgeloop/domain': resolve(rootDir, 'packages/domain/src/index.ts'),
      '@forgeloop/executor': resolve(rootDir, 'packages/executor/src/index.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: explicitE2eSelected ? [] : ['tests/e2e/**'],
    environment: 'node',
    setupFiles: ['tests/setup/supertest-local-socket.ts'],
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});

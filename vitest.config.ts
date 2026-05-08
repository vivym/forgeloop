import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const runConsoleE2eSelected = process.argv.some((argument) => argument.includes('tests/e2e/run-console.e2e.test.ts'));

export default defineConfig({
  resolve: {
    alias: {
      '@forgeloop/contracts': resolve(rootDir, 'packages/contracts/src/index.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: runConsoleE2eSelected ? [] : ['tests/e2e/**'],
    environment: 'node',
  },
});

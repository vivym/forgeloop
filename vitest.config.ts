import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const explicitE2eSelected = process.argv.some((argument) => /(?:^|[\\/])tests[\\/]e2e(?:$|[\\/])/.test(argument));

export default defineConfig({
  resolve: {
    alias: {
      '@forgeloop/contracts': resolve(rootDir, 'packages/contracts/src/index.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: explicitE2eSelected ? [] : ['tests/e2e/**'],
    environment: 'node',
  },
});

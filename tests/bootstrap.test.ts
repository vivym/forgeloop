import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const rootUrl = new URL('..', import.meta.url);

const readText = (path: string) => readFileSync(new URL(path, rootUrl), 'utf8');
const readJson = (path: string) => JSON.parse(readText(path));

describe('workspace bootstrap contract', () => {
  it('exposes the expected root scripts and workspace globs', () => {
    const rootPackage = readJson('package.json');

    expect(rootPackage.scripts).toMatchObject({
      build: 'pnpm -r build',
      test: 'vitest run --pool=forks --no-file-parallelism --maxWorkers=1',
      'test:watch': 'vitest',
      'dev:api': 'pnpm --filter @forgeloop/control-plane-api start:dev',
      'dev:automation-daemon': 'pnpm --filter @forgeloop/automation-daemon start',
      'dev:executor': 'pnpm --filter @forgeloop/executor-gateway start:dev',
      'dev:worker': 'pnpm --filter @forgeloop/workflow-worker start:dev',
      'dev:web': 'pnpm --filter @forgeloop/web dev',
      'smoke:delivery': 'vitest run tests/smoke',
    });

    expect(readText('pnpm-workspace.yaml')).toBe("packages:\n  - 'apps/*'\n  - 'packages/*'\n");
  });

  it('keeps the expected apps and packages registered as private modules', () => {
    const manifests = {
      'apps/automation-daemon/package.json': '@forgeloop/automation-daemon',
      'apps/control-plane-api/package.json': '@forgeloop/control-plane-api',
      'apps/executor-gateway/package.json': '@forgeloop/executor-gateway',
      'apps/web/package.json': '@forgeloop/web',
      'apps/workflow-worker/package.json': '@forgeloop/workflow-worker',
      'packages/automation/package.json': '@forgeloop/automation',
      'packages/contracts/package.json': '@forgeloop/contracts',
      'packages/db/package.json': '@forgeloop/db',
      'packages/domain/package.json': '@forgeloop/domain',
      'packages/executor/package.json': '@forgeloop/executor',
      'packages/run-worker/package.json': '@forgeloop/run-worker',
      'packages/workflow/package.json': '@forgeloop/workflow',
    };

    for (const [path, name] of Object.entries(manifests)) {
      const manifest = readJson(path);

      expect(manifest).toMatchObject({ name, private: true, type: 'module' });
      expect(manifest.scripts).toHaveProperty('build');
    }
  });

  it('maps package import aliases to source entrypoints', () => {
    const baseTsconfig = readJson('tsconfig.base.json');

    expect(baseTsconfig.compilerOptions.paths).toEqual({
      '@forgeloop/automation': ['packages/automation/src/index.ts'],
      '@forgeloop/contracts': ['packages/contracts/src/index.ts'],
      '@forgeloop/domain': ['packages/domain/src/index.ts'],
      '@forgeloop/db': ['packages/db/src/index.ts'],
      '@forgeloop/executor': ['packages/executor/src/index.ts'],
      '@forgeloop/run-worker': ['packages/run-worker/src/index.ts'],
      '@forgeloop/workflow': ['packages/workflow/src/index.ts'],
    });
  });

  it('keeps workflow definitions isolated from runtime implementation packages', () => {
    const workflowPackage = readJson('packages/workflow/package.json');
    const workflowTsconfig = readJson('packages/workflow/tsconfig.json');

    expect(workflowTsconfig.extends).toBe('../../tsconfig.lib.json');
    expect(Object.keys(workflowPackage.dependencies).sort()).toEqual([
      '@forgeloop/contracts',
      '@temporalio/workflow',
    ]);
    expect(workflowPackage.dependencies).not.toHaveProperty('@forgeloop/db');
    expect(workflowPackage.dependencies).not.toHaveProperty('@forgeloop/executor');
  });
});

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const textFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (path.includes('.react-router') || path.includes('/dist/') || path.includes('/node_modules/')) return [];
    if (statSync(path).isDirectory()) return textFiles(path);
    return /\.(ts|tsx|css|html|md)$/.test(path) ? [path] : [];
  });

const legacyWebScanFiles = () =>
  ['apps/web', 'tests/web', 'tests/e2e']
    .flatMap(textFiles)
    .filter((file) => !file.endsWith('no-legacy-web-ui.test.ts'));

const sourceText = () =>
  legacyWebScanFiles()
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');

const productSourceText = () =>
  textFiles('apps/web')
    .filter((file) => !file.includes('/features/dev-tools/') && !file.includes('/routes/dev-tools/'))
    .concat(
      textFiles('tests/web').filter(
        (file) => !file.endsWith('no-legacy-web-ui.test.ts') && !file.endsWith('dev-tools-gating.test.tsx'),
      ),
    )
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');

type LegacyPattern = {
  target: string;
  pattern: RegExp;
};

const deletionTargetPatterns: LegacyPattern[] = [
  { target: 'work-item-owner', pattern: /work-item-owner/ },
  { target: 'RoleWorkbench*', pattern: /\bRoleWorkbench\w*\b/ },
  { target: 'roleWorkbench*', pattern: /\broleWorkbench\w*\b/ },
  { target: 'RoleQueue*', pattern: /\bRoleQueue\w*\b/ },
  { target: 'role-workbench', pattern: /role-workbench/ },
  { target: 'getRoleWorkbench', pattern: /\bgetRoleWorkbench\b/ },
  { target: 'useWorkbenchQuery', pattern: /\buseWorkbenchQuery\b/ },
  { target: 'workbenchIdForProductRole', pattern: /\bworkbenchIdForProductRole\b/ },
  { target: 'productRoleToWorkbenchId', pattern: /\bproductRoleToWorkbenchId\b/ },
  { target: 'workItemOwnerRole', pattern: /\bworkItemOwnerRole\b/ },
  { target: 'workItemOwnerWorkbenchId', pattern: /\bworkItemOwnerWorkbenchId\b/ },
  { target: 'manager-health', pattern: /manager-health/ },
  { target: '[?&]role=', pattern: /[?&]role=/ },
  { target: '/workbench/work-item-owner', pattern: /\/workbench\/work-item-owner/ },
  { target: '/query/workbenches/', pattern: /\/query\/workbenches\// },
  { target: 'Available after role queues are ready', pattern: /Available after role queues are ready/ },
  { target: 'Available after a draft exists', pattern: /Available after a draft exists/ },
  { target: 'Update brief', pattern: /Update brief/ },
  { target: 'Attach evidence', pattern: /Attach evidence/ },
];

const intakeDeletionTargetPatterns: LegacyPattern[] = [
  { target: 'old intake workbench endpoint', pattern: /\/query\/workbenches\/intake\b/ },
  { target: 'old intake workbench route or query state', pattern: /\/workbench\/intake\b|[?&](?:role|lane|workbench)=intake\b/ },
  {
    target: 'old intake workbench identifier',
    pattern:
      /\b(?:workbenchId|workbench_id|roleWorkbenchId|role_workbench_id|productLaneId|product_lane_id|laneId|lane_id)\s*[:=]\s*['"]intake['"]/,
  },
];

const legacyDeletionMatches = () =>
  legacyWebScanFiles().flatMap((file) => {
    const content = readFileSync(file, 'utf8');
    return content.split('\n').flatMap((line, index) =>
      deletionTargetPatterns.concat(intakeDeletionTargetPatterns).flatMap(({ target, pattern }) =>
        pattern.test(line) ? [`${file}:${index + 1} ${target}: ${line.trim()}`] : [],
      ),
    );
  });

const workItemWebScanFiles = () =>
  [
    'apps/web/src/features/work-items',
    'apps/web/src/app/routes/work-items',
    'apps/web/src/app/routes/lanes',
    'apps/web/src/features/product-lanes',
    'tests/web/work-item-intake-form.test.tsx',
    'tests/web/work-item-product-route.test.tsx',
    'tests/web/product-lanes-route.test.tsx',
    'tests/web/api-hooks.test.tsx',
  ].flatMap((path) => (statSync(path).isDirectory() ? textFiles(path) : [path]));

const allowedWorkItemOwnerWebContext = (context: string): boolean =>
  /rejects owner_actor_id|owner_actor_id is not supported|does not expose owner_actor_id|not\.toHaveProperty\('owner_actor_id'\)|not\.toContain\('owner_actor_id'\)|queryByLabelText\('owner_actor_id'\)|strips stale kind and owner filters|omits owner filters|without translating execution owner filters|Execution Owner|executionPackage\.owner_actor_id|owner: executionPackage\.owner_actor_id|workItemTypeLaneIds\.has\(laneId\)|key === 'kind' \|\| key === 'owner_actor_id'|supportedProductLaneSearchParams[\s\S]*qa_owner_actor_id[\s\S]*release_owner_actor_id/.test(
    context,
  );

const workItemWebOwnerMatches = () =>
  workItemWebScanFiles().flatMap((file) => {
    if (file.endsWith('no-legacy-web-ui.test.ts')) return [];
    const lines = readFileSync(file, 'utf8').split('\n');
    return lines.flatMap((line, index) => {
      if (!/Work Item Owner|work item owner|work-item-owner|workItemOwner|work_item_owner|\bowner_actor_id\b/i.test(line)) return [];
      const context = lines.slice(Math.max(0, index - 8), index + 9).join('\n');
      return allowedWorkItemOwnerWebContext(context) ? [] : [`${file}:${index + 1} ${line.trim()}`];
    });
  });

describe('no legacy Web UI baggage', () => {
  it('does not keep old workbench classes or legacy routes', () => {
    expect(sourceText()).not.toMatch(/workbench-grid|className="panel"|\.panel\b|\/legacy|src\/main\.tsx|Load role queue|Load cockpit|Load replay/);
  });

  it('does not import the old monolithic App', () => {
    expect(sourceText()).not.toMatch(/from ['"].*src\/App['"]|<App\b/);
  });

  it('does not keep old API or state shims', () => {
    expect(sourceText()).not.toMatch(/src\/api|src\/workbenchState|from ['"].*\/api['"]/);
  });

  it('does not keep deleted role workbench product vocabulary', () => {
    expect(legacyDeletionMatches()).toEqual([]);
  });

  it('does not keep Work Item Owner copy or fields on Work Item Web surfaces', () => {
    expect(workItemWebOwnerMatches()).toEqual([]);
  });

  it('scans all Work Item product lane Web surfaces for Work Item Owner baggage', () => {
    expect(workItemWebScanFiles()).toContain('apps/web/src/features/work-items/delivery-cockpit/typed-brief.tsx');
    expect(workItemWebScanFiles()).toContain('apps/web/src/features/product-lanes/product-lanes.ts');
  });

  it('does not expose raw or debug-only controls on product Web surfaces', () => {
    expect(productSourceText()).not.toMatch(
      /raw JSON|raw replay|raw payload|Replay payload|Load raw replay|Object ID|manual ID|manual .*loader|direct id loading|debug-only/i,
    );
  });

  it('removes old Web entry, API, state, and stylesheet files', () => {
    for (const path of [
      'apps/web/src/App.tsx',
      'apps/web/src/api.ts',
      'apps/web/src/api',
      'apps/web/src/styles.css',
      'apps/web/src/workbenchState.ts',
    ]) {
      expect(existsSync(path), path).toBe(false);
    }
  });
});

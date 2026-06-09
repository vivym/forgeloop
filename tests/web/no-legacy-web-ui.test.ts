import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { legacyClassTokenMatches } from './helpers/no-legacy-class-scan';

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
        (file) =>
          !file.endsWith('no-legacy-web-ui.test.ts') &&
          !file.endsWith('dev-tools-gating.test.tsx') &&
          !file.endsWith('product-grade-first-viewport.test.tsx') &&
          !file.endsWith('project-management-routes.test.tsx'),
      ),
    )
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');

const activeWebSourceText = () =>
  textFiles('apps/web')
    .filter((file) => !file.includes('/features/dev-tools/') && !file.includes('/routes/dev-tools/'))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');

const activeTypedDocumentText = () =>
  [
    'apps/web/src/features/project-management',
    'apps/web/src/features/requirements',
    'apps/web/src/features/initiatives',
    'apps/web/src/features/bugs',
    'apps/web/src/features/tech-debt',
  ]
    .flatMap(textFiles)
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');

const activeDevelopmentPlanText = () =>
  textFiles('apps/web/src/features/development-plans')
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
    'apps/web/src/app/routes',
    'apps/web/src/features/work-items',
    'apps/web/src/features/product-lanes',
    'tests/web/work-item-intake-form.test.tsx',
    'tests/web/work-item-product-route.test.tsx',
    'tests/web/product-lanes-route.test.tsx',
    'tests/web/api-hooks.test.tsx',
  ].flatMap((path) => {
    if (!existsSync(path)) return [];
    return statSync(path).isDirectory() ? textFiles(path) : [path];
  });

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

  it('scans active project-management Web surfaces for Work Item Owner baggage', () => {
    expect(workItemWebScanFiles()).toContain('apps/web/src/app/routes/_layout.tsx');
    expect(workItemWebScanFiles()).toContain('apps/web/src/app/routes/requirements/index.tsx');
    expect(workItemWebScanFiles()).not.toContain('apps/web/src/app/routes/work-items/index.tsx');
    expect(workItemWebScanFiles()).not.toContain('apps/web/src/app/routes/lanes/index.tsx');
  });

  it('does not keep old product route modules', () => {
    for (const path of [
      'apps/web/src/app/routes/lanes',
      'apps/web/src/app/routes/pipeline',
      'apps/web/src/app/routes/work-items',
      'apps/web/src/app/routes/packages',
      'apps/web/src/app/routes/runs',
      'apps/web/src/features/product-lanes',
      'apps/web/src/features/pipeline',
      'apps/web/src/features/execution-packages/execution-package-routes.tsx',
      'apps/web/src/features/run-console/run-console-routes.tsx',
      'apps/web/src/features/review-packets/review-packet-routes.tsx',
    ]) {
      expect(existsSync(path), path).toBe(false);
    }
  });

  it('does not keep removed top-level product route hrefs or labels on active Web surfaces', () => {
    expect(productSourceText()).not.toMatch(
      /(?:to=|href=|href:|target:\s*{[\s\S]{0,120}href:)\s*['"`]\/(?:lanes|pipeline|work-items|packages|runs)(?:\/|\?|['"`])/,
    );
    expect(activeWebSourceText()).not.toMatch(
      /(?:to=|href=|href:|basePath=)\s*['"`]\/(?:specs|plans)(?:\?|['"`])/,
    );
    expect(productSourceText()).not.toMatch(/>Lanes<|>Pipeline<|>Work Items<|>Packages<|>Runs</);
  });

  it('does not expose raw or debug-only controls on product Web surfaces', () => {
    expect(activeWebSourceText()).not.toMatch(
      /raw JSON|raw replay|raw payload|Replay payload|Load raw replay|Object ID|manual ID|manual .*loader|direct id loading|debug-only/i,
    );
  });

  it('does not expose Wave 7 runtime control or raw runtime fields in the Plan Item workflow workspace', () => {
    const source = readFileSync('apps/web/src/features/development-plans/plan-item-workflow-workspace.tsx', 'utf8');

    expect(source).toContain('commandMutations.continueExecution');
    expect(source).toContain('commandMutations.respondToReview');
    expect(source).toContain('commandMutations.requestFix');
    expect(source).toContain('commandMutations.abandonNewSession');
    expect(source).not.toMatch(/plan-item-workflows\/[^"'`\s]+\/run-sessions\/[^"'`\s]+\/(?:input|cancel|resume|retry|rerun)/);
    expect(source).not.toMatch(/plan-item-workflows\/[^"'`\s]+\/(?:fork|select-fork|select-active-fork)/);
    expect(source).not.toMatch(/\b(?:automation_action_run|action_run_id)\b/);
    expect(source).not.toMatch(
      /\bcodex_thread_id\b(?!_digest)|\b(?:active_)?codex_session_id\b|\bcodex_session_turn_id\b|\b(?:lease_token|worker_id|credential_binding_id|runtime_profile_id)\b|artifact:\/\/|\/Users\//,
    );
  });

  it('removes old Web entry, API, state, and stylesheet files', () => {
    for (const path of [
      'apps/web/src/App.tsx',
      'apps/web/src/api.ts',
      'apps/web/src/api',
      'apps/web/src/styles.css',
      'apps/web/src/workbenchState.ts',
      'apps/web/src/shared/design-system/theme/css-variables.css',
    ]) {
      expect(existsSync(path), path).toBe(false);
    }
  });

  it('removes retired generic product workspace layout primitives', () => {
    for (const path of [
      'apps/web/src/shared/layout/action-strip/action-strip.tsx',
      'apps/web/src/shared/layout/priority-summary/priority-summary.tsx',
      'apps/web/src/shared/layout/object-workspace/object-workspace.tsx',
      'apps/web/src/shared/layout/queue-workspace/queue-workspace.tsx',
      'apps/web/src/shared/layout/planning-table-workspace/planning-table-workspace.tsx',
      'apps/web/src/shared/layout/gate-workspace/gate-workspace.tsx',
      'apps/web/src/shared/layout/workspace-page/workspace-page.tsx',
    ]) {
      expect(existsSync(path), path).toBe(false);
    }
  });

  it('does not use old global visual class tokens on active Web surfaces', () => {
    expect(legacyClassTokenMatches()).toEqual([]);
  });

  it('does not keep generic typed document workspace copy in active typed document routes', () => {
    expect(activeTypedDocumentText()).not.toMatch(/source document database/i);
    expect(activeTypedDocumentText()).not.toMatch(/create source document/i);
    expect(activeTypedDocumentText()).not.toMatch(/plan source document/i);
    expect(activeTypedDocumentText()).not.toMatch(/source document context/i);
    expect(activeTypedDocumentText()).not.toMatch(/planning input context/i);
    expect(activeTypedDocumentText()).not.toMatch(/planning input intent/i);
    expect(activeTypedDocumentText()).not.toMatch(/planning input narrative document/i);
    expect(activeTypedDocumentText()).not.toMatch(/ready to author document/i);
    expect(activeTypedDocumentText()).not.toMatch(/work item owner/i);
    expect(activeTypedDocumentText()).not.toMatch(/\bdriver owns\b/i);
    expect(activeTypedDocumentText()).not.toMatch(/responsibility:\s*actor-owner/i);
    expect(activeTypedDocumentText()).not.toMatch(/requirement summary unavailable/i);
    expect(activeTypedDocumentText()).not.toMatch(/planning state unknown/i);
    expect(activeTypedDocumentText()).not.toMatch(/evidence unavailable/i);
  });

  it('does not keep generic Development Plan workspace copy or normal state banners', () => {
    expect(activeDevelopmentPlanText()).not.toMatch(/source document context/i);
    expect(activeDevelopmentPlanText()).not.toMatch(/\b(?:add|save|preview|generate missing|regenerate missing|new) rows?\b/i);
    expect(activeDevelopmentPlanText()).not.toMatch(/normal loaded|normal approved|approved state|Development Plan Page/i);
  });

  it('does not keep legacy Plan Item gate route chrome or raw runtime navigation labels', () => {
    const source = activeDevelopmentPlanText();

    expect(source).not.toMatch(/Development Plan Item Detail/i);
    expect(source.match(/Gate progress/g) ?? []).toHaveLength(1);
    expect(source).not.toMatch(/source document context/i);
    expect(source).not.toMatch(/>\s*(?:Package|Run|Trace)\s*</);
    expect(source).not.toMatch(/Open (?:Package|Run|Trace)\b|(?:Package|Run|Trace) unavailable\b/);
  });
});

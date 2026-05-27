import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const roots = ['apps', 'packages', 'scripts', 'tests', 'docs', 'package.json'];
const oldPriority = 'P' + '0';
const oldRoute = 'p' + '0';
const currentRoleWorkbenchPlan = 'docs/superpowers/plans/2026-05-19-role-based-workbench-product-actions.md';
const supersededHistoricalNote =
  '> Superseded historical migration note: this document mentions the old subsystem name for audit history only. Current commands, routes, files, and product docs use delivery terminology.';
const historicalFiles = new Set([
  'docs/architecture-design/v0/archi-design.md',
  'docs/architecture-design/v0/drizzle.md',
  'docs/architecture-design/v0/entity-design.md',
  'docs/architecture-design/v0/query.md',
  'docs/architecture-design/v0/task-list.md',
  'docs/superpowers/decisions/2026-05-08-p1-trace-evidence-plane.md',
  `docs/superpowers/plans/2026-05-04-${oldRoute}-delivery-loop-mvp.md`,
  'docs/superpowers/plans/2026-05-07-codex-long-running-execution.md',
  'docs/superpowers/plans/2026-05-08-codex-execution-verification-closure.md',
  `docs/superpowers/plans/2026-05-08-${oldRoute}-dogfood-readiness.md`,
  `docs/superpowers/plans/2026-05-08-${oldRoute}-strict-and-trace-evidence-design.md`,
  'docs/superpowers/plans/2026-05-09-codex-unified-run-event-stream.md',
  `docs/superpowers/plans/2026-05-09-${oldRoute}-durable-revision-lookup.md`,
  `docs/superpowers/plans/2026-05-09-${oldRoute}-p1-closure.md`,
  `docs/superpowers/plans/2026-05-09-${oldRoute}-query-surface-cleanup.md`,
  'docs/superpowers/plans/2026-05-09-p1-core-schema-release-flow.md',
  'docs/superpowers/plans/2026-05-10-public-evidence-serialization.md',
  'docs/superpowers/plans/2026-05-11-p1-release-durable-strict-dogfood-closure.md',
  'docs/superpowers/plans/2026-05-11-p1-release-risk-radar-product-surface.md',
  'docs/superpowers/plans/2026-05-13-prd-first-automation-daemon.md',
  'docs/superpowers/plans/2026-05-15-http-automation-daemon-mvp.md',
  'docs/superpowers/reports/codex-unified-run-event-stream-closure-report.md',
  `docs/superpowers/specs/2026-05-04-${oldRoute}-delivery-loop-mvp-design.md`,
  'docs/superpowers/specs/2026-05-06-codex-long-running-execution-design.md',
  'docs/superpowers/specs/2026-05-08-codex-execution-verification-closure-design.md',
  `docs/superpowers/specs/2026-05-08-${oldRoute}-strict-and-trace-evidence-design.md`,
  `docs/superpowers/specs/2026-05-09-${oldRoute}-durable-revision-lookup-design.md`,
  `docs/superpowers/specs/2026-05-09-${oldRoute}-p1-closure-design.md`,
  `docs/superpowers/specs/2026-05-09-${oldRoute}-query-surface-cleanup-design.md`,
  'docs/superpowers/specs/2026-05-09-p1-core-schema-release-flow-design.md',
  'docs/superpowers/specs/2026-05-10-public-evidence-serialization-design.md',
  'docs/superpowers/specs/2026-05-11-p1-release-durable-strict-dogfood-closure-design.md',
  'docs/superpowers/specs/2026-05-11-p1-release-risk-radar-product-surface-design.md',
  'docs/superpowers/specs/2026-05-13-prd-first-automation-daemon-design.md',
  'docs/superpowers/specs/2026-05-16-delivery-boundary-and-role-workbench-design.md',
  'docs/superpowers/plans/2026-05-16-delivery-boundary-and-role-workbench.md',
]);
const externallyOwnedFiles = new Set(['docs/superpowers/specs/2026-05-16-executor-runtime-safety-foundation-design.md']);
const priorityLiteral = new RegExp(
  [
    String.raw`\b(?:priority|default_priority|defaultPriority):\s*['"]${oldPriority}['"]`,
    String.raw`Priority:\*\*\s*${oldPriority}`,
    String.raw`\.priority\)\.toBe\(['"]${oldPriority}['"]\)`,
  ].join('|'),
  'g',
);
const oldSubsystem = new RegExp(
  [oldPriority, oldRoute, `${oldRoute}-`, `${oldRoute}_`, `${oldRoute}\\.`, `${oldRoute}/`, `/${oldRoute}`, `forgeloop:${oldRoute}`, `forgeloop://${oldRoute}`].join('|'),
  'g',
);

const files = (path: string): string[] => {
  const stat = statSync(path);
  if (stat.isFile()) return [path];
  return readdirSync(path).flatMap((entry) => {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') return [];
    return files(join(path, entry));
  });
};

const oldRouteAssertionFiles = new Set(['tests/api/automation-commands.test.ts', 'tests/api/delivery-route-contract.test.ts']);
const withoutAllowedOldRouteAssertions = (rel: string, content: string): string => {
  if (!oldRouteAssertionFiles.has(rel)) return content;
  return content.replaceAll(
    /await request\([^;]+;/gs,
    (statement) => (statement.includes(`/${oldRoute}/`) && statement.includes('.expect(404)') ? '' : statement),
  );
};

const withoutExplicitDeletionChecklist = (content: string): string => {
  const heading = '## Explicit Deletion Checklist';
  const start = content.indexOf(heading);
  if (start === -1) return content;
  const afterHeading = start + heading.length;
  const nextHeadingOffset = content.slice(afterHeading).search(/\n## /);
  const end = nextHeadingOffset === -1 ? content.length : afterHeading + nextHeadingOffset;
  const removedLineCount = content.slice(start, end).split('\n').length - 1;
  return `${content.slice(0, start)}${'\n'.repeat(removedLineCount)}${content.slice(end)}`;
};

const contentForNamingScan = (rel: string, content: string): string => {
  const withoutRouteAssertions = withoutAllowedOldRouteAssertions(rel, content);
  return rel === currentRoleWorkbenchPlan ? withoutExplicitDeletionChecklist(withoutRouteAssertions) : withoutRouteAssertions;
};

type LegacyPattern = {
  target: string;
  pattern: RegExp;
};

const roleWorkbenchDeletionTargetPatterns: LegacyPattern[] = [
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

const roleWorkbenchScanRoots = ['apps', 'packages', 'scripts', 'tests', currentRoleWorkbenchPlan];
const roleWorkbenchGuardFiles = new Set(['tests/naming/delivery-naming.test.ts', 'tests/web/no-legacy-web-ui.test.ts']);
const workItemDriverScanRoots = ['apps', 'packages', 'tests', 'docs/PRD_v1.md'];
const workItemDriverGuardFiles = new Set(['tests/naming/delivery-naming.test.ts', 'tests/web/no-legacy-web-ui.test.ts']);

const roleWorkbenchDeletionMatches = () =>
  roleWorkbenchScanRoots.flatMap(files).flatMap((file) => {
    const rel = relative(process.cwd(), file);
    if (roleWorkbenchGuardFiles.has(rel)) return [];
    const content = contentForNamingScan(rel, readFileSync(file, 'utf8'));
    return content.split('\n').flatMap((line, index) =>
      roleWorkbenchDeletionTargetPatterns.concat(intakeDeletionTargetPatterns).flatMap(({ target, pattern }) =>
        pattern.test(line) ? [`${rel}:${index + 1} ${target}: ${line.trim()}`] : [],
      ),
    );
  });

const workItemDriverForbiddenPatterns: LegacyPattern[] = [
  { target: 'Work Item Owner', pattern: /Work Item Owner/ },
  { target: 'work item owner', pattern: /work item owner/i },
  { target: 'work-item-owner', pattern: /work-item-owner/ },
  { target: 'workItemOwner', pattern: /workItemOwner/ },
  { target: 'work_item_owner', pattern: /work_item_owner/ },
  { target: 'owner_actor_id', pattern: /\bowner_actor_id\b/ },
];

const nearbyContext = (lines: string[], index: number): string => lines.slice(Math.max(0, index - 16), index + 17).join('\n');

const matchesAny = (rel: string, patterns: RegExp[]): boolean => patterns.some((pattern) => pattern.test(rel));

const allowedWorkItemOwnerActorIdReference = (rel: string, context: string): boolean => {
  const projectOwnerPaths = [
    /^apps\/control-plane-api\/src\/modules\/projects\//,
    /^packages\/db\/src\/schema\/project\.ts$/,
  ];
  const projectOwnerTestPaths = [
    /^tests\/api\/(?:automation-commands|automation-daemon\.integration|brainstorming|delivery-flow|development-plans|durable-id-generation|durable-revision-lookup|execution-package-service|local-codex-routing|product-lanes|query-module|spec-plan-service|tasks)\.test\.ts$/,
    /^tests\/db\/(?:schema|task-repository)\.test\.ts$/,
    /^tests\/e2e\/helpers\/capture-route-screenshots\.ts$/,
    /^tests\/helpers\/delivery-runtime-fixtures\.ts$/,
    /^tests\/helpers\/execution-supervision-fixtures\.ts$/,
    /^tests\/smoke\/(?:delivery-dogfood-script|delivery-smoke|release-flow-dogfood-script)\.test\.ts$/,
  ];
  const executionPackageOwnerPaths = [
    /^apps\/control-plane-api\/src\/modules\/core\/product-architecture-demo-seed\.ts$/,
    /^apps\/control-plane-api\/src\/modules\/execution-packages\//,
    /^apps\/control-plane-api\/src\/modules\/automation\//,
    /^apps\/control-plane-api\/src\/modules\/run-control\//,
    /^apps\/control-plane-api\/src\/modules\/delivery\/dto\.ts$/,
    /^apps\/web\/src\/features\/execution-packages\//,
    /^packages\/db\/src\/schema\/execution-package\.ts$/,
    /^packages\/db\/src\/queries\/work-item-cockpit-queries\.ts$/,
    /^packages\/contracts\/src\/work-item-delivery-readiness\.ts$/,
    /^packages\/workflow\/src\/activities\.ts$/,
    /^apps\/web\/src\/features\/work-items\/work-item-view-model\.ts$/,
    /^apps\/web\/src\/features\/work-items\/delivery-cockpit\/package-matrix\.tsx$/,
  ];
  const executionPackageOwnerTestPaths = [
    /^tests\/api\/(?:automation-commands|automation-daemon\.integration|automation-runtime-snapshot|codex-runtime-control-plane|delivery-flow|durable-id-generation|execution-package-service|local-codex-routing|product-lanes|query-module|release-module|task-scoped-evidence|test-acceptance-gate)\.test\.ts$/,
    /^tests\/db\/(?:automation-repository|codex-runtime-drizzle-concurrency|codex-runtime-repository|release-cockpit-queries|release-replay-queries|repository|task-repository|work-item-delivery-readiness|work-item-delivery-selection|work-item-release-readiness)\.test\.ts$/,
    /^tests\/db\/repository-contract\.ts$/,
    /^tests\/contracts\/work-item-delivery-readiness\.test\.ts$/,
    /^tests\/domain\/(?:release-gates|release-states|states|validators)\.test\.ts$/,
    /^tests\/helpers\/delivery-runtime-fixtures\.ts$/,
    /^tests\/smoke\/(?:delivery-dogfood-script|delivery-dogfood-work-items-script|delivery-smoke|release-flow-dogfood-script)\.test\.ts$/,
    /^tests\/web\/(?:api|api-hooks|package-run-product-routes|review-release-product-routes)\.test\.tsx?$/,
    /^tests\/web\/fixtures\/product-(?:api-mock|data)\.ts$/,
    /^tests\/workflow\/package-execution-workflow\.test\.ts$/,
  ];
  const productLaneOwnerPaths = [
    /^apps\/control-plane-api\/src\/modules\/query\/product-lane-query-parser\.ts$/,
    /^apps\/web\/src\/app\/routes\/lanes\//,
    /^apps\/web\/src\/features\/product-lanes\//,
    /^apps\/web\/src\/shared\/api\/hooks\.ts$/,
    /^apps\/web\/src\/shared\/api\/query-keys\.ts$/,
    /^apps\/web\/src\/shared\/api\/types\.ts$/,
    /^packages\/contracts\/src\/api\.ts$/,
    /^packages\/contracts\/src\/web-product-query\.ts$/,
    /^packages\/db\/src\/queries\/product-lane-/,
    /^packages\/db\/src\/queries\/web-product-queries\.ts$/,
  ];
  const releaseOrPackageSurfacePaths = [
    /^apps\/web\/src\/features\/pipeline\//,
    /^tests\/web\/fixtures\/product-api-mock\.ts$/,
    /^tests\/web\/fixtures\/product-data\.ts$/,
    /^tests\/web\/package-run-product-routes\.test\.tsx$/,
    /^tests\/web\/review-release-product-routes\.test\.tsx$/,
    /^tests\/web\/spec-plan-product-route\.test\.tsx$/,
    /^tests\/web\/api\.test\.ts$/,
  ];
  const workItemOwnerRejectionTestPaths = [
    /^apps\/control-plane-api\/src\/modules\/query\/query\.service\.ts$/,
    /^tests\/contracts\/(?:product-actions|project-management-contracts|work-item-intake)\.test\.ts$/,
    /^tests\/api\/(?:product-lanes|project-management-query|query-module|work-items)\.test\.ts$/,
    /^tests\/domain\/states\.test\.ts$/,
    /^tests\/web\/(?:api|api-hooks|product-lanes-route|work-item-intake-form|work-item-product-route)\.test\.tsx?$/,
  ];
  const projectOwnerContext =
    /\bProject\b|\bprojects\b|\/projects|records\.project|seed\.project|project\.owner_actor_id|columnType\(projects|hasForeignKey\(projects|repo_ids|object_type: 'project'|project_created/.test(
      context,
    );
  const executionPackageOwnerContext =
    /ExecutionPackage|executionPackage|execution_package|execution-packages|execution_packages|execution-owner|Execution Owner|packageBase|validateExecutionPackage|CreateExecutionPackage|PatchExecutionPackage|package_created|package_edited|cockpitPackage|Package assignee|Package owner|ownerActorId|ownerActorIdValues|context\.workItem\.driver_actor_id|reviewer_actor_id|qa_owner_actor_id|required_checks|required_artifact_kinds|spec_revision_id|plan_revision_id|repo_id/.test(
      context,
    );
  const negativeWorkItemOwnerContext =
    /rejects owner_actor_id|rejects public product list items that expose work_item refs or owner_actor_id|rejects public product query filters with legacy owner or work item fields|rejects Spec and Plan read models with legacy work_item refs or owner fields|owner_actor_id is not supported|owner_actor_id is not accepted|does not expose owner_actor_id|not\.toHaveProperty\('owner_actor_id'\)|not\.toContain\('owner_actor_id'\)|not\.toMatch\([\s\S]*owner_actor_id|queryByLabelText\('owner_actor_id'\)|required_fields.*owner_actor_id|unsupported_filters.*owner_actor_id|strips stale kind and owner filters|omits owner filters|direct Work Item lane filter resolution|filters Work Item type lanes by driver_actor_id|without translating execution owner filters|rejects Work Item create bodies with execution owner fields before POSTing|whitelists source-object query filters before sending requests|editableObjectRefSchema\.parse[\s\S]*owner_actor_id|productListItemSchema\.parse[\s\S]*owner_actor_id|productListQuerySchema\.parse[\s\S]*owner_actor_id|specDetailSchema\.parse[\s\S]*owner_actor_id|productActionSchema\.safeParse[\s\S]*owner_actor_id[\s\S]*toBe\(false\)|productLaneResponseSchema\.safeParse[\s\S]*owner_actor_id[\s\S]*toBe\(false\)|createWorkItemRequestSchema[\s\S]*owner_actor_id|patchWorkItemRequestSchema[\s\S]*owner_actor_id|publicWorkItemSchema[\s\S]*owner_actor_id|api\.createWorkItem\([\s\S]*owner_actor_id|\.patch\(`\/work-items\/[\s\S]*owner_actor_id/.test(
      context,
    );
  const runRequesterContext = /requested_by_actor_id|runSession\.requested_by_actor_id/.test(context);
  const qaOwnerQueueContext = /qa_owner_queues|PipelineQaOwnerQueue|pipelineQaOwnerQueueSchema/.test(context);

  return (
    (matchesAny(rel, workItemOwnerRejectionTestPaths) && negativeWorkItemOwnerContext) ||
    runRequesterContext ||
    qaOwnerQueueContext ||
    (matchesAny(rel, projectOwnerPaths.concat(projectOwnerTestPaths)) && projectOwnerContext) ||
    (matchesAny(rel, executionPackageOwnerPaths.concat(executionPackageOwnerTestPaths)) && executionPackageOwnerContext) ||
    (/^packages\/domain\/src\/(?:states|types|validators)\.ts$/.test(rel) && (projectOwnerContext || executionPackageOwnerContext)) ||
    (productLaneOwnerPaths.some((pattern) => pattern.test(rel)) && (executionPackageOwnerContext || negativeWorkItemOwnerContext)) ||
    (releaseOrPackageSurfacePaths.some((pattern) => pattern.test(rel)) && (executionPackageOwnerContext || runRequesterContext))
  );
};

const allowedWorkItemDriverReference = (rel: string, target: string, context: string): boolean => {
  const negativeLegacyNameContext =
    /Keep legacy Work Item Owner semantics out of product refs|forbiddenProductStrings|not\.toMatch\([\s\S]*Work Item Owner|not\.toContain\([\s\S]*Work Item Owner/.test(
      context,
    );
  if (target !== 'owner_actor_id') {
    return negativeLegacyNameContext;
  }
  if (rel === 'docs/superpowers/plans/2026-05-20-typed-work-item-intake.md') {
    return true;
  }
  return negativeLegacyNameContext || allowedWorkItemOwnerActorIdReference(rel, context);
};

const workItemDriverNamingMatches = () =>
  workItemDriverScanRoots.flatMap(files).flatMap((file) => {
    const rel = relative(process.cwd(), file);
    if (workItemDriverGuardFiles.has(rel)) return [];
    const lines = readFileSync(file, 'utf8').split('\n');
    return lines.flatMap((line, index) =>
      workItemDriverForbiddenPatterns.flatMap(({ target, pattern }) => {
        pattern.lastIndex = 0;
        if (!pattern.test(line)) return [];
        const context = nearbyContext(lines, index);
        return allowedWorkItemDriverReference(rel, target, context) ? [] : [`${rel}:${index + 1} ${target}: ${line.trim()}`];
      }),
    );
  });

describe('delivery naming cleanup', () => {
  it('has no active historical subsystem names', () => {
    const offenders: string[] = [];
    for (const rel of historicalFiles) {
      try {
        const content = readFileSync(rel, 'utf8');
        if (!content.startsWith(`${supersededHistoricalNote}\n\n`)) offenders.push(rel);
      } catch {
        offenders.push(rel);
      }
    }
    for (const file of roots.flatMap(files)) {
      const rel = relative(process.cwd(), file);
      const content = contentForNamingScan(rel, readFileSync(file, 'utf8')).replace(priorityLiteral, '');
      if (historicalFiles.has(rel)) {
        if (!content.startsWith(`${supersededHistoricalNote}\n\n`)) offenders.push(rel);
        continue;
      }
      if (externallyOwnedFiles.has(rel)) continue;
      if (oldSubsystem.test(content) || oldSubsystem.test(rel)) offenders.push(rel);
      oldSubsystem.lastIndex = 0;
    }
    expect(offenders).toEqual([]);
  });

  it('has no active role workbench deletion targets outside the current checklist', () => {
    expect(roleWorkbenchDeletionMatches()).toEqual([]);
  });

  it('has no active Work Item Owner baggage on public Driver surfaces', () => {
    expect(workItemDriverNamingMatches()).toEqual([]);
  });

  it('does not allow Work Item owner fields globally across tests', () => {
    expect(allowedWorkItemOwnerActorIdReference('tests/unknown-owner-field.test.ts', 'Project owner_actor_id')).toBe(false);
    expect(allowedWorkItemOwnerActorIdReference('tests/unknown-owner-field.test.ts', 'ExecutionPackage owner_actor_id')).toBe(false);
    expect(allowedWorkItemOwnerActorIdReference('apps/web/src/features/work-items/work-items-list.tsx', 'ExecutionPackage owner_actor_id')).toBe(false);
    expect(allowedWorkItemOwnerActorIdReference('apps/web/src/features/work-items/work-item-view-model.ts', 'ExecutionPackage owner_actor_id')).toBe(true);
    expect(
      allowedWorkItemOwnerActorIdReference('apps/web/src/features/product-lanes/product-lane-route.tsx', 'Product Lane owner_actor_id lane'),
    ).toBe(false);
    expect(
      allowedWorkItemOwnerActorIdReference(
        'apps/web/src/features/work-items/delivery-cockpit/package-matrix.tsx',
        'Package assignee, latest execution, and blocking context. Owner',
      ),
    ).toBe(true);
  });
});

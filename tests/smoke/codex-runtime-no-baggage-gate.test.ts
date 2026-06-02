import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  codexRuntimeSuperpowersNoBaggageAllowlist,
  scanCodexRuntimeSuperpowersNoBaggage,
} from '../../scripts/check-codex-runtime-superpowers-no-baggage';

const repoRoot = new URL('../..', import.meta.url).pathname;
const readRepoFile = (path: string): string => readFileSync(join(repoRoot, path), 'utf8');

const runtimeNewWriteSourceFiles = [
  'apps/control-plane-api/src/modules/codex-runtime/codex-runtime.dto.ts',
  'apps/control-plane-api/src/modules/codex-runtime/codex-runtime.service.ts',
  'apps/control-plane-api/src/modules/codex-runtime/product-generation-runtime-scheduler.service.ts',
  'apps/automation-daemon/src/generation-runtime.ts',
  'packages/codex-worker-runtime/src/remote-worker-client.ts',
  'packages/codex-worker-runtime/src/runtime-job-artifacts.ts',
  'packages/run-worker/src/run-worker.ts',
];

const productFacingArtifactExposureFiles = [
  'apps/control-plane-api/src/modules/automation/automation.dto.ts',
  'apps/control-plane-api/src/modules/brainstorming/brainstorming.controller.ts',
  'apps/control-plane-api/src/modules/codex-runtime/codex-runtime.dto.ts',
  'apps/control-plane-api/src/modules/development-plans/development-plans.controller.ts',
  'apps/control-plane-api/src/modules/execution-packages/execution-packages.controller.ts',
  'apps/control-plane-api/src/modules/executions/executions.controller.ts',
  'apps/control-plane-api/src/modules/projects/projects.controller.ts',
  'apps/control-plane-api/src/modules/query/product-lane-query-parser.ts',
  'apps/control-plane-api/src/modules/query/public-run-session-projection.ts',
  'apps/control-plane-api/src/modules/query/query.controller.ts',
  'apps/control-plane-api/src/modules/query/query.service.ts',
  'apps/control-plane-api/src/modules/release/release.controller.ts',
  'apps/control-plane-api/src/modules/review-evidence/review-packets.controller.ts',
  'apps/control-plane-api/src/modules/review-evidence/work-item-evidence.controller.ts',
  'apps/control-plane-api/src/modules/run-control/execution-package-runs.controller.ts',
  'apps/control-plane-api/src/modules/run-control/run-sessions.controller.ts',
  'apps/control-plane-api/src/modules/spec-plan/spec-plan.controller.ts',
  'apps/control-plane-api/src/modules/work-items/work-items.controller.ts',
  'packages/db/src/queries/delivery-runtime-readiness.ts',
  'packages/db/src/queries/product-action-builders.ts',
  'packages/db/src/queries/product-lane-filters.ts',
  'packages/db/src/queries/product-lane-queries.ts',
  'packages/db/src/queries/product-lane-types.ts',
  'packages/db/src/queries/project-management-queries.ts',
  'packages/db/src/queries/public-evidence-serialization.ts',
  'packages/db/src/queries/release-cockpit-queries.ts',
  'packages/db/src/queries/release-public-link-visibility.ts',
  'packages/db/src/queries/release-test-acceptance-gate.ts',
  ['packages', 'db', 'src', 'queries', 'replay-queries.ts'].join('/'),
  'packages/db/src/queries/web-product-queries.ts',
  'packages/db/src/queries/work-item-cockpit-queries.ts',
  'packages/db/src/queries/work-item-delivery-readiness.ts',
  'packages/db/src/queries/work-item-delivery-selection.ts',
  'packages/db/src/queries/work-item-release-readiness.ts',
];

const workflowOwnedPublicMutatorControllers = [
  {
    controllerFile: 'apps/control-plane-api/src/modules/brainstorming/brainstorming.controller.ts',
    serviceFile: 'apps/control-plane-api/src/modules/brainstorming/brainstorming.service.ts',
    serviceProperty: 'service',
  },
  {
    controllerFile: 'apps/control-plane-api/src/modules/spec-plan/spec-plan.controller.ts',
    serviceFile: 'apps/control-plane-api/src/modules/spec-plan/spec-plan.service.ts',
    serviceProperty: 'specPlanService',
  },
  {
    controllerFile: 'apps/control-plane-api/src/modules/execution-packages/execution-packages.controller.ts',
    serviceFile: 'apps/control-plane-api/src/modules/execution-packages/execution-package.service.ts',
    serviceProperty: 'service',
  },
  {
    controllerFile: 'apps/control-plane-api/src/modules/executions/executions.controller.ts',
    serviceFile: 'apps/control-plane-api/src/modules/executions/executions.service.ts',
    serviceProperty: 'executionsService',
  },
  {
    controllerFile: 'apps/control-plane-api/src/modules/run-control/execution-package-runs.controller.ts',
    serviceFile: 'apps/control-plane-api/src/modules/run-control/run-control.service.ts',
    serviceProperty: 'runControlService',
  },
  {
    controllerFile: 'apps/control-plane-api/src/modules/run-control/run-sessions.controller.ts',
    serviceFile: 'apps/control-plane-api/src/modules/run-control/run-control.service.ts',
    serviceProperty: 'runControlService',
  },
];

type PublicWorkflowMutatorFinding = {
  file: string;
  route: string;
  method: string;
  reason: string;
};

type PublicMutatorRoute = {
  decorator: string;
  route: string;
  method: string;
  body: string;
};

const workflowGateMarkers = ['PlanItemWorkflowService', 'workflow_legacy_entrypoint_disabled'];
const mutatorDecoratorPattern = /@(Post|Patch|Put|Delete)\('([^']+)'\)\s*(?:\n\s*(?:@[A-Za-z][^\n]*\n\s*)*)?([A-Za-z0-9_]+)\s*\(/g;
const nonWorkflowStateMutatorRoutes = new Set(['Post run-sessions/:runSessionId/events/stream-token']);

const findMatchingBrace = (source: string, openBraceIndex: number): number => {
  let depth = 0;
  for (let index = openBraceIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
};

const extractBlockAfter = (source: string, startIndex: number): string | undefined => {
  const openBraceIndex = source.indexOf('{', startIndex);
  if (openBraceIndex === -1) return undefined;
  const closeBraceIndex = findMatchingBrace(source, openBraceIndex);
  if (closeBraceIndex === -1) return undefined;
  return source.slice(openBraceIndex, closeBraceIndex + 1);
};

const publicMutatorRoutesIn = (source: string): PublicMutatorRoute[] =>
  [...source.matchAll(mutatorDecoratorPattern)].flatMap((match) => {
    const body = extractBlockAfter(source, match.index ?? 0);
    if (body === undefined) return [];
    return [
      {
        decorator: match[1],
        route: match[2],
        method: match[3],
        body,
      },
    ];
  });

const serviceMethodsIn = (source: string): Map<string, string> => {
  const methods = new Map<string, string>();
  const methodPattern = /^  (?:(?:public|private|protected)\s+)?(?:async\s+)?([A-Za-z0-9_]+)\s*\(/gm;
  for (const match of source.matchAll(methodPattern)) {
    const methodName = match[1];
    if (['if', 'for', 'while', 'switch', 'catch', 'function', 'constructor'].includes(methodName)) {
      continue;
    }
    const parameterStartIndex = source.indexOf('(', match.index ?? 0);
    let parameterDepth = 0;
    let signatureEndIndex = -1;
    for (let index = parameterStartIndex; index < source.length; index += 1) {
      const char = source[index];
      if (char === '(') parameterDepth += 1;
      if (char === ')') {
        parameterDepth -= 1;
        if (parameterDepth === 0) {
          signatureEndIndex = index;
          break;
        }
      }
    }
    if (signatureEndIndex === -1) continue;
    const openBraceIndex = source.indexOf('{', signatureEndIndex);
    const closeBraceIndex = findMatchingBrace(source, openBraceIndex);
    if (closeBraceIndex === -1) continue;
    methods.set(methodName, source.slice(openBraceIndex, closeBraceIndex + 1));
  }
  return methods;
};

const serviceCallFromRoute = (body: string, serviceProperty: string): string | undefined =>
  body.match(new RegExp(`this\\.${serviceProperty}\\.([A-Za-z0-9_]+)\\(`))?.[1];

const blockHasWorkflowGate = (block: string): boolean => workflowGateMarkers.some((marker) => block.includes(marker));

const methodReachesWorkflowGate = (methods: Map<string, string>, methodName: string, visited = new Set<string>()): boolean => {
  if (visited.has(methodName)) return false;
  visited.add(methodName);
  const body = methods.get(methodName);
  if (body === undefined) return false;
  if (blockHasWorkflowGate(body)) return true;
  return [...body.matchAll(/\bthis\.([A-Za-z0-9_]+)\(/g)].some((match) => methodReachesWorkflowGate(methods, match[1], visited));
};

const scanWorkflowOwnedPublicMutators = (rootDir: string): PublicWorkflowMutatorFinding[] =>
  workflowOwnedPublicMutatorControllers.flatMap(({ controllerFile, serviceFile, serviceProperty }) => {
    const controllerSource = readFileSync(join(rootDir, controllerFile), 'utf8');
    const serviceMethods = serviceMethodsIn(readFileSync(join(rootDir, serviceFile), 'utf8'));
    return publicMutatorRoutesIn(controllerSource).flatMap((route) => {
      if (nonWorkflowStateMutatorRoutes.has(`${route.decorator} ${route.route}`)) return [];
      if (blockHasWorkflowGate(route.body)) return [];
      const serviceMethod = serviceCallFromRoute(route.body, serviceProperty);
      if (serviceMethod === undefined) {
        return [
          {
            file: controllerFile,
            route: `${route.decorator} ${route.route}`,
            method: route.method,
            reason: `public mutator does not call ${serviceProperty}`,
          },
        ];
      }
      if (methodReachesWorkflowGate(serviceMethods, serviceMethod)) return [];
      return [
        {
          file: serviceFile,
          route: `${route.decorator} ${route.route}`,
          method: serviceMethod,
          reason: 'service method does not reach PlanItemWorkflowService or workflow_legacy_entrypoint_disabled',
        },
      ];
    });
  });

describe('Codex runtime Superpowers no-baggage gate', () => {
  it('requires every allowlist entry to carry owner and reason', () => {
    expect(codexRuntimeSuperpowersNoBaggageAllowlist.length).toBeGreaterThan(0);
    for (const entry of codexRuntimeSuperpowersNoBaggageAllowlist) {
      expect(entry.owner).toMatch(/^(legacy-local-executor|negative-test|internal-runtime-storage|historical-doc)$/);
      expect(entry.reason.trim().length).toBeGreaterThan(12);
    }
  });

  it('flags active strict dogfood use of legacy routes, host Codex setup, and CLI fallback', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'forgeloop-no-baggage-'));
    try {
      writeFileSync(
        join(tempRoot, 'strict-dogfood.ts'),
        [
          'await fetch("/work-items");',
          'await fetch("/tasks/task-1");',
          'const hostCodexHome = "~/.codex";',
          'const mode = "exec_fallback";',
          'await run("codex", ["exec", "prompt"]);',
        ].join('\n'),
      );

      const result = scanCodexRuntimeSuperpowersNoBaggage({
        rootDir: tempRoot,
        files: ['strict-dogfood.ts'],
        allowlist: [],
      });

      expect(result.ok).toBe(false);
      expect(result.violations.map((violation) => violation.pattern).sort()).toEqual([
        'codex_exec_cli',
        'exec_fallback',
        'host_codex_home',
        'legacy_tasks_route',
        'legacy_work_items_route',
      ]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('flags raw runtime route helper shapes for plans specs and replay browsers', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'forgeloop-no-baggage-raw-routes-'));
    try {
      writeFileSync(
        join(tempRoot, 'strict-dogfood.ts'),
        [
          "const rawPlanRoute = route('plans');",
          "const rawSpecPath = { path: 'specs' };",
          'const replayBrowser = "Raw Replay Browser";',
        ].join('\n'),
      );

      const result = scanCodexRuntimeSuperpowersNoBaggage({
        rootDir: tempRoot,
        files: ['strict-dogfood.ts'],
        allowlist: [],
      });

      expect(result.ok).toBe(false);
      expect(result.violations.map((violation) => violation.pattern)).toEqual([
        'raw_runtime_route',
        'raw_runtime_route',
        'raw_runtime_route',
      ]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('flags every legacy task and source-specific spec or plan route shape required by the strict spec', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'forgeloop-no-baggage-spec-required-'));
    try {
      writeFileSync(
        join(tempRoot, 'strict-dogfood.ts'),
        [
          'await fetch("/query/tasks");',
          'createTask({ title: "legacy task" });',
          "const oldWorkItem = { type: z.literal('work_item') };",
          "const oldTask = { type: z.literal('task') };",
          "const oldPlan = { type: z.literal('plan') };",
          'await fetch("/requirements/requirement-1/spec");',
          'await fetch("/bugs/bug-1/plan");',
          'await fetch("/tech-debt/debt-1/spec");',
          'await fetch("/initiatives/initiative-1/plan");',
        ].join('\n'),
      );

      const result = scanCodexRuntimeSuperpowersNoBaggage({
        rootDir: tempRoot,
        files: ['strict-dogfood.ts'],
        allowlist: [],
      });

      expect(result.ok).toBe(false);
      expect(result.violations.map((violation) => violation.excerpt)).toEqual(
        expect.arrayContaining([
          'await fetch("/query/tasks");',
          'createTask({ title: "legacy task" });',
          "const oldWorkItem = { type: z.literal('work_item') };",
          "const oldTask = { type: z.literal('task') };",
          "const oldPlan = { type: z.literal('plan') };",
          'await fetch("/requirements/requirement-1/spec");',
          'await fetch("/bugs/bug-1/plan");',
          'await fetch("/tech-debt/debt-1/spec");',
          'await fetch("/initiatives/initiative-1/plan");',
        ]),
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('flags active legacy Codex session snapshot vocabulary', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'forgeloop-no-baggage-snapshots-'));
    const legacyLines = [
      'type CodexSessionSnapshot = {};',
      "const ref = 'artifact://internal/codex_session_snapshot/codex_session/session-1/snapshot-1';",
      "const latest_snapshot_digest = 'sha256:old';",
      "const expected_previous_snapshot_digest = 'sha256:old';",
      "const output_snapshot_digest = 'sha256:old-output';",
      "const forked_from_snapshot_id = 'snapshot-1';",
      "const fork_point_snapshot_id = 'snapshot-1';",
      "const error = 'codex_session_snapshot_stale';",
      "const latest = { latestSnapshot: 'snapshot-1' };",
      "const previous = { expectedPreviousSnapshotDigest: 'sha256:old' };",
      "const output = { outputSnapshot: 'snapshot-2' };",
      "const attempted = { attemptedOutputSnapshotDigest: 'sha256:attempted' };",
      "const forked = { forkedFromSnapshotId: 'snapshot-1' };",
      "const forkPoint = { forkPointSnapshot: 'snapshot-1' };",
      'const collection = repository.codexSessionSnapshots;',
      'await repository.createCodexSessionSnapshot(snapshot);',
      "await repository.getCodexSessionSnapshot('snapshot-1');",
      'await repository.getLatestSnapshot(sessionId);',
      "await fetch('/internal/codex-sessions/session-1/snapshots');",
      "await fetch('/internal/codex-sessions/:sessionId/snapshots');",
    ];
    try {
      writeFileSync(join(tempRoot, 'strict-dogfood.ts'), legacyLines.join('\n'));

      const result = scanCodexRuntimeSuperpowersNoBaggage({
        rootDir: tempRoot,
        files: ['strict-dogfood.ts'],
        allowlist: [],
      });

      expect(result.ok).toBe(false);
      expect(result.violations).toHaveLength(legacyLines.length);
      expect(result.violations.map((violation) => violation.pattern)).toEqual(
        legacyLines.map(() => 'legacy_codex_session_snapshot'),
      );
      expect(result.violations.map((violation) => violation.excerpt)).toEqual(legacyLines);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('allows superseded snapshot vocabulary only in historical design specs', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'forgeloop-no-baggage-historical-snapshots-'));
    try {
      const specsSegment = ['s', 'p', 'e', 'c', 's'].join('');
      const historicalSpecFile = join('docs', 'superpowers', specsSegment, '2026-06-02-codex-runtime-capsule-packaging-restore-design.md');
      const specDir = join(tempRoot, 'docs', 'superpowers', specsSegment);
      const runbookDir = join(tempRoot, 'docs', 'runbooks');
      mkdirSync(specDir, { recursive: true });
      mkdirSync(runbookDir, { recursive: true });
      writeFileSync(
        join(specDir, '2026-06-02-codex-runtime-capsule-packaging-restore-design.md'),
        'This design supersedes `CodexSessionSnapshot`; future work uses `CodexRuntimeCapsule` instead.',
      );
      writeFileSync(join(runbookDir, 'codex-runtime.md'), 'Runbook still says CodexSessionSnapshot.');

      const result = scanCodexRuntimeSuperpowersNoBaggage({
        rootDir: tempRoot,
        files: [
          historicalSpecFile,
          'docs/runbooks/codex-runtime.md',
        ],
        allowlist: [],
      });

      expect(result.violations).toEqual([
        expect.objectContaining({
          file: 'docs/runbooks/codex-runtime.md',
          pattern: 'legacy_codex_session_snapshot',
        }),
      ]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('keeps the current strict Codex runtime Superpowers lane free of unowned baggage matches', () => {
    const result = scanCodexRuntimeSuperpowersNoBaggage({
      rootDir: repoRoot,
    });

    expect(result.violations).toEqual([]);
  });

  it('keeps new-write runtime artifact paths off legacy storage authorities', () => {
    const forbiddenNewWritePatterns = [
      {
        name: 'legacy runtime artifact storage authority',
        pattern: /artifact:\/\/codex-runtime-jobs\/[^"'`\s]+\/(?:artifacts|workspace-bundle)(?:\/|\b)/,
      },
      {
        name: 'legacy pending bundle storage authority',
        pattern: /artifact:codex-pending-bundles:/,
      },
      {
        name: 'generated payload metadata as canonical source',
        pattern: /metadata_json\.generated_payload|\bgenerated_payload:\s*result\.generated\b/,
      },
      {
        name: 'pending bundle replay from caller-supplied archive bytes',
        pattern: /archive_bytes_base64:\s*input\.archive_bytes_base64/,
      },
    ];

    const violations = runtimeNewWriteSourceFiles.flatMap((file) => {
      const content = readRepoFile(file);
      return forbiddenNewWritePatterns
        .filter(({ pattern }) => pattern.test(content))
        .map(({ name }) => `${file}: ${name}`);
    });

    expect(violations).toEqual([]);
  });

  it('does not treat digest-bound runtime workload labels as byte storage authorities', () => {
    const workloadLabelSource = readRepoFile('packages/run-worker/src/run-worker.ts');

    expect(workloadLabelSource).toContain('artifact://codex-runtime-jobs/${runtimeJobId}/workload/package-prompt');
    expect(workloadLabelSource).toContain('artifact://codex-runtime-jobs/${runtimeJobId}/workload/execution-context');
    expect(workloadLabelSource).not.toMatch(
      /artifact:\/\/codex-runtime-jobs\/[^"'`\s]+\/(?:artifacts|workspace-bundle)(?:\/|\b)/,
    );
  });

  it('keeps product-facing DTO and query surfaces free of internal artifact storage details', () => {
    const forbiddenProductExposurePatterns = [
      {
        name: 'storage_key',
        pattern: /\bstorage_key\b/,
      },
      {
        name: 'internal_artifact_objects.storageKey',
        pattern: /\binternal_artifact_objects\.storageKey\b/,
      },
      {
        name: 'direct internal artifact download URL',
        pattern: /\/internal\/artifacts\/[^"'`\s]+\/download|downloadInternalArtifact/,
      },
    ];

    const violations = productFacingArtifactExposureFiles.flatMap((file) => {
      const content = readRepoFile(file);
      return forbiddenProductExposurePatterns
        .filter(({ pattern }) => pattern.test(content))
        .map(({ name }) => `${file}: ${name}`);
    });

    expect(violations).toEqual([]);
  });

  it('requires workflow-owned public mutators to delegate through PlanItemWorkflowService or reject', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'forgeloop-workflow-mutator-gate-'));
    try {
      const weakControllerPath = join(tempRoot, 'apps/control-plane-api/src/modules/brainstorming');
      mkdirSync(weakControllerPath, { recursive: true });
      writeFileSync(
        join(weakControllerPath, 'brainstorming.controller.ts'),
        [
          "import { Controller, Post } from '@nestjs/common';",
          '@Controller()',
          'export class BrainstormingController {',
          '  constructor(private readonly service: BrainstormingService) {}',
          "  @Post('development-plans/:developmentPlanId/items/:itemId/boundary-brainstorming')",
          '  startBoundaryBrainstorming() {',
          '    return this.service.startBoundaryBrainstorming();',
          '  }',
          '}',
        ].join('\n'),
      );
      writeFileSync(
        join(weakControllerPath, 'brainstorming.service.ts'),
        [
          'export class BrainstormingService {',
          '  startBoundaryBrainstorming() {',
          '    return this.repository.saveBrainstormingSession({});',
          '  }',
          '}',
        ].join('\n'),
      );
      for (const { controllerFile, serviceFile } of workflowOwnedPublicMutatorControllers.filter(
        (entry) => entry.controllerFile !== 'apps/control-plane-api/src/modules/brainstorming/brainstorming.controller.ts',
      )) {
        mkdirSync(join(tempRoot, controllerFile, '..'), { recursive: true });
        writeFileSync(join(tempRoot, controllerFile), 'export class EmptyController {}');
        writeFileSync(join(tempRoot, serviceFile), 'export class EmptyService {}');
      }

      expect(scanWorkflowOwnedPublicMutators(tempRoot)).toEqual([
        {
          file: 'apps/control-plane-api/src/modules/brainstorming/brainstorming.service.ts',
          route: 'Post development-plans/:developmentPlanId/items/:itemId/boundary-brainstorming',
          method: 'startBoundaryBrainstorming',
          reason: 'service method does not reach PlanItemWorkflowService or workflow_legacy_entrypoint_disabled',
        },
      ]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }

    const violations = scanWorkflowOwnedPublicMutators(repoRoot);

    expect(violations).toEqual([]);
  });

  it('does not expose runtime worker or lease identifiers in product generation public DTOs', () => {
    const scheduler = readFileSync(
      join(repoRoot, 'apps/control-plane-api/src/modules/codex-runtime/product-generation-runtime-scheduler.service.ts'),
      'utf8',
    );
    const publicDtoType = extractBlockAfter(scheduler, scheduler.indexOf('export type PublicProductGenerationRuntimeJob'));
    const publicMapper = extractBlockAfter(scheduler, scheduler.indexOf('private publicRuntimeJob'));

    expect(publicDtoType).toBeDefined();
    expect(publicMapper).toBeDefined();
    expect(publicDtoType).not.toContain('worker_id');
    expect(publicDtoType).not.toContain('launch_lease_id');
    expect(publicMapper).not.toContain('worker_id');
    expect(publicMapper).not.toContain('launch_lease_id');
  });

  it('scans product reports by default and applies allowlist entries to specific occurrences', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'forgeloop-no-baggage-report-'));
    try {
      writeFileSync(
        join(tempRoot, 'report.md'),
        'placeholder',
      );
      const docsDir = join(tempRoot, 'docs', 'superpowers', 'reports');
      const runbookDir = join(tempRoot, 'docs', 'runbooks');
      const scriptsDir = join(tempRoot, 'scripts');
      mkdirSync(docsDir, { recursive: true });
      mkdirSync(runbookDir, { recursive: true });
      mkdirSync(scriptsDir, { recursive: true });
      writeFileSync(join(docsDir, 'codex-runtime-superpowers-dogfood.md'), 'Bad report mentions /tasks/task-1 and CODEX_HOME.');
      writeFileSync(
        join(runbookDir, 'codex-remote-worker-runtime.md'),
        [
          'Local files are only inputs to the bootstrap step: ~/.codex/config.toml.',
          'Bad worker setup says use CODEX_HOME from the host.',
        ].join('\n'),
      );

      const result = scanCodexRuntimeSuperpowersNoBaggage({
        rootDir: tempRoot,
        allowlist: [
          {
            file: 'docs/runbooks/codex-remote-worker-runtime.md',
            pattern: 'host_codex_home',
            owner: 'historical-doc',
            reason: 'Allow exactly the import-only bootstrap reference in this fixture.',
            excerpt: 'only inputs to the bootstrap step',
          },
        ],
      });

      expect(result.violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            file: 'docs/superpowers/reports/codex-runtime-superpowers-dogfood.md',
            pattern: 'legacy_tasks_route',
          }),
          expect.objectContaining({
            file: 'docs/superpowers/reports/codex-runtime-superpowers-dogfood.md',
            pattern: 'host_codex_home',
          }),
          expect.objectContaining({
            file: 'docs/runbooks/codex-remote-worker-runtime.md',
            pattern: 'host_codex_home',
          }),
        ]),
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

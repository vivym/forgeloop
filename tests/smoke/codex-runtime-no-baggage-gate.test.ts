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

const workflowGateMarkers = ['PlanItemWorkflowService', 'workflow_legacy_entrypoint_disabled', 'legacy_execution_entrypoint_disabled'];
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
    const controllerMethods = serviceMethodsIn(controllerSource);
    const serviceMethods = serviceMethodsIn(readFileSync(join(rootDir, serviceFile), 'utf8'));
    return publicMutatorRoutesIn(controllerSource).flatMap((route) => {
      if (nonWorkflowStateMutatorRoutes.has(`${route.decorator} ${route.route}`)) return [];
      if (blockHasWorkflowGate(route.body)) return [];
      if (methodReachesWorkflowGate(controllerMethods, route.method)) return [];
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

const publicRunPackageGuardInvariant = (rootDir: string): string[] => {
  const source = readFileSync(join(rootDir, 'apps/control-plane-api/src/modules/run-control/run-control.service.ts'), 'utf8');
  const methods = serviceMethodsIn(source);
  const publicTombstone = methods.get('legacyExecutionEntrypointDisabled');
  const findings: string[] = [];
  for (const legacyMethod of ['runPackage', 'runPackageWithRepository', 'runPackageReplacementContext', 'assertPublicRunPackageMutationAllowed']) {
    if (methods.has(legacyMethod)) {
      findings.push(`${legacyMethod} legacy execution package start helper is still present`);
    }
  }
  if (publicTombstone === undefined || !publicTombstone.includes('legacy_execution_entrypoint_disabled')) {
    findings.push('retired public execution package tombstone does not emit legacy_execution_entrypoint_disabled');
  }
  if (/activeWorkflow|development_plan_item_id|getActivePlanItemWorkflowByItem|enqueueRunWithRepository\([^)]*dto/.test(source)) {
    findings.push('retired public execution package code conditionally allows legacy starts');
  }
  return findings;
};

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

  it('flags Wave 5 legacy workflow routes and session mutations outside queued actions', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'forgeloop-no-baggage-wave5-routes-'));
    const forbiddenLines = [
      'await fetch("/plan-item-workflows/workflow-1/spec/generate-draft");',
      'await fetch("/plan-item-workflows/workflow-1/implementation-plan/generate-draft");',
      'await fetch("/plan-item-workflows/workflow-1/execution/start");',
      'await fetch("/development-plans/plan-1/items/item-1/execution/start");',
      'await fetch("/plan-item-workflows/workflow-1/run-sessions/run-1/input");',
      'await fetch("/plan-item-workflows/workflow-1/run-sessions/run-1/cancel");',
      'await fetch("/plan-item-workflows/workflow-1/run-sessions/run-1/resume");',
      'await fetch("/plan-item-workflows/workflow-1/transitions");',
      'await fetch("/plan-item-workflows/workflow-1/spec/draft");',
      'await fetch("/plan-item-workflows/workflow-1/spec-revisions/revision-1/submit");',
      'await fetch("/plan-item-workflows/workflow-1/spec-revisions/revision-1/approve");',
      'await fetch("/plan-item-workflows/workflow-1/request-spec-changes");',
      'await fetch("/plan-item-workflows/workflow-1/block");',
      'await fetch("/plan-item-workflows/workflow-1/archive");',
      'await fetch("/plan-item-workflows/workflow-1/recover");',
      'await fetch("/plan-item-workflows/workflow-1/codex-sessions/session-1/fork");',
      'await fetch("/plan-item-workflows/workflow-1/codex-sessions/session-1/select-active-fork");',
      'await fetch("/plan-item-workflows/workflow-1/codex-sessions/session-1/new-session");',
      'await fetch("/plan-item-workflows/workflow-1/codex-sessions/session-1/abandon");',
      'await fetch("/plan-item-workflows/workflow-1/codex-sessions/session-1/scavenge");',
    ];
    try {
      const fixtureFile = 'apps/web/src/features/development-plans/plan-item-workflow-workspace.tsx';
      mkdirSync(join(tempRoot, 'apps/web/src/features/development-plans'), { recursive: true });
      writeFileSync(join(tempRoot, fixtureFile), forbiddenLines.join('\n'));

      const result = scanCodexRuntimeSuperpowersNoBaggage({
        rootDir: tempRoot,
        files: [fixtureFile],
        allowlist: [],
      });

      expect(result.violations.map((violation) => violation.excerpt)).toEqual(forbiddenLines);
      expect(result.violations.map((violation) => violation.pattern)).toEqual([
        'legacy_workflow_direct_spec_generation',
        'legacy_workflow_direct_plan_generation',
        'legacy_workflow_direct_execution_start',
        'legacy_workflow_direct_execution_start',
        'legacy_workflow_run_session_control',
        'legacy_workflow_run_session_control',
        'legacy_workflow_run_session_control',
        'wave5_forbidden_session_mutation',
        'legacy_workflow_direct_spec_generation',
        'legacy_workflow_direct_spec_generation',
        'legacy_workflow_direct_spec_generation',
        'wave5_forbidden_session_mutation',
        'wave5_forbidden_session_mutation',
        'wave5_forbidden_session_mutation',
        'wave5_forbidden_session_mutation',
        'wave5_forbidden_session_mutation',
        'wave5_forbidden_session_mutation',
        'wave5_forbidden_session_mutation',
        'wave5_forbidden_session_mutation',
        'wave5_forbidden_session_mutation',
      ]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('flags retired public execution package start calls and helpers', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'forgeloop-no-baggage-run-package-starts-'));
    const forbiddenLines = [
      'await fetch("/execution-packages/package-1/run");',
      'await fetch("/execution-packages/package-1/rerun");',
      'await fetch("/execution-packages/package-1/force-rerun");',
      'createCommandApi().runPackage("package-1", actorId, {});',
      'createCommandApi().rerunPackage("package-1", actorId, {});',
      'createCommandApi().forceRerunPackage("package-1", actorId, {});',
      "const command = { type: 'run_package', package_id: 'package-1' };",
    ];
    try {
      const fixtureFile = 'apps/web/src/shared/api/commands.ts';
      mkdirSync(join(tempRoot, 'apps/web/src/shared/api'), { recursive: true });
      writeFileSync(join(tempRoot, fixtureFile), forbiddenLines.join('\n'));

      const result = scanCodexRuntimeSuperpowersNoBaggage({
        rootDir: tempRoot,
        files: [fixtureFile],
        allowlist: [],
      });

      expect(result.violations.map((violation) => violation.excerpt)).toEqual(forbiddenLines);
      expect(result.violations.map((violation) => violation.pattern)).toEqual(
        forbiddenLines.map(() => 'legacy_public_execution_package_start'),
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('flags retired public execution package commands in public contracts', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'forgeloop-no-baggage-contract-run-package-'));
    try {
      const fixtureFile = 'packages/contracts/src/api.ts';
      mkdirSync(join(tempRoot, 'packages/contracts/src'), { recursive: true });
      writeFileSync(
        join(tempRoot, fixtureFile),
        [
          "const runPackageCommandSchema = z.object({ type: z.literal('run_package') });",
          "const command = { command: 'force_rerun_package', path: '/execution-packages/:packageId/force-rerun' };",
        ].join('\n'),
      );

      const result = scanCodexRuntimeSuperpowersNoBaggage({
        rootDir: tempRoot,
        files: [fixtureFile],
        allowlist: [],
      });

      expect(result.violations.map((violation) => violation.pattern)).toEqual([
        'legacy_public_execution_package_start',
        'legacy_public_execution_package_start',
      ]);
      expect(result.violations.map((violation) => violation.excerpt)).toEqual([
        "const runPackageCommandSchema = z.object({ type: z.literal('run_package') });",
        "const command = { command: 'force_rerun_package', path: '/execution-packages/:packageId/force-rerun' };",
      ]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('flags package scripts that re-expose retired package-run dogfood paths', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'forgeloop-no-baggage-package-dogfood-'));
    const forbiddenScripts = {
      'dogfood:delivery': 'tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/delivery-dogfood.ts',
      'dogfood:delivery:durable': 'tsx scripts/delivery-durable-dogfood.ts',
      'dogfood:delivery:local-codex':
        'tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/delivery-local-codex-dogfood.ts',
      'dogfood:delivery:work-items':
        'tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/delivery-dogfood-work-items.ts',
      'dogfood:release-flow': 'tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/release-flow-dogfood.ts',
      'dogfood:release-flow:strict':
        'tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/release-flow-strict-dogfood.ts',
    };
    try {
      writeFileSync(join(tempRoot, 'package.json'), JSON.stringify({ scripts: forbiddenScripts }, undefined, 2));

      const result = scanCodexRuntimeSuperpowersNoBaggage({
        rootDir: tempRoot,
        files: ['package.json'],
        allowlist: [],
      });

      expect(result.violations.map((violation) => violation.pattern)).toEqual(
        Object.keys(forbiddenScripts).map(() => 'legacy_public_execution_package_start'),
      );
      expect(result.violations.map((violation) => violation.excerpt)).toEqual(
        Object.entries(forbiddenScripts).map(([scriptName, scriptCommand], index, entries) => {
          const suffix = index === entries.length - 1 ? '' : ',';
          return `"${scriptName}": "${scriptCommand}"${suffix}`;
        }),
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('scans active package-script targets for retired package-run calls even with new script names', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'forgeloop-no-baggage-active-script-target-'));
    try {
      mkdirSync(join(tempRoot, 'scripts'), { recursive: true });
      writeFileSync(
        join(tempRoot, 'package.json'),
        JSON.stringify(
          {
            scripts: {
              'dogfood:workflow-regression': 'tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/workflow-regression.ts',
            },
          },
          undefined,
          2,
        ),
      );
      writeFileSync(join(tempRoot, 'scripts/workflow-regression.ts'), 'await fetch("/execution-packages/package-1/run");\n');

      const result = scanCodexRuntimeSuperpowersNoBaggage({
        rootDir: tempRoot,
        allowlist: [],
      });

      expect(result.violations).toContainEqual(
        expect.objectContaining({
          file: 'scripts/workflow-regression.ts',
          pattern: 'legacy_public_execution_package_start',
          excerpt: 'await fetch("/execution-packages/package-1/run");',
        }),
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('flags public legacy disabled wrapper routes instead of accepting compatibility shells', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'forgeloop-no-baggage-disabled-wrapper-'));
    try {
      const fixtureFile = 'apps/control-plane-api/src/modules/spec-plan/spec-plan.controller.ts';
      mkdirSync(join(tempRoot, 'apps/control-plane-api/src/modules/spec-plan'), { recursive: true });
      writeFileSync(
        join(tempRoot, fixtureFile),
        [
          "import { Controller, Post } from '@nestjs/common';",
          '@Controller()',
          'export class SpecPlanController {',
          "  @Post('development-plans/:developmentPlanId/items/:itemId/spec/generate-draft')",
          '  generateItemSpecDraft() {',
          "    return this.legacyEntrypointDisabled('item-spec-generate-draft');",
          '  }',
          '  private legacyEntrypointDisabled(operation: string): never {',
          "    throw new DomainError('workflow_legacy_entrypoint_disabled', operation);",
          '  }',
          '}',
        ].join('\n'),
      );

      const result = scanCodexRuntimeSuperpowersNoBaggage({
        rootDir: tempRoot,
        files: [fixtureFile],
        allowlist: [],
      });

      expect(result.violations).toContainEqual(expect.objectContaining({
        file: fixtureFile,
        pattern: 'legacy_workflow_direct_spec_generation',
      }));
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('flags composer generation actions and raw runtime refs on public UI surfaces', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'forgeloop-no-baggage-wave5-ui-'));
    const forbiddenLines = [
      "const badComposerAction = { action: 'generate_spec_doc' };",
      "const badPlanAction = { action: 'generate_implementation_plan_doc' };",
      "const badExecutionAction = { action: 'start_execution' };",
      'const thread = workflow.codex_thread_id;',
      'const activeSession = workflow.active_codex_session_id;',
      'const session = workflow.codex_session_id;',
      'const turn = workflow.codex_session_turn_id;',
      'const selectedSession = workflow.selected_codex_session_id;',
      'const capsule = workflow.output_capsule_id;',
      'const artifact = "artifact://internal/codex_runtime_capsule/codex_session/session-1/capsule-1";',
      'const memory = workflow.memory_bundle_ref;',
      'const transcript = workflow.prompt_transcript;',
      'const localPath = "/Users/example/.codex/session.json";',
      'type PublicWorkflowDto = CodexSessionSnapshot;',
    ];
    try {
      const fixtureFile = 'apps/web/src/features/development-plans/plan-item-workflow-workspace.tsx';
      mkdirSync(join(tempRoot, 'apps/web/src/features/development-plans'), { recursive: true });
      writeFileSync(join(tempRoot, fixtureFile), forbiddenLines.join('\n'));

      const result = scanCodexRuntimeSuperpowersNoBaggage({
        rootDir: tempRoot,
        files: [fixtureFile],
        allowlist: [],
      });

      expect(result.violations.map((violation) => violation.excerpt)).toEqual(forbiddenLines);
      expect(result.violations.map((violation) => violation.pattern)).toEqual([
        'workflow_composer_generation_action',
        'workflow_composer_generation_action',
        'workflow_composer_generation_action',
        'public_raw_codex_runtime_ref',
        'public_raw_codex_runtime_ref',
        'public_raw_codex_runtime_ref',
        'public_raw_codex_runtime_ref',
        'public_raw_codex_runtime_ref',
        'public_raw_codex_runtime_ref',
        'public_raw_codex_runtime_ref',
        'public_raw_codex_runtime_ref',
        'public_raw_codex_runtime_ref',
        'public_raw_codex_runtime_ref',
        'legacy_codex_session_snapshot',
      ]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('flags Wave 7 product surfaces that expose direct run-session controls, fork, automation action runs, or raw runtime refs', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'forgeloop-no-baggage-wave7-'));
    const forbiddenLines = [
      'await fetch("/plan-item-workflows/workflow-1/run-sessions/run-1/resume");',
      'await fetch("/plan-item-workflows/workflow-1/execution-packages/package-1/rerun");',
      'const packageRerun = workflowOwnedExecutionPackageRerun;',
      'const directResume = workflowRunSessionResume;',
      'await fetch("/plan-item-workflows/workflow-1/select-fork");',
      "const reviewResponseTarget = 'automation_action_run';",
      'const reviewResponseActionRun = payload.action_run_id;',
      'const rawThread = workflow.codex_thread_id;',
      'const rawSession = workflow.codex_session_id;',
      'const rawTurn = workflow.codex_session_turn_id;',
      'const rawCapsule = workflow.latest_capsule_id;',
      'const memory = workflow.latest_memory_bundle_ref;',
      'const env = workflow.latest_environment_manifest_ref;',
      'const internalRef = evidence.internal_object_ref;',
      'const lease = workflow.lease_token;',
      'const worker = workflow.worker_id;',
      'const credential = workflow.credential_binding_id;',
      'const runtimeProfile = workflow.runtime_profile_revision_id;',
      'const artifact = "artifact://internal/codex_runtime_capsule/capsule-1";',
      'const localPath = "/Users/example/.codex/session.json";',
    ];
    try {
      const fixtureFile = 'apps/web/src/features/development-plans/plan-item-workflow-workspace.tsx';
      mkdirSync(join(tempRoot, 'apps/web/src/features/development-plans'), { recursive: true });
      writeFileSync(join(tempRoot, fixtureFile), forbiddenLines.join('\n'));

      const result = scanCodexRuntimeSuperpowersNoBaggage({
        rootDir: tempRoot,
        files: [fixtureFile],
        allowlist: [],
      });

      expect(result.violations.map((violation) => violation.excerpt)).toEqual(forbiddenLines);
      expect(result.violations.map((violation) => violation.pattern)).toEqual([
        'legacy_workflow_run_session_control',
        'legacy_public_execution_package_start',
        'wave7_workflow_execution_package_rerun',
        'wave7_direct_run_session_control',
        'wave7_public_fork_before_wave8',
        'wave7_review_response_automation_action_run',
        'wave7_review_response_automation_action_run',
        'public_raw_codex_runtime_ref',
        'public_raw_codex_runtime_ref',
        'public_raw_codex_runtime_ref',
        'wave7_public_raw_runtime_ref',
        'wave7_public_raw_runtime_ref',
        'wave7_public_raw_runtime_ref',
        'wave7_public_raw_runtime_ref',
        'wave7_public_raw_runtime_ref',
        'wave7_public_raw_runtime_ref',
        'wave7_public_raw_runtime_ref',
        'wave7_public_raw_runtime_ref',
        'public_raw_codex_runtime_ref',
        'public_raw_codex_runtime_ref',
      ]);
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
      "const attempted_output_snapshot_digest = 'sha256:attempted-output';",
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

  it('flags active legacy Codex runtime env aliases in daemon and dogfood files', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'forgeloop-no-baggage-env-aliases-'));
    const legacyAutomationEnv = ['FORGELOOP', 'CODEX', 'AUTOMATION', 'GENERATION'].join('_');
    const legacyWorkerEnv = ['FORGELOOP', 'CODEX', 'WORKER', 'ID'].join('_');
    try {
      const daemonDir = join(tempRoot, 'apps', 'automation-daemon', 'src');
      const scriptDir = join(tempRoot, 'scripts');
      mkdirSync(daemonDir, { recursive: true });
      mkdirSync(scriptDir, { recursive: true });
      writeFileSync(join(daemonDir, 'config.ts'), `process.env.${legacyAutomationEnv};\n`);
      writeFileSync(join(scriptDir, 'codex-remote-worker-dogfood.ts'), `process.env.${legacyWorkerEnv};\n`);

      const result = scanCodexRuntimeSuperpowersNoBaggage({
        rootDir: tempRoot,
        allowlist: [],
      });

      expect(result.violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            file: 'apps/automation-daemon/src/config.ts',
            pattern: 'legacy_codex_runtime_env_alias',
          }),
          expect.objectContaining({
            file: 'scripts/codex-remote-worker-dogfood.ts',
            pattern: 'legacy_codex_runtime_env_alias',
          }),
        ]),
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('scans active API domain db and worker tests for legacy snapshot vocabulary', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'forgeloop-no-baggage-active-tests-'));
    const activeTestFixtures = [
      {
        file: 'tests/api/codex-session-lease.test.ts',
        source: "await fetch('/internal/codex-sessions/session-1/snapshots');",
      },
      {
        file: 'tests/domain/internal-artifacts.test.ts',
        source: "const ref = 'artifact://internal/codex_session_snapshot/codex_session/session-1/snapshot-1';",
      },
      {
        file: 'tests/db/schema.test.ts',
        source: "expect(columns).not.toContain('latestSnapshotId');",
      },
      {
        file: 'tests/codex-worker-runtime/remote-worker-client.test.ts',
        source: "const terminalization = { expected_previous_snapshot_digest: 'sha256:old' };",
      },
    ];
    try {
      for (const fixture of activeTestFixtures) {
        const directory = join(tempRoot, ...fixture.file.split('/').slice(0, -1));
        mkdirSync(directory, { recursive: true });
        writeFileSync(join(tempRoot, fixture.file), fixture.source);
      }

      const result = scanCodexRuntimeSuperpowersNoBaggage({
        rootDir: tempRoot,
        allowlist: [],
      });

      expect(result.violations).toHaveLength(activeTestFixtures.length);
      expect(result.violations).toEqual(
        expect.arrayContaining(
          activeTestFixtures.map((fixture) =>
            expect.objectContaining({
              file: fixture.file,
              pattern: 'legacy_codex_session_snapshot',
            }),
          ),
        ),
      );
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
          "  @Post('development-plans/:developmentPlanId/items/:itemId/boundary-brainstorming/restart')",
          '  restartBoundaryBrainstorming() {',
          "    return this.legacyEntrypointDisabled('boundary-brainstorming-restart');",
          '  }',
          '  private legacyEntrypointDisabled(operation: string): never {',
          "    throw new DomainError('workflow_legacy_entrypoint_disabled', operation);",
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

  it('requires public execution-package run routes to fail closed instead of conditionally allowing legacy starts', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'forgeloop-run-package-fail-closed-'));
    try {
      const serviceDir = join(tempRoot, 'apps/control-plane-api/src/modules/run-control');
      mkdirSync(serviceDir, { recursive: true });
      writeFileSync(
        join(serviceDir, 'run-control.service.ts'),
        [
          'export class RunControlService {',
          '  async runPackageWithRepository(repository, packageId, dto, mode) {',
          '    const executionPackage = await repository.getExecutionPackage(packageId);',
          '    await this.assertPublicRunPackageMutationAllowed(repository, executionPackage, mode);',
          '    return this.enqueueRunWithRepository(repository, executionPackage, dto);',
          '  }',
          '  private async assertPublicRunPackageMutationAllowed(repository, executionPackage, mode) {',
          '    if (executionPackage.development_plan_item_id === undefined) return;',
          '    const activeWorkflow = await repository.getActivePlanItemWorkflowByItem(executionPackage.development_plan_item_id);',
          '    if (activeWorkflow === undefined) return;',
          "    throw new DomainError('workflow_legacy_entrypoint_disabled', mode);",
          '  }',
          '}',
        ].join('\n'),
      );

      expect(publicRunPackageGuardInvariant(tempRoot)).toEqual([
        'runPackageWithRepository legacy execution package start helper is still present',
        'assertPublicRunPackageMutationAllowed legacy execution package start helper is still present',
        'retired public execution package tombstone does not emit legacy_execution_entrypoint_disabled',
        'retired public execution package code conditionally allows legacy starts',
      ]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }

    expect(publicRunPackageGuardInvariant(repoRoot)).toEqual([]);
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

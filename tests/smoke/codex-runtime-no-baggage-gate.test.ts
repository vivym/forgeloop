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

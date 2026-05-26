import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  codexRuntimeSuperpowersNoBaggageAllowlist,
  scanCodexRuntimeSuperpowersNoBaggage,
} from '../../scripts/check-codex-runtime-superpowers-no-baggage';

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
      rootDir: new URL('../..', import.meta.url).pathname,
    });

    expect(result.violations).toEqual([]);
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

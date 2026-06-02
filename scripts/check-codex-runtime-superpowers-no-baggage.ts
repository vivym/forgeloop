import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type CodexRuntimeSuperpowersBaggagePattern =
  | 'legacy_work_items_route'
  | 'legacy_tasks_route'
  | 'legacy_plan_draft_generator'
  | 'raw_runtime_route'
  | 'host_codex_home'
  | 'exec_fallback'
  | 'codex_exec_cli'
  | 'legacy_codex_session_snapshot';

export type AllowedMatch = {
  file: string;
  pattern: CodexRuntimeSuperpowersBaggagePattern;
  owner: 'legacy-local-executor' | 'negative-test' | 'internal-runtime-storage' | 'historical-doc';
  reason: string;
  excerpt?: string;
};

export interface CodexRuntimeSuperpowersNoBaggageViolation {
  file: string;
  line: number;
  pattern: CodexRuntimeSuperpowersBaggagePattern;
  excerpt: string;
}

export interface CodexRuntimeSuperpowersNoBaggageScanResult {
  ok: boolean;
  violations: CodexRuntimeSuperpowersNoBaggageViolation[];
}

const defaultScanFiles = [
  'package.json',
  'docs/runbooks/codex-remote-worker-runtime.md',
  'scripts/codex-runtime-superpowers-dogfood.ts',
  'scripts/codex-runtime-import.ts',
  'scripts/codex-runtime-dogfood-bootstrap.ts',
  'scripts/codex-remote-worker-dogfood.ts',
  'apps/control-plane-api/src/modules/brainstorming/brainstorming.controller.ts',
  'apps/control-plane-api/src/modules/brainstorming/brainstorming.service.ts',
  'apps/control-plane-api/src/modules/spec-plan/spec-plan.controller.ts',
  'apps/control-plane-api/src/modules/spec-plan/spec-plan.service.ts',
  'apps/control-plane-api/src/modules/executions/executions.controller.ts',
  'apps/control-plane-api/src/modules/executions/executions.service.ts',
  'apps/control-plane-api/src/modules/codex-runtime/codex-runtime.dto.ts',
  'apps/control-plane-api/src/modules/codex-runtime/codex-runtime.controller.ts',
  'apps/control-plane-api/src/modules/codex-runtime/codex-runtime.service.ts',
  'apps/control-plane-api/src/modules/codex-runtime/product-generation-runtime-scheduler.service.ts',
  'apps/control-plane-api/src/modules/run-control/run-control.module.ts',
  'packages/codex-runtime/src/payloads.ts',
  'packages/codex-runtime/src/runtime.ts',
  'packages/codex-runtime/src/types.ts',
  'packages/codex-worker-runtime/src/remote-worker-client.ts',
  'packages/run-worker/src/run-worker.ts',
  'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
  'tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts',
];
const defaultScanRoots = [
  'scripts',
  'packages/codex-runtime',
  'packages/codex-worker-runtime',
  'packages/workflow',
  'packages/run-worker',
  'apps/control-plane-api/src/modules',
  'docs/runbooks',
  'docs/superpowers/reports',
  'tests',
];
const legacyCodexSessionSnapshotScanRoots = [
  'packages/domain',
  'packages/contracts',
  'packages/db/src',
];
const scanExtensions = new Set(['.ts', '.tsx', '.md', '.json']);
const ignoredHistoricalPathFragments = [
  'scripts/dogfood/strict-local-codex.ts',
  'scripts/dogfood/release-flow-core.ts',
  'scripts/delivery-local-codex-dogfood.ts',
  'scripts/delivery-dogfood-work-items.ts',
  'tests/executor/',
  'tests/executor-gateway/',
  'tests/run-worker/',
  'tests/api/work-items.test.ts',
  'tests/api/delivery-flow.test.ts',
  'tests/api/automation-daemon.integration.test.ts',
  'tests/api/local-codex-routing.test.ts',
  'tests/api/task-scoped-evidence.test.ts',
  'tests/smoke/delivery-local-codex-dogfood-script.test.ts',
  'tests/smoke/release-flow-dogfood-script.test.ts',
  'tests/contracts/markdown-document.test.ts',
  'tests/web/project-management-routes.test.tsx',
  'tests/e2e/web-product-routes.e2e.test.ts',
];
const activeStrictScripts = new Set([
  'scripts/check-codex-runtime-superpowers-no-baggage.ts',
  'scripts/check-runbook-scripts.ts',
  'scripts/codex-runtime-superpowers-dogfood.ts',
  'scripts/codex-runtime-import.ts',
  'scripts/codex-runtime-dogfood-bootstrap.ts',
  'scripts/codex-remote-worker-dogfood.ts',
]);
const activeTask8Tests = new Set([
  'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
  'tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts',
  'tests/smoke/runbook-script-consistency.test.ts',
]);

export const codexRuntimeSuperpowersNoBaggageAllowlist: AllowedMatch[] = [
  {
    file: 'docs/runbooks/codex-remote-worker-runtime.md',
    pattern: 'host_codex_home',
    owner: 'historical-doc',
    reason: 'Documents local Codex files as import sources only; strict workers must not mount host Codex state.',
    excerpt: 'only inputs to the bootstrap step',
  },
  {
    file: 'docs/runbooks/codex-remote-worker-runtime.md',
    pattern: 'host_codex_home',
    owner: 'historical-doc',
    reason: 'Documents the strict worker prohibition against mounting or reading host Codex state.',
    excerpt: 'must not mount or read the worker host',
  },
  {
    file: 'scripts/codex-runtime-import.ts',
    pattern: 'host_codex_home',
    owner: 'internal-runtime-storage',
    reason: 'Import CLI may read local Codex files as setup input before centralized distribution.',
  },
  {
    file: 'scripts/codex-remote-worker-dogfood.ts',
    pattern: 'host_codex_home',
    owner: 'internal-runtime-storage',
    reason: 'Remote worker script rejects host Codex configuration in no-shared-filesystem mode.',
  },
  {
    file: 'apps/control-plane-api/src/modules/run-control/run-control.module.ts',
    pattern: 'exec_fallback',
    owner: 'legacy-local-executor',
    reason: 'Legacy run-control fallback remains outside the strict Superpowers dogfood entry point.',
  },
  {
    file: 'packages/run-worker/src/run-worker.ts',
    pattern: 'exec_fallback',
    owner: 'legacy-local-executor',
    reason: 'Legacy run-worker fallback remains outside the strict Superpowers dogfood entry point.',
  },
  {
    file: 'packages/run-worker/src/fake-codex-session-driver.ts',
    pattern: 'exec_fallback',
    owner: 'legacy-local-executor',
    reason: 'Fake local run driver keeps legacy fallback vocabulary outside strict remote dogfood execution.',
  },
  {
    file: 'packages/codex-worker-runtime/src/docker-command.ts',
    pattern: 'host_codex_home',
    owner: 'internal-runtime-storage',
    reason: 'Docker command sets container-local CODEX_HOME, not host Codex state.',
    excerpt: 'CODEX_HOME=/codex-home',
  },
  {
    file: 'packages/codex-runtime/src/runtime.ts',
    pattern: 'legacy_plan_draft_generator',
    owner: 'legacy-local-executor',
    reason: 'Legacy draft generation API remains for existing automation actions outside the new product closure path.',
  },
  {
    file: 'packages/codex-runtime/src/types.ts',
    pattern: 'legacy_plan_draft_generator',
    owner: 'legacy-local-executor',
    reason: 'Legacy draft generation type remains for existing automation actions outside the new product closure path.',
  },
  {
    file: 'packages/codex-worker-runtime/src/remote-worker-client.ts',
    pattern: 'legacy_plan_draft_generator',
    owner: 'legacy-local-executor',
    reason: 'Legacy generation dispatch remains explicit and separate from new product generation task kinds.',
  },
  {
    file: 'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
    pattern: 'legacy_work_items_route',
    owner: 'negative-test',
    reason: 'Negative test fixture proves the strict gate catches legacy Work Item route usage.',
  },
  {
    file: 'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
    pattern: 'legacy_tasks_route',
    owner: 'negative-test',
    reason: 'Negative test fixture proves the strict gate catches legacy task route usage.',
  },
  {
    file: 'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
    pattern: 'legacy_tasks_route',
    owner: 'negative-test',
    reason: 'Negative test fixture proves the strict gate catches legacy task query route usage.',
    excerpt: '/query/tasks',
  },
  {
    file: 'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
    pattern: 'legacy_tasks_route',
    owner: 'negative-test',
    reason: 'Negative test fixture proves the strict gate catches legacy task factory usage.',
    excerpt: 'createTask',
  },
  {
    file: 'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
    pattern: 'legacy_tasks_route',
    owner: 'negative-test',
    reason: 'Negative test fixture proves the strict gate catches legacy task literal usage.',
    excerpt: 'oldTask',
  },
  {
    file: 'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
    pattern: 'legacy_work_items_route',
    owner: 'negative-test',
    reason: 'Negative test fixture proves the strict gate catches legacy work item literal usage.',
    excerpt: 'oldWorkItem',
  },
  {
    file: 'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
    pattern: 'raw_runtime_route',
    owner: 'negative-test',
    reason: 'Negative test fixture proves the strict gate catches legacy plan literal usage.',
    excerpt: 'oldPlan',
  },
  {
    file: 'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
    pattern: 'raw_runtime_route',
    owner: 'negative-test',
    reason: 'Negative test fixture proves the strict gate catches source-specific direct spec and plan routes.',
    excerpt: '/requirements/',
  },
  {
    file: 'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
    pattern: 'raw_runtime_route',
    owner: 'negative-test',
    reason: 'Negative test fixture proves the strict gate catches source-specific direct spec and plan routes.',
    excerpt: '/bugs/',
  },
  {
    file: 'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
    pattern: 'raw_runtime_route',
    owner: 'negative-test',
    reason: 'Negative test fixture proves the strict gate catches source-specific direct spec and plan routes.',
    excerpt: '/tech-debt/',
  },
  {
    file: 'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
    pattern: 'raw_runtime_route',
    owner: 'negative-test',
    reason: 'Negative test fixture proves the strict gate catches source-specific direct spec and plan routes.',
    excerpt: '/initiatives/',
  },
  {
    file: 'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
    pattern: 'host_codex_home',
    owner: 'negative-test',
    reason: 'Negative test fixture proves the strict gate catches host Codex home usage.',
  },
  {
    file: 'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
    pattern: 'exec_fallback',
    owner: 'negative-test',
    reason: 'Negative test fixture proves the strict gate catches exec fallback usage.',
  },
  {
    file: 'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
    pattern: 'codex_exec_cli',
    owner: 'negative-test',
    reason: 'Negative test fixture proves the strict gate catches Codex exec CLI usage.',
  },
  {
    file: 'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
    pattern: 'legacy_codex_session_snapshot',
    owner: 'negative-test',
    reason: 'Negative test fixture proves the strict gate catches legacy Codex session snapshot vocabulary.',
  },
  {
    file: 'tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts',
    pattern: 'host_codex_home',
    owner: 'negative-test',
    reason: 'Report redaction test asserts host Codex paths never appear in public dogfood output.',
  },
  {
    file: 'tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts',
    pattern: 'legacy_tasks_route',
    owner: 'negative-test',
    reason: 'Report redaction test asserts unsafe legacy task paths are rejected from public dogfood output.',
  },
  {
    file: 'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
    pattern: 'raw_runtime_route',
    owner: 'negative-test',
    reason: 'Negative test fixture proves the strict gate catches raw runtime route helper shapes.',
    excerpt: 'rawPlanRoute',
  },
  {
    file: 'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
    pattern: 'raw_runtime_route',
    owner: 'negative-test',
    reason: 'Negative test fixture proves the strict gate catches raw runtime path helper shapes.',
    excerpt: 'rawSpecPath',
  },
  {
    file: 'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
    pattern: 'raw_runtime_route',
    owner: 'negative-test',
    reason: 'Negative test fixture proves the strict gate catches raw replay browser labels.',
    excerpt: 'replayBrowser',
  },
  {
    file: 'scripts/check-codex-runtime-superpowers-no-baggage.ts',
    pattern: 'exec_fallback',
    owner: 'internal-runtime-storage',
    reason: 'The guard must name the forbidden fallback token it scans for.',
  },
  {
    file: 'scripts/check-codex-runtime-superpowers-no-baggage.ts',
    pattern: 'host_codex_home',
    owner: 'internal-runtime-storage',
    reason: 'The guard must name the forbidden host Codex token patterns it scans for.',
  },
  {
    file: 'scripts/check-codex-runtime-superpowers-no-baggage.ts',
    pattern: 'legacy_tasks_route',
    owner: 'internal-runtime-storage',
    reason: 'The guard must name the forbidden legacy task route pattern it scans for.',
  },
  {
    file: 'scripts/check-codex-runtime-superpowers-no-baggage.ts',
    pattern: 'legacy_work_items_route',
    owner: 'internal-runtime-storage',
    reason: 'The guard must name the forbidden legacy Work Item route pattern it scans for.',
  },
  {
    file: 'scripts/codex-runtime-superpowers-dogfood.ts',
    pattern: 'host_codex_home',
    owner: 'internal-runtime-storage',
    reason: 'The strict dogfood script must name host Codex env keys so it can remove them before worker startup.',
    excerpt: "'FORGELOOP_CODEX_HOME'",
  },
  {
    file: 'scripts/codex-runtime-superpowers-dogfood.ts',
    pattern: 'host_codex_home',
    owner: 'internal-runtime-storage',
    reason: 'The strict dogfood script must name container Codex env keys so it can remove host-provided values before worker startup.',
    excerpt: "'CODEX_HOME'",
  },
];

const baggagePatterns: Record<CodexRuntimeSuperpowersBaggagePattern, RegExp[]> = {
  legacy_work_items_route: [
    /[("'`]\s*\/work-items(?:\/|\b)/,
    /\.post\(\s*["']\/work-items(?:\/|\b)/,
    /type:\s*z\.literal\(\s*['"]work_item['"]\s*\)/,
  ],
  legacy_tasks_route: [
    /\/(?:query\/)?tasks(?:\/|\b)/,
    /\bcreateTask\(/,
    /type:\s*z\.literal\(\s*['"]task['"]\s*\)/,
  ],
  legacy_plan_draft_generator: [/\bgeneratePlanDraft\b/],
  raw_runtime_route: [
    /\/(?:plans|specs|replay)(?:\/|\b)/,
    /\broute\(\s*['"](?:plans|specs|replay)['"]\s*\)/,
    /\bpath:\s*['"](?:plans|specs|replay)['"]/,
    /type:\s*z\.literal\(\s*['"]plan['"]\s*\)/,
    /\/(?:requirements|bugs|tech-debt|initiatives)\/[^"'`\s]+\/(?:spec|plan)(?:\/|\b)/,
    /(?:Execution Package|Run Session|Review Packet|Raw Replay) Browser/,
  ],
  host_codex_home: [/~\/\.codex/, /\bCODEX_HOME\b/, /\bFORGELOOP_CODEX_HOME\b/, /\bhost_config_path\b/, /\bhost_auth_path\b/],
  exec_fallback: [/\bexec_fallback\b/],
  codex_exec_cli: [/\bcodex\s+exec\b/, /\brun\(\s*["']codex["']\s*,\s*\[\s*["']exec["']/],
  legacy_codex_session_snapshot: [
    /\bCodexSessionSnapshot\b/,
    /\bcodex_session_snapshot\b/,
    /\blatest_snapshot_/,
    /\bexpected_previous_snapshot_digest\b/,
    /\boutput_snapshot_/,
    /\battempted_output_snapshot_digest\b/,
    /\bforked_from_snapshot_id\b/,
    /\bfork_point_snapshot_/,
    /\bcodex_session_snapshot_stale\b/,
    /\blatestSnapshot/,
    /\bexpectedPreviousSnapshotDigest\b/,
    /\boutputSnapshot/,
    /\battemptedOutputSnapshotDigest\b/,
    /\bforkedFromSnapshotId\b/,
    /\bforkPointSnapshot/,
    /\bcodexSessionSnapshots\b/,
    /\bcreateCodexSessionSnapshot\b/,
    /\bgetCodexSessionSnapshot\b/,
    /\bgetLatestSnapshot\b/,
    /\/codex-sessions\/[^'"]+\/snapshots/,
    /:sessionId\/snapshots/,
  ],
};

const fileExtension = (file: string): string => {
  const dot = file.lastIndexOf('.');
  return dot < 0 ? '' : file.slice(dot);
};

const isIgnoredHistoricalPath = (file: string, pattern: CodexRuntimeSuperpowersBaggagePattern): boolean =>
  file.includes('/node_modules/') ||
  (pattern !== 'legacy_codex_session_snapshot' &&
    (ignoredHistoricalPathFragments.some((fragment) => file === fragment || file.includes(fragment)) ||
      (file.startsWith('scripts/') && !activeStrictScripts.has(file)) ||
      (file.startsWith('tests/') && !activeTask8Tests.has(file)) ||
      (file.startsWith('docs/superpowers/reports/') && !file.includes('codex-runtime-superpowers'))));

const collectFilesUnder = (rootDir: string, relativePath: string): string[] => {
  const absolutePath = join(rootDir, relativePath);
  if (!existsSync(absolutePath)) {
    return [];
  }
  const stat = statSync(absolutePath);
  if (stat.isFile()) {
    return scanExtensions.has(fileExtension(relativePath)) && !relativePath.includes('/node_modules/') ? [relativePath] : [];
  }
  if (!stat.isDirectory()) {
    return [];
  }
  return readdirSync(absolutePath)
    .flatMap((entry) => collectFilesUnder(rootDir, join(relativePath, entry)))
    .filter((file) => !file.includes('/node_modules/'));
};

const isAllowed = (input: {
  file: string;
  pattern: CodexRuntimeSuperpowersBaggagePattern;
  line: string;
  allowlist: AllowedMatch[];
}): boolean =>
  (input.pattern === 'legacy_codex_session_snapshot' &&
    input.file.split('/').slice(0, 3).join(':') === 'docs:superpowers:specs' &&
    /supersedes|superseded|legacy|old|prior|previous/.test(input.line)) ||
  input.allowlist.some(
    (entry) =>
      entry.file === input.file &&
      entry.pattern === input.pattern &&
      (entry.excerpt === undefined || input.line.includes(entry.excerpt)),
  );

const patternsForFile = (
  file: string,
): Array<[CodexRuntimeSuperpowersBaggagePattern, RegExp[]]> => {
  const patterns = Object.entries(baggagePatterns) as Array<[CodexRuntimeSuperpowersBaggagePattern, RegExp[]]>;
  if (legacyCodexSessionSnapshotScanRoots.some((root) => file === root || file.startsWith(`${root}/`))) {
    return patterns.filter(([pattern]) => pattern === 'legacy_codex_session_snapshot');
  }
  return patterns;
};

const scanFile = (input: {
  rootDir: string;
  file: string;
  allowlist: AllowedMatch[];
}): CodexRuntimeSuperpowersNoBaggageViolation[] => {
  const absolutePath = join(input.rootDir, input.file);
  if (!existsSync(absolutePath)) {
    return [];
  }

  const content = readFileSync(absolutePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const violations: CodexRuntimeSuperpowersNoBaggageViolation[] = [];
  for (const [lineIndex, line] of lines.entries()) {
    for (const [pattern, expressions] of patternsForFile(input.file)) {
      if (isIgnoredHistoricalPath(input.file, pattern)) {
        continue;
      }
      if (expressions.some((expression) => expression.test(line))) {
        if (!isAllowed({ file: input.file, pattern, line, allowlist: input.allowlist })) {
          violations.push({
            file: input.file,
            line: lineIndex + 1,
            pattern,
            excerpt: line.trim(),
          });
        }
      }
    }
  }
  return violations;
};

export const scanCodexRuntimeSuperpowersNoBaggage = (input: {
  rootDir?: string;
  files?: string[];
  allowlist?: AllowedMatch[];
}): CodexRuntimeSuperpowersNoBaggageScanResult => {
  const rootDir = resolve(input.rootDir ?? process.cwd());
  const defaultFiles = [
    ...defaultScanFiles,
    ...defaultScanRoots.flatMap((scanRoot) => collectFilesUnder(rootDir, scanRoot)),
    ...legacyCodexSessionSnapshotScanRoots.flatMap((scanRoot) => collectFilesUnder(rootDir, scanRoot)),
  ];
  const files = Array.from(
    new Set(
      (input.files ?? defaultFiles).map((file) => relative(rootDir, resolve(rootDir, file))),
    ),
  ).sort();
  const allowlist = input.allowlist ?? codexRuntimeSuperpowersNoBaggageAllowlist;
  const violations = files.flatMap((file) => scanFile({ rootDir, file, allowlist }));
  return { ok: violations.length === 0, violations };
};

const main = (): number => {
  const result = scanCodexRuntimeSuperpowersNoBaggage({});
  if (result.ok) {
    console.log('Codex runtime Superpowers strict lane has no unowned baggage matches.');
    return 0;
  }

  console.error('Codex runtime Superpowers strict lane has unowned baggage matches:');
  for (const violation of result.violations) {
    console.error(`- ${violation.file}:${violation.line} ${violation.pattern}`);
  }
  return 1;
};

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = main();
}

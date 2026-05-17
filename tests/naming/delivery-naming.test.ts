import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const roots = ['apps', 'packages', 'scripts', 'tests', 'docs', 'package.json'];
const oldPriority = 'P' + '0';
const oldRoute = 'p' + '0';
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
  `docs/superpowers/reports/${oldRoute}-p1-closure-report.md`,
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
]);
const activeMigrationFiles = new Set([
  'docs/superpowers/specs/2026-05-16-delivery-boundary-and-role-workbench-design.md',
  'docs/superpowers/plans/2026-05-16-delivery-boundary-and-role-workbench.md',
]);
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
      const content = withoutAllowedOldRouteAssertions(rel, readFileSync(file, 'utf8')).replace(priorityLiteral, '');
      if (historicalFiles.has(rel)) {
        if (!content.startsWith(`${supersededHistoricalNote}\n\n`)) offenders.push(rel);
        continue;
      }
      if (activeMigrationFiles.has(rel)) continue;
      if (oldSubsystem.test(content) || oldSubsystem.test(rel)) offenders.push(rel);
      oldSubsystem.lastIndex = 0;
    }
    expect(offenders).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';

import {
  classifyStrictLocalCodexExit,
  classifyStrictLocalCodexReportStatus,
  STRICT_LOCAL_CODEX_DOGFOOD_DIRTY_ALLOWLIST_SOURCE,
  releaseStrictDirtyAllowlist,
  sanitizeStrictBlockerDetails,
  type PreflightResult,
  type StrictDirtySourceSummary,
} from '../../scripts/dogfood/strict-local-codex';

const deliveryDirtyAllowlistSource = (
  summary: StrictDirtySourceSummary,
): typeof STRICT_LOCAL_CODEX_DOGFOOD_DIRTY_ALLOWLIST_SOURCE => summary.dirty_allowlist_source;

const deliveryPreflightDirtyAllowlistSource = (
  preflight: PreflightResult,
): typeof STRICT_LOCAL_CODEX_DOGFOOD_DIRTY_ALLOWLIST_SOURCE | undefined =>
  preflight.ok ? preflight.dirtySource.dirty_allowlist_source : preflight.dirtySource?.dirty_allowlist_source;

describe('shared strict local Codex dogfood helper', () => {
  it('defines the release strict dirty allowlist as repo-relative paths', () => {
    expect(releaseStrictDirtyAllowlist).toEqual([
      'docs/superpowers/reports/p1-release-risk-radar-verification.md',
      '.superpowers/**',
    ]);
  });

  it('keeps default delivery dirty allowlist source literal typing while supporting alternate sources', () => {
    const deliverySummary: StrictDirtySourceSummary = {
      allowed_dirty_entries: [],
      blocked_dirty_entries: [],
      dirty_allowlist_source: STRICT_LOCAL_CODEX_DOGFOOD_DIRTY_ALLOWLIST_SOURCE,
    };
    const releaseSummary: StrictDirtySourceSummary<'RELEASE_STRICT_DIRTY_ALLOWLIST'> = {
      allowed_dirty_entries: [],
      blocked_dirty_entries: [],
      dirty_allowlist_source: 'RELEASE_STRICT_DIRTY_ALLOWLIST',
    };

    expect(deliveryDirtyAllowlistSource(deliverySummary)).toBe(STRICT_LOCAL_CODEX_DOGFOOD_DIRTY_ALLOWLIST_SOURCE);
    expect(
      deliveryPreflightDirtyAllowlistSource({
        ok: true,
        blockers: [],
        repoPath: '/repo',
        dirtyFiles: [],
        dirtySource: deliverySummary,
        worktreeProbePath: '/repo/.worktrees/preflight',
      }),
    ).toBe(STRICT_LOCAL_CODEX_DOGFOOD_DIRTY_ALLOWLIST_SOURCE);
    expect(releaseSummary.dirty_allowlist_source).toBe('RELEASE_STRICT_DIRTY_ALLOWLIST');
  });

  it('sanitizes blocker details before report rendering', () => {
    expect(
      sanitizeStrictBlockerDetails({
        workspace_path: '/Users/viv/projs/forgeloop/.worktrees/run-1',
        database_url: 'postgresql://user:secret@localhost:5432/db',
        allowed_dirty_entries: ['docs/superpowers/reports/p1-release-risk-radar-verification.md'],
        blocked_dirty_entries: ['/Users/viv/projs/forgeloop/README.md'],
      }),
    ).toEqual({
      redacted_detail_count: 2,
      allowed_dirty_entries: ['docs/superpowers/reports/p1-release-risk-radar-verification.md'],
      blocked_dirty_entries: ['README.md'],
    });
  });

  it('removes unsafe report-bound detail keys instead of preserving redacted values', () => {
    expect(
      sanitizeStrictBlockerDetails({
        artifact_path: '/tmp/review-packet.md',
        runtime_metadata: { workspace_path: '/repo/.worktrees/run-1' },
        stderr: 'token leaked',
        authorization: 'Bearer secret',
        api_key: 'secret',
      }),
    ).toEqual({
      redacted_detail_count: 5,
    });
  });

  it('removes nested unsafe report-bound detail keys before JSON rendering', () => {
    const sanitized = sanitizeStrictBlockerDetails({
      diagnostic: {
        runtime_metadata: { workspace_path: '/repo/.worktrees/run-1' },
        safe: 'kept',
      },
    });

    expect(JSON.stringify(sanitized)).not.toMatch(/runtime_metadata|workspace_path/);
    expect(sanitized).toEqual({
      diagnostic: {
        safe: 'kept',
        redacted_detail_count: 1,
      },
    });
  });

  it('redacts unsafe strings under safe-looking keys before report rendering', () => {
    const sanitized = sanitizeStrictBlockerDetails({
      error: 'postgresql://user:secret@localhost/db',
      diagnostic: '/Users/viv/projs/forgeloop/.worktrees/run',
      note: 'plain diagnostic message',
    });

    expect(JSON.stringify(sanitized)).not.toMatch(/postgresql|secret|localhost|\/Users|\.worktrees/);
    expect(sanitized).toEqual({
      note: 'plain diagnostic message',
      redacted_detail_count: 2,
    });
  });

  it('redacts unsafe primitive strings inside arrays under safe-looking keys', () => {
    const sanitized = sanitizeStrictBlockerDetails({
      diagnostics: [
        'safe message',
        '/Users/viv/projs/forgeloop/.worktrees/run',
        'stderr: token leaked',
        'https://example.test/artifacts/review-packet.md',
      ],
    });

    expect(JSON.stringify(sanitized)).not.toMatch(/\/Users|\.worktrees|token|https:\/\/|review-packet/);
    expect(sanitized).toEqual({
      diagnostics: ['safe message'],
      redacted_detail_count: 3,
    });
  });

  it('redacts workspace and opt absolute paths under safe-looking keys', () => {
    const sanitized = sanitizeStrictBlockerDetails({
      error: '/workspace/forgeloop/README.md',
      diagnostic: '/opt/forgeloop/README.md',
      allowed_dirty_entries: ['docs/superpowers/reports/p1-release-risk-radar-verification.md'],
    });

    expect(JSON.stringify(sanitized)).not.toMatch(/\/workspace|\/opt|forgeloop\/README/);
    expect(sanitized).toEqual({
      allowed_dirty_entries: ['docs/superpowers/reports/p1-release-risk-radar-verification.md'],
      redacted_detail_count: 2,
    });
  });

  it('keeps failed markers non-zero even when blocked reports are allowed', () => {
    expect(classifyStrictLocalCodexExit({ markers: ['FAILED'], allowBlocked: true })).toBe(1);
    expect(classifyStrictLocalCodexExit({ markers: ['BLOCKED with reason'], allowBlocked: false })).toBe(1);
    expect(classifyStrictLocalCodexExit({ markers: ['BLOCKED with reason'], allowBlocked: true })).toBe(0);
    expect(classifyStrictLocalCodexExit({ markers: ['PASSED'], allowBlocked: false })).toBe(0);
  });

  it('classifies preflight blockers as blocked and terminal evidence failures as failed', () => {
    expect(classifyStrictLocalCodexReportStatus('dangerous_mode_unconfirmed')).toBe('BLOCKED with reason');
    expect(classifyStrictLocalCodexReportStatus('missing_terminal_evidence')).toBe('FAILED');
    expect(classifyStrictLocalCodexReportStatus('missing_public_non_terminal_live_event')).toBe('FAILED');
    expect(classifyStrictLocalCodexReportStatus('local_codex_run_terminal_timeout')).toBe('FAILED');
    expect(classifyStrictLocalCodexReportStatus('public_projection_leak')).toBe('FAILED');
  });
});

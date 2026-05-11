import { describe, expect, it } from 'vitest';

import {
  assertNoUnsafeReleaseDogfoodStrings,
  renderReleaseFlowVerificationReport,
  requiredReleaseFlowReportMarkers,
  strictReleaseClosureMarkers,
} from '../../scripts/dogfood/release-flow-core';
import { requiredReleaseFlowReportMarkers as wrapperRequiredReleaseFlowReportMarkers } from '../../scripts/release-flow-dogfood';

describe('release flow dogfood script helpers', () => {
  it('exports the exact required verification report markers', () => {
    expect(requiredReleaseFlowReportMarkers).toEqual([
      'P0 delivery path',
      'Release create/link/submit',
      'Release approval or override approval',
      'Release observing/close',
      'Release cockpit query',
      'Release replay redaction',
      'Release observation backlink projection',
      'Durable local reset',
      'Strict local_codex run',
    ]);
    expect(wrapperRequiredReleaseFlowReportMarkers).toEqual(requiredReleaseFlowReportMarkers);
  });

  it('defines the strict closure markers separately from all required report markers', () => {
    expect(strictReleaseClosureMarkers).toEqual(['Durable local reset', 'Strict local_codex run']);
  });

  it('renders failed markers and blocked markers without unsafe values', () => {
    const report = renderReleaseFlowVerificationReport([
      ...requiredReleaseFlowReportMarkers.map((marker) => ({
        marker,
        status: marker === 'Durable local reset' ? 'FAILED' : marker === 'Strict local_codex run' ? 'BLOCKED with reason' : 'PASSED',
        details: ['safe detail'],
      })),
    ]);

    expect(report).toContain('Status: FAILED');
    expect(report).toContain('Status: BLOCKED with reason');
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', report)).not.toThrow();
  });

  it('serializes weird safe values without opaque stringify errors', () => {
    const circular: Record<string, unknown> = { label: 'safe' };
    circular.self = circular;

    expect(() => assertNoUnsafeReleaseDogfoodStrings('undefined report value', undefined)).not.toThrow();
    expect(() => assertNoUnsafeReleaseDogfoodStrings('function report value', () => 'safe')).not.toThrow();
    expect(() => assertNoUnsafeReleaseDogfoodStrings('symbol report value', Symbol('safe'))).not.toThrow();
    expect(() => assertNoUnsafeReleaseDogfoodStrings('bigint report value', 123n)).not.toThrow();
    expect(() => assertNoUnsafeReleaseDogfoodStrings('circular report value', circular)).not.toThrow();
  });

  it('rejects unsafe public report strings', () => {
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { path: '/Users/viv/projs/forgeloop/.worktrees/run-1' })).toThrow(
      /unsafe serialized string/,
    );
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { local_ref: '/tmp/forgeloop-executor-artifacts/review.md' })).toThrow(
      /unsafe serialized string/,
    );
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { artifact_path: '/var/folders/tmp/review.md' })).toThrow(
      /unsafe serialized string/,
    );
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { storage_uri: '/tmp/custom-artifacts/review.md' })).toThrow(
      /unsafe serialized pattern/,
    );
    expect(() =>
      assertNoUnsafeReleaseDogfoodStrings('report', {
        storage_uri: `${process.env.FORGELOOP_EXECUTOR_ARTIFACT_ROOT ?? '/tmp/codex-run'}/review.md`,
      }),
    ).toThrow(/unsafe serialized pattern/);
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { authorization: 'Bearer secret' })).toThrow(
      /unsafe serialized string/,
    );
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { access_token: 'value' })).toThrow(/unsafe serialized string/);
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { api_key: 'value' })).toThrow(/unsafe serialized string/);
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { client_secret: 'value' })).toThrow(/unsafe serialized string/);
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { accessToken: 'value' })).toThrow(/unsafe serialized string/);
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { clientSecret: 'value' })).toThrow(/unsafe serialized string/);
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { apiKey: 'value' })).toThrow(/unsafe serialized pattern/);
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { Authorization: 'Bearer value' })).toThrow(/unsafe serialized string/);
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { databaseUrl: 'postgresql://user:secret@localhost/db' })).toThrow(
      /unsafe serialized string/,
    );
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { localRef: '/home/runner/work/forgeloop/review.md' })).toThrow(
      /unsafe serialized string/,
    );
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { artifactPath: '/opt/forgeloop/artifact.md' })).toThrow(
      /unsafe serialized string/,
    );
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { rawMetadata: { ok: true } })).toThrow(/unsafe serialized string/);
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { runtimeMetadata: { ok: true } })).toThrow(/unsafe serialized string/);
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { sessionSecret: 'value' })).toThrow(/unsafe serialized string/);
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { path: 'C:\\Users\\viv\\forgeloop\\artifact.md' })).toThrow(
      /unsafe serialized pattern/,
    );
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { allowedPaths: ['README.md'] })).toThrow(/unsafe serialized string/);
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { forbiddenPaths: ['.env'] })).toThrow(/unsafe serialized string/);
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { workspace_path: '[redacted]' })).toThrow(/unsafe serialized string/);
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { workspacePath: '[redacted]' })).toThrow(/unsafe serialized string/);
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { worktree_path: '[redacted]' })).toThrow(/unsafe serialized string/);
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { worktreePath: '[redacted]' })).toThrow(/unsafe serialized string/);
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { runtime_metadata: { workspace_path: 'x' } })).toThrow(
      /unsafe serialized string/,
    );
  });
});

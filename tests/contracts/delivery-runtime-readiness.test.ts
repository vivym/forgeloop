import { describe, expect, it } from 'vitest';
import { deliveryRunReadinessResponseSchema } from '@forgeloop/contracts';

const blockedReadiness = {
  executor_type: 'local_codex',
  target_kind: 'run_execution',
  state: 'blocked',
  generated_at: '2026-05-20T00:00:00.000Z',
  blockers: [
    {
      code: 'runtime_profile_missing',
      message: 'A local Codex run execution profile must be active before this package can use local Codex.',
      severity: 'blocking',
      next_step_href: '/executions/exec-1',
    },
  ],
} as const;

describe('Delivery runtime readiness contracts', () => {
  it('accepts a public-safe blocked local Codex run response', () => {
    expect(deliveryRunReadinessResponseSchema.parse(blockedReadiness)).toEqual(blockedReadiness);
  });

  it('accepts plan blocker codes and unknown runtime state', () => {
    expect(
      deliveryRunReadinessResponseSchema.parse({
        ...blockedReadiness,
        state: 'unknown',
        blockers: [
          {
            code: 'runtime_status_unknown',
            message: 'Runtime status could not be derived.',
            severity: 'warning',
            next_step_href: '/executions/exec-1',
          },
        ],
      }),
    ).toMatchObject({ state: 'unknown', blockers: [{ code: 'runtime_status_unknown' }] });

    for (const code of [
      'runtime_profile_missing',
      'runtime_profile_invalid',
      'runtime_target_incompatible',
      'credential_binding_unconfigured',
      'credential_binding_ambiguous',
      'worker_unavailable',
      'worker_target_unsupported',
      'worker_docker_capability_mismatch',
      'worker_network_policy_mismatch',
      'package_policy_snapshot_missing',
      'package_runtime_target_incompatible',
      'runtime_status_unknown',
    ] as const) {
      expect(
        deliveryRunReadinessResponseSchema.parse({
          ...blockedReadiness,
          blockers: [{ ...blockedReadiness.blockers[0], code }],
        }).blockers[0]?.code,
      ).toBe(code);
    }
  });

  it('rejects legacy status, label, summary, and renamed blocker codes', () => {
    expect(deliveryRunReadinessResponseSchema.safeParse({ ...blockedReadiness, status: 'blocked' }).success).toBe(false);
    expect(
      deliveryRunReadinessResponseSchema.safeParse({
        ...blockedReadiness,
        blockers: [{ ...blockedReadiness.blockers[0], label: 'Old label' }],
      }).success,
    ).toBe(false);
    expect(
      deliveryRunReadinessResponseSchema.safeParse({
        ...blockedReadiness,
        blockers: [{ ...blockedReadiness.blockers[0], summary: 'Old summary' }],
      }).success,
    ).toBe(false);
    expect(
      deliveryRunReadinessResponseSchema.safeParse({
        ...blockedReadiness,
        blockers: [{ ...blockedReadiness.blockers[0], code: 'missing_run_profile' }],
      }).success,
    ).toBe(false);
  });

  it('rejects raw runtime identifiers, digests, lease metadata, local paths, and config', () => {
    const unsafeFields = [
      ['execution_package_id', 'pkg-1'],
      ['runtime_profile_id', 'profile-1'],
      ['runtime_profile_revision_id', 'profile-revision-1'],
      ['credential_binding_id', 'credential-binding-1'],
      ['credential_binding_version_id', 'credential-version-1'],
      ['worker_id', 'worker-1'],
      ['launch_lease_id', 'lease-1'],
      ['runtime_profile_digest', `sha256:${'a'.repeat(64)}`],
      ['credential_payload_digest', `sha256:${'b'.repeat(64)}`],
      ['docker_image_digest', `sha256:${'c'.repeat(64)}`],
      ['network_policy_digest', `sha256:${'d'.repeat(64)}`],
      ['lease_expires_at', '2026-05-20T00:05:00.000Z'],
      ['workspace_path', '/Users/viv/projs/forgeloop/.worktrees/pkg-1'],
      ['codex_config_toml', 'approval_policy = "never"'],
      ['raw_runtime_metadata', { runtime_profile_id: 'profile-1' }],
    ] as const;

    for (const [field, value] of unsafeFields) {
      expect(deliveryRunReadinessResponseSchema.safeParse({ ...blockedReadiness, [field]: value }).success).toBe(false);
    }
  });

  it('rejects unsafe next-step links', () => {
    expect(
      deliveryRunReadinessResponseSchema.safeParse({
        ...blockedReadiness,
        blockers: [{ ...blockedReadiness.blockers[0], next_step_href: 'file:///tmp/pkg-1' }],
      }).success,
    ).toBe(false);
    expect(
      deliveryRunReadinessResponseSchema.safeParse({
        ...blockedReadiness,
        blockers: [{ ...blockedReadiness.blockers[0], next_step_href: '/Users/viv/projs/forgeloop/pkg-1' }],
      }).success,
    ).toBe(false);
    expect(
      deliveryRunReadinessResponseSchema.safeParse({
        ...blockedReadiness,
        blockers: [{ ...blockedReadiness.blockers[0], next_step_href: '/packages/../query/secrets' }],
      }).success,
    ).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';

import {
  mutatingActionIdempotencyKey,
  projectRuntimeSnapshotIdempotencyKey,
  type MutatingActionIdentity,
  type StablePolicyObservationIdentity,
} from '../../packages/automation/src/index';

describe('automation idempotency helpers', () => {
  const base = {
    actionType: 'ensure_package_drafts',
    targetObjectType: 'plan_revision',
    targetObjectId: 'plan-revision-1',
    targetRevisionId: 'plan-revision-1:v1',
    automationScope: 'repo:project-1:repo-1',
    automationSettingsVersion: 7,
    capabilityFingerprint: 'capability-a',
    preconditionFingerprint: 'precondition-a',
    generationKey: 'default:plan-revision-1',
    policyDigest: 'policy-digest-a',
  } satisfies MutatingActionIdentity;

  const observationA = {
    repoId: 'repo-1',
    policyStatus: 'loaded',
    policyDigest: 'policy-digest-a',
    parserVersion: 'workflow-md-parser:v1',
    reasonCode: 'loaded',
  } satisfies StablePolicyObservationIdentity;

  it('builds stable mutating action keys from durable command identity', () => {
    expect(mutatingActionIdempotencyKey(base)).toBe(mutatingActionIdempotencyKey(base));
    expect(mutatingActionIdempotencyKey({ ...base, capabilityFingerprint: 'changed' })).not.toBe(
      mutatingActionIdempotencyKey(base),
    );
    expect(mutatingActionIdempotencyKey({ ...base, policyDigest: 'ignored' })).toBe(mutatingActionIdempotencyKey(base));
  });

  it('builds runtime snapshot keys from stable policy observation identity only', () => {
    expect(projectRuntimeSnapshotIdempotencyKey(observationA)).toBe(
      projectRuntimeSnapshotIdempotencyKey({ ...observationA, observedAt: '2026-05-15T00:00:01.000Z' }),
    );
    expect(projectRuntimeSnapshotIdempotencyKey({ ...observationA, policyStatus: 'parse_failed' })).not.toBe(
      projectRuntimeSnapshotIdempotencyKey(observationA),
    );
  });
});

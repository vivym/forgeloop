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

  it('canonicalizes mutating action identity field order', () => {
    const first = mutatingActionIdempotencyKey({
      actionType: base.actionType,
      targetObjectType: base.targetObjectType,
      targetObjectId: base.targetObjectId,
      targetRevisionId: base.targetRevisionId,
      automationScope: base.automationScope,
      automationSettingsVersion: base.automationSettingsVersion,
      capabilityFingerprint: base.capabilityFingerprint,
      preconditionFingerprint: base.preconditionFingerprint,
      generationKey: base.generationKey,
    });
    const reordered = mutatingActionIdempotencyKey({
      generationKey: base.generationKey,
      preconditionFingerprint: base.preconditionFingerprint,
      capabilityFingerprint: base.capabilityFingerprint,
      automationSettingsVersion: base.automationSettingsVersion,
      automationScope: base.automationScope,
      targetRevisionId: base.targetRevisionId,
      targetObjectId: base.targetObjectId,
      targetObjectType: base.targetObjectType,
      actionType: base.actionType,
    });
    const changed = mutatingActionIdempotencyKey({
      ...base,
      generationKey: 'changed',
    });

    expect(reordered).toBe(first);
    expect(changed).not.toBe(first);
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

import { createHash } from 'node:crypto';

import type { MutatingActionIdentity, StablePolicyObservationIdentity } from './types.js';

type CanonicalJsonValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue };

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

const canonicalize = (value: CanonicalJsonValue): CanonicalJsonValue => {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => (item === undefined ? null : canonicalize(item)));
  }

  const record = value as { readonly [key: string]: CanonicalJsonValue };

  return Object.keys(record)
    .sort()
    .reduce<Record<string, CanonicalJsonValue>>((accumulator, key) => {
      const item = record[key];
      if (item !== undefined) {
        accumulator[key] = canonicalize(item);
      }
      return accumulator;
    }, {});
};

export const canonicalJson = (value: CanonicalJsonValue): string => JSON.stringify(canonicalize(value));

const mutatingActionIdentityJson = (input: MutatingActionIdentity) => ({
  actionType: input.actionType,
  targetObjectType: input.targetObjectType,
  targetObjectId: input.targetObjectId,
  targetRevisionId: input.targetRevisionId,
  targetVersion: input.targetVersion,
  automationScope: input.automationScope,
  automationSettingsVersion: input.automationSettingsVersion,
  capabilityFingerprint: input.capabilityFingerprint,
  preconditionFingerprint: input.preconditionFingerprint,
  generationKey: input.generationKey,
});

const stablePolicyObservationIdentityJson = (input: StablePolicyObservationIdentity) => ({
  actionType: 'project_runtime_snapshot',
  repoId: input.repoId,
  policyStatus: input.policyStatus,
  policyDigest: input.policyDigest,
  parserVersion: input.parserVersion,
  reasonCode: input.reasonCode,
});

export const mutatingActionIdempotencyKey = (input: MutatingActionIdentity): string =>
  `automation-action:v1:${sha256(canonicalJson(mutatingActionIdentityJson(input)))}`;

export const projectRuntimeSnapshotIdempotencyKey = (input: StablePolicyObservationIdentity): string =>
  `automation-action:v1:${sha256(canonicalJson(stablePolicyObservationIdentityJson(input)))}`;

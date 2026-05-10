import { describe, expect, it } from 'vitest';

import { publicReleaseEvidenceExtraSchema } from '@forgeloop/contracts';
import type { Artifact, Decision, ObjectEvent, ReleaseEvidence, StatusHistory } from '@forgeloop/domain';
import {
  artifactRedactionReason,
  serializePublicArtifactRef,
  serializePublicDecision,
  serializePublicObjectEvent,
  serializePublicReleaseEvidence,
  serializePublicReplayEntry,
  serializePublicStatusHistory,
} from '../../packages/db/src/index';

const timestamp = '2026-05-10T00:00:00.000Z';

type ArtifactRef = Artifact['ref'];

const publicArtifact = (overrides: Partial<ArtifactRef> = {}): ArtifactRef => ({
  kind: 'diff',
  name: 'Patch',
  content_type: 'text/x-patch',
  storage_uri: 's3://forgeloop-artifacts/run-1/diff.patch',
  ...overrides,
});

const objectEvent = (overrides: Partial<ObjectEvent> = {}): ObjectEvent => ({
  id: 'event-1',
  object_type: 'work_item',
  object_id: 'work-item-1',
  event_type: 'work_item_changed',
  actor_type: 'system',
  actor_id: 'actor-1',
  reason: 'transitioned',
  metadata: { internal_payload: 'do not expose' },
  payload: {},
  created_at: timestamp,
  ...overrides,
});

const statusHistory = (overrides: Partial<StatusHistory> = {}): StatusHistory => ({
  id: 'status-1',
  object_type: 'work_item',
  object_id: 'work-item-1',
  field_name: 'status',
  from_status: 'queued',
  to_status: 'ready',
  actor_type: 'system',
  actor_id: 'actor-1',
  reason: 'advanced',
  context: {},
  created_at: timestamp,
  ...overrides,
});

const decision = (overrides: Partial<Decision> = {}): Decision => ({
  id: 'decision-1',
  object_type: 'work_item',
  object_id: 'work-item-1',
  actor_id: 'actor-1',
  decided_by_actor_id: 'actor-2',
  decision_type: 'release_approval',
  outcome: 'approved',
  decision: 'approved',
  summary: 'Approved',
  rationale: 'All checks passed.',
  evidence_refs: [{ artifact_id: 'artifact-secret' }],
  created_at: timestamp,
  ...overrides,
});

const releaseEvidence = (overrides: Partial<ReleaseEvidence> = {}): ReleaseEvidence => ({
  id: 'evidence-1',
  release_id: 'release-1',
  evidence_type: 'observation_note',
  summary: 'Observed',
  object_ref: {
    object_type: 'release',
    object_id: 'release-1',
    relationship: 'observed',
  },
  redacted: false,
  status: 'current',
  created_at: timestamp,
  created_by_actor_id: 'actor-1',
  ...overrides,
});

const hostileStrings = [
  '/Users/viv/projs/forgeloop/out.log',
  '/home/runner/out.log',
  '/workspace/app/out.log',
  '/opt/build/out.log',
  '/tmp/out.log',
  '/private/tmp/out.log',
  '/var/log/forgeloop.log',
  '/mnt/work/out.log',
  '/Volumes/work/out.log',
  'C:\\Users\\viv\\out.log',
  '\\\\server\\share\\out.log',
  'file:///Users/viv/out.log',
  'local://run/out.log',
  'artifacts/run/out.log',
  './artifacts/run/out.log',
  '../artifacts/run/out.log',
  'https://example.test/artifact?token=secret',
  'https://user:pass@example.test/object',
  'https://example.test/object#frag',
  's3://bucket/key?x=y',
  'gs://bucket/key#frag',
  'https://example.test/%2FUsers%2Fviv%2Fout.log',
];

const unsafeKeys = [
  'token',
  'accessToken',
  'access_token',
  'clientSecret',
  'client_secret',
  'authorization',
  'auth_header',
  'api_key',
  'password',
  'private_key',
];

describe('public evidence serialization', () => {
  it('classifies all artifact redaction reasons', () => {
    expect(artifactRedactionReason(publicArtifact({ kind: 'logs' }))).toBe('logs_artifact');
    expect(artifactRedactionReason(publicArtifact({ kind: 'raw_metadata' }))).toBe('raw_metadata_artifact');
    expect(artifactRedactionReason({ ...publicArtifact(), raw_ref: 'raw://secret' } as ArtifactRef & { raw_ref: string })).toBe(
      'raw_ref',
    );
    expect(artifactRedactionReason(publicArtifact({ storage_uri: undefined, local_ref: 'artifacts/run/out.log' }))).toBe(
      'local_ref_only',
    );
    expect(artifactRedactionReason(publicArtifact({ storage_uri: 'https://example.test/object?token=secret' }))).toBe(
      'unsafe_storage_uri',
    );
  });

  it('serializes strict public artifacts and rejects local, raw, and hostile references', () => {
    const serialized = serializePublicArtifactRef(
      publicArtifact({
        storage_uri: 'https://example.test/object',
        local_ref: 'artifacts/run/local.patch',
        digest: 'sha256:abc',
      }),
    );

    expect(serialized).toEqual({
      kind: 'diff',
      name: 'Patch',
      content_type: 'text/x-patch',
      storage_uri: 'https://example.test/object',
      digest: 'sha256:abc',
    });
    expect(serialized).not.toHaveProperty('local_ref');

    expect(serializePublicArtifactRef(publicArtifact({ storage_uri: 'https://example.test/object?token=secret' }))).toBeUndefined();
    expect(serializePublicArtifactRef(publicArtifact({ kind: 'logs', storage_uri: 's3://bucket/logs.txt' }))).toBeUndefined();

    for (const hostileString of hostileStrings) {
      expect(serializePublicArtifactRef(publicArtifact({ storage_uri: hostileString }))).toBeUndefined();
    }
  });

  it('sanitizes artifact metadata strings before serialization', () => {
    expect(serializePublicArtifactRef(publicArtifact({ name: '/Users/viv/projs/forgeloop/out.log' }))).toBeUndefined();
    expect(serializePublicArtifactRef(publicArtifact({ content_type: '/tmp/out.log' }))).toBeUndefined();

    expect(serializePublicArtifactRef(publicArtifact({ digest: 'file:///Users/viv/out.log' }))).toEqual({
      kind: 'diff',
      name: 'Patch',
      content_type: 'text/x-patch',
      storage_uri: 's3://forgeloop-artifacts/run-1/diff.patch',
    });
  });

  it('omits decision evidence refs', () => {
    const serialized = serializePublicDecision(decision());

    expect(serialized).toEqual({
      id: 'decision-1',
      object_type: 'work_item',
      object_id: 'work-item-1',
      actor_id: 'actor-1',
      decided_by_actor_id: 'actor-2',
      decision_type: 'release_approval',
      outcome: 'approved',
      decision: 'approved',
      summary: 'Approved',
      rationale: 'All checks passed.',
      created_at: timestamp,
    });
    expect(serialized).not.toHaveProperty('evidence_refs');
  });

  it('sanitizes object event payloads without throwing on bad stored values', () => {
    const event = serializePublicObjectEvent(
      objectEvent({
        payload: {
          work_item_id: 'work-item-1',
          required_check_ids: ['contracts', 123, 'api'],
          missing_artifact_kinds: ['diff', 'logs', 'review_packet', 123],
          workflow_only: true,
          previous_value: { nested: 'not allowed here' },
          token_count: 2,
          secretary_note: 'allowed near miss but not an event field',
          secret: 'drop',
          output_path: '/Users/viv/out.log',
          unknown: 'drop',
          nested: { path: '/workspace/app/out.log', token: 'secret' },
        },
      }),
    );

    expect(event.payload).toEqual({
      work_item_id: 'work-item-1',
      workflow_only: true,
      required_check_ids: ['contracts', 'api'],
      missing_artifact_kinds: ['diff', 'review_packet'],
    });
    expect(event).not.toHaveProperty('metadata');
    expect(JSON.stringify(event)).not.toContain('secret');
    expect(JSON.stringify(event)).not.toContain('/Users/');
    expect(JSON.stringify(event)).not.toContain('/workspace/');
  });

  it('sanitizes status history contexts and filters invalid arrays', () => {
    const history = serializePublicStatusHistory(
      statusHistory({
        context: {
          work_item_id: 'work-item-1',
          actor_id: 'actor-1',
          required_check_ids: ['contracts', 0, 'api'],
          missing_artifact_kinds: ['diff', 'logs', 'self_review', null],
          previous_value: 'queued',
          next_value: '/private/tmp/out.log',
          token_count: 2,
          secretary_note: 'allowed near miss but not a context field',
          api_key: 'secret',
          unknown: 'drop',
          nested: { password: 'secret' },
        },
      }),
    );

    expect(history.context).toEqual({
      work_item_id: 'work-item-1',
      actor_id: 'actor-1',
      previous_value: 'queued',
      required_check_ids: ['contracts', 'api'],
      missing_artifact_kinds: ['diff', 'self_review'],
    });
    expect(JSON.stringify(history)).not.toContain('secret');
    expect(JSON.stringify(history)).not.toContain('/private/tmp/');
  });

  it('sanitizes all release evidence extra groups and preserves safe fields', () => {
    const unsafeArtifact = publicArtifact({ storage_uri: 'https://example.test/object#frag' });
    const serialized = serializePublicReleaseEvidence({
      evidence: releaseEvidence({
        artifact_id: 'artifact-unsafe',
        extra: {
          observation: {
            source: 'script',
            severity: 'warning',
            summary: 'Latency increased',
            observed_at: timestamp,
            actor_id: 'actor-1',
            links: [
              { object_type: 'release', object_id: 'release-1', relationship: 'observed' },
              { object_type: 'secret_object', object_id: 'secret', relationship: 'raw' },
            ],
            metrics: {
              latency_ms: 250,
              healthy: true,
              token_count: 3,
              secretary_note: 'near miss',
              ...Object.fromEntries(unsafeKeys.map((key) => [key, 'drop'])),
              output_path: '/Users/viv/projs/forgeloop/out.log',
              complex: { not: 'a public metric' },
            },
            notes: 'Public note',
            raw_payload: 'drop',
          },
          deployment: {
            environment: 'production',
            result: 'succeeded',
            deployment_id: 'deploy-1',
            target: 'web',
            version: 'v1',
            started_at: timestamp,
            completed_at: timestamp,
            actor_id: 'actor-1',
            notes: 'Deployed',
            token: 'drop',
          },
          rollback: {
            result: 'not_required',
            reason: 'No rollback needed',
            rollback_id: 'rollback-1',
            target: 'web',
            started_at: timestamp,
            completed_at: timestamp,
            actor_id: 'actor-1',
            notes: 'No action',
            output_path: '/tmp/out.log',
          },
          build: {
            build_id: 'build-1',
            version: 'v1',
            commit_sha: 'abc123',
            source_branch: 'main',
            result: 'succeeded',
            started_at: timestamp,
            completed_at: timestamp,
            artifact_id: 'build-artifact',
            artifact: unsafeArtifact,
          },
          check_refs: [
            {
              check_id: 'contracts',
              status: 'succeeded',
              summary: 'Passed',
              artifact_id: 'check-artifact',
              artifact: publicArtifact({ kind: 'check_output', storage_uri: 'gs://bucket/stdout.txt' }),
            },
            {
              check_id: 'api',
              status: 'failed',
              artifact_id: 'unsafe-check-artifact',
              artifact: unsafeArtifact,
            },
            {
              check_id: '',
              status: 'succeeded',
            },
          ],
          invalid_group: { token: 'drop' },
          bad_deployment: { environment: 'prod', result: 'not-a-result' },
        },
      }),
      artifact: unsafeArtifact,
    });

    expect(serialized.artifact_id).toBe('artifact-unsafe');
    expect(serialized).not.toHaveProperty('artifact');
    expect(serialized.extra).toEqual({
      observation: {
        source: 'script',
        severity: 'warning',
        summary: 'Latency increased',
        observed_at: timestamp,
        actor_id: 'actor-1',
        links: [{ object_type: 'release', object_id: 'release-1', relationship: 'observed' }],
        metrics: {
          latency_ms: 250,
          healthy: true,
          token_count: 3,
          secretary_note: 'near miss',
        },
        notes: 'Public note',
      },
      deployment: {
        environment: 'production',
        result: 'succeeded',
        deployment_id: 'deploy-1',
        target: 'web',
        version: 'v1',
        started_at: timestamp,
        completed_at: timestamp,
        actor_id: 'actor-1',
        notes: 'Deployed',
      },
      rollback: {
        result: 'not_required',
        reason: 'No rollback needed',
        rollback_id: 'rollback-1',
        target: 'web',
        started_at: timestamp,
        completed_at: timestamp,
        actor_id: 'actor-1',
        notes: 'No action',
      },
      build: {
        build_id: 'build-1',
        version: 'v1',
        commit_sha: 'abc123',
        source_branch: 'main',
        result: 'succeeded',
        started_at: timestamp,
        completed_at: timestamp,
        artifact_id: 'build-artifact',
      },
      check_refs: [
        {
          check_id: 'contracts',
          status: 'succeeded',
          summary: 'Passed',
          artifact_id: 'check-artifact',
          artifact: {
            kind: 'check_output',
            name: 'Patch',
            content_type: 'text/x-patch',
            storage_uri: 'gs://bucket/stdout.txt',
          },
        },
        {
          check_id: 'api',
          status: 'failed',
          artifact_id: 'unsafe-check-artifact',
        },
      ],
    });
    expect(JSON.stringify(serialized)).not.toContain('"token":"drop"');
    expect(JSON.stringify(serialized)).not.toContain('api_key');
    expect(JSON.stringify(serialized)).not.toContain('private_key');
    expect(JSON.stringify(serialized)).not.toContain('/Users/');
    expect(JSON.stringify(serialized)).not.toContain('/tmp/');
  });

  it('preserves release observation links for public backlinks', () => {
    const links = [
      { object_type: 'release', object_id: 'release-1', relationship: 'observed' },
      { object_type: 'artifact', object_id: 'artifact-1', relationship: 'generated_by' },
      { object_type: 'decision', object_id: 'decision-1', relationship: 'rollback_of' },
    ] as const;

    const serialized = serializePublicReleaseEvidence({
      evidence: releaseEvidence({
        extra: {
          observation: {
            source: 'script',
            severity: 'info',
            summary: 'Release has public evidence backlinks.',
            observed_at: timestamp,
            links,
          },
        },
      }),
    });

    expect(serialized.extra.observation?.links).toEqual(links);
  });

  it('drops legacy related object refs while the public extra schema rejects them', () => {
    const serialized = serializePublicReleaseEvidence({
      evidence: releaseEvidence({
        extra: {
          observation: {
            source: 'human',
            severity: 'warning',
            summary: 'Legacy backlinks should not leak.',
            observed_at: timestamp,
            links: [{ object_type: 'release', object_id: 'release-1', relationship: 'observed' }],
            related_object_refs: [
              { object_type: 'decision', object_id: 'decision-1', relationship: 'rollback_of' },
            ],
          },
        } as ReleaseEvidence['extra'],
      }),
    });

    expect(serialized.extra.observation).toEqual({
      source: 'human',
      severity: 'warning',
      summary: 'Legacy backlinks should not leak.',
      observed_at: timestamp,
      links: [{ object_type: 'release', object_id: 'release-1', relationship: 'observed' }],
    });
    expect(JSON.stringify(serialized)).not.toContain('related_object_refs');
    expect(
      publicReleaseEvidenceExtraSchema.safeParse({
        observation: {
          source: 'human',
          severity: 'warning',
          summary: 'Legacy backlinks should not leak.',
          observed_at: timestamp,
          related_object_refs: [
            { object_type: 'decision', object_id: 'decision-1', relationship: 'rollback_of' },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it('uses an Artifact input ref when serializing release evidence', () => {
    const artifact: Artifact = {
      id: 'artifact-1',
      object_type: 'release',
      object_id: 'release-1',
      ref: publicArtifact({ kind: 'execution_summary', storage_uri: 's3://bucket/summary.json' }),
      created_at: timestamp,
    };

    expect(serializePublicReleaseEvidence({ evidence: releaseEvidence({ artifact_id: artifact.id }), artifact })).toMatchObject({
      artifact_id: 'artifact-1',
      artifact: {
        kind: 'execution_summary',
        storage_uri: 's3://bucket/summary.json',
      },
      extra: {},
    });
  });

  it('drops unknown release object ref fields while preserving the valid object ref', () => {
    expect(
      serializePublicReleaseEvidence({
        evidence: releaseEvidence({
          object_ref: {
            object_type: 'work_item',
            object_id: 'work-item-1',
            relationship: 'supports',
            raw_payload: { token: 'drop' },
          } as ReleaseEvidence['object_ref'] & { raw_payload: unknown },
        }),
      }).object_ref,
    ).toEqual({
      object_type: 'work_item',
      object_id: 'work-item-1',
      relationship: 'supports',
    });
  });

  it('enforces replay source and payload pairing', () => {
    const releaseEntry = serializePublicReplayEntry({
      id: 'entry-release-evidence',
      source: 'release_evidence',
      object_type: 'release',
      object_id: 'release-1',
      summary: 'Evidence captured',
      created_at: timestamp,
      payload: {
        evidence: releaseEvidence(),
        artifact: publicArtifact({ storage_uri: 's3://bucket/evidence.txt' }),
      },
    });

    expect(releaseEntry).toMatchObject({
      source: 'release_evidence',
      payload: {
        id: 'evidence-1',
        artifact: {
          storage_uri: 's3://bucket/evidence.txt',
        },
      },
    });

    expect(() =>
      serializePublicReplayEntry({
        id: 'entry-mismatch',
        source: 'decision',
        object_type: 'artifact',
        object_id: 'artifact-1',
        summary: 'Artifact',
        created_at: timestamp,
        payload: publicArtifact(),
      } as never),
    ).toThrow();
  });

  it('throws a clear non-leaking error for unsafe artifact replay payloads', () => {
    let thrown: unknown;

    try {
      serializePublicReplayEntry({
        id: 'entry-unsafe-artifact',
        source: 'artifact',
        object_type: 'artifact',
        object_id: 'artifact-1',
        summary: 'Artifact',
        created_at: timestamp,
        payload: publicArtifact({
          name: '/Users/viv/projs/forgeloop/out.log',
          storage_uri: 's3://bucket/key',
          local_ref: 'artifacts/run/out.log',
        }),
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('Unsafe public artifact replay payload');
    expect((thrown as Error).message).not.toContain('/Users/');
    expect((thrown as Error).message).not.toContain('artifacts/run/out.log');
  });
});

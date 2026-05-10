import { describe, expect, it } from 'vitest';

import {
  isLocalReferenceString,
  isPublicArtifactStorageUri,
  isUnsafePublicEvidenceKey,
  normalizePublicEvidenceKey,
  publicArtifactKindSchema,
  publicArtifactRefSchema,
  publicDecisionSchema,
  publicMetricsSchema,
  publicObjectEventPayloadSchema,
  publicObjectEventSchema,
  publicReleaseEvidenceExtraSchema,
  publicReleaseEvidenceSchema,
  publicReplayEntrySchema,
  publicStatusHistoryContextSchema,
  publicStatusHistorySchema,
} from '@forgeloop/contracts';

const timestamp = '2026-05-10T00:00:00.000Z';

const publicArtifact = {
  kind: 'diff',
  name: 'Patch',
  content_type: 'text/x-patch',
  storage_uri: 's3://forgeloop-artifacts/run-1/diff.patch',
  digest: 'sha256:abc',
};

const publicDecision = {
  id: 'decision-1',
  object_type: 'work_item',
  object_id: 'work-item-1',
  actor_id: 'actor-1',
  decided_by_actor_id: 'actor-2',
  decision_type: 'release_approval',
  outcome: 'approved',
  decision: 'approved',
  summary: 'Approved',
  rationale: 'Checks passed.',
  created_at: timestamp,
};

describe('public evidence contracts', () => {
  it('accepts a safe public artifact and rejects raw/local artifact shapes', () => {
    expect(publicArtifactKindSchema.parse('review_packet')).toBe('review_packet');
    expect(publicArtifactRefSchema.parse(publicArtifact)).toMatchObject({ kind: 'diff' });

    for (const artifact of [
      { kind: 'logs', name: 'Logs', content_type: 'text/plain', storage_uri: 's3://bucket/logs.txt' },
      { kind: 'raw_metadata', name: 'Raw', content_type: 'application/json', storage_uri: 's3://bucket/raw.json' },
      { kind: 'diff', name: 'Local', content_type: 'text/x-patch', local_ref: 'artifacts/run-1/diff.patch' },
      { kind: 'diff', name: 'Raw ref', content_type: 'text/x-patch', storage_uri: 's3://bucket/diff.patch', raw_ref: 'x' },
      { kind: 'diff', name: 'No storage', content_type: 'text/x-patch' },
      { kind: 'diff', name: 'File', content_type: 'text/x-patch', storage_uri: 'file:///Users/viv/out.patch' },
      { kind: 'diff', name: 'Local scheme', content_type: 'text/x-patch', storage_uri: 'local://run/out.patch' },
      { kind: 'diff', name: 'HTTP', content_type: 'text/x-patch', storage_uri: 'http://example.test/out.patch' },
      { kind: 'diff', name: 'Unknown', content_type: 'text/x-patch', storage_uri: 'ftp://example.test/out.patch' },
      { kind: 'diff', name: 'Relative', content_type: 'text/x-patch', storage_uri: 'artifacts/run-1/out.patch' },
      { kind: 'diff', name: 'Userinfo', content_type: 'text/x-patch', storage_uri: 'https://user:pass@example.test/out.patch' },
      { kind: 'diff', name: 'Empty HTTPS host', content_type: 'text/x-patch', storage_uri: 'https://:443/key' },
      { kind: 'diff', name: 'Whitespace HTTPS host', content_type: 'text/x-patch', storage_uri: 'https:// /key' },
      { kind: 'diff', name: 'Invalid HTTPS port', content_type: 'text/x-patch', storage_uri: 'https://example.test:bad/key' },
      { kind: 'diff', name: 'Query', content_type: 'text/x-patch', storage_uri: 'https://example.test/out.patch?token=secret' },
      { kind: 'diff', name: 'Fragment', content_type: 'text/x-patch', storage_uri: 'https://example.test/out.patch#frag' },
      { kind: 'diff', name: 'S3 query', content_type: 'text/x-patch', storage_uri: 's3://bucket/out.patch?x=y' },
      { kind: 'diff', name: 'GS fragment', content_type: 'text/x-patch', storage_uri: 'gs://bucket/out.patch#frag' },
      { kind: 'diff', name: 'Encoded local', content_type: 'text/x-patch', storage_uri: 'https://example.test/%2FUsers%2Fviv%2Fout.patch' },
      {
        kind: 'diff',
        name: 'Embedded encoded local',
        content_type: 'text/x-patch',
        storage_uri: 'https://example.test/safe/%2FUsers%2Fviv%2Fout.log',
      },
    ]) {
      expect(publicArtifactRefSchema.safeParse(artifact).success).toBe(false);
    }
  });

  it('exposes deterministic safety predicates', () => {
    expect(normalizePublicEvidenceKey('accessToken')).toBe('access_token');
    expect(normalizePublicEvidenceKey('Set-Cookie')).toBe('set_cookie');
    expect(isUnsafePublicEvidenceKey('accessToken')).toBe(true);
    expect(isUnsafePublicEvidenceKey('client_secret')).toBe(true);
    expect(isUnsafePublicEvidenceKey('serviceToken')).toBe(true);
    expect(isUnsafePublicEvidenceKey('secret_value')).toBe(true);
    expect(isUnsafePublicEvidenceKey('token_count')).toBe(false);
    expect(isUnsafePublicEvidenceKey('secretary_note')).toBe(false);

    expect(isLocalReferenceString('/Users/viv/projs/forgeloop/out.log')).toBe(true);
    expect(isLocalReferenceString('/private/tmp/out.log')).toBe(true);
    expect(isLocalReferenceString('/var/log/forgeloop.log')).toBe(true);
    expect(isLocalReferenceString('/mnt/work/out.log')).toBe(true);
    expect(isLocalReferenceString('/Volumes/work/out.log')).toBe(true);
    expect(isLocalReferenceString('/workspace/app/out.log')).toBe(true);
    expect(isLocalReferenceString('note: see /Users/viv/out.log')).toBe(true);
    expect(isLocalReferenceString('C:\\Users\\viv\\out.log')).toBe(true);
    expect(isLocalReferenceString('\\\\server\\share\\out.log')).toBe(true);
    expect(isLocalReferenceString('file:///Users/viv/out.log')).toBe(true);
    expect(isLocalReferenceString('local://run/out.log')).toBe(true);
    expect(isLocalReferenceString('artifacts/run/out.log')).toBe(true);
    expect(isLocalReferenceString('./artifacts/run/out.log')).toBe(true);
    expect(isLocalReferenceString('../artifacts/run/out.log')).toBe(true);
    expect(isLocalReferenceString('/query/replay/work_item/1')).toBe(false);

    expect(isPublicArtifactStorageUri('s3://bucket/key')).toBe(true);
    expect(isPublicArtifactStorageUri('gs://bucket/key')).toBe(true);
    expect(isPublicArtifactStorageUri('https://example.test/key')).toBe(true);
    expect(isPublicArtifactStorageUri('s3://')).toBe(false);
    expect(isPublicArtifactStorageUri('https:///key')).toBe(false);
    expect(isPublicArtifactStorageUri('https://:443/key')).toBe(false);
    expect(isPublicArtifactStorageUri('https:// /key')).toBe(false);
    expect(isPublicArtifactStorageUri('https://example.test:bad/key')).toBe(false);
    expect(isPublicArtifactStorageUri('https://example.test/has space/key')).toBe(false);
    expect(isPublicArtifactStorageUri('s3://bucket/key?x=y')).toBe(false);
    expect(isPublicArtifactStorageUri('gs://bucket/key#frag')).toBe(false);
    expect(isPublicArtifactStorageUri('https://example.test/%2FUsers%2Fviv%2Fout.log')).toBe(false);
    expect(isPublicArtifactStorageUri('https://example.test/safe/%2FUsers%2Fviv%2Fout.log')).toBe(false);
  });

  it('parses strict public decision and rejects evidence refs', () => {
    expect(publicDecisionSchema.parse(publicDecision)).toMatchObject({ decision: 'approved' });
    expect(publicDecisionSchema.safeParse({ ...publicDecision, evidence_refs: [] }).success).toBe(false);
  });

  it('rejects unknown nested public payload keys', () => {
    expect(publicObjectEventPayloadSchema.parse({ work_item_id: 'work-item-1', workflow_only: true })).toEqual({
      work_item_id: 'work-item-1',
      workflow_only: true,
    });
    expect(publicStatusHistoryContextSchema.parse({ work_item_id: 'work-item-1', previous_value: false })).toEqual({
      work_item_id: 'work-item-1',
      previous_value: false,
    });

    const objectEvent = {
      id: 'event-1',
      object_type: 'work_item',
      object_id: 'work-item-1',
      event_type: 'work_item_changed',
      payload: { work_item_id: 'work-item-1', raw_payload: 'secret' },
      created_at: timestamp,
    };
    expect(publicObjectEventSchema.safeParse(objectEvent).success).toBe(false);

    const statusHistory = {
      id: 'status-1',
      object_type: 'work_item',
      object_id: 'work-item-1',
      to_status: 'ready',
      context: { work_item_id: 'work-item-1', output_path: '/Users/viv/out.log' },
      created_at: timestamp,
    };
    expect(publicStatusHistorySchema.safeParse(statusHistory).success).toBe(false);
  });

  it('rejects unsafe release evidence metrics and unknown extra groups', () => {
    const base = {
      id: 'evidence-1',
      release_id: 'release-1',
      evidence_type: 'observation_note',
      summary: 'Observed',
      extra: {
        observation: {
          source: 'human',
          severity: 'info',
          summary: 'Looks stable',
          observed_at: timestamp,
          metrics: { latency_ms: 10 },
        },
      },
      redacted: false,
      status: 'current',
      created_at: timestamp,
    };

    expect(publicMetricsSchema.parse({ latency_ms: 10, healthy: true, note: null })).toEqual({
      latency_ms: 10,
      healthy: true,
      note: null,
    });
    expect(publicReleaseEvidenceSchema.parse(base)).toMatchObject({ id: 'evidence-1' });
    expect(
      publicReleaseEvidenceSchema.safeParse({
        ...base,
        extra: { observation: { ...base.extra.observation, metrics: { accessToken: 'secret' } } },
      }).success,
    ).toBe(false);
    expect(
      publicReleaseEvidenceSchema.safeParse({
        ...base,
        extra: { observation: { ...base.extra.observation, metrics: { output_path: '/Users/viv/out.log' } } },
      }).success,
    ).toBe(false);
    expect(publicReleaseEvidenceSchema.safeParse({ ...base, extra: { private_payload: {} } }).success).toBe(false);
  });

  it('accepts every public release evidence extra group', () => {
    const base = {
      id: 'evidence-2',
      release_id: 'release-1',
      evidence_type: 'observation_note',
      summary: 'Release evidence',
      redacted: false,
      status: 'current',
      created_at: timestamp,
    };

    const extra = {
      observation: {
        source: 'script',
        severity: 'warning',
        summary: 'Latency increased',
        observed_at: timestamp,
        actor_id: 'actor-1',
        links: [
          {
            object_type: 'release',
            object_id: 'release-1',
            relationship: 'observed',
          },
        ],
        metrics: { latency_ms: 250 },
        notes: 'Investigate if this repeats.',
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
        notes: 'Deployed.',
      },
      rollback: {
        result: 'not_required',
        reason: 'No rollback needed',
        rollback_id: 'rollback-1',
        target: 'web',
        started_at: timestamp,
        completed_at: timestamp,
        actor_id: 'actor-1',
        notes: 'No action.',
      },
      build: {
        build_id: 'build-1',
        version: 'v1',
        commit_sha: 'abc123',
        source_branch: 'main',
        result: 'succeeded',
        started_at: timestamp,
        completed_at: timestamp,
        artifact_id: 'artifact-build-1',
        artifact: {
          kind: 'diff',
          name: 'Build patch',
          content_type: 'text/x-patch',
          storage_uri: 's3://bucket/build.patch',
        },
      },
      check_refs: [
        {
          check_id: 'contracts',
          status: 'succeeded',
          summary: 'Passed',
          artifact_id: 'artifact-check-1',
          artifact: {
            kind: 'check_output',
            name: 'stdout',
            content_type: 'text/plain',
            storage_uri: 'gs://bucket/stdout.txt',
          },
        },
      ],
    };

    expect(publicReleaseEvidenceExtraSchema.parse(extra)).toMatchObject({ deployment: { result: 'succeeded' } });
    expect(publicReleaseEvidenceSchema.parse({ ...base, artifact_id: 'artifact-1', artifact: publicArtifact, extra })).toMatchObject({
      id: 'evidence-2',
    });
  });

  it('accepts a public release evidence build group without result', () => {
    expect(
      publicReleaseEvidenceSchema.parse({
        id: 'evidence-build-1',
        release_id: 'release-1',
        evidence_type: 'build',
        summary: 'Build metadata captured',
        extra: {
          build: {
            build_id: 'build-1',
            version: 'v1',
            artifact: publicArtifact,
          },
        },
        redacted: false,
        status: 'current',
        created_at: timestamp,
      }),
    ).toMatchObject({ extra: { build: { build_id: 'build-1' } } });
  });

  it('enforces replay source and payload pairing', () => {
    expect(
      publicReplayEntrySchema.parse({
        id: 'entry-1',
        source: 'decision',
        object_type: 'work_item',
        object_id: 'work-item-1',
        summary: 'Approved',
        created_at: timestamp,
        payload: publicDecision,
      }),
    ).toMatchObject({ source: 'decision' });

    expect(
      publicReplayEntrySchema.parse({
        id: 'entry-release-evidence',
        source: 'release_evidence',
        object_type: 'release',
        object_id: 'release-1',
        summary: 'Release evidence',
        created_at: timestamp,
        payload: {
          id: 'evidence-1',
          release_id: 'release-1',
          evidence_type: 'observation_note',
          summary: 'Observed',
          extra: {},
          redacted: false,
          status: 'current',
          created_at: timestamp,
        },
      }),
    ).toMatchObject({ source: 'release_evidence' });

    expect(
      publicReplayEntrySchema.safeParse({
        id: 'entry-2',
        source: 'decision',
        object_type: 'artifact',
        object_id: 'artifact-1',
        summary: 'Artifact',
        created_at: timestamp,
        payload: publicArtifact,
      }).success,
    ).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';

import { publicArtifactRefSchema } from '@forgeloop/contracts';
import {
  buildInternalArtifactRef,
  decodeInternalArtifactRefBase64Url,
  encodeInternalArtifactRefBase64Url,
  isInternalArtifactRefString,
  parseInternalArtifactRef,
  runtimeArtifactUploadProofPayload,
} from '@forgeloop/domain';

describe('internal artifact refs', () => {
  it('builds and parses canonical internal artifact refs', () => {
    const ref = buildInternalArtifactRef({
      kind: 'codex_runtime_job_artifact',
      owner_type: 'codex_runtime_job',
      owner_id: 'runtime-job-1',
      artifact_id: 'artifact-1',
    });

    expect(ref).toBe('artifact://internal/codex_runtime_job_artifact/codex_runtime_job/runtime-job-1/artifact-1');
    expect(parseInternalArtifactRef(ref)).toEqual({
      kind: 'codex_runtime_job_artifact',
      owner_type: 'codex_runtime_job',
      owner_id: 'runtime-job-1',
      artifact_id: 'artifact-1',
    });
    expect(isInternalArtifactRefString(ref)).toBe(true);
  });

  it.each([
    'codex_runtime_capsule',
    'codex_thread_state_bundle',
    'codex_memory_bundle',
    'codex_memory_delta',
    'codex_environment_manifest',
    'codex_plugin_package',
    'codex_skill_bundle',
  ] as const)('builds codex capsule component ref for %s', (kind) => {
    const ref = buildInternalArtifactRef({
      kind,
      owner_type: 'codex_session',
      owner_id: 'session-1',
      artifact_id: 'artifact-1',
    });

    expect(parseInternalArtifactRef(ref)).toEqual({
      kind,
      owner_type: 'codex_session',
      owner_id: 'session-1',
      artifact_id: 'artifact-1',
    });
  });

  it('rejects legacy codex_session_snapshot refs', () => {
    expect(() =>
      parseInternalArtifactRef('artifact://internal/codex_session_snapshot/codex_session/session-1/snapshot-1'),
    ).toThrow(/kind is invalid/);
  });

  it.each([
    'artifact://internal/codex_runtime_job_artifact/codex_runtime_job/runtime-job-1',
    'artifact://internal/codex_runtime_job_artifact/codex_runtime_job/runtime-job-1/../x',
    'artifact://internal/codex_runtime_job_artifact/codex_runtime_job/runtime-job-1/%2F',
    'artifact://internal/codex_runtime_job_artifact/codex_runtime_job/runtime-job-1/artifact-1?x=1',
    'artifact://internal/codex_runtime_job_artifact/codex_runtime_job/runtime-job-1/artifact-1#x',
    'artifact://internal/codex_runtime_job_artifact/codex_runtime_job/runtime-job-1/CAPS',
    '/tmp/local-file',
  ])('rejects unsafe ref %s', (ref) => {
    expect(() => parseInternalArtifactRef(ref)).toThrow();
    expect(isInternalArtifactRefString(ref)).toBe(false);
  });

  it('round-trips refs through base64url transport encoding', () => {
    const ref = 'artifact://internal/workspace_bundle/run_session/run-session-1/bundle-1';
    expect(decodeInternalArtifactRefBase64Url(encodeInternalArtifactRefBase64Url(ref))).toBe(ref);
  });

  it.each([
    ['padding', (encoded: string) => `${encoded}=`],
    ['newline', (encoded: string) => `${encoded}\n`],
    ['space', (encoded: string) => ` ${encoded}`],
    ['dollar', (encoded: string) => `${encoded.slice(0, -1)}$`],
    ['standard-base64 slash', (encoded: string) => `${encoded.slice(0, -1)}/`],
    ['standard-base64 plus', (encoded: string) => `${encoded.slice(0, -1)}+`],
  ])('rejects non-canonical base64url transport encoding with %s', (_name, mutate) => {
    const ref = 'artifact://internal/workspace_bundle/run_session/run-session-1/bundle-1';
    expect(() => decodeInternalArtifactRefBase64Url(mutate(encodeInternalArtifactRefBase64Url(ref)))).toThrow();
  });

  it('does not widen public artifact schemas to accept internal refs', () => {
    const publicShape = {
      kind: 'diff',
      name: 'patch.diff',
      content_type: 'text/x-diff',
      storage_uri: 'artifact://internal/codex_runtime_job_artifact/codex_runtime_job/runtime-job-1/artifact-1',
    };

    expect(publicArtifactRefSchema.safeParse(publicShape).success).toBe(false);
  });

  it('builds a stable runtime artifact upload proof payload without raw bytes', () => {
    expect(
      runtimeArtifactUploadProofPayload({
        method: 'POST',
        path: '/internal/codex-workers/worker-1/runtime-jobs/runtime-job-1/artifacts',
        worker_id: 'worker-1',
        runtime_job_id: 'runtime-job-1',
        metadata: {
          schema_version: 'codex_runtime_job_artifact_upload.v2',
          worker_session_token: 'session-1',
          nonce: 'nonce-1',
          nonce_timestamp: '2026-05-30T00:00:00.000Z',
          artifact_idempotency_key: 'artifact-key-1',
          kind: 'generated_payload',
          name: 'payload.json',
          content_type: 'application/json',
          digest: `sha256:${'a'.repeat(64)}`,
          size_bytes: '12',
          metadata_json: { schema_version: 'generated_payload_metadata.v1' },
        },
      }),
    ).toEqual({
      schema_version: 'runtime_artifact_upload_proof.v1',
      method: 'POST',
      path: '/internal/codex-workers/worker-1/runtime-jobs/runtime-job-1/artifacts',
      worker_id: 'worker-1',
      runtime_job_id: 'runtime-job-1',
      worker_session_token: 'session-1',
      nonce: 'nonce-1',
      nonce_timestamp: '2026-05-30T00:00:00.000Z',
      upload: {
        schema_version: 'codex_runtime_job_artifact_upload.v2',
        artifact_idempotency_key: 'artifact-key-1',
        kind: 'generated_payload',
        name: 'payload.json',
        content_type: 'application/json',
        digest: `sha256:${'a'.repeat(64)}`,
        size_bytes: '12',
        metadata_json: { schema_version: 'generated_payload_metadata.v1' },
      },
    });
  });
});

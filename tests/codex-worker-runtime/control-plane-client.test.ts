import { Buffer } from 'node:buffer';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { codexCanonicalDigest, runtimeArtifactUploadProofPayload } from '@forgeloop/domain';

import { CodexRuntimeControlPlaneClient } from '../../packages/codex-worker-runtime/src/control-plane-client';
import { workspaceBundleArchiveDigest } from '../../packages/codex-worker-runtime/src/workspace-bundle';

type CapturedRequest = {
  url: string;
  init: RequestInit;
};

const jsonResponse = (body: unknown = { ok: true }, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const createFetchRecorder = (responseFactory: () => Response = () => jsonResponse()) => {
  const requests: CapturedRequest[] = [];
  const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
    requests.push({ url: String(url), init: init ?? {} });
    return responseFactory();
  });
  return { fetchImpl, requests };
};

const parseRequestBody = (request: CapturedRequest): Record<string, unknown> => JSON.parse(String(request.init.body));

const expectWorkerDigest = (body: Record<string, unknown>) => {
  const { body_digest: bodyDigest, ...unsignedBody } = body;
  expect(bodyDigest).toBe(codexCanonicalDigest(unsignedBody));
};

const parseRuntimeArtifactMetadata = (request: CapturedRequest): Record<string, unknown> =>
  JSON.parse(Buffer.from(String((request.init.headers as Record<string, string>)['x-forgeloop-runtime-artifact-metadata']), 'base64url').toString('utf8'));

const tempRoots: string[] = [];

const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'forgeloop-control-plane-client-'));
  tempRoots.push(dir);
  return dir;
};

describe('CodexRuntimeControlPlaneClient', () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('signs trusted runtime job orchestration requests with exact path and raw body', async () => {
    const { fetchImpl, requests } = createFetchRecorder();
    const signed: Array<{ method: string; pathAndQuery: string; rawBody: string }> = [];
    const client = new CodexRuntimeControlPlaneClient({
      baseUrl: 'https://control.test/',
      fetchImpl,
      trustedActorHeaders: { 'x-forgeloop-actor': 'automation-daemon' },
      trustedActorSigner: (input) => {
        signed.push(input);
        return { 'x-forgeloop-signature': codexCanonicalDigest(input) };
      },
    });

    const createBody = { runtime_job_id: 'runtime-job-1', job_request_id: 'request-1' };
    await client.createRuntimeJob(createBody);
    await client.cancelRuntimeJob('runtime-job-1', {
      reason_code: 'user_requested',
      idempotency_key: 'cancel-1',
    });
    await client.recoverStaleRuntimeJobs({
      stale_before: '2026-05-23T00:00:00.000Z',
      reason_code: 'codex_runtime_job_stale',
    });
    await client.getLaunchLeaseStatus({ launchLeaseId: 'lease-1' });

    expect(requests.map((request) => [request.init.method, new URL(request.url).pathname])).toEqual([
      ['POST', '/internal/codex-runtime/runtime-jobs'],
      ['POST', '/internal/codex-runtime/runtime-jobs/runtime-job-1/cancel'],
      ['POST', '/internal/codex-runtime/runtime-jobs/recover-stale'],
      ['GET', '/internal/codex-launch-leases/lease-1/status'],
    ]);
    expect(requests[0]?.init.headers).toMatchObject({
      'x-forgeloop-actor': 'automation-daemon',
      'x-forgeloop-signature': expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    expect(signed).toEqual([
      {
        method: 'POST',
        pathAndQuery: '/internal/codex-runtime/runtime-jobs',
        rawBody: JSON.stringify(createBody),
      },
      {
        method: 'POST',
        pathAndQuery: '/internal/codex-runtime/runtime-jobs/runtime-job-1/cancel',
        rawBody: JSON.stringify({ reason_code: 'user_requested', idempotency_key: 'cancel-1' }),
      },
      {
        method: 'POST',
        pathAndQuery: '/internal/codex-runtime/runtime-jobs/recover-stale',
        rawBody: JSON.stringify({
          stale_before: '2026-05-23T00:00:00.000Z',
          reason_code: 'codex_runtime_job_stale',
        }),
      },
      {
        method: 'GET',
        pathAndQuery: '/internal/codex-launch-leases/lease-1/status',
        rawBody: '',
      },
    ]);
  });

  it('adds worker session proof, nonce, timestamp, body digest, and idempotency keys to worker POST methods', async () => {
    const { fetchImpl, requests } = createFetchRecorder();
    const client = new CodexRuntimeControlPlaneClient({
      baseUrl: 'https://control.test',
      fetchImpl,
      nonceFactory: () => 'nonce-1',
      now: () => '2026-05-23T01:02:03.000Z',
    });

    await client.refreshWorkerSession('worker-1', {
      workerSessionToken: 'session-1',
      next_session_public_key_id: 'key-2',
      next_session_public_key_algorithm: 'x25519',
      next_session_public_key_material: 'pubkey-2',
      next_session_public_key_expires_at: '2026-05-23T02:02:03.000Z',
      refresh_idempotency_key: 'refresh-1',
    });
    await client.pollRuntimeJobs('worker-1', {
      workerSessionToken: 'session-1',
      target_kinds: ['generation'],
      limit: 1,
    });
    await client.acceptRuntimeJob('worker-1', 'runtime-job-1', {
      workerSessionToken: 'session-1',
      accept_idempotency_key: 'accept-1',
      accepted_worker_session_digest: 'sha256:' + 'a'.repeat(64),
      accepted_session_public_key_id: 'key-1',
      accepted_session_epoch: 1,
    });
    await client.claimLaunchTokenEnvelope('worker-1', 'runtime-job-1', {
      workerSessionToken: 'session-1',
      envelope_id: 'envelope-1',
      claim_request_id: 'claim-1',
      accepted_worker_session_digest: 'sha256:' + 'a'.repeat(64),
      accepted_session_public_key_id: 'key-1',
      accepted_session_epoch: 1,
    });
    await client.materializeRuntimeJob('worker-1', 'runtime-job-1', {
      workerSessionToken: 'session-1',
      launch_lease_id: 'lease-1',
      launch_token: 'launch-token-secret',
      materialization_request_id: 'materialize-1',
      accepted_worker_session_digest: 'sha256:' + 'a'.repeat(64),
      accepted_session_public_key_id: 'key-1',
      accepted_session_epoch: 1,
    });
    await client.startRuntimeJob('worker-1', 'runtime-job-1', {
      workerSessionToken: 'session-1',
      start_idempotency_key: 'start-1',
      runtime_evidence_digest: 'sha256:' + 'b'.repeat(64),
      launch_materialization_digest: 'sha256:' + 'c'.repeat(64),
    });
    await client.appendRuntimeJobEvent('worker-1', 'runtime-job-1', {
      workerSessionToken: 'session-1',
      event_id: 'event-1',
      event_idempotency_key: 'event-key-1',
      event_type: 'progress',
      event_payload_json: { stage: 'started' },
      event_payload_digest: codexCanonicalDigest({ stage: 'started' }),
    });
    await client.terminalizeRuntimeJob('worker-1', 'runtime-job-1', {
      workerSessionToken: 'session-1',
      launch_lease_id: 'lease-1',
      terminal_status: 'succeeded',
      reason_code: 'completed',
      terminal_result_json: { public_summary: 'ok' },
      terminal_idempotency_key: 'terminal-1',
    });

    expect(requests.map((request) => [request.init.method, new URL(request.url).pathname])).toEqual([
      ['POST', '/internal/codex-workers/worker-1/session/refresh'],
      ['POST', '/internal/codex-workers/worker-1/runtime-jobs/poll'],
      ['POST', '/internal/codex-workers/worker-1/runtime-jobs/runtime-job-1/accepted'],
      ['POST', '/internal/codex-workers/worker-1/runtime-jobs/runtime-job-1/envelope/claim'],
      ['POST', '/internal/codex-workers/worker-1/runtime-jobs/runtime-job-1/materialize'],
      ['POST', '/internal/codex-workers/worker-1/runtime-jobs/runtime-job-1/started'],
      ['POST', '/internal/codex-workers/worker-1/runtime-jobs/runtime-job-1/events'],
      ['POST', '/internal/codex-workers/worker-1/runtime-jobs/runtime-job-1/terminal'],
    ]);

    for (const request of requests) {
      const body = parseRequestBody(request);
      expect(body).toMatchObject({
        worker_session_token: 'session-1',
        nonce: 'nonce-1',
        nonce_timestamp: '2026-05-23T01:02:03.000Z',
        body_digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      });
      expect(body).not.toHaveProperty('workerSessionToken');
      expectWorkerDigest(body);
    }
    const bodyAt = (index: number) => parseRequestBody(requests[index]!);
    expect(bodyAt(0)).toMatchObject({ refresh_idempotency_key: 'refresh-1' });
    expect(bodyAt(2)).toMatchObject({ accept_idempotency_key: 'accept-1' });
    expect(bodyAt(3)).toMatchObject({ claim_request_id: 'claim-1' });
    expect(bodyAt(4)).toMatchObject({ materialization_request_id: 'materialize-1' });
    expect(bodyAt(5)).toMatchObject({ start_idempotency_key: 'start-1' });
    expect(bodyAt(6)).toMatchObject({ event_idempotency_key: 'event-key-1' });
    expect(bodyAt(7)).toMatchObject({ terminal_idempotency_key: 'terminal-1' });
  });

  it('uploads runtime artifact bytes as octet-stream with metadata in the runtime artifact header', async () => {
    const artifactBytes = Buffer.from('{"ok":true}', 'utf8');
    const { fetchImpl, requests } = createFetchRecorder();
    const client = new CodexRuntimeControlPlaneClient({
      baseUrl: 'https://control.test',
      fetchImpl,
      nonceFactory: () => 'nonce-artifact',
      now: () => '2026-05-23T01:02:03.000Z',
    });

    await client.uploadRuntimeJobArtifact('worker-1', 'runtime-job-1', {
      workerSessionToken: 'session-1',
      artifact_idempotency_key: 'artifact-1',
      kind: 'generation_output',
      name: 'payload.json',
      content_type: 'application/json',
      digest: 'sha256:' + 'd'.repeat(64),
      size_bytes: artifactBytes.byteLength,
      metadata_json: { schema: 'test' },
      bytes: artifactBytes,
    });

    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    expect([request.init.method, new URL(request.url).pathname]).toEqual([
      'POST',
      '/internal/codex-workers/worker-1/runtime-jobs/runtime-job-1/artifacts',
    ]);
    expect(request.init.body).toEqual(artifactBytes);
    expect(request.init.headers).toMatchObject({
      'content-type': 'application/octet-stream',
      accept: 'application/json',
      'x-forgeloop-runtime-artifact-metadata': expect.any(String),
    });
    expect(request.init.headers).not.toHaveProperty('content-length');
    const metadata = parseRuntimeArtifactMetadata(request);
    const { body_digest: bodyDigest, ...unsignedMetadata } = metadata;
    expect(unsignedMetadata).toEqual({
      schema_version: 'codex_runtime_job_artifact_upload.v2',
      worker_session_token: 'session-1',
      nonce: 'nonce-artifact',
      nonce_timestamp: '2026-05-23T01:02:03.000Z',
      artifact_idempotency_key: 'artifact-1',
      kind: 'generation_output',
      name: 'payload.json',
      content_type: 'application/json',
      digest: 'sha256:' + 'd'.repeat(64),
      size_bytes: String(artifactBytes.byteLength),
      metadata_json: { schema: 'test' },
    });
    expect(bodyDigest).toBe(
      codexCanonicalDigest(
        runtimeArtifactUploadProofPayload({
          method: 'POST',
          path: '/internal/codex-workers/worker-1/runtime-jobs/runtime-job-1/artifacts',
          worker_id: 'worker-1',
          runtime_job_id: 'runtime-job-1',
          metadata: unsignedMetadata as Parameters<typeof runtimeArtifactUploadProofPayload>[0]['metadata'],
        }),
      ),
    );
  });

  it('binds worker GET proofs to the requested workload and control paths without a request body', async () => {
    const { fetchImpl, requests } = createFetchRecorder();
    const client = new CodexRuntimeControlPlaneClient({
      baseUrl: 'https://control.test',
      fetchImpl,
      nonceFactory: () => 'nonce-get',
      now: () => '2026-05-23T03:04:05.000Z',
    });

    await client.fetchRuntimeJobWorkload('worker/1', 'runtime/job/1', { workerSessionToken: 'session-1' });
    await client.getRuntimeJobControl('worker/1', 'runtime/job/1', { workerSessionToken: 'session-1' });

    expect(requests.map((request) => [request.init.method, new URL(request.url).pathname])).toEqual([
      ['GET', '/internal/codex-workers/worker%2F1/runtime-jobs/runtime%2Fjob%2F1/workload'],
      ['GET', '/internal/codex-workers/worker%2F1/runtime-jobs/runtime%2Fjob%2F1/control'],
    ]);
    for (const request of requests) {
      expect(request.init.body).toBeUndefined();
      const query = Object.fromEntries(new URL(request.url).searchParams.entries());
      expect(query).toMatchObject({
        worker_session_token: 'session-1',
        nonce: 'nonce-get',
        nonce_timestamp: '2026-05-23T03:04:05.000Z',
        body_digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      });
      expectWorkerDigest(query);
    }
  });

  it('downloads workspace bundle bytes with worker GET proof and verifies digest before writing under temp root', async () => {
    const bundleBytes = Buffer.from('workspace bundle bytes\n');
    const archiveDigest = workspaceBundleArchiveDigest(bundleBytes);
    const { fetchImpl, requests } = createFetchRecorder(
      () =>
        new Response(bundleBytes, {
          status: 200,
          headers: {
            'content-type': 'application/vnd.forgeloop.workspace-bundle',
            'content-length': String(bundleBytes.byteLength),
          },
        }),
    );
    const tempRoot = await makeTempDir();
    const client = new CodexRuntimeControlPlaneClient({
      baseUrl: 'https://control.test',
      fetchImpl,
      nonceFactory: () => 'nonce-bundle',
      now: () => '2026-05-23T05:06:07.000Z',
    });

    const result = await client.downloadWorkspaceBundle('worker/1', 'runtime/job/1', 'bundle/1', {
      workerSessionToken: 'session-1',
      tempRoot,
      expectedArchiveDigest: archiveDigest,
      maxSizeBytes: 1_000,
    });

    expect(result).toMatchObject({
      archive_digest: archiveDigest,
      size_bytes: bundleBytes.byteLength,
      content_type: 'application/vnd.forgeloop.workspace-bundle',
    });
    await expect(readFile(result.archive_path)).resolves.toEqual(bundleBytes);
    expect(requests).toHaveLength(1);
    const requestUrl = new URL(requests[0]!.url);
    expect([requests[0]!.init.method, requestUrl.pathname]).toEqual([
      'GET',
      '/internal/codex-workers/worker%2F1/runtime-jobs/runtime%2Fjob%2F1/workspace-bundle/bundle%2F1',
    ]);
    const query = Object.fromEntries(requestUrl.searchParams.entries());
    expect(query).toMatchObject({
      worker_session_token: 'session-1',
      nonce: 'nonce-bundle',
      nonce_timestamp: '2026-05-23T05:06:07.000Z',
      body_digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    expect(query).not.toHaveProperty('expectedArchiveDigest');
    expect(query).not.toHaveProperty('tempRoot');
    expectWorkerDigest(query);
  });

  it('rejects symlinked workspace bundle download directories before writing archive bytes', async () => {
    const bundleBytes = Buffer.from('workspace bundle bytes\n');
    const archiveDigest = workspaceBundleArchiveDigest(bundleBytes);
    const { fetchImpl } = createFetchRecorder(
      () =>
        new Response(bundleBytes, {
          status: 200,
          headers: { 'content-type': 'application/vnd.forgeloop.workspace-bundle' },
        }),
    );
    const tempRoot = await makeTempDir();
    const outside = await makeTempDir();
    await symlink(outside, join(tempRoot, 'workspace-bundles'));
    const client = new CodexRuntimeControlPlaneClient({
      baseUrl: 'https://control.test',
      fetchImpl,
      nonceFactory: () => 'nonce-symlink-dir',
      now: () => '2026-05-23T05:06:07.000Z',
    });

    await expect(
      client.downloadWorkspaceBundle('worker-1', 'runtime-job-1', 'bundle-1', {
        workerSessionToken: 'session-1',
        tempRoot,
        expectedArchiveDigest: archiveDigest,
      }),
    ).rejects.toThrow(/codex_control_plane_workspace_bundle_temp_root_rejected/);
    await expect(readFile(join(outside, `${archiveDigest.slice('sha256:'.length)}.bundle`))).rejects.toThrow();
  });

  it('rejects symlinked workspace bundle archive paths before writing archive bytes', async () => {
    const bundleBytes = Buffer.from('workspace bundle bytes\n');
    const archiveDigest = workspaceBundleArchiveDigest(bundleBytes);
    const { fetchImpl } = createFetchRecorder(
      () =>
        new Response(bundleBytes, {
          status: 200,
          headers: { 'content-type': 'application/vnd.forgeloop.workspace-bundle' },
        }),
    );
    const tempRoot = await makeTempDir();
    const outside = await makeTempDir();
    await mkdir(join(tempRoot, 'workspace-bundles'), { mode: 0o700 });
    await writeFile(join(outside, 'archive.bundle'), 'outside\n');
    await symlink(join(outside, 'archive.bundle'), join(tempRoot, 'workspace-bundles', `${archiveDigest.slice('sha256:'.length)}.bundle`));
    const client = new CodexRuntimeControlPlaneClient({
      baseUrl: 'https://control.test',
      fetchImpl,
      nonceFactory: () => 'nonce-symlink-file',
      now: () => '2026-05-23T05:06:07.000Z',
    });

    await expect(
      client.downloadWorkspaceBundle('worker-1', 'runtime-job-1', 'bundle-1', {
        workerSessionToken: 'session-1',
        tempRoot,
        expectedArchiveDigest: archiveDigest,
      }),
    ).rejects.toThrow(/codex_control_plane_workspace_bundle_temp_root_rejected/);
    await expect(readFile(join(outside, 'archive.bundle'), 'utf8')).resolves.toBe('outside\n');
  });

  it('keeps existing launch lease worker methods on worker proof auth without trusted actor headers', async () => {
    const { fetchImpl, requests } = createFetchRecorder();
    const client = new CodexRuntimeControlPlaneClient({
      baseUrl: 'https://control.test',
      fetchImpl,
      trustedActorHeaders: { 'x-forgeloop-actor': 'automation-daemon' },
      trustedActorSigner: () => ({ 'x-forgeloop-signature': 'trusted-signature' }),
      nonceFactory: () => 'nonce-lease',
      now: () => '2026-05-23T06:07:08.000Z',
    });

    await client.materializeLaunchLease('worker-1', 'lease-1', {
      workerSessionToken: 'session-1',
      launch_token: 'launch-token-secret',
      materialization_request_hash: 'sha256:' + 'e'.repeat(64),
    });
    await client.terminalizeLaunchLease('worker-1', 'lease-1', {
      workerSessionToken: 'session-1',
      terminal_status: 'terminal',
      reason_code: 'completed',
      idempotency_key: 'terminal-lease-1',
    });

    expect(requests.map((request) => [request.init.method, new URL(request.url).pathname])).toEqual([
      ['POST', '/internal/codex-workers/worker-1/launch-leases/lease-1/materialize'],
      ['POST', '/internal/codex-workers/worker-1/launch-leases/lease-1/terminal'],
    ]);
    for (const request of requests) {
      expect(request.init.headers).not.toMatchObject({
        'x-forgeloop-actor': expect.any(String),
        'x-forgeloop-signature': expect.any(String),
      });
      const body = parseRequestBody(request);
      expect(body).toMatchObject({
        worker_session_token: 'session-1',
        nonce: 'nonce-lease',
        nonce_timestamp: '2026-05-23T06:07:08.000Z',
        body_digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      });
      expectWorkerDigest(body);
    }
    expect(parseRequestBody(requests[0]!)).toMatchObject({
      materialization_request_hash: 'sha256:' + 'e'.repeat(64),
    });
    expect(parseRequestBody(requests[1]!)).toMatchObject({
      idempotency_key: 'terminal-lease-1',
    });
  });

  it('maps failed HTTP responses to public-safe errors without response body leakage', async () => {
    const { fetchImpl } = createFetchRecorder(() => jsonResponse({ token: 'raw-session-token', path: '/tmp/secret' }, 500));
    const client = new CodexRuntimeControlPlaneClient({
      baseUrl: 'https://control.test',
      fetchImpl,
      nonceFactory: () => 'nonce-1',
      now: () => '2026-05-23T01:02:03.000Z',
    });

    await expect(
      client.pollRuntimeJobs('worker-1', {
        workerSessionToken: 'raw-session-token',
        limit: 1,
      }),
    ).rejects.toThrow(/^codex_control_plane_request_failed:500$/);
    await expect(
      client.pollRuntimeJobs('worker-1', {
        workerSessionToken: 'raw-session-token',
        limit: 1,
      }),
    ).rejects.not.toThrow(/raw-session-token|\/tmp\/secret/);
  });
});

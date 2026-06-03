import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

import {
  codexCanonicalDigest,
  encodeInternalArtifactRefBase64Url,
  runtimeArtifactUploadProofPayload,
  type CodexRuntimeStatusProjection,
  type CodexDockerPolicy,
  type CodexEffectiveConfigAssertions,
  type CodexLaunchMaterialization,
  type CodexLaunchTarget,
  type CodexRuntimeNetworkPolicy,
  type CodexRuntimeProfileRevision,
  type CodexRuntimeResourceLimits,
  type CodexRuntimeTargetKind,
  type CodexSourceAccessMode,
  type InternalArtifactKind,
  type InternalArtifactOwnerType,
  type InternalArtifactVisibility,
} from '@forgeloop/domain';

import { workspaceBundleArchiveDigest } from './workspace-bundle.js';

const hasFilesystemCode = (error: unknown, code: string): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === code;

const rawSha256Digest = (bytes: Uint8Array): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const maybeLstat = async (path: string) => {
  try {
    return await lstat(path);
  } catch (error) {
    if (hasFilesystemCode(error, 'ENOENT')) {
      return undefined;
    }
    throw error;
  }
};

const isInsidePath = (root: string, child: string): boolean => {
  const childRelative = relative(resolve(root), resolve(child));
  return childRelative === '' || (!childRelative.startsWith('..') && !isAbsolute(childRelative));
};

const assertSafeWorkspaceBundlePath = (root: string, path: string): void => {
  if (!isInsidePath(root, path)) {
    throw new Error('codex_control_plane_workspace_bundle_temp_root_rejected');
  }
};

const ensureWorkspaceBundleDirectory = async (root: string): Promise<string> => {
  const archiveDir = resolve(join(root, 'workspace-bundles'));
  assertSafeWorkspaceBundlePath(root, archiveDir);
  const existing = await maybeLstat(archiveDir);
  if (existing === undefined) {
    await mkdir(archiveDir, { recursive: false, mode: 0o700 }).catch((error) => {
      if (!hasFilesystemCode(error, 'EEXIST')) {
        throw error;
      }
    });
  } else if (existing.isSymbolicLink() || !existing.isDirectory()) {
    throw new Error('codex_control_plane_workspace_bundle_temp_root_rejected');
  }
  const finalInfo = await maybeLstat(archiveDir);
  if (finalInfo === undefined || finalInfo.isSymbolicLink() || !finalInfo.isDirectory()) {
    throw new Error('codex_control_plane_workspace_bundle_temp_root_rejected');
  }
  const realArchiveDir = await realpath(archiveDir);
  assertSafeWorkspaceBundlePath(root, realArchiveDir);
  return realArchiveDir;
};

const writeWorkspaceBundleArchive = async (archiveDir: string, archiveDigest: string, bytes: Uint8Array): Promise<string> => {
  const archivePath = resolve(join(archiveDir, `${archiveDigest.slice('sha256:'.length)}.bundle`));
  assertSafeWorkspaceBundlePath(archiveDir, archivePath);
  const validateExisting = async (): Promise<string | undefined> => {
    const existing = await maybeLstat(archivePath);
    if (existing === undefined) {
      return undefined;
    }
    if (existing.isSymbolicLink() || !existing.isFile()) {
      throw new Error('codex_control_plane_workspace_bundle_temp_root_rejected');
    }
    const existingBytes = await readFile(archivePath);
    if (workspaceBundleArchiveDigest(existingBytes) !== archiveDigest) {
      throw new Error('codex_control_plane_workspace_bundle_temp_root_rejected');
    }
    return archivePath;
  };
  const existing = await validateExisting();
  if (existing !== undefined) {
    return existing;
  }
  const handle = await open(archivePath, 'wx', 0o600).catch(async (error) => {
    if (hasFilesystemCode(error, 'EEXIST')) {
      const racedExisting = await validateExisting();
      if (racedExisting !== undefined) {
        return undefined;
      }
    }
    throw error;
  });
  if (handle === undefined) {
    return archivePath;
  }
  try {
    await handle.writeFile(bytes);
  } finally {
    await handle.close();
  }
  return archivePath;
};

export interface CodexRuntimeControlPlaneClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  trustedActorHeaders?: Record<string, string>;
  trustedActorSigner?: (input: { method: string; pathAndQuery: string; rawBody: string }) => Record<string, string>;
  nonceFactory?: () => string;
  now?: () => string;
}

export class CodexRuntimeControlPlaneClient {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #trustedActorHeaders: Record<string, string>;
  readonly #trustedActorSigner: CodexRuntimeControlPlaneClientOptions['trustedActorSigner'];
  readonly #nonceFactory: () => string;
  readonly #now: () => string;

  constructor(options: CodexRuntimeControlPlaneClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/$/, '');
    this.#fetch = options.fetchImpl ?? fetch;
    this.#trustedActorHeaders = options.trustedActorHeaders ?? {};
    this.#trustedActorSigner = options.trustedActorSigner;
    this.#nonceFactory = options.nonceFactory ?? (() => crypto.randomUUID());
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async registerWorker(input: Record<string, unknown>): Promise<{ session_token: string; session_expires_at: string }> {
    return this.#postJson('/internal/codex-workers/register', input);
  }

  async heartbeatWorker(workerId: string, input: Record<string, unknown>): Promise<unknown> {
    return this.#postJson(`/internal/codex-workers/${encodeURIComponent(workerId)}/heartbeat`, input);
  }

  async createLaunchLease(input: Record<string, unknown>): Promise<unknown> {
    return this.#trustedPost('/internal/codex-launch-leases', input);
  }

  async revokeLaunchLease(leaseId: string, input: Record<string, unknown>): Promise<unknown> {
    return this.#trustedPost(`/internal/codex-launch-leases/${encodeURIComponent(leaseId)}/revoke`, input);
  }

  async getStatus(input: {
    projectId: string;
    repoId?: string;
    targetKind: string;
    runtimeProfileId?: string;
    credentialBindingId?: string;
  }): Promise<CodexRuntimeStatusProjection> {
    const query = new URLSearchParams({
      project_id: input.projectId,
      target_kind: input.targetKind,
    });
    if (input.repoId !== undefined) {
      query.set('repo_id', input.repoId);
    }
    if (input.runtimeProfileId !== undefined) {
      query.set('runtime_profile_id', input.runtimeProfileId);
    }
    if (input.credentialBindingId !== undefined) {
      query.set('credential_binding_id', input.credentialBindingId);
    }
    return this.#trustedGet(`/internal/codex-runtime/status?${query.toString()}`);
  }

  async createRuntimeJob(input: Record<string, unknown>): Promise<unknown> {
    return this.#trustedPost('/internal/codex-runtime/runtime-jobs', input);
  }

  async getRuntimeJob(jobId: string): Promise<unknown> {
    return this.#trustedGet(`/internal/codex-runtime/runtime-jobs/${encodeURIComponent(jobId)}`);
  }

  async cancelRuntimeJob(jobId: string, input: Record<string, unknown>): Promise<unknown> {
    return this.#trustedPost(`/internal/codex-runtime/runtime-jobs/${encodeURIComponent(jobId)}/cancel`, input);
  }

  async renewAutomationActionRunClaim(actionRunId: string, input: Record<string, unknown>): Promise<unknown> {
    return this.#trustedPost(`/internal/automation/action-runs/${encodeURIComponent(actionRunId)}/claim/renew`, input);
  }

  async recoverStaleRuntimeJobs(input: Record<string, unknown>): Promise<unknown> {
    return this.#trustedPost('/internal/codex-runtime/runtime-jobs/recover-stale', input);
  }

  async getLaunchLeaseStatus(input: { launchLeaseId?: string; launch_lease_id?: string }): Promise<unknown> {
    const leaseId = input.launchLeaseId ?? input.launch_lease_id;
    if (leaseId === undefined) {
      throw new Error('codex_control_plane_launch_lease_id_required');
    }
    return this.#trustedGet(`/internal/codex-launch-leases/${encodeURIComponent(leaseId)}/status`);
  }

  async refreshWorkerSession(workerId: string, input: WorkerRequestInput): Promise<unknown> {
    return this.#workerPost(`/internal/codex-workers/${encodeURIComponent(workerId)}/session/refresh`, input);
  }

  async pollRuntimeJobs(workerId: string, input: WorkerRequestInput): Promise<unknown> {
    return this.#workerPost(`/internal/codex-workers/${encodeURIComponent(workerId)}/runtime-jobs/poll`, input);
  }

  async acceptRuntimeJob(workerId: string, jobId: string, input: WorkerRequestInput): Promise<unknown> {
    return this.#workerPost(
      `/internal/codex-workers/${encodeURIComponent(workerId)}/runtime-jobs/${encodeURIComponent(jobId)}/accepted`,
      input,
    );
  }

  async claimLaunchTokenEnvelope(workerId: string, jobId: string, input: WorkerRequestInput): Promise<unknown> {
    return this.#workerPost(
      `/internal/codex-workers/${encodeURIComponent(workerId)}/runtime-jobs/${encodeURIComponent(jobId)}/envelope/claim`,
      input,
    );
  }

  async fetchRuntimeJobWorkload(workerId: string, jobId: string, input: WorkerRequestInput): Promise<unknown> {
    return this.#workerGet(
      `/internal/codex-workers/${encodeURIComponent(workerId)}/runtime-jobs/${encodeURIComponent(jobId)}/workload`,
      input,
    );
  }

  async materializeRuntimeJob(workerId: string, jobId: string, input: WorkerRequestInput): Promise<CodexLaunchMaterialization> {
    const response = await this.#workerPost(
      `/internal/codex-workers/${encodeURIComponent(workerId)}/runtime-jobs/${encodeURIComponent(jobId)}/materialize`,
      input,
    );
    return normalizeMaterializationResponse(response);
  }

  async startRuntimeJob(workerId: string, jobId: string, input: WorkerRequestInput): Promise<unknown> {
    return this.#workerPost(
      `/internal/codex-workers/${encodeURIComponent(workerId)}/runtime-jobs/${encodeURIComponent(jobId)}/started`,
      input,
    );
  }

  async markCodexSessionRunnerOwner(workerId: string, jobId: string, input: WorkerRequestInput): Promise<unknown> {
    return this.#workerPost(
      `/internal/codex-workers/${encodeURIComponent(workerId)}/runtime-jobs/${encodeURIComponent(jobId)}/session-runner/owner`,
      input,
    );
  }

  async attachCodexSessionRunnerRuntimeJob(workerId: string, jobId: string, input: WorkerRequestInput): Promise<unknown> {
    return this.#workerPost(
      `/internal/codex-workers/${encodeURIComponent(workerId)}/runtime-jobs/${encodeURIComponent(jobId)}/session-runner/attach`,
      input,
    );
  }

  async appendRuntimeJobEvent(workerId: string, jobId: string, input: WorkerRequestInput): Promise<unknown> {
    return this.#workerPost(
      `/internal/codex-workers/${encodeURIComponent(workerId)}/runtime-jobs/${encodeURIComponent(jobId)}/events`,
      input,
    );
  }

  async uploadRuntimeJobArtifact(workerId: string, jobId: string, input: WorkerRequestInput): Promise<unknown> {
    const requestPath = `/internal/codex-workers/${encodeURIComponent(workerId)}/runtime-jobs/${encodeURIComponent(jobId)}/artifacts`;
    const proofPath = `/internal/codex-workers/${workerId}/runtime-jobs/${jobId}/artifacts`;
    return this.#workerPostArtifact(requestPath, proofPath, workerId, jobId, input);
  }

  async uploadInternalArtifact(input: {
    kind: InternalArtifactKind;
    ownerType: InternalArtifactOwnerType;
    ownerId: string;
    visibility: InternalArtifactVisibility;
    contentType: string;
    bytes: Uint8Array;
    idempotencyKey: string;
    metadataJson?: Record<string, unknown>;
    maxSizeBytes?: number;
  }): Promise<{
    ref: string;
    kind: InternalArtifactKind;
    content_type: string;
    size_bytes: string;
    digest: string;
    visibility: InternalArtifactVisibility;
    owner_type: InternalArtifactOwnerType;
    owner_id: string;
    created_at: string;
  }> {
    const path = '/internal/artifacts:upload';
    const digest = rawSha256Digest(input.bytes);
    const metadata = {
      schema_version: 'internal_artifact_upload.v1',
      owner_type: input.ownerType,
      owner_id: input.ownerId,
      kind: input.kind,
      visibility: input.visibility,
      content_type: input.contentType,
      declared_size_bytes: String(input.bytes.byteLength),
      declared_artifact_digest: digest,
      idempotency_key: input.idempotencyKey,
      metadata_json: input.metadataJson ?? {},
      created_by_actor_type: 'codex_worker',
      created_by_actor_id: this.#trustedActorHeaders['X-Forgeloop-Actor-Id'] ?? this.#trustedActorHeaders['x-forgeloop-actor-id'] ?? 'codex-worker',
      ...(input.maxSizeBytes === undefined ? {} : { max_size_bytes: input.maxSizeBytes }),
    };
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/octet-stream',
        'x-forgeloop-artifact-metadata': Buffer.from(JSON.stringify(metadata), 'utf8').toString('base64url'),
        ...this.#trustedHeaders('POST', path, ''),
      },
      body: input.bytes,
    });
    if (!response.ok) {
      throw new Error(`codex_control_plane_request_failed:${response.status}`);
    }
    const parsed = (await response.json()) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.artifact)) {
      throw new Error('codex_control_plane_internal_artifact_response_invalid');
    }
    const artifact = parsed.artifact;
    const artifactDigest = requiredString(artifact, 'digest');
    if (artifactDigest !== digest) {
      throw new Error('codex_control_plane_internal_artifact_digest_rejected');
    }
    return {
      ref: requiredString(artifact, 'ref'),
      kind: requiredString(artifact, 'kind') as InternalArtifactKind,
      content_type: requiredString(artifact, 'content_type'),
      size_bytes: requiredString(artifact, 'size_bytes'),
      digest: artifactDigest,
      visibility: requiredString(artifact, 'visibility') as InternalArtifactVisibility,
      owner_type: requiredString(artifact, 'owner_type') as InternalArtifactOwnerType,
      owner_id: requiredString(artifact, 'owner_id'),
      created_at: requiredString(artifact, 'created_at'),
    };
  }

  async downloadInternalArtifact(input: {
    ref: string;
    expectedDigest: string;
    maxSizeBytes?: number;
  }): Promise<Uint8Array> {
    const pathAndQuery = `/internal/artifacts?ref_base64url=${encodeInternalArtifactRefBase64Url(input.ref)}`;
    const response = await this.#fetch(`${this.#baseUrl}${pathAndQuery}`, {
      method: 'GET',
      headers: {
        accept: 'application/octet-stream',
        ...this.#trustedHeaders('GET', pathAndQuery, ''),
      },
    });
    if (!response.ok) {
      throw new Error(`codex_control_plane_request_failed:${response.status}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (input.maxSizeBytes !== undefined && bytes.byteLength > input.maxSizeBytes) {
      throw new Error('codex_control_plane_internal_artifact_size_rejected');
    }
    if (rawSha256Digest(bytes) !== input.expectedDigest) {
      throw new Error('codex_control_plane_internal_artifact_digest_rejected');
    }
    return bytes;
  }

  async getRuntimeJobControl(workerId: string, jobId: string, input: WorkerRequestInput): Promise<unknown> {
    return this.#workerGet(
      `/internal/codex-workers/${encodeURIComponent(workerId)}/runtime-jobs/${encodeURIComponent(jobId)}/control`,
      input,
    );
  }

  async downloadWorkspaceBundle(
    workerId: string,
    jobId: string,
    bundleId: string,
    input: WorkerRequestInput & {
      tempRoot: string;
      expectedArchiveDigest: string;
      maxSizeBytes?: number;
    },
  ): Promise<{ archive_path: string; archive_digest: string; size_bytes: number; content_type: string }> {
    const { tempRoot, expectedArchiveDigest, maxSizeBytes, ...workerInput } = input;
    const response = await this.#workerGetBytes(
      `/internal/codex-workers/${encodeURIComponent(workerId)}/runtime-jobs/${encodeURIComponent(jobId)}/workspace-bundle/${encodeURIComponent(bundleId)}`,
      workerInput,
    );
    const contentType = response.contentType.split(';')[0]?.trim() ?? '';
    if (contentType !== 'application/vnd.forgeloop.workspace-bundle') {
      throw new Error('codex_control_plane_workspace_bundle_content_type_rejected');
    }
    if (maxSizeBytes !== undefined && response.bytes.byteLength > maxSizeBytes) {
      throw new Error('codex_control_plane_workspace_bundle_size_rejected');
    }
    const archiveDigest = workspaceBundleArchiveDigest(response.bytes);
    if (archiveDigest !== expectedArchiveDigest) {
      throw new Error('codex_control_plane_workspace_bundle_digest_rejected');
    }
    const root = await realpath(tempRoot).catch(() => {
      throw new Error('codex_control_plane_workspace_bundle_temp_root_rejected');
    });
    const archiveDir = await ensureWorkspaceBundleDirectory(root);
    const archivePath = await writeWorkspaceBundleArchive(archiveDir, archiveDigest, response.bytes);
    return {
      archive_path: archivePath,
      archive_digest: archiveDigest,
      size_bytes: response.bytes.byteLength,
      content_type: contentType,
    };
  }

  async terminalizeRuntimeJob(workerId: string, jobId: string, input: WorkerRequestInput): Promise<unknown> {
    return this.#workerPost(
      `/internal/codex-workers/${encodeURIComponent(workerId)}/runtime-jobs/${encodeURIComponent(jobId)}/terminal`,
      input,
    );
  }

  async materializeLaunchLease(workerId: string, leaseId: string, input: Record<string, unknown>): Promise<CodexLaunchMaterialization> {
    const response = await this.#workerPost(
      `/internal/codex-workers/${encodeURIComponent(workerId)}/launch-leases/${encodeURIComponent(leaseId)}/materialize`,
      input,
    );
    return normalizeMaterializationResponse(response);
  }

  async terminalizeLaunchLease(workerId: string, leaseId: string, input: Record<string, unknown>): Promise<unknown> {
    return this.#workerPost(`/internal/codex-workers/${encodeURIComponent(workerId)}/launch-leases/${encodeURIComponent(leaseId)}/terminal`, input);
  }

  materializationRequestHash(input: Record<string, unknown>): string {
    return codexCanonicalDigest(input);
  }

  async #trustedGet(pathAndQuery: string): Promise<any> {
    return this.#getJson(pathAndQuery, this.#trustedHeaders('GET', pathAndQuery, ''));
  }

  async #trustedPost(path: string, body: Record<string, unknown>): Promise<any> {
    const rawBody = JSON.stringify(body);
    return this.#postJson(path, body, this.#trustedHeaders('POST', path, rawBody));
  }

  async #workerGet(path: string, input: WorkerRequestInput): Promise<any> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(this.#workerPayload(input))) {
      query.set(key, String(value));
    }
    return this.#getJson(`${path}?${query.toString()}`);
  }

  async #workerGetBytes(path: string, input: WorkerRequestInput): Promise<{ bytes: Uint8Array; contentType: string }> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(this.#workerPayload(input))) {
      query.set(key, String(value));
    }
    const response = await this.#fetch(`${this.#baseUrl}${path}?${query.toString()}`, {
      method: 'GET',
      headers: { accept: 'application/vnd.forgeloop.workspace-bundle' },
    });
    if (!response.ok) {
      throw new Error(`codex_control_plane_request_failed:${response.status}`);
    }
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get('content-type') ?? '',
    };
  }

  async #workerPost(path: string, input: WorkerRequestInput): Promise<any> {
    return this.#postJson(path, this.#workerPayload(input));
  }

  async #workerPostArtifact(
    requestPath: string,
    proofPath: string,
    workerId: string,
    jobId: string,
    input: WorkerRequestInput,
  ): Promise<any> {
    const { bytes, ...metadataInput } = input;
    if (!(bytes instanceof Uint8Array)) {
      throw new Error('codex_control_plane_runtime_artifact_bytes_required');
    }
    const metadata = this.#workerArtifactUploadMetadata(metadataInput);
    const metadataWithDigest = {
      ...metadata,
      body_digest: codexCanonicalDigest(
        runtimeArtifactUploadProofPayload({
          method: 'POST',
          path: proofPath,
          worker_id: workerId,
          runtime_job_id: jobId,
          metadata,
        }),
      ),
    };
    const response = await this.#fetch(`${this.#baseUrl}${requestPath}`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/octet-stream',
        'x-forgeloop-runtime-artifact-metadata': Buffer.from(JSON.stringify(metadataWithDigest), 'utf8').toString('base64url'),
      },
      body: bytes,
    });
    if (!response.ok) {
      throw new Error(`codex_control_plane_request_failed:${response.status}`);
    }
    return response.json();
  }

  async #getJson(pathAndQuery: string, headers: Record<string, string> = {}): Promise<any> {
    const response = await this.#fetch(`${this.#baseUrl}${pathAndQuery}`, {
      method: 'GET',
      headers: { accept: 'application/json', ...headers },
    });
    if (!response.ok) {
      throw new Error(`codex_control_plane_request_failed:${response.status}`);
    }
    return response.json();
  }

  async #postJson(path: string, body: Record<string, unknown>, headers: Record<string, string> = {}): Promise<any> {
    const rawBody = JSON.stringify(body);
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: rawBody,
    });
    if (!response.ok) {
      throw new Error(`codex_control_plane_request_failed:${response.status}`);
    }
    return response.json();
  }

  #trustedHeaders(method: string, pathAndQuery: string, rawBody: string): Record<string, string> {
    return {
      ...this.#signedHeaders(method, pathAndQuery, rawBody),
      ...this.#trustedActorHeaders,
    };
  }

  #signedHeaders(method: string, pathAndQuery: string, rawBody: string): Record<string, string> {
    return this.#trustedActorSigner?.({ method, pathAndQuery, rawBody }) ?? {};
  }

  #workerPayload(input: WorkerRequestInput): Record<string, unknown> {
    const {
      workerSessionToken,
      worker_session_token: workerSessionTokenSnake,
      nonce,
      nonceTimestamp,
      nonce_timestamp: nonceTimestampSnake,
      body_digest: _bodyDigest,
      ...body
    } = input;
    const workerSessionTokenValue = workerSessionTokenSnake ?? workerSessionToken;
    if (typeof workerSessionTokenValue !== 'string' || workerSessionTokenValue.length === 0) {
      throw new Error('codex_control_plane_worker_session_token_required');
    }
    const nonceValue = nonce ?? this.#nonceFactory();
    if (typeof nonceValue !== 'string' || nonceValue.length === 0) {
      throw new Error('codex_control_plane_worker_nonce_required');
    }
    const nonceTimestampValue = nonceTimestampSnake ?? nonceTimestamp ?? this.#now();
    if (typeof nonceTimestampValue !== 'string' || nonceTimestampValue.length === 0) {
      throw new Error('codex_control_plane_worker_nonce_timestamp_required');
    }
    const unsignedBody = {
      worker_session_token: workerSessionTokenValue,
      nonce: nonceValue,
      nonce_timestamp: nonceTimestampValue,
      ...body,
    };
    return {
      ...unsignedBody,
      body_digest: codexCanonicalDigest(unsignedBody),
    };
  }

  #workerArtifactUploadMetadata(input: WorkerRequestInput): {
    schema_version: 'codex_runtime_job_artifact_upload.v2';
    worker_session_token: string;
    nonce: string;
    nonce_timestamp: string;
    artifact_idempotency_key: string;
    kind: string;
    name: string;
    content_type: string;
    digest: string;
    size_bytes: string;
    metadata_json: Record<string, unknown>;
  } {
    const {
      workerSessionToken,
      worker_session_token: workerSessionTokenSnake,
      nonce,
      nonceTimestamp,
      nonce_timestamp: nonceTimestampSnake,
      body_digest: _bodyDigest,
      artifact_idempotency_key: artifactIdempotencyKey,
      kind,
      name,
      content_type: contentType,
      digest,
      size_bytes: sizeBytes,
      metadata_json: metadataJson,
      ...extra
    } = input;
    if (Object.keys(extra).length > 0) {
      throw new Error('codex_control_plane_runtime_artifact_metadata_unexpected');
    }
    const workerSessionTokenValue = workerSessionTokenSnake ?? workerSessionToken;
    if (typeof workerSessionTokenValue !== 'string' || workerSessionTokenValue.length === 0) {
      throw new Error('codex_control_plane_worker_session_token_required');
    }
    const nonceValue = nonce ?? this.#nonceFactory();
    if (typeof nonceValue !== 'string' || nonceValue.length === 0) {
      throw new Error('codex_control_plane_worker_nonce_required');
    }
    const nonceTimestampValue = nonceTimestampSnake ?? nonceTimestamp ?? this.#now();
    if (typeof nonceTimestampValue !== 'string' || nonceTimestampValue.length === 0) {
      throw new Error('codex_control_plane_worker_nonce_timestamp_required');
    }
    if (typeof artifactIdempotencyKey !== 'string' || artifactIdempotencyKey.length === 0) {
      throw new Error('codex_control_plane_runtime_artifact_idempotency_key_required');
    }
    if (typeof kind !== 'string' || kind.length === 0) {
      throw new Error('codex_control_plane_runtime_artifact_kind_required');
    }
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('codex_control_plane_runtime_artifact_name_required');
    }
    if (typeof contentType !== 'string' || contentType.length === 0) {
      throw new Error('codex_control_plane_runtime_artifact_content_type_required');
    }
    if (typeof digest !== 'string' || digest.length === 0) {
      throw new Error('codex_control_plane_runtime_artifact_digest_required');
    }
    if (typeof sizeBytes !== 'number' || !Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
      throw new Error('codex_control_plane_runtime_artifact_size_required');
    }
    if (metadataJson !== undefined && !isRecord(metadataJson)) {
      throw new Error('codex_control_plane_runtime_artifact_metadata_json_required');
    }
    return {
      schema_version: 'codex_runtime_job_artifact_upload.v2',
      worker_session_token: workerSessionTokenValue,
      nonce: nonceValue,
      nonce_timestamp: nonceTimestampValue,
      artifact_idempotency_key: artifactIdempotencyKey,
      kind,
      name,
      content_type: contentType,
      digest,
      size_bytes: String(sizeBytes),
      metadata_json: metadataJson ?? {},
    };
  }
}

export type WorkerRequestInput = Record<string, unknown> & {
  workerSessionToken?: string;
  worker_session_token?: string;
  nonce?: string;
  nonceTimestamp?: string;
  nonce_timestamp?: string;
  body_digest?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const requiredString = (record: Record<string, unknown>, key: string): string => {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('codex_control_plane_response_invalid');
  }
  return value;
};

export const normalizeMaterializationResponse = (value: unknown): CodexLaunchMaterialization => {
  if (isRecord(value) && isRecord(value.runtime_profile) && isRecord(value.credential) && isRecord(value.launch_target)) {
    const runtimeProfile = value.runtime_profile;
    const credential = value.credential;
    const launchTarget = value.launch_target as unknown as CodexLaunchTarget;
    const profileRevision = {
      id: String(runtimeProfile.revision_id),
      profile_id: String(runtimeProfile.profile_id),
      revision_number: 0,
      status: 'active',
      environment: runtimeProfile.environment === 'local_dogfood' ? 'local_dogfood' : 'test',
      docker_image: String(runtimeProfile.docker_image),
      docker_image_digest: String(runtimeProfile.docker_image_digest),
      target_kind: runtimeProfile.target_kind as CodexRuntimeTargetKind,
      source_access_mode: runtimeProfile.source_access_mode as CodexSourceAccessMode,
      codex_config_toml: String(runtimeProfile.codex_config_toml),
      codex_config_digest: String(runtimeProfile.codex_config_digest),
      expected_effective_config_digest: String(runtimeProfile.expected_effective_config_digest),
      effective_config_assertions: runtimeProfile.effective_config_assertions as CodexEffectiveConfigAssertions,
      app_server_required: runtimeProfile.app_server_required === true,
      allowed_driver_kind: 'app_server',
      network_policy: runtimeProfile.network_policy as CodexRuntimeNetworkPolicy,
      resource_limits: runtimeProfile.resource_limits as CodexRuntimeResourceLimits,
      docker_policy: runtimeProfile.docker_policy as CodexDockerPolicy,
      allowed_scopes: [
        {
          project_id: launchTarget.project_id,
          ...(launchTarget.repo_id === undefined ? {} : { repo_id: launchTarget.repo_id }),
        },
      ],
      profile_digest: String(runtimeProfile.profile_digest),
      created_by_actor_id: 'control-plane',
      created_at: String(value.materialized_at),
    } satisfies CodexRuntimeProfileRevision;
    return {
      launch_target: launchTarget,
      profile_revision: profileRevision,
      resolved_credentials: [
        {
          binding_id: String(credential.binding_id),
          binding_version_id: String(credential.version_id),
          payload: credential.secret_payload_json,
          payload_digest: String(credential.secret_payload_digest),
        },
      ],
      lease_id: String(value.lease_id),
      expires_at: String(value.expires_at),
      materialized_at: String(value.materialized_at),
    };
  }
  return value as CodexLaunchMaterialization;
};

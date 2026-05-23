import {
  codexCanonicalDigest,
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
} from '@forgeloop/domain';

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

  async appendRuntimeJobEvent(workerId: string, jobId: string, input: WorkerRequestInput): Promise<unknown> {
    return this.#workerPost(
      `/internal/codex-workers/${encodeURIComponent(workerId)}/runtime-jobs/${encodeURIComponent(jobId)}/events`,
      input,
    );
  }

  async uploadRuntimeJobArtifact(workerId: string, jobId: string, input: WorkerRequestInput): Promise<unknown> {
    return this.#workerPost(
      `/internal/codex-workers/${encodeURIComponent(workerId)}/runtime-jobs/${encodeURIComponent(jobId)}/artifacts`,
      input,
    );
  }

  async getRuntimeJobControl(workerId: string, jobId: string, input: WorkerRequestInput): Promise<unknown> {
    return this.#workerGet(
      `/internal/codex-workers/${encodeURIComponent(workerId)}/runtime-jobs/${encodeURIComponent(jobId)}/control`,
      input,
    );
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

  async #workerPost(path: string, input: WorkerRequestInput): Promise<any> {
    return this.#postJson(path, this.#workerPayload(input));
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

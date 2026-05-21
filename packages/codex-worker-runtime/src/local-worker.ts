import { randomBytes } from 'node:crypto';

import { codexRuntimeScopeMatches, type CodexRuntimeScope, type CodexRuntimeTargetKind } from '@forgeloop/domain';

export interface LocalCodexWorkerRuntime {
  register(): Promise<void>;
  heartbeat(): Promise<void>;
  startHeartbeatLoop(): { stop(): void };
  getSessionPublicKey(): {
    keyId: string;
    algorithm: 'x25519';
    publicKey: string;
    expiresAt: string;
  };
  decryptLaunchTokenEnvelope(input: {
    ciphertext: string;
    nonce: string;
    aad: Record<string, string>;
    envelopeDigest: string;
    keyId: string;
    algorithm: 'x25519-hkdf-sha256-aes-256-gcm';
  }): Promise<string>;
  selectForLaunch(input: {
    projectId: string;
    repoId?: string;
    dockerImageDigest: string;
    targetKind: CodexRuntimeTargetKind;
  }): Promise<{ workerId: string; sessionToken: string }>;
  withLeaseSlot<T>(operation: () => Promise<T>): Promise<T>;
}

export interface LocalCodexWorkerRuntimeOptions {
  workerId: string;
  workerIdentity: string;
  version: string;
  bootstrapToken: string;
  bootstrapTokenVersion: number;
  authorizedScopes: readonly CodexRuntimeScope[];
  capabilities: readonly CodexRuntimeTargetKind[];
  dockerImageDigests: readonly string[];
  networkPolicyDigests: readonly string[];
  networkProviderConfigDigests?: readonly string[];
  hostUid: number;
  hostGid: number;
  maxConcurrency: number;
  labels?: Record<string, unknown>;
  controlPlaneClient: {
    registerWorker(input: Record<string, unknown>): Promise<{ session_token: string; session_expires_at: string }>;
    heartbeatWorker(workerId: string, input: Record<string, unknown>): Promise<unknown>;
  };
  scavenger?: () => Promise<void>;
  now?: () => string;
  nonceFactory?: () => string;
}

export const createLocalCodexWorkerRuntime = (options: LocalCodexWorkerRuntimeOptions): LocalCodexWorkerRuntime => {
  let sessionToken: string | undefined;
  let sessionExpiresAt: string | undefined;
  let activeLeaseCount = 0;
  let scavenged = false;
  let online = false;
  const now = options.now ?? (() => new Date().toISOString());
  const nonceFactory = options.nonceFactory ?? (() => randomBytes(16).toString('base64url'));
  const publicKey = {
    keyId: `${options.workerId}-session-key`,
    algorithm: 'x25519' as const,
    publicKey: randomBytes(32).toString('base64url'),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  };

  const ensureSession = (): string => {
    if (sessionToken === undefined) {
      throw new Error('codex_worker_unavailable: worker is not registered');
    }
    return sessionToken;
  };

  return {
    async register() {
      const result = await options.controlPlaneClient.registerWorker({
        worker_id: options.workerId,
        worker_identity: options.workerIdentity,
        version: options.version,
        bootstrap_token: options.bootstrapToken,
        bootstrap_token_version: options.bootstrapTokenVersion,
        status: 'offline',
        control_channel_status: 'connected',
        allowed_scopes: options.authorizedScopes,
        capabilities: options.capabilities,
        docker_image_digests: options.dockerImageDigests,
        network_policy_digests: options.networkPolicyDigests,
        ...(options.networkProviderConfigDigests === undefined ? {} : { network_provider_config_digests: options.networkProviderConfigDigests }),
        host_worker_uid: options.hostUid,
        host_worker_gid: options.hostGid,
        lease_count: activeLeaseCount,
        max_concurrency: options.maxConcurrency,
        labels: options.labels ?? {},
        session_public_key_id: publicKey.keyId,
        session_public_key_algorithm: publicKey.algorithm,
        session_public_key_material: publicKey.publicKey,
        session_public_key_expires_at: publicKey.expiresAt,
      });
      sessionToken = result.session_token;
      sessionExpiresAt = result.session_expires_at;
      await options.scavenger?.();
      scavenged = true;
    },
    async heartbeat() {
      const token = ensureSession();
      if (!scavenged) {
        throw new Error('codex_worker_unavailable: scavenger has not completed');
      }
      await options.controlPlaneClient.heartbeatWorker(options.workerId, {
        session_token: token,
        nonce: nonceFactory(),
        nonce_timestamp: now(),
        status: 'online',
        control_channel_status: 'connected',
        active_lease_count: activeLeaseCount,
        capabilities: options.capabilities,
      });
      online = true;
    },
    startHeartbeatLoop() {
      const timer = setInterval(() => {
        void this.heartbeat();
      }, 30_000);
      return { stop: () => clearInterval(timer) };
    },
    getSessionPublicKey() {
      return publicKey;
    },
    async decryptLaunchTokenEnvelope() {
      throw new Error('codex_worker_unavailable: encrypted token envelopes are implemented by remote worker mode');
    },
    async selectForLaunch(input) {
      const token = ensureSession();
      if (sessionExpiresAt !== undefined && Date.parse(sessionExpiresAt) <= Date.parse(now())) {
        throw new Error('codex_worker_unavailable: worker session expired');
      }
      if (!scavenged || !online) {
        throw new Error('codex_worker_unavailable: worker heartbeat is not online');
      }
      if (activeLeaseCount >= options.maxConcurrency) {
        throw new Error('codex_worker_unavailable: worker concurrency is saturated');
      }
      if (!options.capabilities.includes(input.targetKind)) {
        throw new Error('codex_worker_capability_mismatch: target kind is not supported');
      }
      if (!options.dockerImageDigests.includes(input.dockerImageDigest)) {
        throw new Error('codex_worker_capability_mismatch: docker image digest is not supported');
      }
      if (!codexRuntimeScopeMatches(options.authorizedScopes, { project_id: input.projectId, ...(input.repoId === undefined ? {} : { repo_id: input.repoId }) })) {
        throw new Error('codex_worker_capability_mismatch: scope is not authorized');
      }
      return { workerId: options.workerId, sessionToken: token };
    },
    async withLeaseSlot(operation) {
      if (activeLeaseCount >= options.maxConcurrency) {
        throw new Error('codex_worker_unavailable: worker concurrency is saturated');
      }
      activeLeaseCount += 1;
      try {
        return await operation();
      } finally {
        activeLeaseCount -= 1;
      }
    },
  };
};

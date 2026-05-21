import { randomUUID } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import {
  codexCanonicalDigest,
  codexRuntimeNetworkPolicyDigest,
  validateCodexEffectiveConfigAssertions,
  type CodexDockerRuntimeEvidence,
  type CodexLaunchMaterialization,
} from '@forgeloop/domain';

import { buildCodexAppServerDockerCommand } from './docker-command.js';
import type { DockerRunner, StartedDockerContainer } from './docker-runner.js';
import { runNetworkPolicySelfTest } from './network-policy.js';
import { cleanupCodexTaskFilesystem, prepareCodexTaskFilesystem, type PreparedCodexTaskFilesystem } from './task-filesystem.js';
import { prepareContainerWorkspace, type PreparedContainerWorkspace } from './workspace-isolation.js';

export interface DockerizedCodexAppServerSession {
  endpoint: `unix:${string}`;
  containerWorkspacePath: '/workspace';
  hostWorkspacePathDigest?: string;
  publicEvidence: CodexDockerRuntimeEvidence;
  close(status: 'succeeded' | 'failed' | 'cancelled', summary: string): Promise<void>;
}

export interface DockerizedCodexAppServerLauncherOptions {
  dockerBin: string;
  workerId: string;
  workerSessionToken?: string;
  workerTempRoot: string;
  dockerRunner: DockerRunner & { options?: { effectiveConfig?: Record<string, unknown> } };
  effectiveConfigProbe?: (endpoint: `unix:${string}`) => Promise<Record<string, unknown>>;
  controlPlaneClient: {
    materializeLaunchLease(workerId: string, leaseId: string, input: Record<string, unknown>): Promise<CodexLaunchMaterialization>;
    terminalizeLaunchLease(workerId: string, leaseId: string, input: Record<string, unknown>): Promise<unknown>;
  };
  hostUid: number;
  hostGid: number;
  allowedRepoRoots?: readonly string[];
  nonceFactory?: () => string;
  now?: () => string;
}

export class DockerizedCodexAppServerLauncher {
  constructor(private readonly options: DockerizedCodexAppServerLauncherOptions) {}

  async materializeOnly(input: { leaseId: string; launchToken: string; workerSessionToken?: string }): Promise<CodexLaunchMaterialization> {
    const workerSessionToken = this.#workerSessionToken(input.workerSessionToken);
    const request = {
      launch_token: input.launchToken,
      worker_session_token: workerSessionToken,
      nonce: this.options.nonceFactory?.() ?? randomUUID(),
      nonce_timestamp: this.options.now?.() ?? new Date().toISOString(),
    };
    return this.options.controlPlaneClient.materializeLaunchLease(this.options.workerId, input.leaseId, {
      ...request,
      materialization_request_hash: codexCanonicalDigest(request),
    });
  }

  async startFromMaterialization(
    materialization: CodexLaunchMaterialization,
    input: {
      originalWorkspacePath?: string;
      workerSessionToken?: string;
    } = {},
  ): Promise<DockerizedCodexAppServerSession> {
    const workerSessionToken = this.#workerSessionToken(input.workerSessionToken);
    let filesystem: PreparedCodexTaskFilesystem | undefined;
    let workspace: PreparedContainerWorkspace | undefined;
    let container: StartedDockerContainer | undefined;
    let networkSelfTest: Awaited<ReturnType<typeof runNetworkPolicySelfTest>> | undefined;
    try {
      if (input.originalWorkspacePath !== undefined && this.options.allowedRepoRoots === undefined) {
        throw new Error('codex_runtime_workspace_isolation_unavailable: allowed repo roots are required');
      }
      const credential = materialization.resolved_credentials[0];
      filesystem = await prepareCodexTaskFilesystem({
        workerTempRoot: this.options.workerTempRoot,
        launchLeaseId: materialization.lease_id,
        codexConfigToml: materialization.profile_revision.codex_config_toml,
        authJson: credential?.payload ?? {},
      });
      workspace = await prepareContainerWorkspace({
        sourceAccessMode: materialization.profile_revision.source_access_mode,
        ...(input.originalWorkspacePath === undefined ? {} : { originalWorkspacePath: input.originalWorkspacePath }),
        leaseTempRoot: filesystem.leaseTempRoot,
        allowedRepoRoots: this.options.allowedRepoRoots ?? (input.originalWorkspacePath === undefined ? [] : [input.originalWorkspacePath]),
      });
      networkSelfTest = await runNetworkPolicySelfTest({
        runner: this.options.dockerRunner,
        dockerBin: this.options.dockerBin,
        workerId: this.options.workerId,
        launchLeaseId: materialization.lease_id,
        hostUid: this.options.hostUid,
        hostGid: this.options.hostGid,
        policy: materialization.profile_revision.network_policy,
      });

      const command = buildCodexAppServerDockerCommand({
        dockerBin: this.options.dockerBin,
        workerId: this.options.workerId,
        launchLeaseId: materialization.lease_id,
        targetType: materialization.launch_target.target_type,
        targetId: materialization.launch_target.target_id,
        image: materialization.profile_revision.docker_image,
        imageDigest: materialization.profile_revision.docker_image_digest,
        hostUid: this.options.hostUid,
        hostGid: this.options.hostGid,
        ...(workspace.hostWorkspacePath === undefined ? {} : { workspaceHostPath: workspace.hostWorkspacePath }),
        workspaceContainerPath: '/workspace',
        artifactHostPath: filesystem.artifactHostPath,
        codexHomeHostPath: filesystem.codexHomeHostPath,
        socketHostDir: filesystem.socketHostDir,
        socketContainerPath: '/run/forgeloop/codex.sock',
        networkPolicy: materialization.profile_revision.network_policy,
        resourceLimits: materialization.profile_revision.resource_limits,
        dockerPolicy: materialization.profile_revision.docker_policy,
      });
      container = await this.options.dockerRunner.start(command);
      const endpoint = `unix:${container.socketHostPath}` as const;
      await waitForUnixSocketInside(container.socketHostPath, filesystem.socketHostDir);

      const effectiveConfig = await this.#waitForEffectiveConfig(endpoint);
      if (effectiveConfig === undefined) {
        throw new Error('codex_app_server_effective_config_mismatch');
      }
      const effectiveConfigDigest = codexCanonicalDigest(effectiveConfig);
      if (effectiveConfigDigest !== materialization.profile_revision.expected_effective_config_digest) {
        throw new Error('codex_app_server_effective_config_mismatch');
      }
      const assertionBlocker = validateCodexEffectiveConfigAssertions(effectiveConfig, materialization.profile_revision.effective_config_assertions);
      if (assertionBlocker !== undefined) {
        throw new Error(assertionBlocker);
      }

      const publicEvidence: CodexDockerRuntimeEvidence = {
        runtime_profile_id: materialization.profile_revision.profile_id,
        runtime_profile_revision_id: materialization.profile_revision.id,
        runtime_profile_digest: materialization.profile_revision.profile_digest,
        runtime_target_kind: materialization.profile_revision.target_kind,
        source_access_mode: materialization.profile_revision.source_access_mode,
        environment: materialization.profile_revision.environment,
        ...(credential === undefined
          ? {}
          : {
              credential_binding_id: credential.binding_id,
              credential_binding_version_id: credential.binding_version_id,
              credential_payload_digest: credential.payload_digest,
            }),
        launch_lease_id: materialization.lease_id,
        worker_id: this.options.workerId,
        docker_image_digest: materialization.profile_revision.docker_image_digest,
        container_id_digest: container.containerIdDigest,
        app_server_effective_config_digest: effectiveConfigDigest,
        network_policy_digest: codexRuntimeNetworkPolicyDigest(materialization.profile_revision.network_policy),
        ...(networkSelfTest.selfTestDigest === undefined ? {} : { network_policy_self_test_digest: networkSelfTest.selfTestDigest }),
        docker_policy_self_check_digest: codexCanonicalDigest(command.publicSummary),
        ...(workspace.publicWorkspaceDigest === undefined ? {} : { workspace_isolation_digest: workspace.publicWorkspaceDigest }),
        app_server_attempted: true,
        selected_execution_mode: 'app_server',
      };

      return {
        endpoint,
        containerWorkspacePath: '/workspace',
        ...(workspace.hostWorkspacePath === undefined ? {} : { hostWorkspacePathDigest: codexCanonicalDigest(workspace.hostWorkspacePath) }),
        publicEvidence,
        close: (() => {
          let closed = false;
          return async (status, summary) => {
            if (closed) {
              return;
            }
            closed = true;
            let terminalizeError: unknown;
            try {
              await this.options.controlPlaneClient.terminalizeLaunchLease(this.options.workerId, materialization.lease_id, {
                worker_session_token: workerSessionToken,
                nonce: this.options.nonceFactory?.() ?? randomUUID(),
                nonce_timestamp: this.options.now?.() ?? new Date().toISOString(),
                terminal_status: 'terminal',
                reason_code: `codex_app_server_${status}`,
                evidence_summary: publicEvidence,
                idempotency_key: codexCanonicalDigest({ lease_id: materialization.lease_id, status, summary_digest: codexCanonicalDigest(summary) }),
              });
            } catch (error) {
              terminalizeError = error;
            } finally {
              await container?.stop();
              await networkSelfTest?.cleanup?.();
              await workspace?.cleanup();
              if (filesystem !== undefined) {
                await cleanupCodexTaskFilesystem({ leaseTempRoot: filesystem.leaseTempRoot });
              }
            }
            if (terminalizeError !== undefined) {
              throw terminalizeError;
            }
          };
        })(),
      };
    } catch (error) {
      await this.#terminalizeStartupFailure(materialization, workerSessionToken, error);
      await container?.stop();
      await networkSelfTest?.cleanup?.();
      await workspace?.cleanup();
      if (filesystem !== undefined) {
        await cleanupCodexTaskFilesystem({ leaseTempRoot: filesystem.leaseTempRoot });
      }
      throw error;
    }
  }

  async launchFromLease(input: {
    leaseId: string;
    launchToken: string;
    originalWorkspacePath?: string;
    workerSessionToken?: string;
  }): Promise<DockerizedCodexAppServerSession> {
    const materialization = await this.materializeOnly(input);
    return this.startFromMaterialization(materialization, {
      ...(input.originalWorkspacePath === undefined ? {} : { originalWorkspacePath: input.originalWorkspacePath }),
      ...(input.workerSessionToken === undefined ? {} : { workerSessionToken: input.workerSessionToken }),
    });
  }

  async #waitForEffectiveConfig(endpoint: `unix:${string}`): Promise<Record<string, unknown> | undefined> {
    if (this.options.effectiveConfigProbe === undefined) {
      return this.options.dockerRunner.options?.effectiveConfig;
    }
    const deadline = Date.now() + 5_000;
    let lastError: unknown;
    while (Date.now() <= deadline) {
      try {
        return await this.options.effectiveConfigProbe(endpoint);
      } catch (error) {
        lastError = error;
        await delay(50);
      }
    }
    if (lastError !== undefined) {
      throw lastError;
    }
    return undefined;
  }

  #workerSessionToken(override?: string): string {
    const token = override ?? this.options.workerSessionToken;
    if (token === undefined || token.length === 0) {
      throw new Error('codex_worker_unavailable: worker session token is required');
    }
    return token;
  }

  async #terminalizeStartupFailure(
    materialization: CodexLaunchMaterialization,
    workerSessionToken: string,
    error: unknown,
  ): Promise<void> {
    await this.options.controlPlaneClient
      .terminalizeLaunchLease(this.options.workerId, materialization.lease_id, {
        worker_session_token: workerSessionToken,
        nonce: this.options.nonceFactory?.() ?? randomUUID(),
        nonce_timestamp: this.options.now?.() ?? new Date().toISOString(),
        terminal_status: 'terminal',
        reason_code: publicStartupFailureCode(error),
        evidence_summary: {
          runtime_profile_id: materialization.profile_revision.profile_id,
          runtime_profile_revision_id: materialization.profile_revision.id,
          runtime_profile_digest: materialization.profile_revision.profile_digest,
          runtime_target_kind: materialization.profile_revision.target_kind,
          source_access_mode: materialization.profile_revision.source_access_mode,
          environment: materialization.profile_revision.environment,
          launch_lease_id: materialization.lease_id,
          worker_id: this.options.workerId,
          docker_image_digest: materialization.profile_revision.docker_image_digest,
          network_policy_digest: codexRuntimeNetworkPolicyDigest(materialization.profile_revision.network_policy),
          app_server_attempted: true,
          selected_execution_mode: 'app_server',
          startup_blocker_code: publicStartupFailureCode(error),
        },
        idempotency_key: codexCanonicalDigest({
          lease_id: materialization.lease_id,
          status: 'startup_failed',
          blocker_code: publicStartupFailureCode(error),
        }),
      })
      .catch(() => undefined);
  }
}

const publicStartupFailureCodes = new Set([
  'codex_worker_unavailable',
  'codex_worker_docker_policy_unavailable',
  'codex_runtime_workspace_isolation_unavailable',
  'codex_app_server_effective_config_mismatch',
  'codex_app_server_socket_invalid',
  'codex_docker_runtime_evidence_unsafe',
  'codex_runtime_profile_invalid',
]);

const publicStartupFailureCode = (error: unknown): string => {
  if (!(error instanceof Error)) {
    return 'codex_app_server_unavailable';
  }
  const code = error.message.split(':', 1)[0]?.trim();
  return code !== undefined && publicStartupFailureCodes.has(code) ? code : 'codex_app_server_unavailable';
};

const assertInside = (root: string, child: string): void => {
  const childRelative = relative(resolve(root), resolve(child));
  if (childRelative === '' || childRelative.startsWith('..') || childRelative.startsWith('/')) {
    throw new Error('codex_app_server_socket_invalid');
  }
};

const assertUnixSocketInside = async (socketPath: string, socketDir: string): Promise<void> => {
  assertInside(socketDir, socketPath);
  const socketStat = await lstat(socketPath).catch(() => undefined);
  if (socketStat === undefined || !socketStat.isSocket()) {
    throw new Error('codex_app_server_socket_invalid');
  }
};

const waitForUnixSocketInside = async (socketPath: string, socketDir: string): Promise<void> => {
  const deadline = Date.now() + 5_000;
  let lastError: unknown;
  while (Date.now() <= deadline) {
    try {
      await assertUnixSocketInside(socketPath, socketDir);
      return;
    } catch (error) {
      lastError = error;
      await delay(50);
    }
  }
  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error('codex_app_server_socket_invalid');
};

import { randomBytes, randomUUID } from 'node:crypto';
import { lstat, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import {
  codexCanonicalDigest,
  codexRuntimeNetworkPolicyDigest,
  validateCodexEffectiveConfigAssertions,
  type CodexDockerRuntimeEvidence,
  type CodexLaunchMaterialization,
} from '@forgeloop/domain';
import type { CodexAppServerTransport } from '@forgeloop/codex-runtime';

import { buildCodexAppServerDockerCommand, type CodexDockerAppServerTransport } from './docker-command.js';
import { CodexAppServerDockerExecTransport } from './docker-exec-app-server-transport.js';
import type { DockerRunner, StartedDockerContainer } from './docker-runner.js';
import { runNetworkPolicySelfTest } from './network-policy.js';
import { cleanupCodexTaskFilesystem, prepareCodexTaskFilesystem, type PreparedCodexTaskFilesystem } from './task-filesystem.js';
import { prepareContainerWorkspace, type PreparedContainerWorkspace } from './workspace-isolation.js';

export type DockerizedCodexAppServerEndpoint = `unix:${string}` | `ws://${string}` | `docker-exec:${string}`;

export interface DockerizedCodexAppServerSession {
  endpoint: DockerizedCodexAppServerEndpoint;
  endpointAuth?: {
    bearerToken: string;
  };
  createTransport?: () => CodexAppServerTransport;
  containerWorkspacePath: '/workspace';
  hostWorkspacePathDigest?: string;
  capsuleHookInput?: DockerizedCodexAppServerLauncherHookInput;
  publicEvidence: CodexDockerRuntimeEvidence;
  close(status: 'succeeded' | 'failed' | 'cancelled', summary: string): Promise<void>;
}

export interface DockerizedCodexAppServerLauncherOptions {
  dockerBin: string;
  workerId: string;
  workerSessionToken?: string;
  workerTempRoot: string;
  dockerRunner: DockerRunner & { options?: { effectiveConfig?: Record<string, unknown> } };
  effectiveConfigProbe?: (
    endpoint: DockerizedCodexAppServerEndpoint,
    auth?: { bearerToken: string },
    createTransport?: () => CodexAppServerTransport,
  ) => Promise<Record<string, unknown>>;
  controlPlaneClient: {
    materializeLaunchLease(workerId: string, leaseId: string, input: Record<string, unknown>): Promise<CodexLaunchMaterialization>;
    terminalizeLaunchLease(workerId: string, leaseId: string, input: Record<string, unknown>): Promise<unknown>;
  };
  hostUid: number;
  hostGid: number;
  appServerTransport?: CodexDockerAppServerTransport;
  websocketTokenFactory?: () => string;
  dockerExecTransportFactory?: (input: { containerId: string; socketContainerPath: string }) => CodexAppServerTransport;
  startupProbeTimeoutMs?: number;
  allowedRepoRoots?: readonly string[];
  nonceFactory?: () => string;
  now?: () => string;
}

export type DockerizedCodexAppServerLauncherHookInput = {
  codexHomeHostPath: string;
  artifactHostPath: string;
};

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
      taskWorkspaceDigest?: string;
      taskWorkspaceRoot?: string;
      workerSessionToken?: string;
      terminalizeLaunchLeaseOnClose?: boolean;
      restoreCodexHome?: (codexHomeHostPath: string) => Promise<void>;
      writeConfigAndAuth?: boolean;
      beforeAppServerStart?: (input: DockerizedCodexAppServerLauncherHookInput) => Promise<void>;
      beforeRuntimeCleanup?: (
        input: DockerizedCodexAppServerLauncherHookInput & { status: 'succeeded' | 'failed' | 'cancelled' },
      ) => Promise<void>;
    } = {},
  ): Promise<DockerizedCodexAppServerSession> {
    const workerSessionToken = this.#workerSessionToken(input.workerSessionToken);
    const terminalizeLaunchLeaseOnClose = input.terminalizeLaunchLeaseOnClose ?? true;
    let filesystem: PreparedCodexTaskFilesystem | undefined;
    let workspace: PreparedContainerWorkspace | undefined;
    let container: StartedDockerContainer | undefined;
    let networkSelfTest: Awaited<ReturnType<typeof runNetworkPolicySelfTest>> | undefined;
    try {
      if (
        input.originalWorkspacePath !== undefined &&
        input.taskWorkspaceDigest === undefined &&
        this.options.allowedRepoRoots === undefined
      ) {
        throw new Error('codex_runtime_workspace_isolation_unavailable: allowed repo roots are required');
      }
      const credential = materialization.resolved_credentials[0];
      filesystem = await prepareCodexTaskFilesystem({
        workerTempRoot: this.options.workerTempRoot,
        workerId: this.options.workerId,
        launchLeaseId: materialization.lease_id,
        codexConfigToml: materialization.profile_revision.codex_config_toml,
        authJson: credential?.payload ?? {},
        ...(input.restoreCodexHome === undefined ? {} : { restoreCodexHome: input.restoreCodexHome }),
        ...(input.writeConfigAndAuth === undefined ? {} : { writeConfigAndAuth: input.writeConfigAndAuth }),
      });
      await input.beforeAppServerStart?.({
        codexHomeHostPath: filesystem.codexHomeHostPath,
        artifactHostPath: filesystem.artifactHostPath,
      });
      workspace = await prepareContainerWorkspace({
        sourceAccessMode: materialization.profile_revision.source_access_mode,
        ...(input.originalWorkspacePath === undefined ? {} : { originalWorkspacePath: input.originalWorkspacePath }),
        ...(input.taskWorkspaceDigest === undefined ? {} : { taskWorkspaceDigest: input.taskWorkspaceDigest }),
        ...(input.taskWorkspaceRoot === undefined ? {} : { taskWorkspaceRoot: input.taskWorkspaceRoot }),
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

      const appServerTransport = this.options.appServerTransport ?? 'docker_exec';
      const endpointAuth =
        appServerTransport === 'websocket'
          ? { bearerToken: this.options.websocketTokenFactory?.() ?? randomBytes(32).toString('base64url') }
          : undefined;
      if (endpointAuth !== undefined) {
        await writeFile(`${filesystem.socketHostDir}/ws-token`, endpointAuth.bearerToken, { mode: 0o600 });
      }

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
        appServerTransport,
        networkPolicy: materialization.profile_revision.network_policy,
        resourceLimits: materialization.profile_revision.resource_limits,
        dockerPolicy: materialization.profile_revision.docker_policy,
      });
      container = await this.options.dockerRunner.start(command);
      const createTransport =
        appServerTransport === 'docker_exec'
          ? () =>
              this.options.dockerExecTransportFactory?.({
                containerId: container!.containerId,
                socketContainerPath: '/run/forgeloop/codex.sock',
              }) ??
              new CodexAppServerDockerExecTransport({
                dockerBin: this.options.dockerBin,
                containerId: container!.containerId,
                socketContainerPath: '/run/forgeloop/codex.sock',
              })
          : undefined;
      const endpoint =
        appServerTransport === 'websocket'
          ? appServerWebSocketEndpoint(container.appServerEndpoint)
          : appServerTransport === 'docker_exec'
            ? appServerDockerExecEndpoint(container.containerIdDigest)
            : (`unix:${container.socketHostPath}` as const);
      if (appServerTransport === 'unix') {
        await waitForUnixSocketInside(container.socketHostPath, filesystem.socketHostDir);
      }

      const probedEffectiveConfig = await this.#waitForEffectiveConfig(endpoint, endpointAuth, createTransport);
      if (probedEffectiveConfig === undefined) {
        throw new Error('codex_app_server_effective_config_mismatch');
      }
      const effectiveConfig = runtimeEvidenceEffectiveConfig(probedEffectiveConfig, materialization.profile_revision);
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
        ...(endpointAuth === undefined ? {} : { endpointAuth }),
        ...(createTransport === undefined ? {} : { createTransport }),
        containerWorkspacePath: '/workspace',
        ...(workspace.hostWorkspacePath === undefined ? {} : { hostWorkspacePathDigest: codexCanonicalDigest(workspace.hostWorkspacePath) }),
        capsuleHookInput: {
          codexHomeHostPath: filesystem.codexHomeHostPath,
          artifactHostPath: filesystem.artifactHostPath,
        },
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
              if (terminalizeLaunchLeaseOnClose) {
                await this.options.controlPlaneClient.terminalizeLaunchLease(this.options.workerId, materialization.lease_id, {
                  worker_session_token: workerSessionToken,
                  nonce: this.options.nonceFactory?.() ?? randomUUID(),
                  nonce_timestamp: this.options.now?.() ?? new Date().toISOString(),
                  terminal_status: 'terminal',
                  reason_code: `codex_app_server_${status}`,
                  evidence_summary: publicEvidence,
                  idempotency_key: codexCanonicalDigest({ lease_id: materialization.lease_id, status, summary_digest: codexCanonicalDigest(summary) }),
                });
              }
            } catch (error) {
              terminalizeError = error;
            } finally {
              let cleanupHookError: unknown;
              if (filesystem !== undefined) {
                try {
                  await input.beforeRuntimeCleanup?.({
                    codexHomeHostPath: filesystem.codexHomeHostPath,
                    artifactHostPath: filesystem.artifactHostPath,
                    status,
                  });
                } catch (error) {
                  cleanupHookError = error;
                }
              }
              await container?.stop();
              await networkSelfTest?.cleanup?.();
              await workspace?.cleanup();
              if (filesystem !== undefined) {
                await cleanupCodexTaskFilesystem({ leaseTempRoot: filesystem.leaseTempRoot });
              }
              if (terminalizeError === undefined && cleanupHookError !== undefined) {
                throw cleanupHookError;
              }
            }
            if (terminalizeError !== undefined) {
              throw terminalizeError;
            }
          };
        })(),
      };
    } catch (error) {
      if (terminalizeLaunchLeaseOnClose) {
        await this.#terminalizeStartupFailure(materialization, workerSessionToken, error);
      }
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

  async #waitForEffectiveConfig(
    endpoint: DockerizedCodexAppServerEndpoint,
    auth?: { bearerToken: string },
    createTransport?: () => CodexAppServerTransport,
  ): Promise<Record<string, unknown> | undefined> {
    if (this.options.effectiveConfigProbe === undefined) {
      return this.options.dockerRunner.options?.effectiveConfig;
    }
    const deadline = Date.now() + (this.options.startupProbeTimeoutMs ?? 15_000);
    let lastError: unknown;
    while (Date.now() <= deadline) {
      try {
        const remainingMs = Math.max(1, deadline - Date.now());
        return await withTimeout(
          this.options.effectiveConfigProbe(endpoint, auth, createTransport),
          remainingMs,
          'codex_app_server_unavailable',
        );
      } catch (error) {
        lastError = error;
        const remainingMs = deadline - Date.now();
        if (remainingMs > 0) {
          await delay(Math.min(50, remainingMs));
        }
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
  'codex_worker_docker_unavailable',
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

const appServerWebSocketEndpoint = (endpoint: string | undefined): `ws://${string}` => {
  if (endpoint === undefined || !endpoint.startsWith('ws://')) {
    throw new Error('codex_app_server_socket_invalid');
  }
  return endpoint as `ws://${string}`;
};

const appServerDockerExecEndpoint = (containerIdDigest: string): `docker-exec:${string}` => {
  if (!/^sha256:[a-f0-9]{64}$/.test(containerIdDigest)) {
    throw new Error('codex_app_server_socket_invalid');
  }
  return `docker-exec:${containerIdDigest}`;
};

const stringValue = (record: Record<string, unknown>, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') {
      return value;
    }
  }
  return undefined;
};

const withTimeout = async <T>(operation: Promise<T>, timeoutMs: number, errorCode: string): Promise<T> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(errorCode)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
};

const sandboxType = (config: Record<string, unknown>): string | undefined => {
  const sandbox = config.sandbox_policy ?? config.sandboxPolicy ?? config.sandbox ?? config.sandbox_mode;
  if (typeof sandbox === 'string') {
    return sandbox;
  }
  if (sandbox !== null && typeof sandbox === 'object' && !Array.isArray(sandbox)) {
    const type = (sandbox as Record<string, unknown>).type;
    return typeof type === 'string' ? type : undefined;
  }
  return undefined;
};

const runtimeEvidenceEffectiveConfig = (
  config: Record<string, unknown>,
  revision: CodexLaunchMaterialization['profile_revision'],
): Record<string, unknown> => {
  const approvalPolicy = stringValue(config, ['approval_policy', 'approvalPolicy']);
  const base: Record<string, unknown> = {
    target_kind: revision.target_kind,
    ...(approvalPolicy === undefined ? {} : { approval_policy: approvalPolicy }),
  };
  if (revision.target_kind === 'generation') {
    return {
      ...base,
      source_write_policy: revision.source_access_mode,
      forbidden_writable_roots: revision.source_access_mode === 'artifact_only' ? ['workspace'] : [],
    };
  }
  const assertedSandboxType =
    revision.effective_config_assertions.target_kind === 'run_execution'
      ? revision.effective_config_assertions.sandbox_type
      : undefined;
  const effectiveSandboxType = sandboxType(config) ?? assertedSandboxType;
  return {
    ...base,
    ...(effectiveSandboxType === undefined ? {} : { sandbox_type: effectiveSandboxType }),
    writable_roots_policy: 'task_workspace_only',
  };
};

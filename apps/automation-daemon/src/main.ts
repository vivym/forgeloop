import { randomBytes, randomUUID } from 'node:crypto';

import { AutomationHttpClient, signAutomationRequest } from '@forgeloop/automation';
import {
  CliDockerRunner,
  CodexRuntimeControlPlaneClient,
  createLocalCodexWorkerRuntime,
  DockerizedCodexAppServerLauncher,
} from '@forgeloop/codex-worker-runtime';
import { CodexAppServerEndpointTransport, effectiveConfigFromResponse } from '@forgeloop/codex-runtime';

import { AutomationDaemon } from './automation-daemon.js';
import { generationPlanningForDaemon, loadAutomationDaemonConfig } from './config.js';
import { createAutomationDaemonGenerationRuntime } from './generation-runtime.js';
import { loadDaemonWorkflowPolicyDigest } from './workflow-policy-loader.js';

const config = loadAutomationDaemonConfig();
const client = new AutomationHttpClient({
  baseUrl: config.controlPlaneUrl,
  actorId: config.actorId,
  daemonIdentity: config.daemonIdentity,
  secret: config.trustedActorHeaderSecret,
});

const requiredLocalDockerConfig = <T>(value: T | undefined, name: string): T => {
  if (value === undefined) {
    throw new Error(`Missing required local Docker Codex runtime config: ${name}`);
  }
  return value;
};

const codexEffectiveConfigProbe = async (endpoint: `unix:${string}`): Promise<Record<string, unknown>> => {
  const transport = new CodexAppServerEndpointTransport(endpoint);
  try {
    await transport.initialize();
    for (const method of ['getEffectiveConfig', 'codex/getEffectiveConfig', 'effective_config']) {
      try {
        const response = await transport.request(method, {});
        const config = effectiveConfigFromResponse(response);
        if (config !== undefined) {
          return config as Record<string, unknown>;
        }
      } catch {
        // Try the next known effective-config method name.
      }
    }
  } finally {
    await transport.close().catch(() => undefined);
  }
  throw new Error('codex_app_server_effective_config_mismatch');
};

const createLocalDockerGenerationRuntimeOptions = async () => {
  if (config.codexWorkerMode !== 'local_docker') {
    return undefined;
  }
  const workerId = requiredLocalDockerConfig(config.workerId, 'FORGELOOP_CODEX_WORKER_ID or FORGELOOP_WORKER_IDENTITY');
  const workerTempRoot = requiredLocalDockerConfig(config.workerTempRoot, 'FORGELOOP_WORKER_TEMP_ROOT');
  const workerBootstrapToken = requiredLocalDockerConfig(config.workerBootstrapToken, 'FORGELOOP_WORKER_BOOTSTRAP_TOKEN');
  const workerBootstrapTokenVersion = requiredLocalDockerConfig(
    config.workerBootstrapTokenVersion,
    'FORGELOOP_WORKER_BOOTSTRAP_TOKEN_VERSION',
  );
  const workerDockerImageDigests = requiredLocalDockerConfig(config.workerDockerImageDigests, 'FORGELOOP_CODEX_DOCKER_IMAGE_DIGEST');
  const workerNetworkPolicyDigests = requiredLocalDockerConfig(
    config.workerNetworkPolicyDigests,
    'FORGELOOP_CODEX_NETWORK_POLICY_DIGEST',
  );
  const generationCredentialBindingId = requiredLocalDockerConfig(
    config.generationCredentialBindingId,
    'FORGELOOP_CODEX_GENERATION_CREDENTIAL_BINDING_ID',
  );
  const hostUid = config.workerHostUid ?? process.getuid?.() ?? 0;
  const hostGid = config.workerHostGid ?? process.getgid?.() ?? 0;
  const nonceFactory = () => randomBytes(16).toString('base64url');
  const now = () => new Date().toISOString();
  const controlPlaneClient = new CodexRuntimeControlPlaneClient({
    baseUrl: config.controlPlaneUrl,
    trustedActorSigner: ({ method, pathAndQuery, rawBody }) => ({
      ...signAutomationRequest({
        method,
        pathAndQuery,
        rawBody,
        actorId: config.actorId,
        actorClass: 'automation_daemon',
        daemonIdentity: config.daemonIdentity,
        timestamp: now(),
        secret: config.trustedActorHeaderSecret,
      }),
    }),
  });
  const worker = createLocalCodexWorkerRuntime({
    workerId,
    workerIdentity: requiredLocalDockerConfig(config.workerIdentity, 'FORGELOOP_WORKER_IDENTITY'),
    version: 'automation-daemon',
    bootstrapToken: workerBootstrapToken,
    bootstrapTokenVersion: workerBootstrapTokenVersion,
    authorizedScopes: requiredLocalDockerConfig(config.workerAuthorizedScopes, 'FORGELOOP_CODEX_ALLOWED_SCOPE_PROJECT_ID'),
    capabilities: config.workerCapabilities ?? ['generation'],
    dockerImageDigests: workerDockerImageDigests,
    networkPolicyDigests: workerNetworkPolicyDigests,
    ...(config.workerNetworkProviderConfigDigests === undefined
      ? {}
      : { networkProviderConfigDigests: config.workerNetworkProviderConfigDigests }),
    hostUid,
    hostGid,
    maxConcurrency: config.workerMaxConcurrency ?? 1,
    ...(config.workerLabels === undefined ? {} : { labels: config.workerLabels }),
    controlPlaneClient,
    now,
    nonceFactory,
  });
  await worker.register();
  await worker.heartbeat();
  worker.startHeartbeatLoop();
  const dockerRunner = new CliDockerRunner(config.dockerBin ?? 'docker');
  const launcher = new DockerizedCodexAppServerLauncher({
    dockerBin: config.dockerBin ?? 'docker',
    workerId,
    workerTempRoot,
    dockerRunner,
    controlPlaneClient,
    hostUid,
    hostGid,
    allowedRepoRoots: config.allowedRepoRoots,
    effectiveConfigProbe: codexEffectiveConfigProbe,
    now,
    nonceFactory,
  });

  return {
    worker,
    launcher,
    dockerImageDigest: workerDockerImageDigests[0]!,
    createLaunchLease: async ({ taskKind, workerId: selectedWorkerId, generationInput }: any) => {
      const orchestration = generationInput.orchestration;
      if (orchestration === undefined) {
        throw new Error('codex_launch_lease_denied');
      }
      const status = await controlPlaneClient.getStatus({
        projectId: generationInput.projectId,
        repoId: generationInput.repoIds[0],
        targetKind: 'generation',
        ...(config.generationRuntimeProfileId === undefined ? {} : { runtimeProfileId: config.generationRuntimeProfileId }),
        credentialBindingId: generationCredentialBindingId,
      });
      if (
        status.runtime_profile_revision_id === undefined ||
        status.credential_binding_id === undefined ||
        status.credential_binding_version_id === undefined ||
        status.credential_payload_digest === undefined
      ) {
        throw new Error('codex_launch_lease_denied: runtime profile or credential status is incomplete');
      }
      const response = (await controlPlaneClient.createLaunchLease({
        id: `codex-generation-lease-${orchestration.actionRunId}-${randomUUID()}`,
        lease_request_id: `codex-generation-lease-request-${orchestration.actionRunId}-${taskKind}-${randomUUID()}`,
        target: {
          target_type: 'automation_action_run',
          target_id: orchestration.actionRunId,
          target_kind: 'generation',
          project_id: generationInput.projectId,
          ...(generationInput.repoIds[0] === undefined ? {} : { repo_id: generationInput.repoIds[0] }),
        },
        worker_id: selectedWorkerId,
        runtime_profile_revision_id: status.runtime_profile_revision_id,
        credential_binding_id: status.credential_binding_id,
        credential_binding_version_id: status.credential_binding_version_id,
        credential_payload_digest: status.credential_payload_digest,
        launch_token: `codex-launch-${randomBytes(32).toString('base64url')}`,
        launch_attempt: orchestration.actionAttempt,
        action_type: orchestration.actionType,
        action_attempt: orchestration.actionAttempt,
        action_claim_token: orchestration.claimToken,
        precondition_fingerprint: orchestration.preconditionFingerprint,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      })) as { lease: { id: string }; launch_token: string };
      return { leaseId: response.lease.id, launchToken: response.launch_token };
    },
  };
};

const start = async (): Promise<void> => {
  const localDockerOptions = await createLocalDockerGenerationRuntimeOptions();
  const generationRuntime = createAutomationDaemonGenerationRuntime(
    config,
    localDockerOptions === undefined ? {} : { localDocker: localDockerOptions },
  );
  const generationPlanning = generationPlanningForDaemon(config);
  const daemon = new AutomationDaemon({
    client,
    actorId: config.actorId,
    daemonIdentity: config.daemonIdentity,
    allowedRepoRoots: config.allowedRepoRoots,
    policyParserVersion: config.policyParserVersion,
    policyLoader: loadDaemonWorkflowPolicyDigest,
    loopIntervalMs: config.loopIntervalMs,
    noClaimBackoffMs: config.noClaimBackoffMs,
    ...(generationPlanning === undefined ? {} : { generationPlanning }),
    ...(generationRuntime === undefined ? {} : { generationRuntime }),
    onIterationError: (error) => {
      console.error(error instanceof Error ? error.message : error);
    },
  });

  const stop = (): void => daemon.stop();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  await daemon.run();
};

void start().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

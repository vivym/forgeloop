import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  buildInternalArtifactRef,
  codexAppConnectorManifestDigest,
  codexCanonicalDigest,
  codexCredentialLineageDigest,
  codexEnvironmentManifestDigest,
  codexMcpManifestDigest,
  codexMemoryBundleDigest,
  codexMemoryBundleManifestSchema,
  codexMemoryDeltaDigest,
  codexPluginManifestDigest,
  codexRuntimeCapsuleManifestDigest,
  codexSkillManifestDigest,
  codexThreadLocatorRepairManifestDigest,
  codexToolSchemaManifestDigest,
  codexTrustedRuntimeManifestDigest,
  type CodexRuntimeCapsule,
  type InternalArtifactKind,
} from '@forgeloop/domain';

import type { CodexThreadLocatorRepairManifest } from './discovery.js';
import {
  buildCodexMemoryBundleFromRoot,
  diffCodexMemoryBundleManifests,
  materializeCodexMemoryBundleToRoot,
  type CodexMemoryBundleManifest,
} from './memory-state.js';
import { packageCodexRuntimeCapsule, type CodexRuntimeCapsuleArtifactWriter } from './packager.js';
import { restoreCodexRuntimeCapsule, type RestoredCodexRuntimeCapsule } from './restorer.js';
import {
  restoreCodexThreadStateBundle,
  type CodexThreadLocatorRepairExecutor,
  type ThreadStateBundle,
} from './thread-state.js';
import type {
  RemoteWorkerCapsuleBaseMemoryInput,
  RemoteWorkerCapsuleLocatorRepairInput,
  RemoteWorkerCapsuleManager,
  RemoteWorkerCapsulePackageInput,
  RemoteWorkerCapsuleRestoreInput,
} from '../remote-worker-client.js';
import type { GenerationOutputCapsulePackageResult } from '../runtime-job-artifacts.js';

interface InternalArtifactClient {
  uploadInternalArtifact(input: {
    kind: InternalArtifactKind;
    ownerType: 'codex_session';
    ownerId: string;
    visibility: 'private';
    contentType: string;
    bytes: Uint8Array;
    idempotencyKey: string;
    metadataJson?: Record<string, unknown>;
    maxSizeBytes?: number;
  }): Promise<{ ref: string; digest: string; size_bytes: string }>;
  downloadInternalArtifact(input: { ref: string; expectedDigest: string; maxSizeBytes?: number }): Promise<Uint8Array>;
}

export interface RemoteWorkerCapsuleManagerOptions {
  controlPlaneClient: InternalArtifactClient;
  workerId: string;
  codexCliVersion: string;
  appServerProtocolDigest: string;
  now?: () => string;
  locatorRepairExecutor?: CodexThreadLocatorRepairExecutor;
}

type SessionState = {
  baseMemoryBundle: CodexMemoryBundleManifest;
  inputMemoryBundle: CodexMemoryBundleManifest;
  inputCapsuleDigest?: string;
  restored?: RestoredCodexRuntimeCapsule;
};

const rawSha256Digest = (bytes: Uint8Array): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const artifactIdSegment = (value: string): string => value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'artifact';

const parseJsonBytes = (bytes: Uint8Array): unknown => JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;

const listFiles = async (root: string, prefix = ''): Promise<string[]> => {
  const entries = await readdir(join(root, prefix));
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = prefix.length === 0 ? entry : `${prefix}/${entry}`;
    const stat = await lstat(join(root, relativePath));
    if (stat.isDirectory()) {
      files.push(...(await listFiles(root, relativePath)));
    } else if (stat.isFile()) {
      files.push(relativePath);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
};

const findRolloutRelativePath = async (input: {
  codexHomeRoot: string;
  restoredThreadStateBundle?: ThreadStateBundle;
}): Promise<string> => {
  const restoredPath = input.restoredThreadStateBundle?.locator_repair_manifest.rollout_relative_path;
  if (restoredPath !== undefined) {
    await lstat(join(input.codexHomeRoot, restoredPath));
    return restoredPath;
  }
  const rolloutFiles = (await listFiles(input.codexHomeRoot)).filter((relativePath) =>
    /^sessions\/[0-9]{4}\/[0-9]{2}\/[0-9]{2}\/rollout-[A-Za-z0-9._-]+\.jsonl$/.test(relativePath),
  );
  if (rolloutFiles.length !== 1) {
    throw new Error('codex runtime capsule rollout discovery requires exactly one active rollout');
  }
  return rolloutFiles[0]!;
};

const emptyEnvironmentManifest = (input: RemoteWorkerCapsulePackageInput & {
  codexCliVersion: string;
  appServerProtocolDigest: string;
  environmentArtifactRef: string;
}) => {
  const pluginManifest = { schema_version: 'codex_plugin_manifest.v1' as const, plugins: [] };
  const skillManifest = { schema_version: 'codex_skill_manifest.v1' as const, skills: [] };
  const toolSchemaManifest = { schema_version: 'codex_tool_schema_manifest.v1' as const, schemas: [] };
  const mcpServerManifest = { schema_version: 'codex_mcp_server_manifest.v1' as const, servers: [] };
  const appConnectorManifest = { schema_version: 'codex_app_connector_manifest.v1' as const, connectors: [] };
  const credentialBindingLineage = {
    schema_version: 'codex_credential_binding_lineage.v1' as const,
    bindings: input.materialization.resolved_credentials.map((credential) => {
      const scopeDigest = codexCanonicalDigest({
        credential_binding_id: credential.binding_id,
        credential_binding_version_id: credential.binding_version_id,
      });
      return {
        connector_id: credential.binding_id,
        app_id: credential.binding_id,
        credential_binding_id: credential.binding_id,
        credential_binding_version_id: credential.binding_version_id,
        credential_binding_digest: credential.payload_digest,
        scope_digest: scopeDigest,
      };
    }),
  };
  const trustedRuntimeManifest = {
    schema_version: 'codex_trusted_runtime_manifest.v1' as const,
    trusted_project_digest: codexCanonicalDigest(input.materialization.launch_target),
    runtime_profile_revision_id: input.materialization.profile_revision.id,
    runtime_profile_digest: input.materialization.profile_revision.profile_digest,
    feature_flag_digest: codexCanonicalDigest({}),
    codex_cli_version: input.codexCliVersion,
    app_server_protocol_digest: input.appServerProtocolDigest,
  };
  return {
    schema_version: 'codex_environment_manifest.v1' as const,
    codex_session_id: input.codexSessionId,
    artifact_ref: input.environmentArtifactRef,
    codex_cli_version: input.codexCliVersion,
    app_server_protocol_digest: input.appServerProtocolDigest,
    feature_flag_digest: trustedRuntimeManifest.feature_flag_digest,
    trusted_project_digest: trustedRuntimeManifest.trusted_project_digest,
    runtime_profile_revision_id: input.materialization.profile_revision.id,
    runtime_profile_digest: input.materialization.profile_revision.profile_digest,
    plugin_manifest: pluginManifest,
    plugin_manifest_digest: codexPluginManifestDigest(pluginManifest),
    skill_manifest: skillManifest,
    skill_manifest_digest: codexSkillManifestDigest(skillManifest),
    tool_schema_manifest: toolSchemaManifest,
    tool_schema_digest: codexToolSchemaManifestDigest(toolSchemaManifest),
    mcp_server_manifest: mcpServerManifest,
    mcp_server_manifest_digest: codexMcpManifestDigest(mcpServerManifest),
    app_connector_manifest: appConnectorManifest,
    app_connector_manifest_digest: codexAppConnectorManifestDigest(appConnectorManifest),
    credential_binding_lineage: credentialBindingLineage,
    credential_binding_lineage_digest: codexCredentialLineageDigest(credentialBindingLineage),
    trusted_runtime_manifest: trustedRuntimeManifest,
    trusted_runtime_manifest_digest: codexTrustedRuntimeManifestDigest(trustedRuntimeManifest),
  };
};

export const createRemoteWorkerCapsuleManager = (options: RemoteWorkerCapsuleManagerOptions): RemoteWorkerCapsuleManager => {
  const now = options.now ?? (() => new Date().toISOString());
  const sessionStates = new Map<string, SessionState>();

  const artifactReader = {
    read: async (ref: string, expectedDigest: string): Promise<Uint8Array> =>
      options.controlPlaneClient.downloadInternalArtifact({ ref, expectedDigest }),
  };

  const artifactWriter: CodexRuntimeCapsuleArtifactWriter = {
    write: async (input) => {
      const uploaded = await options.controlPlaneClient.uploadInternalArtifact({
        kind: input.kind,
        ownerType: 'codex_session',
        ownerId: input.ownerId,
        visibility: 'private',
        contentType: 'application/json',
        bytes: input.content,
        idempotencyKey: codexCanonicalDigest({
          kind: input.kind,
          owner_id: input.ownerId,
          artifact_id: input.artifactId,
          digest: input.digest,
        }),
        metadataJson: {
          ...input.metadata,
          artifact_id: input.artifactId,
        },
      });
      if (uploaded.digest !== input.digest || uploaded.digest !== rawSha256Digest(input.content)) {
        throw new Error('codex runtime capsule artifact upload digest mismatch');
      }
      return uploaded;
    },
  };

  const rememberMemory = (codexSessionId: string, input: Omit<SessionState, 'restored'> & { restored?: RestoredCodexRuntimeCapsule }) => {
    sessionStates.set(codexSessionId, input);
  };

  return {
    async materializeBaseMemory(input: RemoteWorkerCapsuleBaseMemoryInput): Promise<void> {
      const bytes = await options.controlPlaneClient.downloadInternalArtifact({
        ref: input.baseMemoryBundleRef,
        expectedDigest: input.baseMemoryBundleDigest,
      });
      const bundle = codexMemoryBundleManifestSchema.parse(parseJsonBytes(bytes)) as CodexMemoryBundleManifest;
      if (bundle.codex_session_id !== input.codexSessionId || codexMemoryBundleDigest(bundle) !== input.baseMemoryBundleDigest) {
        throw new Error('codex runtime capsule base memory bundle mismatch');
      }
      await materializeCodexMemoryBundleToRoot({ root: input.codexHomeHostPath, bundle });
      rememberMemory(input.codexSessionId, {
        baseMemoryBundle: bundle,
        inputMemoryBundle: bundle,
      });
    },

    async restore(input: RemoteWorkerCapsuleRestoreInput): Promise<void> {
      const restored = await restoreCodexRuntimeCapsule({
        codexHomeRoot: input.codexHomeHostPath,
        codexSessionId: input.codexSessionId,
        expectedCapsuleDigest: input.inputCapsuleDigest,
        capsuleRef: input.inputCapsuleRef,
        artifactReader,
        currentCodexCliVersion: options.codexCliVersion,
        currentAppServerProtocolDigest: options.appServerProtocolDigest,
        ...(input.deferLocatorRepair === undefined ? {} : { deferLocatorRepair: input.deferLocatorRepair }),
      });
      rememberMemory(input.codexSessionId, {
        baseMemoryBundle: codexMemoryBundleManifestSchema.parse(
          parseJsonBytes(
            await options.controlPlaneClient.downloadInternalArtifact({
              ref: restored.capsuleManifest.memory_state.base_bundle_ref,
              expectedDigest: restored.capsuleManifest.memory_state.base_bundle_digest,
            }),
          ),
        ) as CodexMemoryBundleManifest,
        inputMemoryBundle: restored.outputMemoryBundle,
        inputCapsuleDigest: input.inputCapsuleDigest,
        restored,
      });
    },

    async repairLocator(input: RemoteWorkerCapsuleLocatorRepairInput): Promise<void> {
      const state = sessionStates.get(input.codexSessionId);
      if (state?.restored === undefined) {
        throw new Error('codex runtime capsule restore state missing');
      }
      await restoreCodexThreadStateBundle({
        codexHomeRoot: input.codexHomeHostPath,
        bundle: state.restored.threadStateBundle,
        locatorRepair: state.restored.threadStateBundle.locator_repair_manifest,
        codexThreadId: input.codexThreadId,
        ...(options.locatorRepairExecutor === undefined ? {} : { repairExecutor: options.locatorRepairExecutor }),
      });
    },

    async package(input: RemoteWorkerCapsulePackageInput): Promise<GenerationOutputCapsulePackageResult> {
      if (input.generationResult.codexThread === undefined) {
        throw new Error('codex runtime capsule requires Codex thread terminal evidence');
      }
      const state = sessionStates.get(input.codexSessionId);
      if (state === undefined) {
        throw new Error('codex runtime capsule input memory state missing');
      }
      if (input.expectedInputCapsuleDigest !== undefined && state.inputCapsuleDigest !== input.expectedInputCapsuleDigest) {
        throw new Error('codex runtime capsule expected input digest mismatch');
      }
      const capsuleId = artifactIdSegment(`${input.codexSessionTurnId}-capsule`);
      const outputMemory = await buildCodexMemoryBundleFromRoot({
        root: input.codexHomeHostPath,
        codexSessionId: input.codexSessionId,
        bundleId: `${input.codexSessionTurnId}-memory-output`,
        sourcePolicyDigest: state.inputMemoryBundle.source_policy_digest,
      });
      const memoryDelta = diffCodexMemoryBundleManifests({
        inputBundle: state.inputMemoryBundle,
        outputBundle: outputMemory.manifest,
        codexSessionId: input.codexSessionId,
        turnId: input.codexSessionTurnId,
      });
      const memoryDeltaDigest = memoryDelta === undefined ? undefined : codexMemoryDeltaDigest(memoryDelta);
      const rolloutRelativePath = await findRolloutRelativePath({
        codexHomeRoot: input.codexHomeHostPath,
        ...(state.restored?.threadStateBundle === undefined ? {} : { restoredThreadStateBundle: state.restored.threadStateBundle }),
      });
      const rolloutContent = await readFile(join(input.codexHomeHostPath, rolloutRelativePath), 'utf8');
      const locatorRepair: CodexThreadLocatorRepairManifest = {
        schema_version: 'codex_thread_locator_repair_manifest.v1',
        codex_thread_id_digest: input.generationResult.codexThread.codex_thread_id_digest,
        rollout_relative_path: rolloutRelativePath,
        rollout_digest: codexCanonicalDigest(rolloutContent),
        repair_strategy: 'app_server_scan',
      };
      codexThreadLocatorRepairManifestDigest(locatorRepair);
      const environmentArtifactRef = buildInternalArtifactRef({
        kind: 'codex_environment_manifest',
        owner_type: 'codex_session',
        owner_id: input.codexSessionId,
        artifact_id: `${capsuleId}-environment-manifest`,
      });
      const environmentManifest = emptyEnvironmentManifest({
        ...input,
        codexCliVersion: options.codexCliVersion,
        appServerProtocolDigest: options.appServerProtocolDigest,
        environmentArtifactRef,
      });
      const environmentManifestDigest = codexEnvironmentManifestDigest(environmentManifest);
      const sequence = (state.restored?.capsuleManifest.sequence ?? 0) + 1;
      const packaged = await packageCodexRuntimeCapsule({
        codexHomeRoot: input.codexHomeHostPath,
        codexSessionId: input.codexSessionId,
        capsuleId,
        createdFromTurnId: input.codexSessionTurnId,
        sequence,
        codexThreadIdDigest: input.generationResult.codexThread.codex_thread_id_digest,
        codexCliVersion: options.codexCliVersion,
        appServerProtocolDigest: options.appServerProtocolDigest,
        locatorRepair,
        memoryState: {
          baseBundle: state.baseMemoryBundle,
          baseBundleDigest: codexMemoryBundleDigest(state.baseMemoryBundle),
          inputBundle: state.inputMemoryBundle,
          inputBundleDigest: codexMemoryBundleDigest(state.inputMemoryBundle),
          outputBundle: outputMemory.manifest,
          outputBundleDigest: outputMemory.digest,
          ...(memoryDelta === undefined || memoryDeltaDigest === undefined ? {} : { delta: memoryDelta, deltaDigest: memoryDeltaDigest }),
        },
        environmentManifest,
        environmentManifestDigest,
        artifactWriter,
      });
      const capsule: CodexRuntimeCapsule = {
        id: capsuleId,
        codex_session_id: input.codexSessionId,
        created_from_turn_id: input.codexSessionTurnId,
        sequence,
        artifact_ref: packaged.artifactRef,
        digest: packaged.digest,
        size_bytes: packaged.artifactSizeBytes,
        manifest_digest: codexRuntimeCapsuleManifestDigest(packaged.manifest),
        thread_state_digest: packaged.threadState.digest,
        memory_state_digest: codexCanonicalDigest(packaged.manifest.memory_state),
        environment_manifest_digest: packaged.manifest.environment_manifest.digest,
        codex_thread_id_digest: input.generationResult.codexThread.codex_thread_id_digest,
        codex_cli_version: options.codexCliVersion,
        app_server_protocol_digest: options.appServerProtocolDigest,
        runtime_profile_revision_id: input.materialization.profile_revision.id,
        trusted_runtime_manifest_digest: environmentManifest.trusted_runtime_manifest_digest,
        credential_binding_lineage_digest: environmentManifest.credential_binding_lineage_digest,
        created_by_actor_id: options.workerId,
        created_at: now(),
      };
      rememberMemory(input.codexSessionId, {
        baseMemoryBundle: state.baseMemoryBundle,
        inputMemoryBundle: outputMemory.manifest,
        inputCapsuleDigest: packaged.digest,
        restored: {
          capsuleManifest: packaged.manifest,
          capsuleManifestDigest: capsule.manifest_digest,
          threadStateBundle: packaged.threadState.bundle,
          environmentManifest,
          outputMemoryBundle: outputMemory.manifest,
        },
      });
      return {
        capsule,
        outputMemoryBundleRef: packaged.manifest.memory_state.output_bundle_ref,
        outputMemoryBundleDigest: outputMemory.digest,
        ...(packaged.manifest.memory_state.delta_ref === undefined
          ? {}
          : { memoryDeltaArtifactRef: packaged.manifest.memory_state.delta_ref }),
        ...(packaged.manifest.memory_state.delta_digest === undefined
          ? {}
          : { memoryDeltaDigest: packaged.manifest.memory_state.delta_digest }),
        outputEnvironmentManifestRef: packaged.manifest.environment_manifest.artifact_ref,
        outputEnvironmentManifestDigest: packaged.manifest.environment_manifest.digest,
      };
    },
  };
};

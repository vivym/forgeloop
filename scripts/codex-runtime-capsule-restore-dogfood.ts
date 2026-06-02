import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertCodexRuntimeCapsulePublicReportSafe,
  buildInternalArtifactRef,
  codexAppConnectorManifestDigest,
  codexCanonicalDigest,
  codexCredentialLineageDigest,
  codexEnvironmentManifestDigest,
  codexMcpManifestDigest,
  codexPluginManifestDigest,
  codexSkillManifestDigest,
  codexToolSchemaManifestDigest,
  codexTrustedRuntimeManifestDigest,
  type InternalArtifactKind,
} from '../packages/domain/src/index';
import {
  buildCodexMemoryBundleFromRoot,
  diffCodexMemoryBundles,
  packageCodexRuntimeCapsule,
  replayCodexMemoryDelta,
  restoreCodexRuntimeCapsule,
  type CapsuleComponentArtifactReader,
  type CodexMemoryBundleMetadata,
  type CodexRuntimeCapsuleArtifactWriter,
  type CodexRuntimeCapsuleDiscoveryReport,
} from '../packages/codex-worker-runtime/src/index';
import { runCodexRuntimeCapsuleDiscoveryDogfood } from './codex-runtime-capsule-discovery';

export const codexRuntimeCapsuleRestoreDogfoodCommand =
  'tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/codex-runtime-capsule-restore-dogfood.ts';

export const codexRuntimeCapsuleRestoreReportPath = 'test-results/codex-runtime-capsule-restore-report.json';

type EnvLike = Record<string, string | undefined>;
type RestoreDogfoodMode = 'real' | 'fake';
type RestoreCheckStatus = 'passed';
type RestoreReasonCode = 'codex_runtime_capsule_restore_credentials_unavailable';

interface PassedRestoreScenarioResult {
  scenario_kind: 'fake_cross_worker_restore';
  discovery_report_digest: string;
  codex_cli_version_digest: string;
  app_server_protocol_digest: string;
  worker_root_count: 2;
  restore_checks: {
    thread_locator_digest_continuity: RestoreCheckStatus;
    memory_output_input_digest_continuity: RestoreCheckStatus;
    memory_delta_replay: RestoreCheckStatus;
    environment_manifest_digest_continuity: RestoreCheckStatus;
    second_capsule_packaged: RestoreCheckStatus;
  };
  memory_delta_operation_counts: Record<'add' | 'modify' | 'delete' | 'rename', number>;
  memory_input_digest: string;
  memory_output_digest: string;
  resumed_memory_input_digest: string;
  environment_manifest_digest: string;
  first_capsule_digest: string;
  second_capsule_digest: string;
  package_sequence_count: 2;
  public_safety: {
    raw_runtime_material: 'excluded';
    report_value_policy: 'digests_status_codes_only';
  };
}

export type CodexRuntimeCapsuleRestoreReport =
  | {
      schema_version: 'codex_runtime_capsule_restore_report.v1';
      status: 'skip';
      reason_code: RestoreReasonCode;
    }
  | {
      schema_version: 'codex_runtime_capsule_restore_report.v1';
      status: 'blocked';
      blocker_codes: string[];
    }
  | ({
      schema_version: 'codex_runtime_capsule_restore_report.v1';
      status: 'passed';
      report_path: string;
    } & PassedRestoreScenarioResult);

export interface CodexRuntimeCapsuleRestoreDogfoodDependencies {
  mode?: RestoreDogfoodMode;
  env?: EnvLike;
  credentialsAvailable?: () => Promise<boolean>;
  discoveryReport?: () => Promise<CodexRuntimeCapsuleDiscoveryReport>;
  executeRestoreScenario?: (input: { discoveryReport: CodexRuntimeCapsuleDiscoveryReport }) => Promise<PassedRestoreScenarioResult>;
}

interface StoredArtifact {
  bytes: Uint8Array;
  digest: string;
}

class InMemoryCapsuleArtifactStore implements CodexRuntimeCapsuleArtifactWriter, CapsuleComponentArtifactReader {
  readonly artifacts = new Map<string, StoredArtifact>();

  async write(input: {
    kind: InternalArtifactKind;
    ownerId: string;
    artifactId: string;
    content: Uint8Array;
    digest: string;
  }): Promise<{ ref: string; digest: string; size_bytes: string }> {
    const ref = buildInternalArtifactRef({
      kind: input.kind,
      owner_type: 'codex_session',
      owner_id: input.ownerId,
      artifact_id: input.artifactId,
    });
    this.artifacts.set(ref, { bytes: input.content, digest: input.digest });
    return {
      ref,
      digest: input.digest,
      size_bytes: String(input.content.byteLength),
    };
  }

  async read(ref: string, expectedDigest: string): Promise<Uint8Array> {
    const artifact = this.artifacts.get(ref);
    if (artifact === undefined) {
      throw new Error('codex runtime capsule restore fake artifact missing');
    }
    if (artifact.digest !== expectedDigest) {
      throw new Error('codex runtime capsule restore fake artifact digest mismatch');
    }
    return artifact.bytes;
  }
}

const reportSchemaVersion = 'codex_runtime_capsule_restore_report.v1';
const safeCodePattern = /^[a-z0-9_]+$/;

const optionalEnv = (env: EnvLike, key: string): string | undefined => {
  const value = env[key]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
};

const modeFromEnv = (env: EnvLike): RestoreDogfoodMode =>
  optionalEnv(env, 'FORGELOOP_CODEX_RUNTIME_CAPSULE_RESTORE_MODE') === 'fake' ? 'fake' : 'real';

const defaultCredentialsAvailable = async (mode: RestoreDogfoodMode, env: EnvLike): Promise<boolean> =>
  mode === 'fake' || optionalEnv(env, 'FORGELOOP_ENABLE_REAL_CODEX_RESTORE_DOGFOOD') === '1';

const sanitizeBlockerCodes = (codes: readonly string[]): string[] => {
  const sanitized = codes.map((code) => (safeCodePattern.test(code) ? code : 'codex_runtime_capsule_restore_unknown_blocker'));
  return [...new Set(sanitized)].sort((left, right) => left.localeCompare(right));
};

const fakeDiscoveryReport = (): CodexRuntimeCapsuleDiscoveryReport => ({
  schema_version: 'codex_runtime_capsule_discovery_report.v1',
  status: 'passed',
  codex_cli_version_digest: codexCanonicalDigest('fake-codex 1.0.0'),
  app_server_protocol_digest: codexCanonicalDigest({ protocol: 'fake-app-server-v1' }),
  path_mutation_counts: {
    thread_state_allowed: 1,
    memory_state_allowed: 1,
    environment_component: 1,
    generated_environment: 0,
    forbidden: 0,
    forbidden_whole_db: 0,
    unknown: 0,
  },
  observed_mutation_count: 3,
  blocker_codes: [],
});

const digest = (value: unknown): string => codexCanonicalDigest(value);

const writeRelativeFile = async (root: string, relativePath: string, content: string): Promise<void> => {
  const path = join(root, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
};

const copyRegularFiles = async (sourceRoot: string, targetRoot: string, relativePrefix = ''): Promise<void> => {
  await mkdir(join(targetRoot, relativePrefix), { recursive: true });
  const entries = await readdir(join(sourceRoot, relativePrefix), { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = relativePrefix.length === 0 ? entry.name : `${relativePrefix}/${entry.name}`;
    if (entry.isDirectory()) {
      await copyRegularFiles(sourceRoot, targetRoot, relativePath);
    } else if (entry.isFile()) {
      await writeRelativeFile(targetRoot, relativePath, await readFile(join(sourceRoot, relativePath), 'utf8'));
    }
  }
};

const operationCounts = (
  operations: readonly { op: 'add' | 'modify' | 'delete' | 'rename' }[],
): Record<'add' | 'modify' | 'delete' | 'rename', number> =>
  operations.reduce(
    (acc, operation) => ({ ...acc, [operation.op]: acc[operation.op] + 1 }),
    { add: 0, modify: 0, delete: 0, rename: 0 },
  );

const fakeEnvironmentManifest = (input: {
  codexSessionId: string;
  codexCliVersion: string;
  appServerProtocolDigest: string;
}): unknown => {
  const pluginManifest = { schema_version: 'codex_plugin_manifest.v1', plugins: [] };
  const skillManifest = { schema_version: 'codex_skill_manifest.v1', skills: [] };
  const toolSchemaManifest = { schema_version: 'codex_tool_schema_manifest.v1', schemas: [] };
  const mcpServerManifest = { schema_version: 'codex_mcp_server_manifest.v1', servers: [] };
  const appConnectorManifest = { schema_version: 'codex_app_connector_manifest.v1', connectors: [] };
  const credentialBindingLineage = { schema_version: 'codex_credential_binding_lineage.v1', bindings: [] };
  const trustedRuntimeManifest = {
    schema_version: 'codex_trusted_runtime_manifest.v1',
    trusted_project_digest: digest({ trusted_project: 'fake-restore' }),
    runtime_profile_revision_id: 'runtime-profile-revision-fake',
    runtime_profile_digest: digest({ runtime_profile: 'fake-restore' }),
    feature_flag_digest: digest({ feature_flags: ['codex-runtime-capsule-restore'] }),
    codex_cli_version: input.codexCliVersion,
    app_server_protocol_digest: input.appServerProtocolDigest,
  };
  return {
    schema_version: 'codex_environment_manifest.v1',
    codex_session_id: input.codexSessionId,
    artifact_ref: buildInternalArtifactRef({
      kind: 'codex_environment_manifest',
      owner_type: 'codex_session',
      owner_id: input.codexSessionId,
      artifact_id: 'environment-manifest',
    }),
    codex_cli_version: input.codexCliVersion,
    app_server_protocol_digest: input.appServerProtocolDigest,
    feature_flag_digest: trustedRuntimeManifest.feature_flag_digest,
    trusted_project_digest: trustedRuntimeManifest.trusted_project_digest,
    runtime_profile_revision_id: trustedRuntimeManifest.runtime_profile_revision_id,
    runtime_profile_digest: trustedRuntimeManifest.runtime_profile_digest,
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

const runFakeCrossWorkerRestoreScenario = async (input: {
  discoveryReport: CodexRuntimeCapsuleDiscoveryReport;
}): Promise<PassedRestoreScenarioResult> => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'forgeloop-capsule-restore-'));
  try {
    const codexSessionId = 'codex-session-restore';
    const codexCliVersion = 'fake-codex 1.0.0';
    const appServerProtocolDigest = input.discoveryReport.app_server_protocol_digest;
    const codexThreadLocatorDigest = digest({ thread_locator: 'fake-cross-worker-restore' });
    const turnA = 'turn-a';
    const turnB = 'turn-b';
    const codexHomeA = join(tempRoot, 'worker-a');
    const codexHomeB = join(tempRoot, 'worker-b');
    const beforeMemoryRoot = join(tempRoot, 'memory-before-a');
    const memoryRootA = join(codexHomeA, 'memories');
    const memoryRootB = join(codexHomeB, 'memories');
    const beforeMemoryRootB = join(tempRoot, 'memory-before-b');
    const rolloutRelativePath = 'sessions/2026/06/03/rollout-restore-dogfood.jsonl';
    const rolloutContent = `${JSON.stringify({
      schema_version: 'codex_runtime_capsule_restore_fake_rollout.v1',
      event_kind: 'turn_context',
      thread_locator_digest: codexThreadLocatorDigest,
    })}\n`;

    await mkdir(codexHomeA, { recursive: true });
    await mkdir(codexHomeB, { recursive: true });
    await writeRelativeFile(codexHomeA, rolloutRelativePath, rolloutContent);
    await writeRelativeFile(beforeMemoryRoot, 'stable.md', 'stable digest input\n');
    await writeRelativeFile(beforeMemoryRoot, 'delete-me.md', 'delete digest input\n');
    await writeRelativeFile(beforeMemoryRoot, 'rename-source.md', 'rename digest input\n');
    await copyRegularFiles(beforeMemoryRoot, memoryRootA);
    await rm(join(memoryRootA, 'delete-me.md'));
    await rename(join(memoryRootA, 'rename-source.md'), join(memoryRootA, 'rename-target.md'));

    const memoryBundleMetadata: CodexMemoryBundleMetadata = {
      bundleId: 'restore-memory',
      sourcePolicyDigest: digest({ source_policy: 'fake-restore-memory' }),
    };
    const inputMemoryBundle = await buildCodexMemoryBundleFromRoot({
      root: beforeMemoryRoot,
      codexSessionId,
      bundleId: memoryBundleMetadata.bundleId,
      sourcePolicyDigest: memoryBundleMetadata.sourcePolicyDigest,
    });
    const outputMemoryBundle = await buildCodexMemoryBundleFromRoot({
      root: memoryRootA,
      codexSessionId,
      bundleId: memoryBundleMetadata.bundleId,
      sourcePolicyDigest: memoryBundleMetadata.sourcePolicyDigest,
    });
    const memoryDelta = await diffCodexMemoryBundles({
      beforeRoot: beforeMemoryRoot,
      afterRoot: memoryRootA,
      inputBundleDigest: inputMemoryBundle.digest,
      codexSessionId,
      turnId: turnA,
      bundleMetadata: memoryBundleMetadata,
    });
    if (memoryDelta === undefined) {
      throw new Error('codex runtime capsule restore fake memory delta missing');
    }

    const environmentManifest = fakeEnvironmentManifest({ codexSessionId, codexCliVersion, appServerProtocolDigest });
    const environmentManifestDigest = codexEnvironmentManifestDigest(environmentManifest);
    const locatorRepair = {
      schema_version: 'codex_thread_locator_repair_manifest.v1' as const,
      codex_thread_id_digest: codexThreadLocatorDigest,
      rollout_relative_path: rolloutRelativePath,
      rollout_digest: digest(rolloutContent),
      repair_strategy: 'app_server_scan' as const,
    };
    const artifactStore = new InMemoryCapsuleArtifactStore();
    const packageA = await packageCodexRuntimeCapsule({
      codexHomeRoot: codexHomeA,
      codexSessionId,
      capsuleId: 'capsule-a',
      createdFromTurnId: turnA,
      sequence: 1,
      codexThreadIdDigest: codexThreadLocatorDigest,
      codexCliVersion,
      appServerProtocolDigest,
      locatorRepair,
      memoryState: {
        baseBundle: inputMemoryBundle.manifest,
        baseBundleDigest: inputMemoryBundle.digest,
        inputBundle: inputMemoryBundle.manifest,
        inputBundleDigest: inputMemoryBundle.digest,
        outputBundle: outputMemoryBundle.manifest,
        outputBundleDigest: outputMemoryBundle.digest,
        delta: memoryDelta,
        deltaDigest: digest(memoryDelta),
      },
      environmentManifest,
      environmentManifestDigest,
      artifactWriter: artifactStore,
    });

    const restored = await restoreCodexRuntimeCapsule({
      codexHomeRoot: codexHomeB,
      codexSessionId,
      expectedCapsuleDigest: packageA.digest,
      capsuleRef: packageA.artifactRef,
      artifactReader: artifactStore,
      currentCodexCliVersion: codexCliVersion,
      currentAppServerProtocolDigest: appServerProtocolDigest,
    });

    if (restored.capsuleManifest.codex_thread_id_digest !== codexThreadLocatorDigest) {
      throw new Error('codex runtime capsule restore fake thread locator digest mismatch');
    }
    if (codexEnvironmentManifestDigest(restored.environmentManifest) !== environmentManifestDigest) {
      throw new Error('codex runtime capsule restore fake environment digest mismatch');
    }

    await copyRegularFiles(beforeMemoryRoot, memoryRootB);
    const replayedDigest = await replayCodexMemoryDelta({
      root: memoryRootB,
      inputBundleDigest: inputMemoryBundle.digest,
      delta: memoryDelta,
      bundleMetadata: memoryBundleMetadata,
    });
    if (replayedDigest !== outputMemoryBundle.digest) {
      throw new Error('codex runtime capsule restore fake replay digest mismatch');
    }

    const resumedMemoryInputBundle = await buildCodexMemoryBundleFromRoot({
      root: memoryRootB,
      codexSessionId,
      bundleId: memoryBundleMetadata.bundleId,
      sourcePolicyDigest: memoryBundleMetadata.sourcePolicyDigest,
    });
    if (resumedMemoryInputBundle.digest !== outputMemoryBundle.digest) {
      throw new Error('codex runtime capsule restore fake memory continuity mismatch');
    }

    await copyRegularFiles(memoryRootB, beforeMemoryRootB);
    await writeRelativeFile(memoryRootB, 'second-turn.md', 'second capsule digest input\n');
    const outputMemoryBundleB = await buildCodexMemoryBundleFromRoot({
      root: memoryRootB,
      codexSessionId,
      bundleId: memoryBundleMetadata.bundleId,
      sourcePolicyDigest: memoryBundleMetadata.sourcePolicyDigest,
    });
    const memoryDeltaB = await diffCodexMemoryBundles({
      beforeRoot: beforeMemoryRootB,
      afterRoot: memoryRootB,
      inputBundleDigest: resumedMemoryInputBundle.digest,
      codexSessionId,
      turnId: turnB,
      bundleMetadata: memoryBundleMetadata,
    });
    if (memoryDeltaB === undefined) {
      throw new Error('codex runtime capsule restore fake second memory delta missing');
    }

    const packageB = await packageCodexRuntimeCapsule({
      codexHomeRoot: codexHomeB,
      codexSessionId,
      capsuleId: 'capsule-b',
      createdFromTurnId: turnB,
      sequence: 2,
      codexThreadIdDigest: codexThreadLocatorDigest,
      codexCliVersion,
      appServerProtocolDigest,
      locatorRepair,
      memoryState: {
        baseBundle: resumedMemoryInputBundle.manifest,
        baseBundleDigest: resumedMemoryInputBundle.digest,
        inputBundle: resumedMemoryInputBundle.manifest,
        inputBundleDigest: resumedMemoryInputBundle.digest,
        outputBundle: outputMemoryBundleB.manifest,
        outputBundleDigest: outputMemoryBundleB.digest,
        delta: memoryDeltaB,
        deltaDigest: digest(memoryDeltaB),
      },
      environmentManifest,
      environmentManifestDigest,
      artifactWriter: artifactStore,
    });

    const counts = operationCounts(memoryDelta.operations);
    if (counts.delete !== 1 || counts.rename !== 1) {
      throw new Error('codex runtime capsule restore fake delete/rename replay coverage missing');
    }

    return {
      scenario_kind: 'fake_cross_worker_restore',
      discovery_report_digest: digest(input.discoveryReport),
      codex_cli_version_digest: input.discoveryReport.codex_cli_version_digest,
      app_server_protocol_digest: appServerProtocolDigest,
      worker_root_count: 2,
      restore_checks: {
        thread_locator_digest_continuity: 'passed',
        memory_output_input_digest_continuity: 'passed',
        memory_delta_replay: 'passed',
        environment_manifest_digest_continuity: 'passed',
        second_capsule_packaged: 'passed',
      },
      memory_delta_operation_counts: counts,
      memory_input_digest: inputMemoryBundle.digest,
      memory_output_digest: outputMemoryBundle.digest,
      resumed_memory_input_digest: resumedMemoryInputBundle.digest,
      environment_manifest_digest: environmentManifestDigest,
      first_capsule_digest: packageA.digest,
      second_capsule_digest: packageB.digest,
      package_sequence_count: 2,
      public_safety: {
        raw_runtime_material: 'excluded',
        report_value_policy: 'digests_status_codes_only',
      },
    };
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
};

const publicSafeReport = <T extends CodexRuntimeCapsuleRestoreReport>(report: T): T => {
  assertCodexRuntimeCapsulePublicReportSafe(report);
  return report;
};

export const runCodexRuntimeCapsuleRestoreDogfood = async (
  dependencies: CodexRuntimeCapsuleRestoreDogfoodDependencies = {},
): Promise<CodexRuntimeCapsuleRestoreReport> => {
  const env = dependencies.env ?? process.env;
  const mode = dependencies.mode ?? modeFromEnv(env);
  const hasCredentials = await (dependencies.credentialsAvailable ?? (() => defaultCredentialsAvailable(mode, env)))();
  if (!hasCredentials) {
    return publicSafeReport({
      schema_version: reportSchemaVersion,
      status: 'skip',
      reason_code: 'codex_runtime_capsule_restore_credentials_unavailable',
    });
  }

  const discoveryReport =
    dependencies.discoveryReport === undefined
      ? mode === 'fake'
        ? fakeDiscoveryReport()
        : await runCodexRuntimeCapsuleDiscoveryDogfood(env)
      : await dependencies.discoveryReport();
  if (discoveryReport.status !== 'passed') {
    return publicSafeReport({
      schema_version: reportSchemaVersion,
      status: 'blocked',
      blocker_codes: sanitizeBlockerCodes(discoveryReport.blocker_codes),
    });
  }

  const scenarioResult =
    dependencies.executeRestoreScenario === undefined
      ? mode === 'fake'
        ? await runFakeCrossWorkerRestoreScenario({ discoveryReport })
        : undefined
      : await dependencies.executeRestoreScenario({ discoveryReport });
  if (scenarioResult === undefined) {
    return publicSafeReport({
      schema_version: reportSchemaVersion,
      status: 'blocked',
      blocker_codes: ['codex_runtime_capsule_restore_real_probe_unavailable'],
    });
  }

  return publicSafeReport({
    schema_version: reportSchemaVersion,
    status: 'passed',
    report_path: codexRuntimeCapsuleRestoreReportPath,
    ...scenarioResult,
  });
};

export const writeCodexRuntimeCapsuleRestoreReport = async (
  report: CodexRuntimeCapsuleRestoreReport,
  path = codexRuntimeCapsuleRestoreReportPath,
): Promise<void> => {
  publicSafeReport(report);
  const absolutePath = resolve(path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
};

export const renderCodexRuntimeCapsuleRestoreSummary = (report: CodexRuntimeCapsuleRestoreReport): string => {
  publicSafeReport(report);
  if (report.status === 'skip') {
    return `SKIP ${report.reason_code}`;
  }
  if (report.status === 'blocked') {
    return `BLOCKED ${report.blocker_codes.join(',')}`;
  }
  return [
    'PASS codex_runtime_capsule_restore_cross_worker_restore',
    `Report: ${report.report_path}`,
    `Discovery report digest: ${report.discovery_report_digest}`,
    `Memory input digest: ${report.memory_input_digest}`,
    `Memory output digest: ${report.memory_output_digest}`,
    `Environment manifest digest: ${report.environment_manifest_digest}`,
    `First capsule digest: ${report.first_capsule_digest}`,
    `Second capsule digest: ${report.second_capsule_digest}`,
    `Restore checks digest: ${digest(report.restore_checks)}`,
  ].join('\n');
};

export const codexRuntimeCapsuleRestoreMain = async (env: EnvLike = process.env): Promise<number> => {
  const report = await runCodexRuntimeCapsuleRestoreDogfood({ env });
  await writeCodexRuntimeCapsuleRestoreReport(report);
  console.log(renderCodexRuntimeCapsuleRestoreSummary(report));
  if (report.status === 'skip') {
    return 0;
  }
  return report.status === 'passed' ? 0 : 1;
};

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await codexRuntimeCapsuleRestoreMain();
}

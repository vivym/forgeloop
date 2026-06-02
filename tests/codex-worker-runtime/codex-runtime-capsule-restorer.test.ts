import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildInternalArtifactRef,
  codexAppConnectorManifestDigest,
  codexCanonicalDigest,
  codexCredentialLineageDigest,
  codexEnvironmentManifestDigest,
  codexMemoryBundleDigest,
  codexMemoryDeltaDigest,
  codexMcpManifestDigest,
  codexPluginManifestDigest,
  codexRuntimeCapsuleManifestDigest,
  codexSkillManifestDigest,
  codexThreadLocatorRepairManifestDigest,
  codexToolSchemaManifestDigest,
  codexTrustedRuntimeManifestDigest,
  type InternalArtifactKind,
} from '@forgeloop/domain';
import { describe, expect, it } from 'vitest';

import {
  restoreCodexRuntimeCapsule,
  type CapsuleComponentArtifactReader,
} from '../../packages/codex-worker-runtime/src/index';

const codexSessionId = 'codex-session-1';
const rolloutRelativePath = 'sessions/2026/06/03/rollout-thread-a.jsonl';
const rolloutContent = '{"type":"turn_context","thread":"redacted"}\n';
const digest = (input: unknown): string => codexCanonicalDigest(input);

const ref = (kind: InternalArtifactKind, artifactId: string, ownerId = codexSessionId): string =>
  buildInternalArtifactRef({ kind, owner_type: 'codex_session', owner_id: ownerId, artifact_id: artifactId });

class MapArtifactReader implements CapsuleComponentArtifactReader {
  constructor(private readonly artifacts: Map<string, Uint8Array>) {}

  async read(ref: string): Promise<Uint8Array> {
    const bytes = this.artifacts.get(ref);
    if (bytes === undefined) {
      throw new Error(`missing artifact: ${ref}`);
    }
    return bytes;
  }
}

const jsonBytes = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));

const makeMemoryBundle = (bundleId: string) => ({
  schema_version: 'codex_memory_bundle_manifest.v1',
  bundle_id: bundleId,
  codex_session_id: codexSessionId,
  source_policy_digest: digest({ source: bundleId }),
  entries: [],
});

const makeEnvironmentManifest = () => {
  const pluginManifest = { schema_version: 'codex_plugin_manifest.v1', plugins: [] };
  const skillManifest = { schema_version: 'codex_skill_manifest.v1', skills: [] };
  const toolSchemaManifest = { schema_version: 'codex_tool_schema_manifest.v1', schemas: [] };
  const mcpServerManifest = { schema_version: 'codex_mcp_server_manifest.v1', servers: [] };
  const appConnectorManifest = { schema_version: 'codex_app_connector_manifest.v1', connectors: [] };
  const credentialBindingLineage = { schema_version: 'codex_credential_binding_lineage.v1', bindings: [] };
  const trustedRuntimeManifest = {
    schema_version: 'codex_trusted_runtime_manifest.v1',
    trusted_project_digest: digest({ project: 'trusted' }),
    runtime_profile_revision_id: 'runtime-revision-a',
    runtime_profile_digest: digest({ runtime: 'profile' }),
    feature_flag_digest: digest({ flags: [] }),
    codex_cli_version: 'codex-cli 1.2.3',
    app_server_protocol_digest: digest({ protocol: 'app-server-v1' }),
  };
  return {
    schema_version: 'codex_environment_manifest.v1',
    codex_session_id: codexSessionId,
    artifact_ref: ref('codex_environment_manifest', 'environment-manifest'),
    codex_cli_version: trustedRuntimeManifest.codex_cli_version,
    app_server_protocol_digest: trustedRuntimeManifest.app_server_protocol_digest,
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

const makeArtifacts = () => {
  const locatorRepairManifest = {
    schema_version: 'codex_thread_locator_repair_manifest.v1',
    codex_thread_id_digest: digest({ thread: 'thread-a' }),
    rollout_relative_path: rolloutRelativePath,
    rollout_digest: digest(rolloutContent),
    repair_strategy: 'app_server_scan',
  };
  const threadBundle = {
    schema_version: 'codex_thread_state_bundle.v1',
    bundle_id: 'capsule-1',
    codex_session_id: codexSessionId,
    locator_repair_manifest: locatorRepairManifest,
    locator_repair_manifest_digest: codexThreadLocatorRepairManifestDigest(locatorRepairManifest),
    entries: [
      {
        relative_path: rolloutRelativePath,
        content: rolloutContent,
        digest: digest(rolloutContent),
        size_bytes: String(Buffer.byteLength(rolloutContent)),
      },
    ],
  };
  const baseMemoryBundle = makeMemoryBundle('base');
  const inputMemoryBundle = makeMemoryBundle('input');
  const outputMemoryBundle = makeMemoryBundle('output');
  const memoryDelta = {
    schema_version: 'codex_memory_delta_manifest.v1',
    codex_session_id: codexSessionId,
    turn_id: 'turn-1',
    input_bundle_digest: codexMemoryBundleDigest(inputMemoryBundle),
    output_bundle_digest: codexMemoryBundleDigest(outputMemoryBundle),
    operations: [{ op: 'add', relative_path: 'memories/session.md', content_digest: digest('session memory\n') }],
  };
  const environmentManifest = makeEnvironmentManifest();
  const capsuleManifest = {
    schema_version: 'codex_runtime_capsule_manifest.v1',
    codex_session_id: codexSessionId,
    created_from_turn_id: 'turn-1',
    sequence: 1,
    codex_thread_id_digest: digest({ thread: 'thread-a' }),
    codex_cli_version: 'codex-cli 1.2.3',
    app_server_protocol_digest: digest({ protocol: 'app-server-v1' }),
    thread_state: { artifact_ref: ref('codex_thread_state_bundle', 'thread-state'), digest: digest(threadBundle) },
    memory_state: {
      base_bundle_ref: ref('codex_memory_bundle', 'memory-base'),
      base_bundle_digest: codexMemoryBundleDigest(baseMemoryBundle),
      input_bundle_ref: ref('codex_memory_bundle', 'memory-input'),
      input_bundle_digest: codexMemoryBundleDigest(inputMemoryBundle),
      output_bundle_ref: ref('codex_memory_bundle', 'memory-output'),
      output_bundle_digest: codexMemoryBundleDigest(outputMemoryBundle),
      delta_ref: ref('codex_memory_delta', 'memory-delta'),
      delta_digest: codexMemoryDeltaDigest(memoryDelta),
    },
    environment_manifest: { artifact_ref: ref('codex_environment_manifest', 'environment-manifest'), digest: codexEnvironmentManifestDigest(environmentManifest) },
    included_files: [rolloutRelativePath],
    excluded_patterns: ['auth.json', 'config.toml'],
    forbidden_patterns_checked: ['auth.json', 'config.toml', 'state_*.sqlite', 'plugins/**'],
  };
  const artifacts = new Map<string, Uint8Array>([
    [ref('codex_runtime_capsule', 'capsule-1'), jsonBytes(capsuleManifest)],
    [capsuleManifest.thread_state.artifact_ref, jsonBytes(threadBundle)],
    [capsuleManifest.memory_state.base_bundle_ref, jsonBytes(baseMemoryBundle)],
    [capsuleManifest.memory_state.input_bundle_ref, jsonBytes(inputMemoryBundle)],
    [capsuleManifest.memory_state.output_bundle_ref, jsonBytes(outputMemoryBundle)],
    [capsuleManifest.memory_state.delta_ref, jsonBytes(memoryDelta)],
    [capsuleManifest.environment_manifest.artifact_ref, jsonBytes(environmentManifest)],
  ]);
  return {
    artifacts,
    capsuleManifest,
    capsuleRef: ref('codex_runtime_capsule', 'capsule-1'),
    capsuleDigest: codexRuntimeCapsuleManifestDigest(capsuleManifest),
    environmentManifest,
    baseMemoryBundle,
  };
};

describe('Codex runtime capsule restorer', () => {
  it('downloads and verifies capsule archive digest before restore', async () => {
    const setup = makeArtifacts();
    const codexHomeRoot = await mkdtemp(join(tmpdir(), 'forgeloop-codex-restore-'));

    const result = await restoreCodexRuntimeCapsule({
      codexHomeRoot,
      codexSessionId,
      expectedCapsuleDigest: setup.capsuleDigest,
      capsuleRef: setup.capsuleRef,
      artifactReader: new MapArtifactReader(setup.artifacts),
      currentCodexCliVersion: 'codex-cli 1.2.3',
      currentAppServerProtocolDigest: digest({ protocol: 'app-server-v1' }),
    });

    expect(result.capsuleManifestDigest).toBe(setup.capsuleDigest);
    await expect(readFile(join(codexHomeRoot, rolloutRelativePath), 'utf8')).resolves.toBe(rolloutContent);
  });

  it('rejects missing component artifact', async () => {
    const setup = makeArtifacts();
    setup.artifacts.delete(setup.capsuleManifest.thread_state.artifact_ref);

    await expect(
      restoreCodexRuntimeCapsule({
        codexHomeRoot: await mkdtemp(join(tmpdir(), 'forgeloop-codex-restore-')),
        codexSessionId,
        expectedCapsuleDigest: setup.capsuleDigest,
        capsuleRef: setup.capsuleRef,
        artifactReader: new MapArtifactReader(setup.artifacts),
        currentCodexCliVersion: 'codex-cli 1.2.3',
        currentAppServerProtocolDigest: digest({ protocol: 'app-server-v1' }),
      }),
    ).rejects.toThrow(/missing artifact/i);
  });

  it('rejects cross-session component ref', async () => {
    const setup = makeArtifacts();
    setup.capsuleManifest.thread_state.artifact_ref = ref('codex_thread_state_bundle', 'thread-state', 'other-session');
    const capsuleBytes = jsonBytes(setup.capsuleManifest);
    setup.artifacts.set(setup.capsuleRef, capsuleBytes);

    await expect(
      restoreCodexRuntimeCapsule({
        codexHomeRoot: await mkdtemp(join(tmpdir(), 'forgeloop-codex-restore-')),
        codexSessionId,
        expectedCapsuleDigest: digest(Buffer.from(capsuleBytes).toString('utf8')),
        capsuleRef: setup.capsuleRef,
        artifactReader: new MapArtifactReader(setup.artifacts),
        currentCodexCliVersion: 'codex-cli 1.2.3',
        currentAppServerProtocolDigest: digest({ protocol: 'app-server-v1' }),
      }),
    ).rejects.toThrow(/component ref|codex session/i);
  });

  it('rejects memory digest mismatch', async () => {
    const setup = makeArtifacts();
    setup.artifacts.set(setup.capsuleManifest.memory_state.base_bundle_ref, jsonBytes({ ...setup.baseMemoryBundle, bundle_id: 'tampered' }));

    await expect(
      restoreCodexRuntimeCapsule({
        codexHomeRoot: await mkdtemp(join(tmpdir(), 'forgeloop-codex-restore-')),
        codexSessionId,
        expectedCapsuleDigest: setup.capsuleDigest,
        capsuleRef: setup.capsuleRef,
        artifactReader: new MapArtifactReader(setup.artifacts),
        currentCodexCliVersion: 'codex-cli 1.2.3',
        currentAppServerProtocolDigest: digest({ protocol: 'app-server-v1' }),
      }),
    ).rejects.toThrow(/memory|digest mismatch/i);
  });

  it('rejects environment manifest digest mismatch', async () => {
    const setup = makeArtifacts();
    setup.artifacts.set(
      setup.capsuleManifest.environment_manifest.artifact_ref,
      jsonBytes({ ...setup.environmentManifest, runtime_profile_revision_id: 'tampered' }),
    );

    await expect(
      restoreCodexRuntimeCapsule({
        codexHomeRoot: await mkdtemp(join(tmpdir(), 'forgeloop-codex-restore-')),
        codexSessionId,
        expectedCapsuleDigest: setup.capsuleDigest,
        capsuleRef: setup.capsuleRef,
        artifactReader: new MapArtifactReader(setup.artifacts),
        currentCodexCliVersion: 'codex-cli 1.2.3',
        currentAppServerProtocolDigest: digest({ protocol: 'app-server-v1' }),
      }),
    ).rejects.toThrow(/environment|digest mismatch/i);
  });

  it('restores into a fresh isolated root only', async () => {
    const setup = makeArtifacts();
    const codexHomeRoot = await mkdtemp(join(tmpdir(), 'forgeloop-codex-restore-'));
    await writeFile(join(codexHomeRoot, 'existing.txt'), 'not fresh\n');

    await expect(
      restoreCodexRuntimeCapsule({
        codexHomeRoot,
        codexSessionId,
        expectedCapsuleDigest: setup.capsuleDigest,
        capsuleRef: setup.capsuleRef,
        artifactReader: new MapArtifactReader(setup.artifacts),
        currentCodexCliVersion: 'codex-cli 1.2.3',
        currentAppServerProtocolDigest: digest({ protocol: 'app-server-v1' }),
      }),
    ).rejects.toThrow(/fresh|empty/i);
  });

  it('never writes auth.json or config.toml', async () => {
    const setup = makeArtifacts();
    const codexHomeRoot = await mkdtemp(join(tmpdir(), 'forgeloop-codex-restore-'));

    await restoreCodexRuntimeCapsule({
      codexHomeRoot,
      codexSessionId,
      expectedCapsuleDigest: setup.capsuleDigest,
      capsuleRef: setup.capsuleRef,
      artifactReader: new MapArtifactReader(setup.artifacts),
      currentCodexCliVersion: 'codex-cli 1.2.3',
      currentAppServerProtocolDigest: digest({ protocol: 'app-server-v1' }),
    });

    await expect(stat(join(codexHomeRoot, 'auth.json'))).rejects.toThrow();
    await expect(stat(join(codexHomeRoot, 'config.toml'))).rejects.toThrow();
  });

  it('fails if app-server protocol digest mismatches', async () => {
    const setup = makeArtifacts();

    await expect(
      restoreCodexRuntimeCapsule({
        codexHomeRoot: await mkdtemp(join(tmpdir(), 'forgeloop-codex-restore-')),
        codexSessionId,
        expectedCapsuleDigest: setup.capsuleDigest,
        capsuleRef: setup.capsuleRef,
        artifactReader: new MapArtifactReader(setup.artifacts),
        currentCodexCliVersion: 'codex-cli 1.2.3',
        currentAppServerProtocolDigest: digest({ protocol: 'other' }),
      }),
    ).rejects.toThrow(/protocol/i);
  });
});

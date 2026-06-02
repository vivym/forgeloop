import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
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
  codexToolSchemaManifestDigest,
  codexTrustedRuntimeManifestDigest,
  parseInternalArtifactRef,
  type InternalArtifactKind,
} from '@forgeloop/domain';
import { describe, expect, it } from 'vitest';

import {
  packageCodexRuntimeCapsule,
  type CodexRuntimeCapsuleArtifactWriter,
  type CodexRuntimeCapsulePackageInput,
} from '../../packages/codex-worker-runtime/src/index';

const codexSessionId = 'codex-session-1';
const capsuleId = 'capsule-1';
const rolloutRelativePath = 'sessions/2026/06/03/rollout-thread-a.jsonl';
const rolloutContent = '{"type":"turn_context","thread":"redacted"}\n';
const digest = (input: unknown): string => codexCanonicalDigest(input);

const ref = (kind: InternalArtifactKind, artifactId: string): string =>
  buildInternalArtifactRef({ kind, owner_type: 'codex_session', owner_id: codexSessionId, artifact_id: artifactId });

const writeCodexHomeFile = async (root: string, relativePath: string, content: string): Promise<void> => {
  const path = join(root, relativePath);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content);
};

class RecordingArtifactWriter implements CodexRuntimeCapsuleArtifactWriter {
  readonly writes: Array<{ kind: InternalArtifactKind; artifactId: string; content: Uint8Array; digest: string }> = [];

  async write(input: {
    kind: InternalArtifactKind;
    ownerId: string;
    artifactId: string;
    content: Uint8Array;
    digest: string;
  }): Promise<{ ref: string; digest: string; size_bytes: string }> {
    this.writes.push({ kind: input.kind, artifactId: input.artifactId, content: input.content, digest: input.digest });
    return {
      ref: buildInternalArtifactRef({
        kind: input.kind,
        owner_type: 'codex_session',
        owner_id: input.ownerId,
        artifact_id: input.artifactId,
      }),
      digest: input.digest,
      size_bytes: String(input.content.byteLength),
    };
  }
}

const makeMemoryBundle = (bundleId: string) => ({
  schema_version: 'codex_memory_bundle_manifest.v1',
  bundle_id: bundleId,
  codex_session_id: codexSessionId,
  source_policy_digest: digest({ source: bundleId }),
  entries: [],
});

const makeMemoryDelta = (inputBundleDigest: string, outputBundleDigest: string) => ({
  schema_version: 'codex_memory_delta_manifest.v1',
  codex_session_id: codexSessionId,
  turn_id: 'turn-1',
  input_bundle_digest: inputBundleDigest,
  output_bundle_digest: outputBundleDigest,
  operations: [{ op: 'add', relative_path: 'memories/session.md', content_digest: digest('session memory\n') }],
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

const makeInput = async (codexHomeRoot?: string): Promise<CodexRuntimeCapsulePackageInput> => {
  const root = codexHomeRoot ?? (await mkdtemp(join(tmpdir(), 'forgeloop-codex-packager-')));
  await writeCodexHomeFile(root, rolloutRelativePath, rolloutContent);
  const baseMemoryBundle = makeMemoryBundle('base');
  const inputMemoryBundle = makeMemoryBundle('input');
  const outputMemoryBundle = makeMemoryBundle('output');
  const memoryDelta = makeMemoryDelta(codexMemoryBundleDigest(inputMemoryBundle), codexMemoryBundleDigest(outputMemoryBundle));
  const environmentManifest = makeEnvironmentManifest();
  return {
    codexHomeRoot: root,
    codexSessionId,
    capsuleId,
    createdFromTurnId: 'turn-1',
    sequence: 1,
    codexThreadIdDigest: digest({ thread: 'thread-a' }),
    codexCliVersion: 'codex-cli 1.2.3',
    appServerProtocolDigest: digest({ protocol: 'app-server-v1' }),
    locatorRepair: {
      schema_version: 'codex_thread_locator_repair_manifest.v1',
      codex_thread_id_digest: digest({ thread: 'thread-a' }),
      rollout_relative_path: rolloutRelativePath,
      rollout_digest: digest(rolloutContent),
      repair_strategy: 'app_server_scan',
    },
    memoryState: {
      baseBundle: baseMemoryBundle,
      baseBundleDigest: codexMemoryBundleDigest(baseMemoryBundle),
      inputBundle: inputMemoryBundle,
      inputBundleDigest: codexMemoryBundleDigest(inputMemoryBundle),
      outputBundle: outputMemoryBundle,
      outputBundleDigest: codexMemoryBundleDigest(outputMemoryBundle),
      delta: memoryDelta,
      deltaDigest: codexMemoryDeltaDigest(memoryDelta),
    },
    environmentManifest,
    environmentManifestDigest: codexEnvironmentManifestDigest(environmentManifest),
  };
};

describe('Codex runtime capsule packager', () => {
  it('uploads thread bundle, memory bundle/delta, environment manifest, then final capsule', async () => {
    const writer = new RecordingArtifactWriter();
    await packageCodexRuntimeCapsule({ ...(await makeInput()), artifactWriter: writer });

    expect(writer.writes.map((write) => write.kind)).toEqual([
      'codex_thread_state_bundle',
      'codex_memory_bundle',
      'codex_memory_bundle',
      'codex_memory_bundle',
      'codex_memory_delta',
      'codex_environment_manifest',
      'codex_runtime_capsule',
    ]);
  });

  it('final manifest includes fetchable refs for memory and environment lineage', async () => {
    const writer = new RecordingArtifactWriter();
    const result = await packageCodexRuntimeCapsule({ ...(await makeInput()), artifactWriter: writer });

    expect(parseInternalArtifactRef(result.manifest.thread_state.artifact_ref)).toMatchObject({ kind: 'codex_thread_state_bundle' });
    expect(parseInternalArtifactRef(result.manifest.memory_state.base_bundle_ref)).toMatchObject({ kind: 'codex_memory_bundle' });
    expect(parseInternalArtifactRef(result.manifest.memory_state.input_bundle_ref)).toMatchObject({ kind: 'codex_memory_bundle' });
    expect(parseInternalArtifactRef(result.manifest.memory_state.output_bundle_ref)).toMatchObject({ kind: 'codex_memory_bundle' });
    expect(parseInternalArtifactRef(result.manifest.memory_state.delta_ref)).toMatchObject({ kind: 'codex_memory_delta' });
    expect(parseInternalArtifactRef(result.manifest.environment_manifest.artifact_ref)).toMatchObject({
      kind: 'codex_environment_manifest',
    });
    expect(result.digest).toBe(codexRuntimeCapsuleManifestDigest(result.manifest));
  });

  it.each(['auth.json', 'config.toml', 'logs_1.sqlite', 'memories_1.sqlite', 'plugins/plugin-a/package.json'])(
    'rejects forbidden file %s',
    async (relativePath) => {
      const root = await mkdtemp(join(tmpdir(), 'forgeloop-codex-packager-'));
      await writeCodexHomeFile(root, relativePath, 'forbidden\n');

      await expect(packageCodexRuntimeCapsule({ ...(await makeInput(root)), artifactWriter: new RecordingArtifactWriter() })).rejects.toMatchObject({
        code: 'codex_runtime_capsule_unknown_path',
      });
    },
  );

  it('rejects symlinks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'forgeloop-codex-packager-'));
    await mkdir(join(root, 'sessions/2026/06/03'), { recursive: true });
    await symlink('/tmp/outside-rollout.jsonl', join(root, rolloutRelativePath));

    await expect(packageCodexRuntimeCapsule({ ...(await makeInput(root)), artifactWriter: new RecordingArtifactWriter() })).rejects.toThrow(
      /symlink/i,
    );
  });

  it('rejects unknown paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'forgeloop-codex-packager-'));
    await writeCodexHomeFile(root, 'unclassified.txt', 'unknown\n');

    await expect(packageCodexRuntimeCapsule({ ...(await makeInput(root)), artifactWriter: new RecordingArtifactWriter() })).rejects.toMatchObject({
      code: 'codex_runtime_capsule_unknown_path',
    });
  });

  it('rejects digest mismatch before upload', async () => {
    const writer = new RecordingArtifactWriter();
    const input = await makeInput();
    await expect(
      packageCodexRuntimeCapsule({
        ...input,
        locatorRepair: { ...input.locatorRepair, rollout_digest: digest('wrong') },
        artifactWriter: writer,
      }),
    ).rejects.toThrow(/digest mismatch/i);
    expect(writer.writes).toEqual([]);
  });

  it('rejects locator repair bound to a different thread digest before upload', async () => {
    const writer = new RecordingArtifactWriter();
    const input = await makeInput();

    await expect(
      packageCodexRuntimeCapsule({
        ...input,
        locatorRepair: { ...input.locatorRepair, codex_thread_id_digest: digest({ thread: 'other-thread' }) },
        artifactWriter: writer,
      }),
    ).rejects.toThrow(/thread locator digest mismatch/i);
    expect(writer.writes).toEqual([]);
  });
});

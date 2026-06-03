import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildInternalArtifactRef,
  codexAppConnectorManifestDigest,
  codexCredentialLineageDigest,
  codexCanonicalDigest,
  codexEnvironmentManifestDigest,
  codexMcpManifestDigest,
  codexPluginManifestDigest,
  codexRuntimeCapsuleManifestDigest,
  codexSkillManifestDigest,
  codexToolSchemaManifestDigest,
  codexTrustedRuntimeManifestDigest,
} from '@forgeloop/domain';
import { describe, expect, it } from 'vitest';

import {
  CodexRuntimeCapsuleMaterializer,
  type CapsuleComponentArtifactReader,
} from '../../packages/codex-worker-runtime/src/index';

const codexSessionId = 'codex-session-1';
const digest = (input: unknown): string => codexCanonicalDigest(input);
const rawDigest = (bytes: Uint8Array): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const ref = (kind: Parameters<typeof buildInternalArtifactRef>[0]['kind'], artifactId: string): string =>
  buildInternalArtifactRef({ kind, owner_type: 'codex_session', owner_id: codexSessionId, artifact_id: artifactId });

class EmptyArtifactReader implements CapsuleComponentArtifactReader {
  async read(): Promise<Uint8Array> {
    throw new Error('unexpected artifact read');
  }
}

class MapArtifactReader implements CapsuleComponentArtifactReader {
  constructor(private readonly artifacts: Map<string, Uint8Array>) {}

  async read(ref: string, expectedDigest: string): Promise<Uint8Array> {
    const bytes = this.artifacts.get(ref);
    if (bytes === undefined) {
      throw new Error(`missing artifact: ${ref}`);
    }
    if (rawDigest(bytes) !== expectedDigest) {
      throw new Error('artifact digest mismatch');
    }
    return bytes;
  }
}

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
  const manifest = {
    schema_version: 'codex_environment_manifest.v1',
    codex_session_id: codexSessionId,
    artifact_ref: ref('codex_environment_manifest', 'environment-a'),
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
  return {
    manifest,
    digest: codexEnvironmentManifestDigest(manifest),
  };
};

const makeEnvironmentManifestWithArtifacts = () => {
  const pluginBytes = new TextEncoder().encode('plugin package bytes');
  const skillBytes = new TextEncoder().encode('skill bundle bytes');
  const pluginManifest = {
    schema_version: 'codex_plugin_manifest.v1',
    plugins: [{
      plugin_id: 'plugin-a',
      source: 'project',
      version: '1.0.0',
      package_ref: ref('codex_plugin_package', 'plugin-a'),
      package_digest: rawDigest(pluginBytes),
      enabled: true,
    }],
  };
  const skillManifest = {
    schema_version: 'codex_skill_manifest.v1',
    skills: [{
      skill_id: 'skill-a',
      source_kind: 'project',
      bundle_ref: ref('codex_skill_bundle', 'skill-a'),
      bundle_digest: rawDigest(skillBytes),
      entrypoint_relative_path: 'SKILL.md',
      enabled: true,
    }],
  };
  const emptyToolSchemaManifest = { schema_version: 'codex_tool_schema_manifest.v1', schemas: [] };
  const emptyMcpServerManifest = { schema_version: 'codex_mcp_server_manifest.v1', servers: [] };
  const emptyAppConnectorManifest = { schema_version: 'codex_app_connector_manifest.v1', connectors: [] };
  const emptyCredentialBindingLineage = { schema_version: 'codex_credential_binding_lineage.v1', bindings: [] };
  const trustedRuntimeManifest = {
    schema_version: 'codex_trusted_runtime_manifest.v1',
    trusted_project_digest: digest({ project: 'trusted' }),
    runtime_profile_revision_id: 'runtime-revision-a',
    runtime_profile_digest: digest({ runtime: 'profile' }),
    feature_flag_digest: digest({ flags: [] }),
    codex_cli_version: 'codex-cli 1.2.3',
    app_server_protocol_digest: digest({ protocol: 'app-server-v1' }),
  };
  const manifest = {
    schema_version: 'codex_environment_manifest.v1',
    codex_session_id: codexSessionId,
    artifact_ref: ref('codex_environment_manifest', 'environment-a'),
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
    tool_schema_manifest: emptyToolSchemaManifest,
    tool_schema_digest: codexToolSchemaManifestDigest(emptyToolSchemaManifest),
    mcp_server_manifest: emptyMcpServerManifest,
    mcp_server_manifest_digest: codexMcpManifestDigest(emptyMcpServerManifest),
    app_connector_manifest: emptyAppConnectorManifest,
    app_connector_manifest_digest: codexAppConnectorManifestDigest(emptyAppConnectorManifest),
    credential_binding_lineage: emptyCredentialBindingLineage,
    credential_binding_lineage_digest: codexCredentialLineageDigest(emptyCredentialBindingLineage),
    trusted_runtime_manifest: trustedRuntimeManifest,
    trusted_runtime_manifest_digest: codexTrustedRuntimeManifestDigest(trustedRuntimeManifest),
  };
  return {
    manifest,
    digest: codexEnvironmentManifestDigest(manifest),
    artifacts: new Map([
      [ref('codex_plugin_package', 'plugin-a'), pluginBytes],
      [ref('codex_skill_bundle', 'skill-a'), skillBytes],
    ]),
  };
};

describe('Codex runtime capsule materializer', () => {
  it('writes trusted config/auth and never copies capsule config/auth files', async () => {
    const codexHomeRoot = await mkdtemp(join(tmpdir(), 'forgeloop-codex-materializer-'));
    const environmentManifest = makeEnvironmentManifest();
    const capsuleManifest = {
      schema_version: 'codex_runtime_capsule_manifest.v1',
      codex_session_id: codexSessionId,
      created_from_turn_id: 'turn-1',
      sequence: 1,
      codex_thread_id_digest: digest({ thread: 'thread-a' }),
      codex_cli_version: 'codex-cli 1.2.3',
      app_server_protocol_digest: digest({ protocol: 'app-server-v1' }),
      thread_state: { artifact_ref: ref('codex_thread_state_bundle', 'thread-state-a'), digest: digest({ thread: 'state' }) },
      memory_state: {
        base_bundle_ref: ref('codex_memory_bundle', 'memory-base'),
        base_bundle_digest: digest({ memory: 'base' }),
        input_bundle_ref: ref('codex_memory_bundle', 'memory-input'),
        input_bundle_digest: digest({ memory: 'input' }),
        output_bundle_ref: ref('codex_memory_bundle', 'memory-output'),
        output_bundle_digest: digest({ memory: 'output' }),
        delta_ref: ref('codex_memory_delta', 'memory-delta'),
        delta_digest: digest({ memory: 'delta' }),
      },
      environment_manifest: { artifact_ref: ref('codex_environment_manifest', 'environment-a'), digest: environmentManifest.digest },
      included_files: ['sessions/2026/06/03/rollout-a.jsonl', 'auth.json', 'config.toml'],
      excluded_patterns: [],
      forbidden_patterns_checked: ['auth.json', 'config.toml'],
    };
    const materializer = new CodexRuntimeCapsuleMaterializer({ artifactReader: new EmptyArtifactReader() });

    const result = await materializer.materialize({
      codexHomeRoot,
      capsuleManifest,
      environmentManifest: environmentManifest.manifest,
      runtimeProfileMaterialization: {
        codexConfigToml: 'approval_policy = "never"\n',
      },
      credentialBindingMaterialization: {
        authJson: { OPENAI_API_KEY: 'sk-test' },
      },
    });

    await expect(readFile(join(codexHomeRoot, 'config.toml'), 'utf8')).resolves.toContain('approval_policy');
    await expect(readFile(join(codexHomeRoot, 'auth.json'), 'utf8')).resolves.toContain('"OPENAI_API_KEY"');
    expect(result.capsuleManifestDigest).toBe(codexRuntimeCapsuleManifestDigest(capsuleManifest));
    expect(result.copiedCapsuleFiles).toContain('sessions/2026/06/03/rollout-a.jsonl');
    expect(result.copiedCapsuleFiles).not.toContain('auth.json');
    expect(result.copiedCapsuleFiles).not.toContain('config.toml');
  });

  it('requires environment validation before writing trusted config/auth', async () => {
    const codexHomeRoot = await mkdtemp(join(tmpdir(), 'forgeloop-codex-materializer-'));
    const capsuleManifest = {
      schema_version: 'codex_runtime_capsule_manifest.v1',
      codex_session_id: codexSessionId,
      created_from_turn_id: 'turn-1',
      sequence: 1,
      codex_thread_id_digest: digest({ thread: 'thread-a' }),
      codex_cli_version: 'codex-cli 1.2.3',
      app_server_protocol_digest: digest({ protocol: 'app-server-v1' }),
      thread_state: { artifact_ref: ref('codex_thread_state_bundle', 'thread-state-a'), digest: digest({ thread: 'state' }) },
      memory_state: {
        base_bundle_ref: ref('codex_memory_bundle', 'memory-base'),
        base_bundle_digest: digest({ memory: 'base' }),
        input_bundle_ref: ref('codex_memory_bundle', 'memory-input'),
        input_bundle_digest: digest({ memory: 'input' }),
        output_bundle_ref: ref('codex_memory_bundle', 'memory-output'),
        output_bundle_digest: digest({ memory: 'output' }),
        delta_ref: ref('codex_memory_delta', 'memory-delta'),
        delta_digest: digest({ memory: 'delta' }),
      },
      environment_manifest: { artifact_ref: ref('codex_environment_manifest', 'environment-a'), digest: digest({ environment: 'manifest' }) },
      included_files: ['sessions/2026/06/03/rollout-a.jsonl', 'auth.json', 'config.toml'],
      excluded_patterns: [],
      forbidden_patterns_checked: ['auth.json', 'config.toml'],
    };
    const materializer = new CodexRuntimeCapsuleMaterializer({ artifactReader: new EmptyArtifactReader() });

    await expect(
      materializer.materialize({
        codexHomeRoot,
        capsuleManifest,
        environmentManifest: undefined,
        runtimeProfileMaterialization: {
          codexConfigToml: 'approval_policy = "never"\n',
        },
        credentialBindingMaterialization: {
          authJson: { OPENAI_API_KEY: 'sk-test' },
        },
      }),
    ).rejects.toThrow(/environment manifest/i);
    await expect(readFile(join(codexHomeRoot, 'config.toml'), 'utf8')).rejects.toThrow();
    await expect(readFile(join(codexHomeRoot, 'auth.json'), 'utf8')).rejects.toThrow();
  });

  it('checks capsule environment digest before writing environment files or trusted config/auth', async () => {
    const codexHomeRoot = await mkdtemp(join(tmpdir(), 'forgeloop-codex-materializer-'));
    const environmentManifest = makeEnvironmentManifestWithArtifacts();
    const capsuleManifest = {
      schema_version: 'codex_runtime_capsule_manifest.v1',
      codex_session_id: codexSessionId,
      created_from_turn_id: 'turn-1',
      sequence: 1,
      codex_thread_id_digest: digest({ thread: 'thread-a' }),
      codex_cli_version: 'codex-cli 1.2.3',
      app_server_protocol_digest: digest({ protocol: 'app-server-v1' }),
      thread_state: { artifact_ref: ref('codex_thread_state_bundle', 'thread-state-a'), digest: digest({ thread: 'state' }) },
      memory_state: {
        base_bundle_ref: ref('codex_memory_bundle', 'memory-base'),
        base_bundle_digest: digest({ memory: 'base' }),
        input_bundle_ref: ref('codex_memory_bundle', 'memory-input'),
        input_bundle_digest: digest({ memory: 'input' }),
        output_bundle_ref: ref('codex_memory_bundle', 'memory-output'),
        output_bundle_digest: digest({ memory: 'output' }),
        delta_ref: ref('codex_memory_delta', 'memory-delta'),
        delta_digest: digest({ memory: 'delta' }),
      },
      environment_manifest: { artifact_ref: ref('codex_environment_manifest', 'environment-a'), digest: digest({ stale: 'environment' }) },
      included_files: ['sessions/2026/06/03/rollout-a.jsonl', 'auth.json', 'config.toml'],
      excluded_patterns: [],
      forbidden_patterns_checked: ['auth.json', 'config.toml'],
    };
    const materializer = new CodexRuntimeCapsuleMaterializer({ artifactReader: new MapArtifactReader(environmentManifest.artifacts) });

    await expect(
      materializer.materialize({
        codexHomeRoot,
        capsuleManifest,
        environmentManifest: environmentManifest.manifest,
        runtimeProfileMaterialization: {
          codexConfigToml: 'approval_policy = "never"\n',
        },
        credentialBindingMaterialization: {
          authJson: { OPENAI_API_KEY: 'sk-test' },
        },
      }),
    ).rejects.toThrow(/environment manifest digest/i);
    await expect(stat(join(codexHomeRoot, 'plugins', 'plugin-a', 'package.bin'))).rejects.toThrow();
    await expect(stat(join(codexHomeRoot, 'skills', 'skill-a', 'bundle.bin'))).rejects.toThrow();
    await expect(stat(join(codexHomeRoot, 'config.toml'))).rejects.toThrow();
    await expect(stat(join(codexHomeRoot, 'auth.json'))).rejects.toThrow();
  });
});

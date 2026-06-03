import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
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
} from '@forgeloop/domain';
import { describe, expect, it } from 'vitest';

import {
  materializeCodexEnvironmentState,
  type CapsuleComponentArtifactReader,
} from '../../packages/codex-worker-runtime/src/index';

const codexSessionId = 'codex-session-1';
const digest = (input: unknown): string => codexCanonicalDigest(input);
const cryptoDigest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const ref = (kind: Parameters<typeof buildInternalArtifactRef>[0]['kind'], artifactId: string): string =>
  buildInternalArtifactRef({ kind, owner_type: 'codex_session', owner_id: codexSessionId, artifact_id: artifactId });

const packageBytes = new TextEncoder().encode('plugin package bytes');
const skillBytes = new TextEncoder().encode('skill bundle bytes');
const packageDigest = `sha256:${cryptoDigest(packageBytes)}`;
const skillDigest = `sha256:${cryptoDigest(skillBytes)}`;

const makeEnvironmentManifest = (override: Partial<Record<string, unknown>> = {}) => {
  const pluginManifest = {
    schema_version: 'codex_plugin_manifest.v1',
    plugins: [
      {
        plugin_id: 'plugin-a',
        source: 'project',
        version: '1.0.0',
        package_ref: ref('codex_plugin_package', 'plugin-a'),
        package_digest: packageDigest,
        enabled: true,
      },
    ],
  };
  const skillManifest = {
    schema_version: 'codex_skill_manifest.v1',
    skills: [
      {
        skill_id: 'skill-a',
        source_kind: 'project',
        bundle_ref: ref('codex_skill_bundle', 'skill-a'),
        bundle_digest: skillDigest,
        entrypoint_relative_path: 'SKILL.md',
        enabled: true,
      },
    ],
  };
  const toolSchemaManifest = {
    schema_version: 'codex_tool_schema_manifest.v1',
    schemas: [
      {
        tool_namespace: 'demo',
        tool_name: 'run',
        schema_payload: { type: 'object', properties: { input: { type: 'string' } } },
        schema_digest: digest({ type: 'object', properties: { input: { type: 'string' } } }),
      },
    ],
  };
  const mcpScopePayload = {
    scopes: ['read'],
    scope_policy_payload: { allow: ['read'] },
    scope_policy_digest: digest({ allow: ['read'] }),
  };
  const mcpCommandPayload = {
    command: 'node',
    args: ['server.js'],
    cwd_policy_payload: { kind: 'codex_home_relative', path: 'mcp/server-a' },
    cwd_policy_digest: digest({ kind: 'codex_home_relative', path: 'mcp/server-a' }),
  };
  const mcpEnvAllowlist = [
    {
      name: 'PUBLIC_VALUE',
      source: 'literal_non_secret',
      value_payload: 'visible',
      value_digest: digest('visible'),
    },
    {
      name: 'OPENAI_API_KEY',
      source: 'credential_binding',
      value_digest: digest({ credential: 'openai' }),
    },
  ];
  const mcpManifest = {
    schema_version: 'codex_mcp_server_manifest.v1',
    servers: [
      {
        server_id: 'server-a',
        command_payload: mcpCommandPayload,
        command_digest: digest(mcpCommandPayload),
        env_allowlist_payload: mcpEnvAllowlist,
        env_allowlist_digest: digest(mcpEnvAllowlist),
        scope_payload: mcpScopePayload,
        scope_digest: digest(mcpScopePayload),
        tool_schema_payload: { tools: [{ name: 'run' }] },
        tool_schema_digest: digest({ tools: [{ name: 'run' }] }),
        enabled: true,
      },
    ],
  };
  const connectorScopePayload = {
    scopes: ['repo:read'],
    scope_policy_payload: { repositories: ['repo-a'] },
    scope_policy_digest: digest({ repositories: ['repo-a'] }),
  };
  const appConnectorManifest = {
    schema_version: 'codex_app_connector_manifest.v1',
    connectors: [
      {
        connector_id: 'github-a',
        app_id: 'github',
        connector_kind: 'oauth',
        connector_schema_payload: { auth: 'oauth' },
        connector_schema_digest: digest({ auth: 'oauth' }),
        tool_schema_payload: { tools: [{ name: 'search' }] },
        tool_schema_digest: digest({ tools: [{ name: 'search' }] }),
        scope_payload: connectorScopePayload,
        scope_digest: digest(connectorScopePayload),
        enabled: true,
      },
    ],
  };
  const credentialBindingLineage = {
    schema_version: 'codex_credential_binding_lineage.v1',
    bindings: [
      {
        connector_id: 'github-a',
        app_id: 'github',
        credential_binding_id: 'binding-a',
        credential_binding_version_id: 'binding-version-a',
        credential_binding_digest: digest({ credential: 'binding-a' }),
        scope_digest: digest(connectorScopePayload),
      },
    ],
  };
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
    mcp_server_manifest: mcpManifest,
    mcp_server_manifest_digest: codexMcpManifestDigest(mcpManifest),
    app_connector_manifest: appConnectorManifest,
    app_connector_manifest_digest: codexAppConnectorManifestDigest(appConnectorManifest),
    credential_binding_lineage: credentialBindingLineage,
    credential_binding_lineage_digest: codexCredentialLineageDigest(credentialBindingLineage),
    trusted_runtime_manifest: trustedRuntimeManifest,
    trusted_runtime_manifest_digest: codexTrustedRuntimeManifestDigest(trustedRuntimeManifest),
    ...override,
  };
  return {
    ...manifest,
    environment_digest: codexEnvironmentManifestDigest(manifest),
  };
};

class MapArtifactReader implements CapsuleComponentArtifactReader {
  constructor(private readonly artifacts: Map<string, Uint8Array>) {}

  async read(ref: string, expectedDigest: string): Promise<Uint8Array> {
    const bytes = this.artifacts.get(ref);
    if (bytes === undefined) {
      throw new Error(`missing artifact: ${ref}`);
    }
    if (`sha256:${cryptoDigest(bytes)}` !== expectedDigest) {
      throw new Error('artifact digest mismatch');
    }
    return bytes;
  }
}

const reader = (artifacts = new Map<string, Uint8Array>([[ref('codex_plugin_package', 'plugin-a'), packageBytes], [ref('codex_skill_bundle', 'skill-a'), skillBytes]])) =>
  new MapArtifactReader(artifacts);

describe('Codex runtime capsule environment state', () => {
  it('materializes enabled plugin packages from codex_plugin_package refs', async () => {
    const targetCodexHomeRoot = await mkdtemp(join(tmpdir(), 'forgeloop-codex-env-'));
    const { environment_digest, ...manifest } = makeEnvironmentManifest();

    const result = await materializeCodexEnvironmentState({ targetCodexHomeRoot, environmentManifest: manifest, artifactReader: reader() });

    expect(result.environmentManifestDigest).toBe(environment_digest);
    await expect(readFile(join(targetCodexHomeRoot, 'generated', 'plugins', 'plugin-a', 'package.bin'), 'utf8')).resolves.toBe(
      'plugin package bytes',
    );
  });

  it('materializes enabled skill bundles from codex_skill_bundle refs', async () => {
    const targetCodexHomeRoot = await mkdtemp(join(tmpdir(), 'forgeloop-codex-env-'));
    const { environment_digest, ...manifest } = makeEnvironmentManifest();

    await materializeCodexEnvironmentState({ targetCodexHomeRoot, environmentManifest: manifest, artifactReader: reader() });

    await expect(readFile(join(targetCodexHomeRoot, 'generated', 'skills', 'skill-a', 'bundle.bin'), 'utf8')).resolves.toBe(
      'skill bundle bytes',
    );
    await expect(readFile(join(targetCodexHomeRoot, 'generated', 'skills', 'skill-a', 'entrypoint.txt'), 'utf8')).resolves.toBe(
      'SKILL.md\n',
    );
  });

  it('requires MCP literal_non_secret env entries to include value payloads', async () => {
    const targetCodexHomeRoot = await mkdtemp(join(tmpdir(), 'forgeloop-codex-env-'));
    const { environment_digest: _environmentDigest, ...base } = makeEnvironmentManifest();
    const mcp_server_manifest = structuredClone(base.mcp_server_manifest);
    delete (mcp_server_manifest.servers[0].env_allowlist_payload[0] as { value_payload?: unknown }).value_payload;
    const manifest = { ...base, mcp_server_manifest, mcp_server_manifest_digest: base.mcp_server_manifest_digest };

    await expect(
      materializeCodexEnvironmentState({ targetCodexHomeRoot, environmentManifest: manifest, artifactReader: reader() }),
    ).rejects.toThrow(/literal_non_secret/i);
  });

  it('digest-checks embedded MCP command cwd policy payloads', async () => {
    const targetCodexHomeRoot = await mkdtemp(join(tmpdir(), 'forgeloop-codex-env-'));
    const { environment_digest: _environmentDigest, ...base } = makeEnvironmentManifest();
    const mcp_server_manifest = structuredClone(base.mcp_server_manifest);
    mcp_server_manifest.servers[0].command_payload.cwd_policy_digest = digest({ stale: true });
    mcp_server_manifest.servers[0].command_digest = digest(mcp_server_manifest.servers[0].command_payload);
    const manifest = { ...base, mcp_server_manifest, mcp_server_manifest_digest: codexMcpManifestDigest(mcp_server_manifest) };

    await expect(
      materializeCodexEnvironmentState({ targetCodexHomeRoot, environmentManifest: manifest, artifactReader: reader() }),
    ).rejects.toThrow(/cwd policy digest/i);
  });

  it('rejects value payloads on MCP env credential and runtime sources', async () => {
    const targetCodexHomeRoot = await mkdtemp(join(tmpdir(), 'forgeloop-codex-env-'));
    const { environment_digest: _environmentDigest, ...base } = makeEnvironmentManifest();
    const mcp_server_manifest = structuredClone(base.mcp_server_manifest);
    (mcp_server_manifest.servers[0].env_allowlist_payload[1] as Record<string, unknown>).value_payload = 'secret';
    const manifest = { ...base, mcp_server_manifest, mcp_server_manifest_digest: base.mcp_server_manifest_digest };

    await expect(
      materializeCodexEnvironmentState({ targetCodexHomeRoot, environmentManifest: manifest, artifactReader: reader() }),
    ).rejects.toThrow(/value_payload/i);
  });

  it('recomputes connector scope policy digests from embedded payloads', async () => {
    const targetCodexHomeRoot = await mkdtemp(join(tmpdir(), 'forgeloop-codex-env-'));
    const { environment_digest: _environmentDigest, ...base } = makeEnvironmentManifest();
    const app_connector_manifest = structuredClone(base.app_connector_manifest);
    app_connector_manifest.connectors[0].scope_payload.scope_policy_digest = digest({ stale: true });
    app_connector_manifest.connectors[0].scope_digest = digest(app_connector_manifest.connectors[0].scope_payload);
    const manifest = { ...base, app_connector_manifest, app_connector_manifest_digest: codexAppConnectorManifestDigest(app_connector_manifest) };

    await expect(
      materializeCodexEnvironmentState({ targetCodexHomeRoot, environmentManifest: manifest, artifactReader: reader() }),
    ).rejects.toThrow(/scope policy digest/i);
  });

  it('digest-checks embedded connector scope payloads', async () => {
    const targetCodexHomeRoot = await mkdtemp(join(tmpdir(), 'forgeloop-codex-env-'));
    const { environment_digest: _environmentDigest, ...base } = makeEnvironmentManifest();
    const app_connector_manifest = structuredClone(base.app_connector_manifest);
    app_connector_manifest.connectors[0].scope_digest = digest({ stale: true });
    const manifest = { ...base, app_connector_manifest, app_connector_manifest_digest: codexAppConnectorManifestDigest(app_connector_manifest) };

    await expect(
      materializeCodexEnvironmentState({ targetCodexHomeRoot, environmentManifest: manifest, artifactReader: reader() }),
    ).rejects.toThrow(/scope digest/i);
  });

  it('recomputes tool schema payload digests from embedded payloads', async () => {
    const targetCodexHomeRoot = await mkdtemp(join(tmpdir(), 'forgeloop-codex-env-'));
    const { environment_digest: _environmentDigest, ...base } = makeEnvironmentManifest();
    const tool_schema_manifest = structuredClone(base.tool_schema_manifest);
    tool_schema_manifest.schemas[0].schema_digest = digest({ stale: true });
    const manifest = { ...base, tool_schema_manifest, tool_schema_digest: codexToolSchemaManifestDigest(tool_schema_manifest) };

    await expect(
      materializeCodexEnvironmentState({ targetCodexHomeRoot, environmentManifest: manifest, artifactReader: reader() }),
    ).rejects.toThrow(/tool schema digest/i);
  });

  it('fails closed when package or bundle refs are missing', async () => {
    const targetCodexHomeRoot = await mkdtemp(join(tmpdir(), 'forgeloop-codex-env-'));
    const { environment_digest: _digest, ...manifest } = makeEnvironmentManifest();

    await expect(
      materializeCodexEnvironmentState({
        targetCodexHomeRoot,
        environmentManifest: manifest,
        artifactReader: reader(new Map([[ref('codex_plugin_package', 'plugin-a'), packageBytes]])),
      }),
    ).rejects.toThrow(/missing artifact/i);
  });

  it('does not leave partial plugin files when a later skill artifact is missing', async () => {
    const targetCodexHomeRoot = await mkdtemp(join(tmpdir(), 'forgeloop-codex-env-'));
    const { environment_digest: _digest, ...manifest } = makeEnvironmentManifest();

    await expect(
      materializeCodexEnvironmentState({
        targetCodexHomeRoot,
        environmentManifest: manifest,
        artifactReader: reader(new Map([[ref('codex_plugin_package', 'plugin-a'), packageBytes]])),
      }),
    ).rejects.toThrow(/missing artifact/i);
    await expect(stat(join(targetCodexHomeRoot, 'plugins', 'plugin-a', 'package.bin'))).rejects.toThrow();
    await expect(stat(join(targetCodexHomeRoot, 'skills', 'skill-a', 'bundle.bin'))).rejects.toThrow();
  });
});

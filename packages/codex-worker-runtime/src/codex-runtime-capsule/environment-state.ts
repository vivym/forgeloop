import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  assertCodexSessionArtifactRef,
  codexAppConnectorManifestDigest,
  codexCanonicalDigest,
  codexCredentialLineageDigest,
  codexEnvironmentManifestDigest,
  codexEnvironmentManifestSchema,
  codexMcpManifestDigest,
  codexPluginManifestDigest,
  codexSkillManifestDigest,
  codexToolSchemaManifestDigest,
  codexTrustedRuntimeManifestDigest,
} from '@forgeloop/domain';
import type { z } from 'zod';

export type CodexEnvironmentManifest = z.infer<typeof codexEnvironmentManifestSchema>;

export interface CapsuleComponentArtifactReader {
  read(ref: string, expectedDigest: string): Promise<Uint8Array>;
}

export interface CodexEnvironmentMaterializationResult {
  environmentManifestDigest: string;
  materializedPluginPackages: readonly string[];
  materializedSkillBundles: readonly string[];
}

export const rawBytesSha256Digest = (bytes: Uint8Array): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const validateComponentId = (value: string, label: string): string => {
  if (!/^[A-Za-z0-9._-]+$/.test(value) || value === '.' || value === '..') {
    throw new Error(`unsafe ${label}: must be a simple path segment`);
  }
  return value;
};

const validateRelativePath = (relativePath: string, label: string): string => {
  if (relativePath.trim() !== relativePath || relativePath.length === 0) {
    throw new Error(`unsafe ${label}: path must be non-empty and canonical`);
  }
  if (relativePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(relativePath) || relativePath.includes('\\')) {
    throw new Error(`unsafe ${label}: absolute paths and backslashes are forbidden`);
  }
  if (relativePath.split('/').some((part) => part.length === 0 || part === '.' || part === '..')) {
    throw new Error(`unsafe ${label}: traversal and empty segments are forbidden`);
  }
  return relativePath;
};

const assertDigest = (actual: string, expected: string, label: string): void => {
  if (actual !== expected) {
    throw new Error(`${label} mismatch`);
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const assertRawMcpEnvPayloadShape = (environmentManifest: unknown): void => {
  if (!isRecord(environmentManifest) || !isRecord(environmentManifest.mcp_server_manifest)) {
    return;
  }
  const servers = environmentManifest.mcp_server_manifest.servers;
  if (!Array.isArray(servers)) {
    return;
  }
  for (const server of servers) {
    if (!isRecord(server) || !Array.isArray(server.env_allowlist_payload)) {
      continue;
    }
    for (const envEntry of server.env_allowlist_payload) {
      if (!isRecord(envEntry)) {
        continue;
      }
      if (envEntry.source === 'literal_non_secret' && !('value_payload' in envEntry)) {
        throw new Error('MCP literal_non_secret env entries require value_payload');
      }
      if ((envEntry.source === 'runtime_profile' || envEntry.source === 'credential_binding') && 'value_payload' in envEntry) {
        throw new Error('MCP runtime_profile and credential_binding env entries must omit value_payload');
      }
    }
  }
};

const assertScopePayloadDigests = (payload: { scope_policy_payload: unknown; scope_policy_digest: string }, scopeDigest: string, label: string): void => {
  assertDigest(codexCanonicalDigest(payload.scope_policy_payload), payload.scope_policy_digest, `${label} scope policy digest`);
  assertDigest(codexCanonicalDigest(payload), scopeDigest, `${label} scope digest`);
};

const assertMcpManifestEmbeddedDigests = (manifest: CodexEnvironmentManifest['mcp_server_manifest']): void => {
  for (const server of manifest.servers) {
    if (server.command_payload.cwd_policy_payload !== undefined || server.command_payload.cwd_policy_digest !== undefined) {
      if (server.command_payload.cwd_policy_payload === undefined || server.command_payload.cwd_policy_digest === undefined) {
        throw new Error('MCP command cwd policy payload and digest must be embedded together');
      }
      assertDigest(
        codexCanonicalDigest(server.command_payload.cwd_policy_payload),
        server.command_payload.cwd_policy_digest,
        'MCP command cwd policy digest',
      );
    }
    assertDigest(codexCanonicalDigest(server.command_payload), server.command_digest, 'MCP command digest');
    for (const envEntry of server.env_allowlist_payload) {
      if (envEntry.source === 'literal_non_secret') {
        if (!('value_payload' in envEntry)) {
          throw new Error('MCP literal_non_secret env entries require value_payload');
        }
        assertDigest(codexCanonicalDigest(envEntry.value_payload), envEntry.value_digest, 'MCP literal_non_secret env value digest');
      } else if ('value_payload' in envEntry) {
        throw new Error('MCP runtime_profile and credential_binding env entries must omit value_payload');
      }
    }
    assertDigest(codexCanonicalDigest(server.env_allowlist_payload), server.env_allowlist_digest, 'MCP env allowlist digest');
    assertScopePayloadDigests(server.scope_payload, server.scope_digest, 'MCP');
    assertDigest(codexCanonicalDigest(server.tool_schema_payload), server.tool_schema_digest, 'MCP tool schema digest');
  }
};

const assertToolSchemaManifestEmbeddedDigests = (manifest: CodexEnvironmentManifest['tool_schema_manifest']): void => {
  for (const schema of manifest.schemas) {
    assertDigest(codexCanonicalDigest(schema.schema_payload), schema.schema_digest, 'tool schema digest');
  }
};

const assertAppConnectorManifestEmbeddedDigests = (manifest: CodexEnvironmentManifest['app_connector_manifest']): void => {
  for (const connector of manifest.connectors) {
    assertDigest(codexCanonicalDigest(connector.connector_schema_payload), connector.connector_schema_digest, 'connector schema digest');
    assertDigest(codexCanonicalDigest(connector.tool_schema_payload), connector.tool_schema_digest, 'connector tool schema digest');
    assertScopePayloadDigests(connector.scope_payload, connector.scope_digest, 'connector');
  }
};

const assertEnvironmentManifestDigests = (manifest: CodexEnvironmentManifest): void => {
  assertDigest(codexPluginManifestDigest(manifest.plugin_manifest), manifest.plugin_manifest_digest, 'plugin manifest digest');
  assertDigest(codexSkillManifestDigest(manifest.skill_manifest), manifest.skill_manifest_digest, 'skill manifest digest');
  assertToolSchemaManifestEmbeddedDigests(manifest.tool_schema_manifest);
  assertDigest(codexToolSchemaManifestDigest(manifest.tool_schema_manifest), manifest.tool_schema_digest, 'tool schema manifest digest');
  assertMcpManifestEmbeddedDigests(manifest.mcp_server_manifest);
  assertDigest(codexMcpManifestDigest(manifest.mcp_server_manifest), manifest.mcp_server_manifest_digest, 'MCP server manifest digest');
  assertAppConnectorManifestEmbeddedDigests(manifest.app_connector_manifest);
  assertDigest(
    codexAppConnectorManifestDigest(manifest.app_connector_manifest),
    manifest.app_connector_manifest_digest,
    'app connector manifest digest',
  );
  assertDigest(
    codexCredentialLineageDigest(manifest.credential_binding_lineage),
    manifest.credential_binding_lineage_digest,
    'credential binding lineage digest',
  );
  assertDigest(
    codexTrustedRuntimeManifestDigest(manifest.trusted_runtime_manifest),
    manifest.trusted_runtime_manifest_digest,
    'trusted runtime manifest digest',
  );
};

export const materializeCodexEnvironmentState = async (input: {
  targetCodexHomeRoot: string;
  environmentManifest: unknown;
  artifactReader: CapsuleComponentArtifactReader;
}): Promise<CodexEnvironmentMaterializationResult> => {
  assertRawMcpEnvPayloadShape(input.environmentManifest);
  const manifest = codexEnvironmentManifestSchema.parse(input.environmentManifest);
  assertEnvironmentManifestDigests(manifest);
  const materializedPluginPackages: string[] = [];
  const materializedSkillBundles: string[] = [];

  for (const plugin of manifest.plugin_manifest.plugins) {
    if (!plugin.enabled) {
      continue;
    }
    assertCodexSessionArtifactRef({
      ref: plugin.package_ref,
      expectedKind: 'codex_plugin_package',
      codexSessionId: manifest.codex_session_id,
    });
    const bytes = await input.artifactReader.read(plugin.package_ref, plugin.package_digest);
    assertDigest(rawBytesSha256Digest(bytes), plugin.package_digest, 'plugin package digest');
    const pluginDir = join(input.targetCodexHomeRoot, 'plugins', validateComponentId(plugin.plugin_id, 'plugin id'));
    await mkdir(pluginDir, { recursive: true });
    const packagePath = join(pluginDir, 'package.bin');
    await writeFile(packagePath, bytes);
    materializedPluginPackages.push(packagePath);
  }

  for (const skill of manifest.skill_manifest.skills) {
    if (!skill.enabled) {
      continue;
    }
    assertCodexSessionArtifactRef({
      ref: skill.bundle_ref,
      expectedKind: 'codex_skill_bundle',
      codexSessionId: manifest.codex_session_id,
    });
    validateRelativePath(skill.entrypoint_relative_path, 'skill entrypoint relative path');
    const bytes = await input.artifactReader.read(skill.bundle_ref, skill.bundle_digest);
    assertDigest(rawBytesSha256Digest(bytes), skill.bundle_digest, 'skill bundle digest');
    const skillDir = join(input.targetCodexHomeRoot, 'skills', validateComponentId(skill.skill_id, 'skill id'));
    await mkdir(skillDir, { recursive: true });
    const bundlePath = join(skillDir, 'bundle.bin');
    await writeFile(bundlePath, bytes);
    await writeFile(join(skillDir, 'entrypoint.txt'), `${skill.entrypoint_relative_path}\n`);
    materializedSkillBundles.push(bundlePath);
  }

  return {
    environmentManifestDigest: codexEnvironmentManifestDigest(manifest),
    materializedPluginPackages,
    materializedSkillBundles,
  };
};

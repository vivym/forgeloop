import { describe, expect, it } from 'vitest';

import {
  DomainError,
  assertCodexRuntimeCapsulePublicReportSafe,
  assertCodexSessionArtifactRef,
  buildInternalArtifactRef,
  codexAppConnectorManifestDigest,
  codexCanonicalDigest,
  codexCredentialLineageDigest,
  codexEnvironmentManifestSchema,
  codexEnvironmentManifestDigest,
  codexMcpManifestDigest,
  codexMemoryBundleDigest,
  codexMemoryDeltaDigest,
  codexPluginManifestDigest,
  codexRuntimeCapsuleDiscoveryReportSchema,
  codexRuntimeCapsuleManifestDigest,
  codexRuntimeCapsuleManifestSchema,
  codexToolSchemaManifestSchema,
  codexSkillManifestDigest,
  codexAppConnectorManifestSchema,
  codexToolSchemaManifestDigest,
  codexTrustedRuntimeManifestDigest,
} from '@forgeloop/domain';
import type { InternalArtifactKind } from '@forgeloop/domain';

const digestA = `sha256:${'a'.repeat(64)}`;
const digestB = `sha256:${'b'.repeat(64)}`;
const digestC = `sha256:${'c'.repeat(64)}`;
const codexSessionId = 'codex-session-1';

const ref = (kind: InternalArtifactKind, artifactId: string, ownerId = codexSessionId): string =>
  buildInternalArtifactRef({
    kind,
    owner_type: 'codex_session',
    owner_id: ownerId,
    artifact_id: artifactId,
  });

const expectDomainErrorCode = (fn: () => unknown, code: string) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    return;
  }
  throw new Error(`Expected DomainError ${code}`);
};

const memoryBundle = {
  schema_version: 'codex_memory_bundle_manifest.v1',
  codex_session_id: codexSessionId,
  bundle_ref: ref('codex_memory_bundle', 'memory-bundle-1'),
  bundle_digest: digestA,
  source: 'codex_home',
  entries: [
    {
      path: 'memory_summary.md',
      content_digest: digestB,
      size_bytes: 128,
    },
  ],
};

const memoryDelta = {
  schema_version: 'codex_memory_delta_manifest.v1',
  codex_session_id: codexSessionId,
  delta_ref: ref('codex_memory_delta', 'memory-delta-1'),
  base_bundle_ref: ref('codex_memory_bundle', 'memory-bundle-1'),
  base_bundle_digest: digestA,
  resulting_bundle_ref: ref('codex_memory_bundle', 'memory-bundle-2'),
  resulting_bundle_digest: digestB,
  operations: [
    { op: 'add', path: 'skills/new/SKILL.md', content_digest: digestA },
    { op: 'modify', path: 'MEMORY.md', before_digest: digestA, after_digest: digestB },
    { op: 'delete', path: 'obsolete.md', before_digest: digestC },
    { op: 'rename', from_path: 'old.md', to_path: 'new.md', content_digest: digestB },
  ],
};

const pluginManifest = {
  schema_version: 'codex_plugin_manifest.v1',
  codex_session_id: codexSessionId,
  packages: [
    {
      package_id: 'browser',
      package_ref: ref('codex_plugin_package', 'plugin-browser'),
      package_digest: digestA,
    },
  ],
};

const skillManifest = {
  schema_version: 'codex_skill_manifest.v1',
  codex_session_id: codexSessionId,
  bundles: [
    {
      skill_id: 'openai-docs',
      bundle_ref: ref('codex_skill_bundle', 'skill-openai-docs'),
      bundle_digest: digestB,
    },
  ],
};

const environmentManifest = {
  schema_version: 'codex_environment_manifest.v1',
  codex_session_id: codexSessionId,
  artifact_ref: ref('codex_environment_manifest', 'environment-manifest-1'),
  mcp: {
    command_payload: {
      command: 'node',
      args: ['server.mjs'],
      transport: 'stdio',
    },
    cwd_policy_payload: {
      mode: 'workspace_root',
      workspace_root_ref: 'workspace:repo',
      allow_subdirectories: true,
    },
    env_allowlist_payload: {
      entries: [
        {
          name: 'FEATURE_FLAG',
          value_payload: {
            kind: 'literal_non_secret',
            value: 'enabled',
          },
        },
      ],
    },
    scope_payload: {
      scope_policy_payload: {
        policy: 'allowlist',
        scopes: ['tools:read', 'files:write'],
      },
    },
  },
  tools: [
    {
      tool_id: 'search',
      schema_payload: {
        type: 'object',
        properties: {
          query: { type: 'string' },
        },
        required: ['query'],
      },
      schema_digest: digestA,
    },
  ],
  app_connectors: [
    {
      connector_id: 'github',
      schema_payload: {
        commands: ['fetch_pr'],
      },
      scope_policy_payload: {
        repositories: ['owner/repo'],
        permissions: ['pull_requests:read'],
      },
      schema_digest: digestB,
    },
  ],
};

const capsuleManifest = {
  schema_version: 'codex_runtime_capsule_manifest.v1',
  codex_session_id: codexSessionId,
  capsule_id: 'capsule-1',
  thread_state: {
    artifact_ref: ref('codex_thread_state_bundle', 'thread-state-1'),
    digest: digestA,
  },
  memory_state: {
    bundle_ref: ref('codex_memory_bundle', 'memory-bundle-1'),
    bundle_digest: codexMemoryBundleDigest(memoryBundle),
    delta_ref: ref('codex_memory_delta', 'memory-delta-1'),
    delta_digest: codexMemoryDeltaDigest(memoryDelta),
  },
  environment_manifest: {
    artifact_ref: ref('codex_environment_manifest', 'environment-manifest-1'),
    digest: codexEnvironmentManifestDigest(environmentManifest),
  },
  plugin_manifest_digest: codexPluginManifestDigest(pluginManifest),
  skill_manifest_digest: codexSkillManifestDigest(skillManifest),
  credential_lineage_digest: codexCredentialLineageDigest({
    schema_version: 'codex_credential_lineage.v1',
    codex_session_id: codexSessionId,
    bindings: [{ binding_id: 'binding-1', source_digest: digestA, resolved_at: '2026-06-02T00:00:00.000Z' }],
  }),
  trusted_runtime_digest: codexTrustedRuntimeManifestDigest({
    schema_version: 'codex_trusted_runtime_manifest.v1',
    codex_session_id: codexSessionId,
    runtime_profile_digest: digestB,
    launcher_digest: digestC,
  }),
};

describe('codex runtime capsule schemas and digests', () => {
  it('computes canonical capsule manifest digest', () => {
    expect(codexRuntimeCapsuleManifestSchema.parse(capsuleManifest)).toEqual(capsuleManifest);
    expect(codexRuntimeCapsuleManifestDigest(capsuleManifest)).toBe(codexCanonicalDigest(capsuleManifest));
  });

  it('computes memory bundle manifest digest', () => {
    expect(codexMemoryBundleDigest(memoryBundle)).toBe(codexCanonicalDigest(memoryBundle));
  });

  it('round-trips memory delta add, modify, delete, and rename operations', () => {
    expect(codexMemoryDeltaDigest(memoryDelta)).toBe(codexCanonicalDigest(memoryDelta));
  });

  it('computes plugin manifest package ref digests and skill manifest bundle digests', () => {
    expect(codexPluginManifestDigest(pluginManifest)).toBe(codexCanonicalDigest(pluginManifest));
    expect(codexSkillManifestDigest(skillManifest)).toBe(codexCanonicalDigest(skillManifest));
  });

  it('round-trips MCP command, cwd policy, literal non-secret env, scope, tool schema, and app connector payloads', () => {
    const parsedEnvironment = codexEnvironmentManifestSchema.parse(environmentManifest);
    const parsedTool = codexToolSchemaManifestSchema.parse(environmentManifest.tools[0]);
    const parsedAppConnector = codexAppConnectorManifestSchema.parse(environmentManifest.app_connectors[0]);
    expect(codexMcpManifestDigest(environmentManifest.mcp)).toBe(codexCanonicalDigest(environmentManifest.mcp));
    expect(codexToolSchemaManifestDigest(environmentManifest.tools[0])).toBe(codexCanonicalDigest(environmentManifest.tools[0]));
    expect(codexAppConnectorManifestDigest(environmentManifest.app_connectors[0])).toBe(
      codexCanonicalDigest(environmentManifest.app_connectors[0]),
    );
    const parsed = codexRuntimeCapsuleManifestSchema.parse(capsuleManifest);
    expect(parsed.environment_manifest).toEqual(capsuleManifest.environment_manifest);
    expect(parsedEnvironment.mcp.command_payload).toEqual(environmentManifest.mcp.command_payload);
    expect(parsedEnvironment.mcp.cwd_policy_payload).toEqual({
      mode: 'workspace_root',
      workspace_root_ref: 'workspace:repo',
      allow_subdirectories: true,
    });
    expect(parsedEnvironment.mcp.env_allowlist_payload.entries[0]?.value_payload).toEqual({
      kind: 'literal_non_secret',
      value: 'enabled',
    });
    expect(parsedEnvironment.mcp.scope_payload.scope_policy_payload).toEqual({
      policy: 'allowlist',
      scopes: ['tools:read', 'files:write'],
    });
    expect(parsedTool.schema_payload).toEqual(environmentManifest.tools[0].schema_payload);
    expect(parsedAppConnector.schema_payload).toEqual(environmentManifest.app_connectors[0].schema_payload);
    expect(parsedAppConnector.scope_policy_payload).toEqual(environmentManifest.app_connectors[0].scope_policy_payload);
  });

  it('computes credential binding lineage and trusted runtime manifest digests', () => {
    const credentialLineage = {
      schema_version: 'codex_credential_lineage.v1',
      codex_session_id: codexSessionId,
      bindings: [{ binding_id: 'binding-1', source_digest: digestA, resolved_at: '2026-06-02T00:00:00.000Z' }],
    };
    const trustedRuntime = {
      schema_version: 'codex_trusted_runtime_manifest.v1',
      codex_session_id: codexSessionId,
      runtime_profile_digest: digestB,
      launcher_digest: digestC,
    };
    expect(codexCredentialLineageDigest(credentialLineage)).toBe(codexCanonicalDigest(credentialLineage));
    expect(codexTrustedRuntimeManifestDigest(trustedRuntime)).toBe(codexCanonicalDigest(trustedRuntime));
  });

  it('rejects product-safe reports containing private runtime material', () => {
    expect(codexRuntimeCapsuleDiscoveryReportSchema.parse({ schema_version: 'codex_runtime_capsule_discovery_report.v1', summary: 'Ready' })).toEqual({
      schema_version: 'codex_runtime_capsule_discovery_report.v1',
      summary: 'Ready',
    });
    for (const unsafe of [
      { codex_thread_id: 'thread-raw' },
      { summary: 'artifact://internal/codex_memory_bundle/codex_session/codex-session-1/bundle' },
      { file: 'auth.json' },
      { file: 'config.toml' },
      { memory_content: 'raw memory text' },
      { path: '/Users/viv/.codex/config.toml' },
    ]) {
      expectDomainErrorCode(() => assertCodexRuntimeCapsulePublicReportSafe(unsafe), 'codex_runtime_capsule_public_report_unsafe');
    }
  });

  it('rejects cross-session component refs and wrong component kinds', () => {
    expect(() =>
      assertCodexSessionArtifactRef({
        ref: ref('codex_memory_bundle', 'memory-bundle-1'),
        expectedKind: 'codex_memory_bundle',
        codexSessionId,
      }),
    ).not.toThrow();
    expectDomainErrorCode(
      () =>
        assertCodexSessionArtifactRef({
          ref: ref('codex_memory_bundle', 'memory-bundle-1', 'other-session'),
          expectedKind: 'codex_memory_bundle',
          codexSessionId,
        }),
      'codex_runtime_capsule_component_ref_invalid',
    );
    expectDomainErrorCode(
      () =>
        assertCodexSessionArtifactRef({
          ref: ref('codex_plugin_package', 'plugin-browser'),
          expectedKind: 'codex_memory_bundle',
          codexSessionId,
        }),
      'codex_runtime_capsule_component_ref_invalid',
    );
    expectDomainErrorCode(
      () =>
        codexRuntimeCapsuleManifestSchema.parse({
          ...capsuleManifest,
          memory_state: {
            ...capsuleManifest.memory_state,
            bundle_ref: ref('codex_memory_bundle', 'memory-bundle-1', 'other-session'),
          },
        }),
      'codex_runtime_capsule_component_ref_invalid',
    );
  });
});

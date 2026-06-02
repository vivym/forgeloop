import { describe, expect, it } from 'vitest';

import {
  DomainError,
  assertCodexRuntimeCapsulePublicReportSafe,
  assertCodexSessionArtifactRef,
  buildInternalArtifactRef,
  codexAppConnectorManifestDigest,
  codexAppConnectorManifestSchema,
  codexCanonicalDigest,
  codexCredentialLineageDigest,
  codexEnvironmentManifestDigest,
  codexEnvironmentManifestSchema,
  codexMcpManifestDigest,
  codexMcpManifestSchema,
  codexMemoryBundleDigest,
  codexMemoryBundleManifestSchema,
  codexMemoryDeltaDigest,
  codexMemoryDeltaManifestSchema,
  codexPluginManifestDigest,
  codexPluginManifestSchema,
  codexRuntimeCapsuleDiscoveryReportSchema,
  codexRuntimeCapsuleManifestDigest,
  codexRuntimeCapsuleManifestSchema,
  codexSkillManifestDigest,
  codexSkillManifestSchema,
  codexThreadLocatorRepairThreadsColumns,
  codexThreadLocatorRepairManifestDigest,
  codexThreadLocatorRepairManifestSchema,
  codexToolSchemaManifestDigest,
  codexToolSchemaManifestSchema,
  codexTrustedRuntimeManifestDigest,
} from '@forgeloop/domain';
import type { InternalArtifactKind } from '@forgeloop/domain';

const digestA = `sha256:${'a'.repeat(64)}`;
const digestB = `sha256:${'b'.repeat(64)}`;
const digestC = `sha256:${'c'.repeat(64)}`;
const digestD = `sha256:${'d'.repeat(64)}`;
const digestE = `sha256:${'e'.repeat(64)}`;
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
  bundle_id: 'memory-bundle-1',
  codex_session_id: codexSessionId,
  created_from_turn_id: 'turn-3',
  source_policy_digest: digestA,
  entries: [
    {
      relative_path: 'memory_summary.md',
      source_kind: 'user_memory',
      content_digest: digestB,
      size_bytes: '128',
      operation: 'present',
    },
    {
      relative_path: 'old-memory.md',
      source_kind: 'session_memory',
      content_digest: digestC,
      size_bytes: '0',
      operation: 'deleted',
    },
  ],
};

const memoryDelta = {
  schema_version: 'codex_memory_delta_manifest.v1',
  codex_session_id: codexSessionId,
  turn_id: 'turn-3',
  input_bundle_digest: digestA,
  output_bundle_digest: digestB,
  operations: [
    { op: 'add', relative_path: 'skills/new/SKILL.md', content_digest: digestA },
    { op: 'modify', relative_path: 'MEMORY.md', before_digest: digestA, after_digest: digestB },
    { op: 'delete', relative_path: 'obsolete.md', before_digest: digestC },
    {
      op: 'rename',
      from_relative_path: 'old.md',
      to_relative_path: 'new.md',
      before_digest: digestD,
      after_digest: digestE,
    },
  ],
};

const pluginManifest = {
  schema_version: 'codex_plugin_manifest.v1',
  plugins: [
    {
      plugin_id: 'browser',
      source: 'openai-bundled',
      version: '26.527.60818',
      package_ref: ref('codex_plugin_package', 'plugin-browser'),
      package_digest: digestA,
      enabled: true,
    },
  ],
};

const skillManifest = {
  schema_version: 'codex_skill_manifest.v1',
  skills: [
    {
      skill_id: 'openai-docs',
      source_kind: 'system',
      bundle_ref: ref('codex_skill_bundle', 'skill-openai-docs'),
      bundle_digest: digestB,
      entrypoint_relative_path: 'SKILL.md',
      enabled: true,
    },
  ],
};

const mcpServerManifest = {
  schema_version: 'codex_mcp_server_manifest.v1',
  servers: [
    {
      server_id: 'filesystem',
      command_payload: {
        command: 'node',
        args: ['server.mjs'],
        cwd_policy_payload: {
          mode: 'workspace_root',
          relative_path: '.',
        },
        cwd_policy_digest: digestA,
      },
      command_digest: digestB,
      env_allowlist_payload: [
        {
          name: 'FEATURE_FLAG',
          source: 'literal_non_secret',
          value_payload: {
            kind: 'literal_non_secret',
            value: 'enabled',
          },
          value_digest: digestC,
        },
      ],
      env_allowlist_digest: digestD,
      scope_payload: {
        scopes: ['tools:read', 'files:write'],
        scope_policy_payload: {
          policy_kind: 'exact',
          allowed_scopes: ['tools:read', 'files:write'],
        },
        scope_policy_digest: digestE,
      },
      scope_digest: digestA,
      tool_schema_payload: {
        type: 'object',
        properties: {
          query: { type: 'string' },
        },
        required: ['query'],
      },
      tool_schema_digest: digestB,
      enabled: true,
    },
  ],
};

const toolSchemaManifest = {
  schema_version: 'codex_tool_schema_manifest.v1',
  schemas: [
    {
      tool_namespace: 'web',
      tool_name: 'search',
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
};

const appConnectorManifest = {
  schema_version: 'codex_app_connector_manifest.v1',
  connectors: [
    {
      connector_id: 'github',
      app_id: 'github',
      connector_kind: 'repository',
      connector_schema_payload: {
        commands: ['fetch_pr'],
      },
      connector_schema_digest: digestA,
      tool_schema_payload: {
        type: 'object',
        properties: {
          pr_number: { type: 'number' },
        },
        required: ['pr_number'],
      },
      tool_schema_digest: digestB,
      scope_payload: {
        scopes: ['pull_requests:read'],
        scope_policy_payload: {
          policy_kind: 'subset',
          allowed_scopes: ['pull_requests:read', 'contents:read'],
        },
        scope_policy_digest: digestC,
      },
      scope_digest: digestD,
      enabled: true,
    },
  ],
};

const credentialLineage = {
  schema_version: 'codex_credential_binding_lineage.v1',
  bindings: [
    {
      connector_id: 'github',
      app_id: 'github',
      credential_binding_id: 'binding-1',
      credential_binding_version_id: 'binding-version-1',
      credential_binding_digest: digestA,
      scope_digest: digestD,
    },
  ],
};

const trustedRuntimeManifest = {
  schema_version: 'codex_trusted_runtime_manifest.v1',
  trusted_project_digest: digestA,
  runtime_profile_revision_id: 'runtime-profile-revision-1',
  runtime_profile_digest: digestB,
  feature_flag_digest: digestC,
  codex_cli_version: '0.133.0',
  app_server_protocol_digest: digestD,
};

const environmentManifest = {
  schema_version: 'codex_environment_manifest.v1',
  codex_session_id: codexSessionId,
  artifact_ref: ref('codex_environment_manifest', 'environment-manifest-1'),
  codex_cli_version: '0.133.0',
  app_server_protocol_digest: digestD,
  feature_flag_digest: digestC,
  trusted_project_digest: digestA,
  runtime_profile_revision_id: 'runtime-profile-revision-1',
  runtime_profile_digest: digestB,
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
  credential_binding_lineage: credentialLineage,
  credential_binding_lineage_digest: codexCredentialLineageDigest(credentialLineage),
  trusted_runtime_manifest: trustedRuntimeManifest,
  trusted_runtime_manifest_digest: codexTrustedRuntimeManifestDigest(trustedRuntimeManifest),
};

const capsuleManifest = {
  schema_version: 'codex_runtime_capsule_manifest.v1',
  codex_session_id: codexSessionId,
  created_from_turn_id: 'turn-3',
  sequence: 3,
  codex_thread_id_digest: digestA,
  codex_cli_version: '0.133.0',
  app_server_protocol_digest: digestD,
  thread_state: {
    artifact_ref: ref('codex_thread_state_bundle', 'thread-state-1'),
    digest: digestB,
  },
  memory_state: {
    base_bundle_ref: ref('codex_memory_bundle', 'memory-base'),
    base_bundle_digest: digestC,
    input_bundle_ref: ref('codex_memory_bundle', 'memory-bundle-1'),
    input_bundle_digest: codexMemoryBundleDigest(memoryBundle),
    output_bundle_ref: ref('codex_memory_bundle', 'memory-bundle-2'),
    output_bundle_digest: digestE,
    delta_ref: ref('codex_memory_delta', 'memory-delta-1'),
    delta_digest: codexMemoryDeltaDigest(memoryDelta),
  },
  environment_manifest: {
    artifact_ref: ref('codex_environment_manifest', 'environment-manifest-1'),
    digest: codexEnvironmentManifestDigest(environmentManifest),
  },
  included_files: ['sessions/2026/06/02/rollout.jsonl'],
  excluded_patterns: ['auth.json', 'config.toml'],
  forbidden_patterns_checked: ['auth.json', 'config.toml', 'logs_*.sqlite*'],
};

describe('codex runtime capsule schemas and digests', () => {
  it('computes canonical capsule manifest digest for the spec manifest shape', () => {
    expect(codexRuntimeCapsuleManifestSchema.parse(capsuleManifest)).toEqual(capsuleManifest);
    expect(codexRuntimeCapsuleManifestDigest(capsuleManifest)).toBe(codexCanonicalDigest(capsuleManifest));
    expect(() => codexRuntimeCapsuleManifestSchema.parse({ ...capsuleManifest, capsule_id: 'legacy-capsule' })).toThrow();
  });

  it('computes memory bundle manifest digest for source-policy entries', () => {
    expect(codexMemoryBundleManifestSchema.parse(memoryBundle)).toEqual(memoryBundle);
    expect(codexMemoryBundleDigest(memoryBundle)).toBe(codexCanonicalDigest(memoryBundle));
  });

  it('round-trips memory delta add, modify, delete, and rename operations', () => {
    expect(codexMemoryDeltaManifestSchema.parse(memoryDelta)).toEqual(memoryDelta);
    expect(codexMemoryDeltaDigest(memoryDelta)).toBe(codexCanonicalDigest(memoryDelta));
    expect(memoryDelta.operations[3]).toMatchObject({
      op: 'rename',
      before_digest: digestD,
      after_digest: digestE,
    });
  });

  it('computes plugin manifest package refs/digests and skill manifest bundle refs/digests', () => {
    expect(codexPluginManifestSchema.parse(pluginManifest)).toEqual(pluginManifest);
    expect(codexSkillManifestSchema.parse(skillManifest)).toEqual(skillManifest);
    expect(codexPluginManifestDigest(pluginManifest)).toBe(codexCanonicalDigest(pluginManifest));
    expect(codexSkillManifestDigest(skillManifest)).toBe(codexCanonicalDigest(skillManifest));
  });

  it('uses environment manifest as embedded restore source of truth', () => {
    const parsedEnvironment = codexEnvironmentManifestSchema.parse(environmentManifest);
    const parsedToolManifest = codexToolSchemaManifestSchema.parse(environmentManifest.tool_schema_manifest);
    const parsedAppConnectorManifest = codexAppConnectorManifestSchema.parse(environmentManifest.app_connector_manifest);
    expect(codexEnvironmentManifestDigest(environmentManifest)).toBe(codexCanonicalDigest(environmentManifest));
    expect(parsedEnvironment.plugin_manifest).toEqual(pluginManifest);
    expect(parsedEnvironment.skill_manifest).toEqual(skillManifest);
    expect(parsedEnvironment.credential_binding_lineage).toEqual(credentialLineage);
    expect(parsedEnvironment.trusted_runtime_manifest).toEqual(trustedRuntimeManifest);
    expect(parsedEnvironment.plugin_manifest_digest).toBe(codexPluginManifestDigest(pluginManifest));
    expect(parsedEnvironment.skill_manifest_digest).toBe(codexSkillManifestDigest(skillManifest));
    expect(parsedEnvironment.tool_schema_digest).toBe(codexToolSchemaManifestDigest(toolSchemaManifest));
    expect(parsedEnvironment.mcp_server_manifest_digest).toBe(codexMcpManifestDigest(mcpServerManifest));
    expect(parsedEnvironment.app_connector_manifest_digest).toBe(codexAppConnectorManifestDigest(appConnectorManifest));
    expect(parsedEnvironment.credential_binding_lineage_digest).toBe(codexCredentialLineageDigest(credentialLineage));
    expect(parsedEnvironment.trusted_runtime_manifest_digest).toBe(codexTrustedRuntimeManifestDigest(trustedRuntimeManifest));
    expect(parsedToolManifest.schemas[0]?.schema_payload).toEqual(toolSchemaManifest.schemas[0]?.schema_payload);
    expect(parsedAppConnectorManifest.connectors[0]?.connector_schema_payload).toEqual(
      appConnectorManifest.connectors[0]?.connector_schema_payload,
    );
    expect(parsedAppConnectorManifest.connectors[0]?.scope_payload.scope_policy_payload).toEqual(
      appConnectorManifest.connectors[0]?.scope_payload.scope_policy_payload,
    );
  });

  it('round-trips MCP command, cwd policy, literal non-secret env, and scope payloads', () => {
    const parsedMcp = codexEnvironmentManifestSchema.parse(environmentManifest).mcp_server_manifest;
    expect(codexMcpManifestDigest(mcpServerManifest)).toBe(codexCanonicalDigest(mcpServerManifest));
    expect(parsedMcp.servers[0]?.command_payload).toEqual(mcpServerManifest.servers[0]?.command_payload);
    expect(parsedMcp.servers[0]?.command_payload.cwd_policy_payload).toEqual({
      mode: 'workspace_root',
      relative_path: '.',
    });
    expect(parsedMcp.servers[0]?.env_allowlist_payload[0]?.value_payload).toEqual({
      kind: 'literal_non_secret',
      value: 'enabled',
    });
    expect(parsedMcp.servers[0]?.scope_payload.scope_policy_payload).toEqual({
      policy_kind: 'exact',
      allowed_scopes: ['tools:read', 'files:write'],
    });
  });

  it('enforces MCP env payload materialization rules', () => {
    const server = mcpServerManifest.servers[0];
    expect(() =>
      codexMcpManifestSchema.parse({
        ...mcpServerManifest,
        servers: [
          {
            ...server,
            env_allowlist_payload: [
              {
                name: 'FEATURE_FLAG',
                source: 'literal_non_secret',
                value_digest: digestC,
              },
            ],
          },
        ],
      }),
    ).toThrow();
    for (const source of ['runtime_profile', 'credential_binding'] as const) {
      expect(() =>
        codexMcpManifestSchema.parse({
          ...mcpServerManifest,
          servers: [
            {
              ...server,
              env_allowlist_payload: [
                {
                  name: 'SECRET_TOKEN',
                  source,
                  value_payload: {
                    value: 'must-not-be-embedded',
                  },
                  value_digest: digestC,
                },
              ],
            },
          ],
        }),
      ).toThrow();
    }
  });

  it('computes credential binding lineage and trusted runtime manifest digests', () => {
    expect(codexCredentialLineageDigest(credentialLineage)).toBe(codexCanonicalDigest(credentialLineage));
    expect(codexTrustedRuntimeManifestDigest(trustedRuntimeManifest)).toBe(codexCanonicalDigest(trustedRuntimeManifest));
  });

  it('validates locator repair manifests with safe rollout paths and minimal DB repair rows', () => {
    const manifest = {
      schema_version: 'codex_thread_locator_repair_manifest.v1',
      codex_thread_id_digest: digestA,
      rollout_relative_path: 'sessions/2026/06/02/rollout-abc.jsonl',
      rollout_digest: digestB,
      repair_strategy: 'minimal_state_index_upsert',
      required_state_tables: [
        {
          table_name: 'threads',
          allowed_columns: [...codexThreadLocatorRepairThreadsColumns],
          row_digest: digestC,
        },
      ],
    };

    expect(codexThreadLocatorRepairManifestSchema.parse(manifest)).toEqual(manifest);
    expect(codexThreadLocatorRepairManifestDigest(manifest)).toBe(codexCanonicalDigest(manifest));
    expect(() =>
      codexThreadLocatorRepairManifestSchema.parse({
        ...manifest,
        codex_session_id: codexSessionId,
        repair_id: 'legacy-repair',
        locator_digest: digestD,
      }),
    ).toThrow();
    for (const rollout_relative_path of [
      '/Users/viv/.codex/sessions/2026/06/02/rollout-abc.jsonl',
      '../sessions/2026/06/02/rollout-abc.jsonl',
      'config.toml',
      'sessions/2026/06/02/not-rollout.jsonl',
    ]) {
      expect(() => codexThreadLocatorRepairManifestSchema.parse({ ...manifest, rollout_relative_path })).toThrow();
    }
    expect(() => codexThreadLocatorRepairManifestSchema.parse({ ...manifest, required_state_tables: undefined })).toThrow();
    expect(() => codexThreadLocatorRepairManifestSchema.parse({ ...manifest, required_state_tables: [] })).toThrow();
    expect(() =>
      codexThreadLocatorRepairManifestSchema.parse({
        ...manifest,
        required_state_tables: [{ table_name: 'sessions', allowed_columns: [...codexThreadLocatorRepairThreadsColumns], row_digest: digestC }],
      }),
    ).toThrow();
    expect(() =>
      codexThreadLocatorRepairManifestSchema.parse({
        ...manifest,
        required_state_tables: [{ table_name: 'threads', allowed_columns: ['id', 'rollout_path'], row_digest: digestC }],
      }),
    ).toThrow();
    expect(() => codexThreadLocatorRepairManifestSchema.parse({ ...manifest, repair_strategy: 'app_server_scan' })).toThrow();
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
      { rollout_relative_path: 'sessions/2026/06/02/rollout-abc.jsonl' },
      { summary: 'Resumed from rollout-abc.jsonl' },
      { summary: 'Resumed from sessions/2026/06/02/rollout-abc.jsonl' },
    ]) {
      expectDomainErrorCode(() => assertCodexRuntimeCapsulePublicReportSafe(unsafe), 'codex_runtime_capsule_public_report_unsafe');
      expect(() => codexRuntimeCapsuleDiscoveryReportSchema.parse({ schema_version: 'codex_runtime_capsule_discovery_report.v1', ...unsafe })).toThrow();
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
            input_bundle_ref: ref('codex_memory_bundle', 'memory-bundle-1', 'other-session'),
          },
        }),
      'codex_runtime_capsule_component_ref_invalid',
    );
    expectDomainErrorCode(
      () =>
        codexEnvironmentManifestSchema.parse({
          ...environmentManifest,
          plugin_manifest: {
            ...pluginManifest,
            plugins: [
              {
                ...pluginManifest.plugins[0],
                package_ref: ref('codex_plugin_package', 'plugin-browser', 'other-session'),
              },
            ],
          },
        }),
      'codex_runtime_capsule_component_ref_invalid',
    );
  });
});

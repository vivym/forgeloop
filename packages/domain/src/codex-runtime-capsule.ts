import { z } from 'zod';

import { codexCanonicalDigest } from './codex-runtime.js';
import { parseInternalArtifactRef, type InternalArtifactKind } from './internal-artifacts.js';
import { DomainError } from './types.js';

const sha256DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const nonEmptyStringSchema = z.string().min(1);
const decimalSizeSchema = z.string().regex(/^(0|[1-9][0-9]*)$/);
const jsonLiteralSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([jsonLiteralSchema, z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)]),
);
const jsonObjectSchema = z.record(z.string(), jsonValueSchema);

const capsuleComponentRefInvalid = (message: string, details?: Record<string, unknown>): DomainError =>
  new DomainError('codex_runtime_capsule_component_ref_invalid', message, details);

const capsulePublicReportUnsafe = (message: string, details?: Record<string, unknown>): DomainError =>
  new DomainError('codex_runtime_capsule_public_report_unsafe', message, details);

export const assertCodexSessionArtifactRef = (input: {
  ref: string;
  expectedKind: InternalArtifactKind;
  codexSessionId: string;
}): void => {
  let parsed;
  try {
    parsed = parseInternalArtifactRef(input.ref);
  } catch (error) {
    throw capsuleComponentRefInvalid('Codex runtime capsule component ref is invalid.', {
      ref: input.ref,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (
    parsed.kind !== input.expectedKind ||
    parsed.owner_type !== 'codex_session' ||
    parsed.owner_id !== input.codexSessionId
  ) {
    throw capsuleComponentRefInvalid('Codex runtime capsule component ref must match the codex session and component kind.', {
      ref: input.ref,
      expected_kind: input.expectedKind,
      codex_session_id: input.codexSessionId,
      actual_kind: parsed.kind,
      actual_owner_type: parsed.owner_type,
      actual_owner_id: parsed.owner_id,
    });
  }
};

const assertManifestRefs = (codexSessionId: string, checks: readonly { ref: string; kind: InternalArtifactKind }[]): void => {
  for (const check of checks) {
    assertCodexSessionArtifactRef({
      ref: check.ref,
      expectedKind: check.kind,
      codexSessionId,
    });
  }
};

const withSessionRefValidation = <Schema extends z.ZodTypeAny>(
  schema: Schema,
  refs: (manifest: z.output<Schema>) => readonly { ref: string; kind: InternalArtifactKind }[],
): Schema =>
  schema.superRefine((manifest) => {
    assertManifestRefs((manifest as { codex_session_id: string }).codex_session_id, refs(manifest));
  }) as Schema;

const withEnvironmentRefValidation = <Schema extends z.ZodTypeAny>(
  schema: Schema,
  refs: (manifest: z.output<Schema>) => readonly { ref: string; kind: InternalArtifactKind }[],
): Schema =>
  schema.superRefine((manifest) => {
    assertManifestRefs((manifest as { codex_session_id: string }).codex_session_id, refs(manifest));
  }) as Schema;

export const codexMemoryBundleManifestSchema = z.object({
  schema_version: z.literal('codex_memory_bundle_manifest.v1'),
  bundle_id: nonEmptyStringSchema,
  codex_session_id: nonEmptyStringSchema,
  created_from_turn_id: nonEmptyStringSchema.optional(),
  source_policy_digest: sha256DigestSchema,
  entries: z.array(
    z.object({
      relative_path: nonEmptyStringSchema,
      source_kind: z.enum(['user_memory', 'project_memory', 'session_memory', 'rollout_summary_reference']),
      content_digest: sha256DigestSchema,
      size_bytes: decimalSizeSchema,
      operation: z.enum(['present', 'deleted']).optional(),
    }).strict(),
  ),
}).strict();

const memoryDeltaOperationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), relative_path: nonEmptyStringSchema, content_digest: sha256DigestSchema }).strict(),
  z.object({ op: z.literal('modify'), relative_path: nonEmptyStringSchema, before_digest: sha256DigestSchema, after_digest: sha256DigestSchema }).strict(),
  z.object({ op: z.literal('delete'), relative_path: nonEmptyStringSchema, before_digest: sha256DigestSchema }).strict(),
  z.object({
    op: z.literal('rename'),
    from_relative_path: nonEmptyStringSchema,
    to_relative_path: nonEmptyStringSchema,
    before_digest: sha256DigestSchema,
    after_digest: sha256DigestSchema,
  }).strict(),
]);

export const codexMemoryDeltaManifestSchema = z.object({
  schema_version: z.literal('codex_memory_delta_manifest.v1'),
  codex_session_id: nonEmptyStringSchema,
  turn_id: nonEmptyStringSchema,
  input_bundle_digest: sha256DigestSchema,
  output_bundle_digest: sha256DigestSchema,
  operations: z.array(memoryDeltaOperationSchema).min(1),
}).strict();

export const codexPluginManifestSchema = z.object({
  schema_version: z.literal('codex_plugin_manifest.v1'),
  plugins: z.array(
    z.object({
      plugin_id: nonEmptyStringSchema,
      source: nonEmptyStringSchema,
      version: nonEmptyStringSchema,
      package_ref: z.string(),
      package_digest: sha256DigestSchema,
      enabled: z.boolean(),
    }).strict(),
  ),
}).strict();

export const codexSkillManifestSchema = z.object({
  schema_version: z.literal('codex_skill_manifest.v1'),
  skills: z.array(
    z.object({
      skill_id: nonEmptyStringSchema,
      source_kind: z.enum(['project', 'user', 'plugin', 'system']),
      bundle_ref: z.string(),
      bundle_digest: sha256DigestSchema,
      entrypoint_relative_path: nonEmptyStringSchema,
      enabled: z.boolean(),
    }).strict(),
  ),
}).strict();

const scopePayloadSchema = z.object({
  scopes: z.array(nonEmptyStringSchema),
  scope_policy_payload: jsonObjectSchema,
  scope_policy_digest: sha256DigestSchema,
}).strict();

export const codexMcpManifestSchema = z.object({
  schema_version: z.literal('codex_mcp_server_manifest.v1'),
  servers: z.array(
    z.object({
      server_id: nonEmptyStringSchema,
      command_payload: z.object({
        command: nonEmptyStringSchema,
        args: z.array(z.string()),
        cwd_policy_payload: jsonObjectSchema.optional(),
        cwd_policy_digest: sha256DigestSchema.optional(),
      }).strict(),
      command_digest: sha256DigestSchema,
      env_allowlist_payload: z.array(
        z.object({
          name: nonEmptyStringSchema,
          value_payload: jsonValueSchema.optional(),
          value_digest: sha256DigestSchema.optional(),
          source: z.enum(['runtime_profile', 'credential_binding', 'literal_non_secret']),
        }).strict(),
      ),
      env_allowlist_digest: sha256DigestSchema,
      scope_payload: scopePayloadSchema,
      scope_digest: sha256DigestSchema,
      tool_schema_payload: jsonValueSchema,
      tool_schema_digest: sha256DigestSchema,
      enabled: z.boolean(),
    }).strict(),
  ),
}).strict();

export const codexToolSchemaManifestSchema = z.object({
  schema_version: z.literal('codex_tool_schema_manifest.v1'),
  schemas: z.array(
    z.object({
      tool_namespace: nonEmptyStringSchema,
      tool_name: nonEmptyStringSchema,
      schema_payload: jsonValueSchema,
      schema_digest: sha256DigestSchema,
    }).strict(),
  ),
}).strict();

export const codexAppConnectorManifestSchema = z.object({
  schema_version: z.literal('codex_app_connector_manifest.v1'),
  connectors: z.array(
    z.object({
      connector_id: nonEmptyStringSchema,
      app_id: nonEmptyStringSchema,
      connector_kind: nonEmptyStringSchema,
      connector_schema_payload: jsonValueSchema,
      connector_schema_digest: sha256DigestSchema,
      tool_schema_payload: jsonValueSchema,
      tool_schema_digest: sha256DigestSchema,
      scope_payload: scopePayloadSchema,
      scope_digest: sha256DigestSchema,
      enabled: z.boolean(),
    }).strict(),
  ),
}).strict();

export const codexCredentialLineageManifestSchema = z.object({
  schema_version: z.literal('codex_credential_binding_lineage.v1'),
  bindings: z.array(
    z.object({
      connector_id: nonEmptyStringSchema,
      app_id: nonEmptyStringSchema,
      credential_binding_id: nonEmptyStringSchema,
      credential_binding_version_id: nonEmptyStringSchema,
      credential_binding_digest: sha256DigestSchema,
      scope_digest: sha256DigestSchema,
    }).strict(),
  ),
}).strict();

export const codexTrustedRuntimeManifestSchema = z.object({
  schema_version: z.literal('codex_trusted_runtime_manifest.v1'),
  trusted_project_digest: sha256DigestSchema,
  runtime_profile_revision_id: nonEmptyStringSchema,
  runtime_profile_digest: sha256DigestSchema,
  feature_flag_digest: sha256DigestSchema,
  codex_cli_version: nonEmptyStringSchema,
  app_server_protocol_digest: sha256DigestSchema,
}).strict();

export const codexEnvironmentManifestSchema = withEnvironmentRefValidation(
  z.object({
    schema_version: z.literal('codex_environment_manifest.v1'),
    codex_session_id: nonEmptyStringSchema,
    artifact_ref: z.string(),
    codex_cli_version: nonEmptyStringSchema,
    app_server_protocol_digest: sha256DigestSchema,
    feature_flag_digest: sha256DigestSchema,
    trusted_project_digest: sha256DigestSchema,
    runtime_profile_revision_id: nonEmptyStringSchema,
    runtime_profile_digest: sha256DigestSchema,
    plugin_manifest: codexPluginManifestSchema,
    plugin_manifest_digest: sha256DigestSchema,
    skill_manifest: codexSkillManifestSchema,
    skill_manifest_digest: sha256DigestSchema,
    tool_schema_manifest: codexToolSchemaManifestSchema,
    tool_schema_digest: sha256DigestSchema,
    mcp_server_manifest: codexMcpManifestSchema,
    mcp_server_manifest_digest: sha256DigestSchema,
    app_connector_manifest: codexAppConnectorManifestSchema,
    app_connector_manifest_digest: sha256DigestSchema,
    credential_binding_lineage: codexCredentialLineageManifestSchema,
    credential_binding_lineage_digest: sha256DigestSchema,
    trusted_runtime_manifest: codexTrustedRuntimeManifestSchema,
    trusted_runtime_manifest_digest: sha256DigestSchema,
  }).strict(),
  (manifest) => [
    { ref: manifest.artifact_ref, kind: 'codex_environment_manifest' },
    ...manifest.plugin_manifest.plugins.map((plugin) => ({ ref: plugin.package_ref, kind: 'codex_plugin_package' as const })),
    ...manifest.skill_manifest.skills.map((skill) => ({ ref: skill.bundle_ref, kind: 'codex_skill_bundle' as const })),
  ],
);

export const codexRuntimeCapsuleManifestSchema = withSessionRefValidation(
  z.object({
    schema_version: z.literal('codex_runtime_capsule_manifest.v1'),
    codex_session_id: nonEmptyStringSchema,
    created_from_turn_id: nonEmptyStringSchema,
    sequence: z.number().int().nonnegative(),
    codex_thread_id_digest: sha256DigestSchema,
    codex_cli_version: nonEmptyStringSchema,
    app_server_protocol_digest: sha256DigestSchema,
    thread_state: z.object({
      artifact_ref: z.string(),
      digest: sha256DigestSchema,
    }).strict(),
    memory_state: z.object({
      base_bundle_ref: z.string(),
      base_bundle_digest: sha256DigestSchema,
      input_bundle_ref: z.string(),
      input_bundle_digest: sha256DigestSchema,
      output_bundle_ref: z.string(),
      output_bundle_digest: sha256DigestSchema,
      delta_ref: z.string(),
      delta_digest: sha256DigestSchema,
    }).strict(),
    environment_manifest: z.object({
      artifact_ref: z.string(),
      digest: sha256DigestSchema,
    }).strict(),
    included_files: z.array(z.string()),
    excluded_patterns: z.array(z.string()),
    forbidden_patterns_checked: z.array(z.string()),
  }).strict(),
  (manifest) => [
    { ref: manifest.thread_state.artifact_ref, kind: 'codex_thread_state_bundle' },
    { ref: manifest.memory_state.base_bundle_ref, kind: 'codex_memory_bundle' },
    { ref: manifest.memory_state.input_bundle_ref, kind: 'codex_memory_bundle' },
    { ref: manifest.memory_state.output_bundle_ref, kind: 'codex_memory_bundle' },
    { ref: manifest.memory_state.delta_ref, kind: 'codex_memory_delta' },
    { ref: manifest.environment_manifest.artifact_ref, kind: 'codex_environment_manifest' },
  ],
);

export const codexThreadLocatorRepairManifestSchema = z.object({
  schema_version: z.literal('codex_thread_locator_repair_manifest.v1'),
  codex_session_id: nonEmptyStringSchema,
  repair_id: nonEmptyStringSchema,
  locator_digest: sha256DigestSchema,
  repaired_locator_digest: sha256DigestSchema,
  evidence_digest: sha256DigestSchema,
}).strict();

export const codexRuntimeCapsuleDiscoveryReportSchema = z.record(z.string(), jsonValueSchema).superRefine((value) => {
  assertCodexRuntimeCapsulePublicReportSafe(value);
});

const unsafeReportKeyPattern = /(?:^|_)(?:codex_thread_id|memory_content)(?:_|$)/;
const absoluteHostPathPattern = /(?:^|[\s"'=])(?:\/(?!\/)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+|[A-Za-z]:[\\/])/;

const assertPublicReportSafeRecord = (value: unknown, path: readonly string[]): void => {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string' ||
    Array.isArray(value) ||
    (typeof value === 'object' && value !== null)
  ) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw capsulePublicReportUnsafe('Codex runtime capsule public report must be JSON-compatible.', { field: path.join('.') });
    }
    if (typeof value === 'string') {
      if (
        value.includes('artifact://internal/') ||
        value.includes('auth.json') ||
        value.includes('config.toml') ||
        /\bmemory content\b/i.test(value) ||
        absoluteHostPathPattern.test(value)
      ) {
        throw capsulePublicReportUnsafe('Codex runtime capsule public report contains private runtime material.', {
          field: path.join('.'),
        });
      }
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => assertPublicReportSafeRecord(entry, [...path, String(index)]));
      return;
    }
    if (typeof value === 'object' && value !== null) {
      for (const [key, entry] of Object.entries(value)) {
        const entryPath = [...path, key];
        if (unsafeReportKeyPattern.test(key) || key === 'auth.json' || key === 'config.toml') {
          throw capsulePublicReportUnsafe('Codex runtime capsule public report contains private runtime material.', {
            field: entryPath.join('.'),
          });
        }
        assertPublicReportSafeRecord(entry, entryPath);
      }
    }
    return;
  }
  throw capsulePublicReportUnsafe('Codex runtime capsule public report must be JSON-compatible.', { field: path.join('.') });
};

export const assertCodexRuntimeCapsulePublicReportSafe = (value: unknown): void => {
  assertPublicReportSafeRecord(value, []);
};

const digestParsed = <Schema extends z.ZodTypeAny>(schema: Schema, input: unknown): string => codexCanonicalDigest(schema.parse(input));

export const codexRuntimeCapsuleManifestDigest = (manifest: unknown): string =>
  digestParsed(codexRuntimeCapsuleManifestSchema, manifest);

export const codexMemoryBundleDigest = (manifest: unknown): string => digestParsed(codexMemoryBundleManifestSchema, manifest);
export const codexMemoryBundleManifestDigest = codexMemoryBundleDigest;

export const codexMemoryDeltaDigest = (manifest: unknown): string => digestParsed(codexMemoryDeltaManifestSchema, manifest);
export const codexMemoryDeltaManifestDigest = codexMemoryDeltaDigest;

export const codexEnvironmentManifestDigest = (manifest: unknown): string => digestParsed(codexEnvironmentManifestSchema, manifest);

export const codexPluginManifestDigest = (manifest: unknown): string => digestParsed(codexPluginManifestSchema, manifest);

export const codexSkillManifestDigest = (manifest: unknown): string => digestParsed(codexSkillManifestSchema, manifest);

export const codexMcpManifestDigest = (manifest: unknown): string => digestParsed(codexMcpManifestSchema, manifest);

export const codexToolSchemaManifestDigest = (manifest: unknown): string => digestParsed(codexToolSchemaManifestSchema, manifest);

export const codexAppConnectorManifestDigest = (manifest: unknown): string => digestParsed(codexAppConnectorManifestSchema, manifest);

export const codexCredentialLineageDigest = (manifest: unknown): string => digestParsed(codexCredentialLineageManifestSchema, manifest);

export const codexTrustedRuntimeManifestDigest = (manifest: unknown): string => digestParsed(codexTrustedRuntimeManifestSchema, manifest);

export const codexThreadLocatorRepairDigest = (manifest: unknown): string =>
  digestParsed(codexThreadLocatorRepairManifestSchema, manifest);
export const codexThreadLocatorRepairManifestDigest = codexThreadLocatorRepairDigest;

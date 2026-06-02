import { z } from 'zod';

import { codexCanonicalDigest } from './codex-runtime.js';
import {
  parseInternalArtifactRef,
  type InternalArtifactKind,
} from './internal-artifacts.js';
import { DomainError } from './types.js';

const sha256DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const nonEmptyStringSchema = z.string().min(1);
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

const assertManifestRefs = (manifest: { codex_session_id: string }, checks: readonly { ref: string; kind: InternalArtifactKind }[]): void => {
  for (const check of checks) {
    assertCodexSessionArtifactRef({
      ref: check.ref,
      expectedKind: check.kind,
      codexSessionId: manifest.codex_session_id,
    });
  }
};

const withRefValidation = <Schema extends z.ZodTypeAny>(
  schema: Schema,
  refs: (manifest: z.output<Schema>) => readonly { ref: string; kind: InternalArtifactKind }[],
): Schema =>
  schema.superRefine((manifest) => {
    assertManifestRefs(manifest as { codex_session_id: string }, refs(manifest));
  }) as Schema;

export const codexMemoryBundleManifestSchema = withRefValidation(
  z.object({
    schema_version: z.literal('codex_memory_bundle_manifest.v1'),
    codex_session_id: nonEmptyStringSchema,
    bundle_ref: z.string(),
    bundle_digest: sha256DigestSchema,
    source: nonEmptyStringSchema,
    entries: z.array(
      z.object({
        path: nonEmptyStringSchema,
        content_digest: sha256DigestSchema,
        size_bytes: z.number().int().nonnegative(),
      }),
    ),
  }).strict(),
  (manifest) => [{ ref: manifest.bundle_ref, kind: 'codex_memory_bundle' }],
);

const memoryDeltaOperationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), path: nonEmptyStringSchema, content_digest: sha256DigestSchema }).strict(),
  z.object({ op: z.literal('modify'), path: nonEmptyStringSchema, before_digest: sha256DigestSchema, after_digest: sha256DigestSchema }).strict(),
  z.object({ op: z.literal('delete'), path: nonEmptyStringSchema, before_digest: sha256DigestSchema }).strict(),
  z.object({ op: z.literal('rename'), from_path: nonEmptyStringSchema, to_path: nonEmptyStringSchema, content_digest: sha256DigestSchema }).strict(),
]);

export const codexMemoryDeltaManifestSchema = withRefValidation(
  z.object({
    schema_version: z.literal('codex_memory_delta_manifest.v1'),
    codex_session_id: nonEmptyStringSchema,
    delta_ref: z.string(),
    base_bundle_ref: z.string(),
    base_bundle_digest: sha256DigestSchema,
    resulting_bundle_ref: z.string(),
    resulting_bundle_digest: sha256DigestSchema,
    operations: z.array(memoryDeltaOperationSchema).min(1),
  }).strict(),
  (manifest) => [
    { ref: manifest.delta_ref, kind: 'codex_memory_delta' },
    { ref: manifest.base_bundle_ref, kind: 'codex_memory_bundle' },
    { ref: manifest.resulting_bundle_ref, kind: 'codex_memory_bundle' },
  ],
);

export const codexPluginManifestSchema = withRefValidation(
  z.object({
    schema_version: z.literal('codex_plugin_manifest.v1'),
    codex_session_id: nonEmptyStringSchema,
    packages: z.array(
      z.object({
        package_id: nonEmptyStringSchema,
        package_ref: z.string(),
        package_digest: sha256DigestSchema,
      }).strict(),
    ),
  }).strict(),
  (manifest) => manifest.packages.map((entry) => ({ ref: entry.package_ref, kind: 'codex_plugin_package' })),
);

export const codexSkillManifestSchema = withRefValidation(
  z.object({
    schema_version: z.literal('codex_skill_manifest.v1'),
    codex_session_id: nonEmptyStringSchema,
    bundles: z.array(
      z.object({
        skill_id: nonEmptyStringSchema,
        bundle_ref: z.string(),
        bundle_digest: sha256DigestSchema,
      }).strict(),
    ),
  }).strict(),
  (manifest) => manifest.bundles.map((entry) => ({ ref: entry.bundle_ref, kind: 'codex_skill_bundle' })),
);

export const codexMcpManifestSchema = z.object({
  command_payload: jsonObjectSchema,
  cwd_policy_payload: jsonObjectSchema,
  env_allowlist_payload: z.object({
    entries: z.array(
      z.object({
        name: nonEmptyStringSchema,
        value_payload: z.object({
          kind: z.literal('literal_non_secret'),
          value: z.string(),
        }).strict(),
      }).strict(),
    ),
  }).strict(),
  scope_payload: z.object({
    scope_policy_payload: jsonObjectSchema,
  }).strict(),
}).strict();

export const codexToolSchemaManifestSchema = z.object({
  tool_id: nonEmptyStringSchema,
  schema_payload: jsonObjectSchema,
  schema_digest: sha256DigestSchema,
}).strict();

export const codexAppConnectorManifestSchema = z.object({
  connector_id: nonEmptyStringSchema,
  schema_payload: jsonObjectSchema,
  scope_policy_payload: jsonObjectSchema,
  schema_digest: sha256DigestSchema,
}).strict();

export const codexEnvironmentManifestSchema = withRefValidation(
  z.object({
    schema_version: z.literal('codex_environment_manifest.v1'),
    codex_session_id: nonEmptyStringSchema,
    artifact_ref: z.string(),
    mcp: codexMcpManifestSchema,
    tools: z.array(codexToolSchemaManifestSchema),
    app_connectors: z.array(codexAppConnectorManifestSchema),
  }).strict(),
  (manifest) => [{ ref: manifest.artifact_ref, kind: 'codex_environment_manifest' }],
);

export const codexCredentialLineageManifestSchema = z.object({
  schema_version: z.literal('codex_credential_lineage.v1'),
  codex_session_id: nonEmptyStringSchema,
  bindings: z.array(
    z.object({
      binding_id: nonEmptyStringSchema,
      source_digest: sha256DigestSchema,
      resolved_at: nonEmptyStringSchema,
    }).strict(),
  ),
}).strict();

export const codexTrustedRuntimeManifestSchema = z.object({
  schema_version: z.literal('codex_trusted_runtime_manifest.v1'),
  codex_session_id: nonEmptyStringSchema,
  runtime_profile_digest: sha256DigestSchema,
  launcher_digest: sha256DigestSchema,
}).strict();

export const codexRuntimeCapsuleManifestSchema = withRefValidation(
  z.object({
    schema_version: z.literal('codex_runtime_capsule_manifest.v1'),
    codex_session_id: nonEmptyStringSchema,
    capsule_id: nonEmptyStringSchema,
    thread_state: z.object({
      artifact_ref: z.string(),
      digest: sha256DigestSchema,
    }).strict(),
    memory_state: z.object({
      bundle_ref: z.string(),
      bundle_digest: sha256DigestSchema,
      delta_ref: z.string().optional(),
      delta_digest: sha256DigestSchema.optional(),
    }).strict(),
    environment_manifest: z.object({
      artifact_ref: z.string(),
      digest: sha256DigestSchema,
    }).strict(),
    plugin_manifest_digest: sha256DigestSchema,
    skill_manifest_digest: sha256DigestSchema,
    credential_lineage_digest: sha256DigestSchema,
    trusted_runtime_digest: sha256DigestSchema,
  }).strict(),
  (manifest) => [
    { ref: manifest.thread_state.artifact_ref, kind: 'codex_thread_state_bundle' },
    { ref: manifest.memory_state.bundle_ref, kind: 'codex_memory_bundle' },
    ...(manifest.memory_state.delta_ref === undefined ? [] : [{ ref: manifest.memory_state.delta_ref, kind: 'codex_memory_delta' as const }]),
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

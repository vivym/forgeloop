import { artifactKindSchema, requiredCheckSpecSchema } from '@forgeloop/contracts';
import { z } from 'zod';

import type { GeneratedPackageDraftSetV1, GeneratedPlanDraftV1, GeneratedSpecDraftV1 } from './types.js';

const nonBlank = z.string().trim().min(1);
const keySlug = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/);
const safePackageSetKey = z.string().trim().min(1).refine((value) => !isUnsafePublicString(value));
const repoRelativePath = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.startsWith('~') &&
      !value.includes('..') &&
      !/^[A-Za-z]:[\\/]/.test(value) &&
      !/[\u0000-\u001f\u007f]/.test(value),
    { message: 'path must be repo-relative and safe' },
  );

const unixLocalPathPattern = /(?:^|[\s"'(=])(\/[A-Za-z0-9._-]+(?:\/[^\s"'`,;)]*)?)/gi;
const homeRelativePathPattern = /(?:^|[\s"'(=])~[\\/][^\s"'`,;)]*/i;
const publicRoutePathPattern = /^\/(?:api|v\d+(?:\.\d+)?|graphql|health|status|auth|oauth)(?:\/|$)/i;
const windowsLocalPathPattern = /[A-Za-z]:[\\/][^\s"'`,;)]*/i;
const secretLikePattern =
  /(?:claim[-_ ]?token|hmac[-_ ]?(?:key|token|secret|material)|secret(?:[-_ ]?(?:key|token|material))?|api[-_ ]?key|raw\s+(?:prompt|output|log)s?)/i;
const rawPromptOutputLogMarkerPattern = /(?:\b(?:BEGIN|END)\s+(?:PROMPT|OUTPUT|LOG)\b|\bAPP\s+SERVER\s+LOG\b:?)/i;
const rawBlockBoundaryMarkerPattern = /\b(?:BEGIN|END)\b/;
const bypassHumanGatePattern =
  /(?:(?:\b(?:bypass(?:es|ing)?|skip|without\s+(?:waiting\s+for\s+)?(?:human\s+)?(?:review|approval|gate))\b[\s\S]{0,80}\b(?:approve|submit|enqueue\s+(?:package\s+)?run|merge|push|release|deploy)\b)|(?:\b(?:approve|submit|enqueue\s+(?:package\s+)?run|merge|push|release|deploy)\b[\s\S]{0,80}\b(?:bypass(?:es|ing)?|skip|without\s+(?:waiting\s+for\s+)?(?:human\s+)?(?:review|approval|gate))\b))/i;
const gatedPlanActionPattern =
  /(?:\b(?:approve|submit|merge|push|release|deploy)\b|\benqueue\s+(?:the\s+)?(?:package\s+)?run\b)/gi;
const planActionContextWindow = 80;
const planActionClauseBoundaries = ['.', '!', '?', ';', ',', '\n'] as const;

const hasUnsafeUnixLocalPath = (value: string): boolean =>
  Array.from(value.matchAll(unixLocalPathPattern)).some((match) => {
    const path = match[1];
    return path !== undefined && !publicRoutePathPattern.test(path);
  });

const isUnsafePublicString = (value: string): boolean =>
  hasUnsafeUnixLocalPath(value) ||
  homeRelativePathPattern.test(value) ||
  windowsLocalPathPattern.test(value) ||
  secretLikePattern.test(value) ||
  rawPromptOutputLogMarkerPattern.test(value) ||
  rawBlockBoundaryMarkerPattern.test(value) ||
  bypassHumanGatePattern.test(value);

const previousPlanActionBoundary = (value: string, actionIndex: number): number =>
  Math.max(...planActionClauseBoundaries.map((boundary) => value.lastIndexOf(boundary, actionIndex)));

const nextPlanActionBoundary = (value: string, actionIndex: number): number =>
  planActionClauseBoundaries
    .map((boundary) => value.indexOf(boundary, actionIndex))
    .filter((index) => index >= 0)
    .reduce((left, right) => Math.min(left, right), value.length);

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const isPlanActionSafelyScopedOut = (clause: string, action: string): boolean => {
  const escapedAction = escapeRegExp(action.toLowerCase().startsWith('enqueue') ? 'enqueue' : action);
  const actionPattern = new RegExp(
    `(?:\\bdo\\s+not\\b[\\s\\S]{0,40}\\b${escapedAction}\\b|\\b(?:no|exclude|excludes|excluding)\\b[\\s\\S]{0,40}\\b${escapedAction}\\b|\\b${escapedAction}\\b[\\s\\S]{0,40}\\b(?:excluded|out\\s+of\\s+scope)\\b)`,
    'i',
  );
  return actionPattern.test(clause);
};

const isUnsafePlanString = (value: string): boolean =>
  isUnsafePublicString(value) ||
  Array.from(value.matchAll(gatedPlanActionPattern)).some((match) => {
    const actionIndex = match.index ?? 0;
    const action = match[0] ?? '';
    const previousBoundary = previousPlanActionBoundary(value, actionIndex);
    const nextBoundary = nextPlanActionBoundary(value, actionIndex);
    const clause = value.slice(
      Math.max(previousBoundary + 1, actionIndex - planActionContextWindow),
      Math.min(nextBoundary, actionIndex + planActionContextWindow),
    );
    return !isPlanActionSafelyScopedOut(clause, action);
  });

const safeParseOrThrow = <T>(schema: z.ZodType<T>, value: unknown, errorCode: string): T => {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(errorCode);
  }
  return result.data;
};

const assertPublicSafeText = (value: unknown, errorCode: string): void => {
  if (typeof value === 'string') {
    if (isUnsafePublicString(value)) {
      throw new Error(errorCode);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => assertPublicSafeText(entry, errorCode));
    return;
  }

  if (value !== null && typeof value === 'object') {
    Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
      assertPublicSafeText(key, errorCode);
      assertPublicSafeText(entry, errorCode);
    });
  }
};

const assertPlanPublicSafeText = (value: unknown, errorCode: string): void => {
  if (typeof value === 'string') {
    if (isUnsafePlanString(value)) {
      throw new Error(errorCode);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => assertPlanPublicSafeText(entry, errorCode));
    return;
  }

  if (value !== null && typeof value === 'object') {
    Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
      assertPlanPublicSafeText(key, errorCode);
      assertPlanPublicSafeText(entry, errorCode);
    });
  }
};

const assertUniqueStrings = (values: string[], errorCode: string): void => {
  if (new Set(values).size !== values.length) {
    throw new Error(errorCode);
  }
};

const assertUniqueCheckIds = (checks: Array<{ check_id: string }>): void => {
  assertUniqueStrings(
    checks.map((check) => check.check_id),
    'generated_package_policy_invalid',
  );
};

export const generatedSpecDraftSchema = z
  .object({
    schema_version: z.literal('spec_draft.v1'),
    summary: nonBlank,
    content: nonBlank,
    background: nonBlank,
    goals: z.array(nonBlank).min(1),
    scope_in: z.array(nonBlank).min(1),
    scope_out: z.array(nonBlank),
    acceptance_criteria: z.array(nonBlank).min(1),
    risk_notes: z.array(nonBlank),
    test_strategy_summary: nonBlank,
    structured_document: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const generatedPlanDraftSchema = z
  .object({
    schema_version: z.literal('plan_draft.v1'),
    summary: nonBlank,
    content: nonBlank,
    implementation_summary: nonBlank,
    split_strategy: nonBlank,
    dependency_order: z.array(keySlug).min(1),
    test_matrix: z.array(nonBlank).min(1),
    risk_mitigations: z.array(nonBlank),
    rollback_notes: nonBlank,
    structured_document: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const generatedPackageDraftSetSchema = z
  .object({
    schema_version: z.literal('package_drafts.v1'),
    manifest: z
      .object({
        manifest_version: z.literal('execution_package_manifest.v1'),
        package_set_key: safePackageSetKey,
        package_count: z.number().int().positive(),
        dependency_order: z.array(keySlug).min(1),
      })
      .strict(),
    packages: z
      .array(
        z
          .object({
            package_key: keySlug,
            repo_id: nonBlank,
            objective: nonBlank,
            required_checks: z.array(requiredCheckSpecSchema.strict()).min(1),
            required_artifact_kinds: z.array(artifactKindSchema).min(1),
            allowed_paths: z.array(repoRelativePath),
            forbidden_paths: z.array(repoRelativePath),
            source_mutation_policy: z.enum(['path_policy_scoped', 'no_source_changes']),
            required_test_gates: z.array(z.record(z.string(), z.unknown())).optional(),
            validation_strategy: z.literal('checks_required').optional(),
            structured_document: z.record(z.string(), z.unknown()).optional(),
          })
          .strict(),
      )
      .min(1),
    dependencies: z.array(
      z
        .object({
          package_key: keySlug,
          depends_on_package_key: keySlug,
          dependency_type: nonBlank.optional(),
          reason: nonBlank.optional(),
          metadata: z.record(z.string(), z.unknown()).optional(),
        })
        .strict(),
    ),
    structured_document: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const validateGeneratedSpecDraft = (value: unknown): GeneratedSpecDraftV1 => {
  const parsed = safeParseOrThrow(generatedSpecDraftSchema, value, 'generated_spec_draft_invalid');
  assertPublicSafeText(parsed, 'generated_spec_draft_invalid');
  return parsed as GeneratedSpecDraftV1;
};

export const validateGeneratedPlanDraft = (value: unknown): GeneratedPlanDraftV1 => {
  const parsed = safeParseOrThrow(generatedPlanDraftSchema, value, 'generated_plan_draft_invalid');
  assertPlanPublicSafeText(parsed, 'generated_plan_draft_invalid');
  assertUniqueStrings(parsed.dependency_order, 'generated_plan_draft_invalid');
  return parsed as GeneratedPlanDraftV1;
};

export const validateGeneratedPackageDraftSet = (value: unknown): GeneratedPackageDraftSetV1 => {
  const parsed = safeParseOrThrow(
    generatedPackageDraftSetSchema,
    value,
    'generated_package_policy_invalid',
  );
  assertPublicSafeText(parsed, 'generated_package_policy_invalid');

  const packageKeys = parsed.packages.map((entry) => entry.package_key);
  assertUniqueStrings(packageKeys, 'generated_package_manifest_invalid');
  parsed.packages.forEach((entry) => assertUniqueCheckIds(entry.required_checks));

  if (
    parsed.manifest.package_count !== parsed.packages.length ||
    parsed.manifest.dependency_order.length !== parsed.packages.length ||
    parsed.manifest.dependency_order.some((key, index) => key !== packageKeys[index])
  ) {
    throw new Error('generated_package_manifest_invalid');
  }

  const packageKeySet = new Set(packageKeys);
  for (const dependency of parsed.dependencies) {
    if (!packageKeySet.has(dependency.package_key) || !packageKeySet.has(dependency.depends_on_package_key)) {
      throw new Error('generated_package_dependency_invalid');
    }
  }

  assertAcyclicPackageDependencies(packageKeys, parsed.dependencies);

  return parsed as GeneratedPackageDraftSetV1;
};

const assertAcyclicPackageDependencies = (
  packageKeys: string[],
  dependencies: Array<{ package_key: string; depends_on_package_key: string }>,
): void => {
  const graph = new Map(packageKeys.map((key) => [key, [] as string[]]));
  dependencies.forEach((dependency) => {
    graph.get(dependency.package_key)?.push(dependency.depends_on_package_key);
  });

  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (key: string): void => {
    if (visiting.has(key)) {
      throw new Error('generated_package_dependency_invalid');
    }
    if (visited.has(key)) {
      return;
    }

    visiting.add(key);
    graph.get(key)?.forEach(visit);
    visiting.delete(key);
    visited.add(key);
  };

  packageKeys.forEach(visit);
};

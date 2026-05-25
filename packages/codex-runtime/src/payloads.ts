import { artifactKindSchema, artifactRefSchema, requiredCheckSpecSchema } from '@forgeloop/contracts';
import { z } from 'zod';

import type {
  BoundaryRoundRuntimeResultV1,
  GeneratedExecutionPlanRevisionV1,
  GeneratedPackageDraftSetV1,
  GeneratedPlanDraftV1,
  GeneratedSpecDraftV1,
  GeneratedSpecRevisionV1,
} from './types.js';

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
      !value.includes('\\') &&
      !/^[A-Za-z]:/.test(value) &&
      !/[\u0000-\u001f\u007f]/.test(value) &&
      !isRuntimeEndpointLikeString(value) &&
      !isBareDnsHostString(value),
    { message: 'path must be repo-relative and safe' },
  );

const unixLocalPathPattern = /(?:^|[\s"'(=])(\/[A-Za-z0-9._-]+(?:\/[^\s"'`,;)]*)?)/gi;
const homeRelativePathPattern = /(?:^|[\s"'(=])~[\\/][^\s"'`,;)]*/i;
const publicRoutePathPattern = /^\/(?:api|v\d+(?:\.\d+)?|graphql|health|status|auth|oauth)(?:\/|$)/i;
const windowsLocalPathPattern = /[A-Za-z]:[\\/][^\s"'`,;)]*/i;
const secretLikePattern =
  /(?:claim[-_ ]?token|hmac[-_ ]?(?:key|token|secret|material)|secret(?:[-_ ]?(?:key|token|material))?|api[-_ ]?key|raw\s+(?:prompt|output|log)s?)/i;
const runtimeMaterialPattern =
  /(?:\b(?:auth\.json|config\.toml)\b|\bapp[-_ ]?server\s+endpoint\b|\bendpoint\s*[:=]\s*(?:unix|https?|wss?|tcp|socket|sock):|\bendpoint\s+(?:unix|https?|wss?|tcp|socket|sock):|\b(?:unix|websocket|socket|sock):|\b(?:socket|sock)\s+(?:path|file|id)\b|\bcontainer[-_ ]?(?:id|name)\b|\bauth[-_ ]?(?:json|config|file|token|material)\b|\braw[-_ ]?(?:config|auth|logs?|output|prompt)\b|\bconfig[-_ ]?(?:json|file|path|material)\b|\bapp[-_ ]?server[-_ ]?logs?\b:?)/i;
const rawContainerIdTokenPattern = /[a-f0-9]{12,64}/gi;
const rawPromptOutputLogMarkerPattern = /(?:\b(?:BEGIN|END)\s+(?:PROMPT|OUTPUT|LOG)\b|\bAPP\s+SERVER\s+LOG\b:?)/i;
const rawBlockBoundaryMarkerPattern = /\b(?:BEGIN|END)\b/;
const displayUnsafeEndpointTokenPattern =
  /\b(?:https?:\/\/\S+|(?:https?|wss?|tcp|ssh|redis|postgres(?:ql)?|mysql|file):\S+|localhost(?::\d{1,5})?(?:\/\S*)?|(?:[a-z0-9-]+\.)+(?:internal|svc|svc\.cluster\.local)(?::\d{1,5})?(?:\/\S*)?|\d{1,3}(?:\.\d{1,3}){1,3}(?::\d{1,5})?(?:\/\S*)?|(?:forgeloop[-_])?(?:app|control)[-_](?:server|plane)[-_]\d+|(?:(?:app|control)[-_](?:server|plane)|[a-z][a-z0-9-]*_[a-z0-9_-]*|redis|postgres|mysql):\d{1,5}|unix:|[A-Za-z]:[\\/]|\\\\|\.sock\b)/i;
const displayBareDnsHostTokenPattern = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/gi;
const safePublicFilenameExtensions = new Set([
  'cjs',
  'css',
  'diff',
  'env',
  'gif',
  'gql',
  'graphql',
  'htm',
  'html',
  'ico',
  'js',
  'json',
  'jsx',
  'lock',
  'map',
  'md',
  'mdx',
  'mjs',
  'mts',
  'patch',
  'pdf',
  'png',
  'proto',
  'py',
  'scss',
  'sh',
  'sql',
  'svg',
  'toml',
  'tsv',
  'ts',
  'tsx',
  'txt',
  'webp',
  'xml',
  'yaml',
  'yml',
]);
const planActionAliases = {
  approval: ['approve', 'approves', 'approving', 'approval', 'approvals'],
  deploy: ['deploy', 'deploys', 'deployed', 'deploying', 'deployment', 'deployments'],
  enqueue: ['enqueue', 'enqueues', 'enqueued', 'enqueuing'],
  merge: ['merge', 'merges', 'merged', 'merging'],
  promote: ['promote', 'promotes', 'promoted', 'promoting', 'promotion', 'promotions'],
  push: ['push', 'pushes', 'pushed', 'pushing'],
  release: ['release', 'releases', 'released', 'releasing'],
  submit: ['submit', 'submits', 'submitted', 'submitting', 'submission', 'submissions'],
} as const;
const planActionFamilyPatterns = Object.fromEntries(
  Object.entries(planActionAliases).map(([family, aliases]) => [family, `(?:${aliases.join('|')})`]),
) as { [K in keyof typeof planActionAliases]: string };
const planActionAnyFamilyPattern = Object.values(planActionFamilyPatterns).join('|');
const anyGatedActionPattern = `(?:\\b(?:${planActionAnyFamilyPattern})\\b|\\b(?:request|send)\\s+(?:for\\s+)?approval\\b|\\b(?:perform|run)\\b[\\s\\S]{0,40}\\b(?:deployment|deployments)\\b|\\benqueue\\s+(?:the\\s+)?(?:package\\s+)?run\\b)`;
const bypassHumanGatePattern = new RegExp(
  `(?:(?:\\b(?:bypass(?:es|ing)?|skip|without\\s+(?:waiting\\s+for\\s+)?(?:human\\s+)?(?:review|approval|gate))\\b[\\s\\S]{0,80}${anyGatedActionPattern})|(?:${anyGatedActionPattern}[\\s\\S]{0,80}\\b(?:bypass(?:es|ing)?|skip|without\\s+(?:waiting\\s+for\\s+)?(?:human\\s+)?(?:review|approval|gate))\\b))`,
  'i',
);
const gatedPlanActionPattern =
  new RegExp(anyGatedActionPattern, 'gi');
const planActionContextWindow = 80;
const planActionClauseBoundaries = ['.', '!', '?', ';', ',', '\n'] as const;
const planActionScopeBoundaryPattern = /\b(?:and|while|with)\b/gi;

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
  runtimeMaterialPattern.test(value) ||
  displayUnsafeEndpointTokenPattern.test(value) ||
  Array.from(value.matchAll(displayBareDnsHostTokenPattern)).some(([candidate]) => isBareDnsHostString(candidate)) ||
  hasRawContainerIdToken(value) ||
  rawPromptOutputLogMarkerPattern.test(value) ||
  rawBlockBoundaryMarkerPattern.test(value) ||
  bypassHumanGatePattern.test(value);

const hasRawContainerIdToken = (value: string): boolean =>
  Array.from(value.matchAll(rawContainerIdTokenPattern)).some((match) => {
    const index = match.index ?? 0;
    const previous = index > 0 ? (value[index - 1] ?? '') : '';
    const next = value[index + match[0].length] ?? '';
    return (
      !/[a-f0-9-]/i.test(previous) &&
      !/[a-f0-9-]/i.test(next) &&
      value.slice(Math.max(0, index - 7), index).toLowerCase() !== 'sha256:'
    );
  });

const isPublicFilenameToken = (value: string): boolean => {
  if (value.includes('/') || value.includes('\\') || value.includes(':') || value.includes('\0')) {
    return false;
  }
  if (/^(?:Dockerfile|Makefile)(?:\.[A-Za-z0-9._-]+)?$/i.test(value)) {
    return true;
  }
  const extension = value.toLowerCase().split('.').at(-1);
  return extension !== undefined && extension !== value.toLowerCase() && safePublicFilenameExtensions.has(extension);
};

const isBareDnsHostString = (value: string): boolean => {
  const candidate = value.split(/[?#]/, 1)[0]?.replace(/\.$/, '') ?? value;
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(candidate)) {
    return false;
  }
  return !isPublicFilenameToken(candidate);
};

const isRuntimeEndpointLikeString = (value: string): boolean =>
  displayUnsafeEndpointTokenPattern.test(value) || isBareDnsHostString(value);

const previousPlanActionBoundary = (value: string, actionIndex: number): number =>
  Math.max(...planActionClauseBoundaries.map((boundary) => value.lastIndexOf(boundary, actionIndex)));

const nextPlanActionBoundary = (value: string, actionIndex: number): number =>
  planActionClauseBoundaries
    .map((boundary) => value.indexOf(boundary, actionIndex))
    .filter((index) => index >= 0)
    .reduce((left, right) => Math.min(left, right), value.length);

type PlanActionFamily = keyof typeof planActionFamilyPatterns;

const planActionFamily = (action: string): PlanActionFamily => {
  const normalized = action.toLowerCase();
  return (
    (Object.entries(planActionAliases).find(([, aliases]) =>
      aliases.some((alias) => new RegExp(`\\b${alias}\\b`).test(normalized)),
    )?.[0] as PlanActionFamily | undefined) ?? 'submit'
  );
};

const isPlanActionSafelyScopedOut = (clause: string, action: string, actionIndex: number): boolean => {
  const family = planActionFamily(action);
  const actionPattern = planActionFamilyPatterns[family];
  const prefix = clause.slice(Math.max(0, actionIndex - 40), actionIndex);
  const suffix = clause.slice(actionIndex + action.length, actionIndex + action.length + 60);
  const previousScopeBoundary = Array.from(prefix.matchAll(planActionScopeBoundaryPattern)).at(-1);
  const scopedPrefix =
    previousScopeBoundary?.index === undefined ? prefix : prefix.slice(previousScopeBoundary.index + previousScopeBoundary[0].length);

  if (/\b(?:do\s+not|exclude|excludes|excluding)\b/i.test(scopedPrefix)) {
    return true;
  }

  const actionThroughScopeNoun = `${scopedPrefix}${clause.slice(actionIndex, actionIndex + action.length + 40)}`;
  const noScopePattern = new RegExp(
    `\\bno\\b[\\s\\S]{0,40}\\b${actionPattern}\\b[\\s\\S]{0,40}\\b(?:work|workflow|workflows|action|actions|operation|operations|task|tasks)\\b`,
    'i',
  );
  if (noScopePattern.test(actionThroughScopeNoun)) {
    return true;
  }

  return new RegExp(
    `^[\\s/,-]*(?:(?:${planActionAnyFamilyPattern})[\\s/,-]+)*(?:work|workflow|workflows|action|actions|operation|operations|task|tasks)\\b[\\s\\S]{0,40}\\b(?:excluded|out\\s+of\\s+scope)\\b`,
    'i',
  ).test(
    suffix,
  );
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
    const actionIndexInClause = actionIndex - Math.max(previousBoundary + 1, actionIndex - planActionContextWindow);
    return !isPlanActionSafelyScopedOut(clause, action, actionIndexInClause);
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

const isExecutionPlanPathField = (path: readonly string[]): boolean => {
  const parent = path[path.length - 2];
  return (parent === 'allowed_paths' || parent === 'forbidden_paths') && /^\d+$/.test(path[path.length - 1] ?? '');
};

const isExecutionPlanRequiredCheckPublicField = (path: readonly string[]): boolean => {
  const last = path[path.length - 1];
  const grandparent = path[path.length - 3];
  return grandparent === 'required_checks' && (last === 'check_id' || last === 'command');
};

const assertGeneratedExecutionPlanPublicSafeText = (value: unknown, errorCode: string, path: readonly string[] = []): void => {
  if (typeof value === 'string') {
    if (isExecutionPlanPathField(path)) {
      return;
    }
    const unsafe = isExecutionPlanRequiredCheckPublicField(path) ? isUnsafePublicString(value) : isUnsafePlanString(value);
    if (unsafe) {
      throw new Error(errorCode);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertGeneratedExecutionPlanPublicSafeText(entry, errorCode, [...path, String(index)]));
    return;
  }

  if (value !== null && typeof value === 'object') {
    Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
      assertGeneratedExecutionPlanPublicSafeText(key, errorCode, [...path, key]);
      assertGeneratedExecutionPlanPublicSafeText(entry, errorCode, [...path, key]);
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

export const boundaryRoundRuntimeResultSchema = z
  .object({
    schema_version: z.literal('boundary_round_result.v1'),
    session_id: nonBlank,
    round_id: nonBlank,
    questions: z.array(
      z
        .object({
          text: nonBlank,
          required: z.boolean(),
          rationale: nonBlank.optional(),
        })
        .strict(),
    ),
    proposed_decisions: z.array(
      z
        .object({
          text: nonBlank,
          rationale: nonBlank.optional(),
        })
        .strict(),
    ),
    summary_proposal: z
      .object({
        summary_markdown: nonBlank,
        confirmed_scope: z.array(nonBlank),
        confirmed_out_of_scope: z.array(nonBlank),
        accepted_assumptions: z.array(nonBlank),
        open_risks: z.array(nonBlank),
        validation_expectations: z.array(nonBlank),
      })
      .strict()
      .optional(),
    needs_leader_input: z.boolean(),
    public_summary: nonBlank,
    artifacts: z.array(artifactRefSchema.strict()),
  })
  .strict();

export const generatedSpecRevisionSchema = z
  .object({
    schema_version: z.literal('spec_revision.v1'),
    development_plan_item_id: nonBlank,
    boundary_summary_revision_id: nonBlank,
    summary: nonBlank,
    content_markdown: nonBlank,
    problem_context: nonBlank,
    scope_in: z.array(nonBlank),
    scope_out: z.array(nonBlank),
    acceptance_criteria: z.array(nonBlank),
    test_strategy: z.array(nonBlank),
    risks: z.array(nonBlank),
    assumptions: z.array(nonBlank),
    unresolved_questions: z.array(nonBlank),
    public_summary: nonBlank,
  })
  .strict();

const generatedExecutionPlanRequiredCheckSchema = z
  .object({
    check_id: nonBlank,
    command: nonBlank,
    timeout_seconds: z.number().int().positive(),
    blocks_review: z.boolean(),
  })
  .strict();

export const generatedExecutionPlanRevisionSchema = z
  .object({
    schema_version: z.literal('execution_plan_revision.v1'),
    development_plan_item_id: nonBlank,
    based_on_spec_revision_id: nonBlank,
    summary: nonBlank,
    content_markdown: nonBlank,
    implementation_sequence: z.array(nonBlank),
    validation_strategy: z.array(nonBlank),
    allowed_paths: z.array(repoRelativePath),
    forbidden_paths: z.array(repoRelativePath),
    required_checks: z.array(generatedExecutionPlanRequiredCheckSchema),
    rollback_notes: nonBlank,
    handoff_criteria: z.array(nonBlank),
    public_summary: nonBlank,
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

export const validateBoundaryRoundRuntimeResult = (value: unknown): BoundaryRoundRuntimeResultV1 => {
  const parsed = safeParseOrThrow(
    boundaryRoundRuntimeResultSchema,
    value,
    'boundary_round_result_invalid',
  );
  assertPublicSafeText(parsed, 'boundary_round_result_invalid');
  return parsed as BoundaryRoundRuntimeResultV1;
};

export const validateGeneratedSpecRevision = (value: unknown): GeneratedSpecRevisionV1 => {
  const parsed = safeParseOrThrow(generatedSpecRevisionSchema, value, 'generated_spec_revision_invalid');
  assertPublicSafeText(parsed, 'generated_spec_revision_invalid');
  return parsed as GeneratedSpecRevisionV1;
};

export const validateGeneratedExecutionPlanRevision = (value: unknown): GeneratedExecutionPlanRevisionV1 => {
  const parsed = safeParseOrThrow(
    generatedExecutionPlanRevisionSchema,
    value,
    'generated_execution_plan_revision_invalid',
  );
  assertGeneratedExecutionPlanPublicSafeText(parsed, 'generated_execution_plan_revision_invalid');
  assertUniqueStrings(
    parsed.required_checks.map((check) => check.check_id),
    'generated_execution_plan_revision_invalid',
  );
  return parsed as GeneratedExecutionPlanRevisionV1;
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

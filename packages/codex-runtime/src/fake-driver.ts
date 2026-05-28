import type {
  BoundaryRoundRuntimeResultV1,
  CodexGenerationResult,
  GeneratedExecutionPlanRevisionV1,
  GeneratedPackageDraftSetV1,
  GeneratedPlanDraftV1,
  GeneratedSpecDraftV1,
  GeneratedSpecRevisionV1,
} from './types.js';

export const specDraftPromptVersion = 'spec-draft.fake.v1';
export const planDraftPromptVersion = 'plan-draft.fake.v1';
export const packageDraftsPromptVersion = 'package-drafts.fake.v1';
export const boundaryRoundPromptVersion = 'boundary-round.fake.v1';
export const specRevisionPromptVersion = 'development-plan-item-spec-revision.fake.v1';
export const executionPlanRevisionPromptVersion = 'development-plan-item-execution-plan-revision.fake.v1';
export const specDraftOutputSchemaVersion = 'spec_draft.v1';
export const planDraftOutputSchemaVersion = 'plan_draft.v1';
export const packageDraftsOutputSchemaVersion = 'package_drafts.v1';
export const boundaryRoundOutputSchemaVersion = 'boundary_round_result.v1';
export const specRevisionOutputSchemaVersion = 'spec_revision.v1';
export const executionPlanRevisionOutputSchemaVersion = 'execution_plan_revision.v1';

const recordValue = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const stringValue = (record: Record<string, unknown>, keys: string[], fallback: string): string => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return fallback;
};

const stringArrayValue = (record: Record<string, unknown>, key: string, fallback: string[]): string[] => {
  const value = record[key];
  if (Array.isArray(value)) {
    const strings = value.filter(
      (entry): entry is string =>
        typeof entry === 'string' &&
        entry.trim().length > 0 &&
        !entry.startsWith('/') &&
        !entry.startsWith('~') &&
        !entry.includes('..') &&
        !/^[A-Za-z]:[\\/]/.test(entry) &&
        !/[\u0000-\u001f\u007f]/.test(entry) &&
        !/(?:endpoint|socket|container[-_ ]?id|auth[-_ ]?json|raw[-_ ]?(?:config|auth|log))/i.test(entry),
    );
    if (strings.length > 0) {
      return strings;
    }
  }
  return fallback;
};

export const createFakeSpecDraft = (context: {
  work_item: { id: string; title: string; goal: string; success_criteria: string[]; risk?: string };
}): CodexGenerationResult<GeneratedSpecDraftV1> => ({
  taskKind: 'spec_draft',
  promptVersion: specDraftPromptVersion,
  outputSchemaVersion: specDraftOutputSchemaVersion,
  generationArtifacts: [],
  publicSummary: 'Fake Spec draft generated.',
  generated: {
    schema_version: 'spec_draft.v1',
    summary: `Draft spec for ${context.work_item.title}`,
    content: [
      `Goal: ${context.work_item.goal}`,
      `Success criteria: ${context.work_item.success_criteria.join('; ')}`,
    ].join('\n\n'),
    background: context.work_item.goal,
    goals: [context.work_item.goal],
    scope_in: [`Deliver ${context.work_item.title}`],
    scope_out: ['Release, deploy, and non-delivery workflows'],
    acceptance_criteria: [...context.work_item.success_criteria],
    risk_notes:
      context.work_item.risk === undefined || context.work_item.risk.trim().length === 0
        ? []
        : [context.work_item.risk],
    test_strategy_summary: `Validate ${context.work_item.title} with API and daemon tests.`,
    structured_document: {
      generated_by: 'fake_codex_generation_runtime',
      work_item_id: context.work_item.id,
    },
  },
});

export const createFakePlanDraft = (context: {
  work_item: { id: string; title: string; goal: string; success_criteria: string[] };
  spec_revision: { id: string; risk_notes: string[] };
}): CodexGenerationResult<GeneratedPlanDraftV1> => ({
  taskKind: 'plan_draft',
  promptVersion: planDraftPromptVersion,
  outputSchemaVersion: planDraftOutputSchemaVersion,
  generationArtifacts: [],
  publicSummary: 'Fake Plan draft generated.',
  generated: {
    schema_version: 'plan_draft.v1',
    summary: `Generated plan for ${context.work_item.title}`,
    content: `Implement approved SpecRevision ${context.spec_revision.id}.`,
    implementation_summary: `Deliver ${context.work_item.goal}`,
    split_strategy: 'Split into API and test packages.',
    dependency_order: ['api', 'tests'],
    test_matrix: ['pnpm test tests/api', 'pnpm test tests/automation'],
    risk_mitigations:
      context.spec_revision.risk_notes.length === 0
        ? ['Keep command boundary narrow.']
        : context.spec_revision.risk_notes,
    rollback_notes: 'Revert generated package changes.',
    structured_document: {
      generated_by: 'fake_codex_generation_runtime',
      work_item_id: context.work_item.id,
      spec_revision_id: context.spec_revision.id,
    },
  },
});

export const createFakePackageDraftSet = (context: {
  generation_key: string;
  plan_revision: { id: string; dependency_order: string[] };
  repos: { repo_id: string }[];
}): CodexGenerationResult<GeneratedPackageDraftSetV1> => {
  const repoId = context.repos[0]?.repo_id ?? 'repo-main';
  const dependencyOrder = context.plan_revision.dependency_order;

  return {
    taskKind: 'package_drafts',
    promptVersion: packageDraftsPromptVersion,
    outputSchemaVersion: packageDraftsOutputSchemaVersion,
    generationArtifacts: [],
    publicSummary: 'Fake Package drafts generated.',
    generated: {
      schema_version: 'package_drafts.v1',
      manifest: {
        manifest_version: 'execution_package_manifest.v1',
        package_set_key: context.generation_key,
        package_count: dependencyOrder.length,
        dependency_order: dependencyOrder,
      },
      packages: dependencyOrder.map((packageKey, index) => ({
        package_key: packageKey,
        repo_id: repoId,
        objective: `Implement ${packageKey}`,
        required_checks: [
          {
            check_id: 'unit',
            display_name: 'Unit tests',
            command: 'pnpm test',
            timeout_seconds: 120,
            blocks_review: true,
          },
        ],
        required_artifact_kinds: ['execution_summary'],
        allowed_paths: index === 0 ? ['apps/control-plane-api/**'] : ['tests/**'],
        forbidden_paths: ['packages/db/migrations/**'],
        source_mutation_policy: 'path_policy_scoped',
        validation_strategy: 'checks_required',
      })),
      dependencies: dependencyOrder.slice(1).map((packageKey) => ({
        package_key: packageKey,
        depends_on_package_key: dependencyOrder[0]!,
        dependency_type: 'requires',
        reason: `${packageKey} depends on ${dependencyOrder[0]}`,
      })),
    },
  };
};

export const createFakeBoundaryRoundRuntimeResult = (
  context: Record<string, unknown>,
): CodexGenerationResult<BoundaryRoundRuntimeResultV1> => {
  const sessionId = stringValue(context, ['session_id', 'boundary_session_id'], 'boundary-session-1');
  const roundId = stringValue(context, ['round_id', 'boundary_round_id'], 'round-1');

  return {
    taskKind: 'boundary_brainstorming_round',
    promptVersion: boundaryRoundPromptVersion,
    outputSchemaVersion: boundaryRoundOutputSchemaVersion,
    generationArtifacts: [],
    publicSummary: 'Fake Boundary Brainstorming round generated.',
    generated: {
      schema_version: 'boundary_round_result.v1',
      session_id: sessionId,
      round_id: roundId,
      questions: [
        {
          text: 'Confirm the product boundary and owner before drafting follow-up work.',
          required: true,
          rationale: 'Leader confirmation keeps generation scoped to the approved item.',
        },
      ],
      proposed_decisions: [
        {
          text: 'Keep execution and release work outside this boundary round.',
          rationale: 'This round only produces reviewable boundary material.',
        },
      ],
      summary_proposal: {
        summary_markdown: 'Boundary draft is ready for Leader review.',
        confirmed_scope: ['Generate reviewable boundary material'],
        confirmed_out_of_scope: ['Execution and release workflows'],
        accepted_assumptions: ['Leader review remains required before downstream generation'],
        open_risks: ['Scope may change after Leader feedback'],
        validation_expectations: ['Codex runtime payload validation passes'],
      },
      needs_leader_input: true,
      public_summary: 'Generated a fake Boundary Brainstorming round for Leader review.',
      artifacts: [],
    },
  };
};

export const createFakeGeneratedSpecRevision = (
  context: Record<string, unknown>,
): CodexGenerationResult<GeneratedSpecRevisionV1> => {
  const item = recordValue(context.development_plan_item);
  const developmentPlanItemId = stringValue(context, ['development_plan_item_id'], stringValue(item, ['id'], 'item-1'));
  const boundarySummaryRevisionId = stringValue(
    context,
    ['approved_boundary_summary_revision_id', 'boundary_summary_revision_id'],
    'boundary-summary-rev-1',
  );

  return {
    taskKind: 'development_plan_item_spec_revision',
    promptVersion: specRevisionPromptVersion,
    outputSchemaVersion: specRevisionOutputSchemaVersion,
    generationArtifacts: [],
    publicSummary: 'Fake Spec revision generated.',
    generated: {
      schema_version: 'spec_revision.v1',
      development_plan_item_id: developmentPlanItemId,
      boundary_summary_revision_id: boundarySummaryRevisionId,
      summary: 'Draft Spec revision for the approved boundary',
      content_markdown: 'Implement the approved boundary as a reviewable Spec revision.',
      problem_context: 'The Development Plan Item needs a Spec revision generated from approved boundary material.',
      scope_in: ['Generate a draft Spec revision'],
      scope_out: ['Execution, release, and deployment workflows'],
      acceptance_criteria: ['Draft Spec revision is stored for review'],
      test_strategy: ['Validate generated payload schema and writer preconditions'],
      risks: ['Boundary inputs may become stale before persistence'],
      assumptions: ['Leader approved the referenced boundary summary revision'],
      unresolved_questions: [],
      public_summary: 'Generated a fake draft Spec revision.',
    },
  };
};

export const createFakeGeneratedExecutionPlanRevision = (
  context: Record<string, unknown>,
): CodexGenerationResult<GeneratedExecutionPlanRevisionV1> => {
  const item = recordValue(context.development_plan_item);
  const developmentPlanItemId = stringValue(context, ['development_plan_item_id'], stringValue(item, ['id'], 'item-1'));
  const basedOnSpecRevisionId = stringValue(context, ['approved_spec_revision_id', 'spec_revision_id'], 'spec-rev-1');

  return {
    taskKind: 'development_plan_item_execution_plan_revision',
    promptVersion: executionPlanRevisionPromptVersion,
    outputSchemaVersion: executionPlanRevisionOutputSchemaVersion,
    generationArtifacts: [],
    publicSummary: 'Fake Execution Plan revision generated.',
    generated: {
      schema_version: 'execution_plan_revision.v1',
      development_plan_item_id: developmentPlanItemId,
      based_on_spec_revision_id: basedOnSpecRevisionId,
      summary: 'Draft Execution Plan revision for the approved Spec',
      content_markdown: 'Implement the approved Spec in focused package slices with explicit validation.',
      implementation_sequence: ['Add package schemas', 'Wire runtime methods', 'Run targeted validation'],
      validation_strategy: ['pnpm vitest run tests/codex-runtime/payloads.test.ts tests/codex-runtime/runtime.test.ts --pool=forks --no-file-parallelism --maxWorkers=1'],
      allowed_paths: stringArrayValue(context, 'allowed_paths', ['packages/codex-runtime/src/**', 'tests/codex-runtime/**']),
      forbidden_paths: stringArrayValue(context, 'forbidden_paths', ['packages/db/migrations/**']),
      required_checks: [
        {
          check_id: 'codex-runtime-unit',
          command: 'pnpm vitest run tests/codex-runtime/payloads.test.ts tests/codex-runtime/runtime.test.ts --pool=forks --no-file-parallelism --maxWorkers=1',
          timeout_seconds: 120,
          blocks_review: true,
        },
      ],
      rollback_notes: 'Revert the generated codex-runtime package changes.',
      handoff_criteria: ['Targeted codex-runtime tests pass'],
      public_summary: 'Generated a fake draft Execution Plan revision.',
    },
  };
};

import type {
  CodexGenerationResult,
  GeneratedPackageDraftSetV1,
  GeneratedPlanDraftV1,
  GeneratedSpecDraftV1,
} from './types.js';

export const specDraftPromptVersion = 'spec-draft.fake.v1';
export const planDraftPromptVersion = 'plan-draft.fake.v1';
export const packageDraftsPromptVersion = 'package-drafts.fake.v1';
export const specDraftOutputSchemaVersion = 'spec_draft.v1';
export const planDraftOutputSchemaVersion = 'plan_draft.v1';
export const packageDraftsOutputSchemaVersion = 'package_drafts.v1';

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

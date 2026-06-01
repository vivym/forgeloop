import type { ArtifactKind, ArtifactRef, RequiredCheckSpec } from '@forgeloop/contracts';

export type CodexGenerationTaskKind =
  | 'spec_draft'
  | 'plan_draft'
  | 'package_drafts'
  | 'boundary_brainstorming_round'
  | 'development_plan_item_spec_revision'
  | 'development_plan_item_execution_plan_revision';
export type CodexGenerationDriverMode = 'disabled' | 'fake' | 'app_server';

export type CodexThreadContinuation =
  | { kind: 'start_thread' }
  | { kind: 'resume_thread'; codex_thread_id: string; codex_thread_id_digest: string };

export interface GeneratedSpecDraftV1 {
  schema_version: 'spec_draft.v1';
  summary: string;
  content: string;
  background: string;
  goals: string[];
  scope_in: string[];
  scope_out: string[];
  acceptance_criteria: string[];
  risk_notes: string[];
  test_strategy_summary: string;
  structured_document?: Record<string, unknown>;
}

export interface GeneratedPlanDraftV1 {
  schema_version: 'plan_draft.v1';
  summary: string;
  content: string;
  implementation_summary: string;
  split_strategy: string;
  dependency_order: string[];
  test_matrix: string[];
  risk_mitigations: string[];
  rollback_notes: string;
  structured_document?: Record<string, unknown>;
}

export interface GeneratedExecutionPackageDraftV1 {
  package_key: string;
  repo_id: string;
  objective: string;
  required_checks: RequiredCheckSpec[];
  required_artifact_kinds: ArtifactKind[];
  allowed_paths: string[];
  forbidden_paths: string[];
  source_mutation_policy: 'path_policy_scoped' | 'no_source_changes';
  required_test_gates?: Record<string, unknown>[];
  validation_strategy?: 'checks_required';
  structured_document?: Record<string, unknown>;
}

export interface GeneratedExecutionPackageDependencyV1 {
  package_key: string;
  depends_on_package_key: string;
  dependency_type?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface GeneratedPackageDraftSetV1 {
  schema_version: 'package_drafts.v1';
  manifest: {
    manifest_version: 'execution_package_manifest.v1';
    package_set_key: string;
    package_count: number;
    dependency_order: string[];
  };
  packages: GeneratedExecutionPackageDraftV1[];
  dependencies: GeneratedExecutionPackageDependencyV1[];
  structured_document?: Record<string, unknown>;
}

export interface BoundaryRoundRuntimeResultV1 {
  schema_version: 'boundary_round_result.v1';
  session_id: string;
  round_id: string;
  questions: Array<{ text: string; required: boolean; rationale?: string }>;
  proposed_decisions: Array<{ text: string; rationale?: string }>;
  summary_proposal?: {
    summary_markdown: string;
    confirmed_scope: string[];
    confirmed_out_of_scope: string[];
    accepted_assumptions: string[];
    open_risks: string[];
    validation_expectations: string[];
  };
  needs_leader_input: boolean;
  public_summary: string;
  artifacts: ArtifactRef[];
}

export interface GeneratedSpecRevisionV1 {
  schema_version: 'spec_revision.v1';
  development_plan_item_id: string;
  boundary_summary_revision_id: string;
  summary: string;
  content_markdown: string;
  problem_context: string;
  scope_in: string[];
  scope_out: string[];
  acceptance_criteria: string[];
  test_strategy: string[];
  risks: string[];
  assumptions: string[];
  unresolved_questions: string[];
  public_summary: string;
}

export interface GeneratedExecutionPlanRequiredCheckV1 {
  check_id: string;
  command: string;
  timeout_seconds: number;
  blocks_review: boolean;
}

export interface GeneratedExecutionPlanRevisionV1 {
  schema_version: 'execution_plan_revision.v1';
  development_plan_item_id: string;
  based_on_spec_revision_id: string;
  summary: string;
  content_markdown: string;
  implementation_sequence: string[];
  validation_strategy: string[];
  allowed_paths: string[];
  forbidden_paths: string[];
  required_checks: GeneratedExecutionPlanRequiredCheckV1[];
  rollback_notes: string;
  handoff_criteria: string[];
  public_summary: string;
}

export interface CodexGenerationResult<TGenerated> {
  taskKind: CodexGenerationTaskKind;
  promptVersion: string;
  outputSchemaVersion: string;
  generated: TGenerated;
  generationArtifacts: ArtifactRef[];
  publicSummary: string;
}

export type CodexGenerationOrchestrationContext = {
  targetType: 'automation_action_run';
  actionRunId: string;
  actionType: 'ensure_package_drafts';
  actionAttempt: number;
  claimToken: string;
  preconditionFingerprint: string;
  automationScope: string;
  idempotencyKey: string;
};

export interface CodexGenerationRuntimeTaskInput<TContext extends Record<string, unknown>> {
  actionRunId: string;
  projectId: string;
  repoIds: string[];
  context: TContext;
  promptVersion: string;
  outputSchemaVersion: string;
  policyDigests: Record<string, string>;
  continuation?: CodexThreadContinuation;
  orchestration?: CodexGenerationOrchestrationContext;
  signal?: AbortSignal;
}

export interface CodexGenerationRuntime {
  generateSpecDraft(
    input: CodexGenerationRuntimeTaskInput<Record<string, unknown>>,
  ): Promise<CodexGenerationResult<GeneratedSpecDraftV1>>;
  generatePlanDraft(
    input: CodexGenerationRuntimeTaskInput<Record<string, unknown>>,
  ): Promise<CodexGenerationResult<GeneratedPlanDraftV1>>;
  generatePackageDrafts(
    input: CodexGenerationRuntimeTaskInput<Record<string, unknown>>,
  ): Promise<CodexGenerationResult<GeneratedPackageDraftSetV1>>;
  generateBoundaryBrainstormingRound(
    input: CodexGenerationRuntimeTaskInput<Record<string, unknown>>,
  ): Promise<CodexGenerationResult<BoundaryRoundRuntimeResultV1>>;
  generateDevelopmentPlanItemSpecRevision(
    input: CodexGenerationRuntimeTaskInput<Record<string, unknown>>,
  ): Promise<CodexGenerationResult<GeneratedSpecRevisionV1>>;
  generateDevelopmentPlanItemExecutionPlanRevision(
    input: CodexGenerationRuntimeTaskInput<Record<string, unknown>>,
  ): Promise<CodexGenerationResult<GeneratedExecutionPlanRevisionV1>>;
}

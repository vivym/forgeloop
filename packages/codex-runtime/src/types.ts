import type { ArtifactKind, ArtifactRef, RequiredCheckSpec } from '@forgeloop/contracts';

export type CodexGenerationTaskKind = 'spec_draft' | 'plan_draft' | 'package_drafts';
export type CodexGenerationDriverMode = 'disabled' | 'fake' | 'app_server';

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
}

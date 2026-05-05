import type { ArtifactKind, RequiredCheckSpec } from '@forgeloop/contracts';
import type { WorkItemKind } from '@forgeloop/domain';

export interface CreateProjectDto {
  name: string;
  owner_actor_id?: string;
}

export interface CreateProjectRepoDto {
  repo_id: string;
  name: string;
  local_path: string;
  default_branch?: string;
  remote_url?: string;
  base_commit_sha: string;
}

export interface CreateWorkItemDto {
  project_id: string;
  kind: WorkItemKind;
  title: string;
  goal: string;
  success_criteria: string[];
  priority: string;
  risk: string;
  owner_actor_id: string;
}

export interface ActorCommandDto {
  actor_id?: string;
}

export interface CreateSpecRevisionDto {
  summary: string;
  content: string;
  background: string;
  goals: string[];
  scope_in: string[];
  scope_out: string[];
  acceptance_criteria: string[];
  risk_notes?: string[];
  test_strategy_summary: string;
  structured_document?: Record<string, unknown>;
  author_actor_id?: string;
}

export interface CreatePlanRevisionDto {
  summary: string;
  content: string;
  implementation_summary: string;
  split_strategy: string;
  dependency_order?: string[];
  test_matrix: string[];
  risk_mitigations?: string[];
  rollback_notes: string;
  structured_document?: Record<string, unknown>;
  author_actor_id?: string;
}

export interface CreateExecutionPackageDto {
  repo_id: string;
  objective: string;
  owner_actor_id: string;
  reviewer_actor_id: string;
  qa_owner_actor_id: string;
  required_checks: RequiredCheckSpec[];
  required_artifact_kinds: ArtifactKind[];
  allowed_paths: string[];
  forbidden_paths: string[];
}

export interface PatchExecutionPackageDto {
  objective?: string;
  owner_actor_id?: string;
  reviewer_actor_id?: string;
  qa_owner_actor_id?: string;
  required_checks?: RequiredCheckSpec[];
  required_artifact_kinds?: ArtifactKind[];
  allowed_paths?: string[];
  forbidden_paths?: string[];
}

export interface RunPackageDto {
  requested_by_actor_id: string;
  executor_type?: 'mock' | 'local_codex';
  workflow_only?: boolean;
  previous_run_session_id?: string;
  force?: true;
  force_reason?: string;
}

export interface ReviewDecisionDto {
  summary: string;
  reviewed_by_actor_id: string;
  reviewed_at: string;
  requested_changes?: Array<{
    title: string;
    description: string;
    file_path?: string;
    severity?: 'minor' | 'major' | 'critical';
    suggested_validation?: string;
  }>;
}

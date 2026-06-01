CREATE TYPE "public"."actor_type" AS ENUM('human', 'system', 'ai');--> statement-breakpoint
CREATE TYPE "public"."decision_outcome" AS ENUM('approved', 'changes_requested', 'rejected', 'override_approved', 'rolled_back', 'cancelled', 'completed');--> statement-breakpoint
CREATE TYPE "public"."decision_value" AS ENUM('approved', 'changes_requested', 'rejected', 'override_approved', 'rolled_back', 'cancelled', 'completed');--> statement-breakpoint
CREATE TYPE "public"."execution_package_activity_state" AS ENUM('idle', 'ai_running', 'ai_retrying', 'human_editing', 'awaiting_human', 'human_reviewing', 'blocked', 'handover');--> statement-breakpoint
CREATE TYPE "public"."execution_package_gate_state" AS ENUM('not_submitted', 'self_review_pending', 'awaiting_human_review', 'changes_requested', 'review_approved', 'integration_failed', 'integration_passed', 'test_failed', 'test_passed', 'release_ready', 'released');--> statement-breakpoint
CREATE TYPE "public"."execution_package_phase" AS ENUM('draft', 'ready', 'queued', 'execution', 'review', 'integration', 'test_gate', 'release', 'archived');--> statement-breakpoint
CREATE TYPE "public"."execution_package_resolution" AS ENUM('none', 'completed', 'cancelled', 'rolled_back', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."project_repo_status" AS ENUM('active', 'paused', 'archived');--> statement-breakpoint
CREATE TYPE "public"."release_activity_state" AS ENUM('idle', 'awaiting_human', 'human_in_progress', 'rolling_out', 'paused', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."release_evidence_status" AS ENUM('current', 'stale', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."release_evidence_type" AS ENUM('test_report', 'review_packet', 'build', 'deployment', 'metric_snapshot', 'rollback_record', 'observation_note');--> statement-breakpoint
CREATE TYPE "public"."release_gate_state" AS ENUM('not_submitted', 'awaiting_approval', 'changes_requested', 'approved', 'rollout_failed', 'rollout_succeeded');--> statement-breakpoint
CREATE TYPE "public"."release_phase" AS ENUM('draft', 'candidate', 'approval', 'rollout', 'observing', 'completed', 'closed');--> statement-breakpoint
CREATE TYPE "public"."release_resolution" AS ENUM('none', 'completed', 'rolled_back', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."release_type" AS ENUM('normal', 'hotfix', 'emergency', 'gray');--> statement-breakpoint
CREATE TYPE "public"."review_packet_decision" AS ENUM('none', 'approved', 'changes_requested', 'need_more_context', 'escalate');--> statement-breakpoint
CREATE TYPE "public"."review_packet_status" AS ENUM('draft', 'ready', 'in_review', 'completed', 'escalated', 'archived');--> statement-breakpoint
CREATE TYPE "public"."run_session_status" AS ENUM('queued', 'running', 'waiting_for_input', 'stalled', 'resuming', 'cancel_requested', 'succeeded', 'failed', 'timed_out', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."spec_plan_editing_state" AS ENUM('idle', 'ai_drafting', 'human_editing', 'co_editing');--> statement-breakpoint
CREATE TYPE "public"."spec_plan_gate_state" AS ENUM('not_submitted', 'awaiting_approval', 'approved', 'changes_requested');--> statement-breakpoint
CREATE TYPE "public"."spec_plan_resolution" AS ENUM('none', 'approved', 'rejected', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."spec_plan_status" AS ENUM('draft', 'in_review', 'approved', 'rejected', 'superseded', 'archived');--> statement-breakpoint
CREATE TYPE "public"."trace_link_relationship" AS ENUM('belongs_to', 'generated_by', 'supports', 'supersedes', 'replaces', 'redacted_from');--> statement-breakpoint
CREATE TYPE "public"."work_item_activity_state" AS ENUM('idle', 'in_progress', 'awaiting_ai', 'ai_running', 'awaiting_human', 'human_in_progress', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."work_item_gate_state" AS ENUM('none', 'awaiting_spec_approval', 'spec_changes_requested', 'awaiting_plan_approval', 'plan_changes_requested', 'awaiting_release_approval', 'release_changes_requested');--> statement-breakpoint
CREATE TYPE "public"."work_item_kind" AS ENUM('initiative', 'requirement', 'bug', 'tech_debt');--> statement-breakpoint
CREATE TYPE "public"."work_item_phase" AS ENUM('draft', 'triage', 'spec', 'plan', 'execution', 'release', 'observing', 'done', 'closed');--> statement-breakpoint
CREATE TYPE "public"."work_item_resolution" AS ENUM('none', 'completed', 'cancelled', 'rejected', 'duplicate', 'superseded', 'won_t_do');--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "actors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"display_name" text NOT NULL,
	"email" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_repos" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" uuid,
	"repo_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" "project_repo_status" NOT NULL,
	"local_path" text NOT NULL,
	"default_branch" text NOT NULL,
	"remote_url" text,
	"base_commit_sha" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"key" text,
	"name" text NOT NULL,
	"repo_ids" jsonb NOT NULL,
	"owner_actor_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" "work_item_kind" NOT NULL,
	"title" text NOT NULL,
	"narrative_markdown" text DEFAULT '' NOT NULL,
	"goal" text NOT NULL,
	"success_criteria" jsonb NOT NULL,
	"priority" text NOT NULL,
	"risk" text NOT NULL,
	"driver_actor_id" uuid NOT NULL,
	"intake_context" jsonb NOT NULL,
	"phase" "work_item_phase" NOT NULL,
	"activity_state" "work_item_activity_state" NOT NULL,
	"gate_state" "work_item_gate_state" NOT NULL,
	"resolution" "work_item_resolution" NOT NULL,
	"current_spec_id" uuid,
	"current_spec_revision_id" uuid,
	"current_plan_id" uuid,
	"current_plan_revision_id" uuid,
	"current_release_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"narrative_markdown" text DEFAULT '' NOT NULL,
	"execution_brief" text NOT NULL,
	"acceptance_checklist" jsonb NOT NULL,
	"status" text NOT NULL,
	"parent_ref" jsonb,
	"controlling_spec_revision_id" uuid,
	"controlling_plan_revision_id" uuid,
	"stale_state" text NOT NULL,
	"audited_exception" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_object_type" text NOT NULL,
	"owner_object_id" text NOT NULL,
	"linked_object_refs" jsonb NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_uri" text NOT NULL,
	"checksum_sha256" text NOT NULL,
	"uploaded_by_actor_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"evidence_category" text NOT NULL,
	"caption" text,
	"alt_text" text,
	"visibility" text NOT NULL,
	"safety_status" text NOT NULL,
	"reference_status" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spec_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spec_id" uuid NOT NULL,
	"work_item_id" uuid NOT NULL,
	"development_plan_item_id" uuid,
	"workflow_id" uuid,
	"codex_session_id" uuid,
	"codex_session_turn_id" uuid,
	"boundary_summary_id" uuid,
	"context_manifest_id" uuid,
	"revision_number" integer NOT NULL,
	"summary" text NOT NULL,
	"content" text NOT NULL,
	"background" text NOT NULL,
	"goals" jsonb NOT NULL,
	"scope_in" jsonb NOT NULL,
	"scope_out" jsonb NOT NULL,
	"acceptance_criteria" jsonb NOT NULL,
	"risk_notes" jsonb NOT NULL,
	"test_strategy_summary" text NOT NULL,
	"structured_document" jsonb,
	"author_actor_id" uuid,
	"artifact_refs" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "specs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_item_id" uuid NOT NULL,
	"development_plan_item_id" uuid,
	"workflow_id" uuid,
	"boundary_summary_id" uuid,
	"context_manifest_id" uuid,
	"entity_type" text NOT NULL,
	"status" "spec_plan_status" NOT NULL,
	"editing_state" "spec_plan_editing_state" NOT NULL,
	"gate_state" "spec_plan_gate_state" NOT NULL,
	"resolution" "spec_plan_resolution" NOT NULL,
	"current_revision_id" uuid,
	"approved_revision_id" uuid,
	"approved_at" timestamp with time zone,
	"approved_by_actor_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"work_item_id" uuid NOT NULL,
	"based_on_spec_revision_id" uuid,
	"revision_number" integer NOT NULL,
	"summary" text NOT NULL,
	"content" text NOT NULL,
	"implementation_summary" text NOT NULL,
	"split_strategy" text NOT NULL,
	"dependency_order" jsonb NOT NULL,
	"test_matrix" jsonb NOT NULL,
	"risk_mitigations" jsonb NOT NULL,
	"rollback_notes" text NOT NULL,
	"structured_document" jsonb,
	"author_actor_id" uuid,
	"artifact_refs" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_item_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"status" "spec_plan_status" NOT NULL,
	"editing_state" "spec_plan_editing_state" NOT NULL,
	"gate_state" "spec_plan_gate_state" NOT NULL,
	"resolution" "spec_plan_resolution" NOT NULL,
	"current_revision_id" uuid,
	"approved_revision_id" uuid,
	"approved_at" timestamp with time zone,
	"approved_by_actor_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "context_manifests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision_id" uuid NOT NULL,
	"source_ref" jsonb NOT NULL,
	"development_plan_id" uuid,
	"development_plan_revision_id" uuid,
	"development_plan_item_id" uuid,
	"development_plan_item_revision_id" uuid,
	"brainstorming_session_id" uuid,
	"brainstorming_session_revision_id" uuid,
	"boundary_summary_id" uuid,
	"boundary_summary_revision_id" uuid,
	"boundary_approver_actor_id" uuid,
	"boundary_approved_at" timestamp with time zone,
	"approved_spec_revision_id" uuid,
	"sources" jsonb NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"runtime_identity" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "development_plan_item_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"development_plan_item_id" uuid NOT NULL,
	"development_plan_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"change_reason" text NOT NULL,
	"edited_by_actor_id" uuid,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "development_plan_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"development_plan_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"source_ref" jsonb NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"driver_actor_id" uuid,
	"responsible_role" text NOT NULL,
	"reviewer_actor_id" uuid,
	"leader_actor_id" uuid,
	"leader_delegate_actor_ids" jsonb,
	"risk" text NOT NULL,
	"dependency_hints" jsonb NOT NULL,
	"affected_surfaces" jsonb NOT NULL,
	"boundary_status" text NOT NULL,
	"spec_status" text NOT NULL,
	"execution_plan_status" text NOT NULL,
	"execution_status" text NOT NULL,
	"review_status" text NOT NULL,
	"qa_handoff_status" text NOT NULL,
	"release_impact" text NOT NULL,
	"next_action" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "development_plan_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"development_plan_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"title" text NOT NULL,
	"status" text NOT NULL,
	"source_refs" jsonb NOT NULL,
	"item_refs" jsonb NOT NULL,
	"generation_state" text,
	"change_reason" text NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "development_plan_source_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"development_plan_id" uuid NOT NULL,
	"source_ref" jsonb NOT NULL,
	"link_type" text NOT NULL,
	"rationale" text,
	"created_by_actor_id" uuid,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "development_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" text NOT NULL,
	"source_refs" jsonb NOT NULL,
	"items" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codex_session_leases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"codex_session_id" uuid NOT NULL,
	"lease_token_hash" text NOT NULL,
	"lease_epoch" integer NOT NULL,
	"worker_id" text NOT NULL,
	"worker_session_digest" text NOT NULL,
	"status" text NOT NULL,
	"acquired_at" timestamp with time zone NOT NULL,
	"heartbeat_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone,
	"fenced_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codex_session_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"codex_session_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"artifact_ref" text NOT NULL,
	"digest" text NOT NULL,
	"size_bytes" text NOT NULL,
	"manifest_digest" text NOT NULL,
	"codex_thread_id_digest" text,
	"runtime_profile_revision_id" uuid NOT NULL,
	"created_from_turn_id" uuid,
	"created_by_actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codex_session_stale_terminalization_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"codex_session_id" uuid NOT NULL,
	"codex_session_turn_id" uuid,
	"lease_id" uuid,
	"lease_epoch" integer,
	"worker_id" text NOT NULL,
	"worker_session_digest" text NOT NULL,
	"expected_previous_snapshot_digest" text,
	"attempted_output_snapshot_digest" text,
	"attempted_codex_thread_id_digest" text,
	"failure_code" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codex_session_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"codex_session_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"intent" text NOT NULL,
	"status" text NOT NULL,
	"input_digest" text NOT NULL,
	"expected_previous_snapshot_digest" text,
	"output_snapshot_id" uuid,
	"output_snapshot_digest" text,
	"output_object_type" text,
	"output_object_id" text,
	"codex_thread_id_digest" text,
	"lease_id" uuid,
	"lease_epoch" integer,
	"automation_action_run_id" uuid,
	"runtime_job_id" uuid,
	"created_by_actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codex_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"status" text NOT NULL,
	"role" text NOT NULL,
	"codex_thread_id" text,
	"codex_thread_id_digest" text,
	"latest_snapshot_id" uuid,
	"latest_snapshot_digest" text,
	"latest_turn_id" uuid,
	"latest_turn_digest" text,
	"runtime_profile_id" uuid NOT NULL,
	"runtime_profile_revision_id" uuid NOT NULL,
	"credential_binding_id" uuid NOT NULL,
	"credential_binding_version_id" uuid NOT NULL,
	"active_lease_id" uuid,
	"lease_epoch" integer DEFAULT 0 NOT NULL,
	"forked_from_session_id" uuid,
	"forked_from_turn_id" uuid,
	"forked_from_snapshot_id" uuid,
	"fork_reason" text,
	"created_by_actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "execution_readiness_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"development_plan_id" uuid NOT NULL,
	"development_plan_item_id" uuid NOT NULL,
	"codex_session_id" uuid NOT NULL,
	"codex_session_turn_id" uuid,
	"approved_boundary_summary_revision_id" uuid NOT NULL,
	"approved_spec_revision_id" uuid NOT NULL,
	"approved_implementation_plan_revision_id" uuid NOT NULL,
	"readiness_state" text NOT NULL,
	"blocker_codes" jsonb NOT NULL,
	"supporting_evidence" jsonb NOT NULL,
	"created_by_actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_item_workflow_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"reason" text,
	"evidence_object_type" text NOT NULL,
	"evidence_object_id" text NOT NULL,
	"evidence_digest" text,
	"supporting_evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"codex_session_id" uuid NOT NULL,
	"codex_session_turn_id" uuid,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_item_workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"development_plan_id" uuid NOT NULL,
	"development_plan_item_id" uuid NOT NULL,
	"status" text NOT NULL,
	"previous_status" text,
	"active_codex_session_id" uuid,
	"active_boundary_summary_revision_id" uuid,
	"active_spec_doc_revision_id" uuid,
	"active_implementation_plan_doc_revision_id" uuid,
	"execution_package_id" uuid,
	"created_by_actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_manual_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"codex_session_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"selected_codex_session_id" uuid,
	"related_object_type" text,
	"related_object_id" text,
	"created_by_actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "boundary_answers" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"round_id" text,
	"question_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"text" text NOT NULL,
	"actor_id" text NOT NULL,
	"actor_role" text,
	"answered_for_actor_id" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "boundary_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"round_id" text,
	"sequence" integer NOT NULL,
	"text" text NOT NULL,
	"actor_id" text NOT NULL,
	"actor_role" text,
	"source" text NOT NULL,
	"state" text NOT NULL,
	"rationale" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "boundary_questions" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"round_id" text,
	"sequence" integer NOT NULL,
	"text" text NOT NULL,
	"author_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"required" boolean NOT NULL,
	"rationale" text,
	"answered_by_answer_id" text,
	"waived_by_decision_id" text
);
--> statement-breakpoint
CREATE TABLE "boundary_rounds" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"session_revision_id" uuid NOT NULL,
	"round_number" integer NOT NULL,
	"trigger" text NOT NULL,
	"leader_input_markdown" text,
	"ai_output_markdown" text,
	"runtime_job_id" uuid,
	"codex_session_turn_id" uuid,
	"runtime_profile_revision_id" uuid,
	"credential_binding_version_id" uuid,
	"app_server_thread_digest" text,
	"app_server_turn_digest" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "boundary_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision_id" uuid NOT NULL,
	"brainstorming_session_id" uuid NOT NULL,
	"brainstorming_session_revision_id" uuid NOT NULL,
	"development_plan_id" uuid NOT NULL,
	"development_plan_item_id" uuid NOT NULL,
	"development_plan_item_revision_id" uuid NOT NULL,
	"source_ref" jsonb NOT NULL,
	"summary" text NOT NULL,
	"approved_by_actor_id" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "boundary_summary_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"boundary_summary_id" uuid NOT NULL,
	"brainstorming_session_id" uuid NOT NULL,
	"brainstorming_session_revision_id" uuid NOT NULL,
	"source_round_id" text,
	"development_plan_id" uuid,
	"development_plan_item_id" uuid NOT NULL,
	"workflow_id" uuid,
	"codex_session_id" uuid,
	"codex_session_turn_id" uuid,
	"development_plan_item_revision_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"status" text,
	"summary_markdown" text NOT NULL,
	"confirmed_scope" jsonb,
	"confirmed_out_of_scope" jsonb,
	"accepted_assumptions" jsonb,
	"open_risks" jsonb,
	"validation_expectations" jsonb,
	"question_answer_snapshot" jsonb,
	"decision_snapshot" jsonb NOT NULL,
	"decision_count" integer NOT NULL,
	"context_manifest_id" uuid,
	"context_manifest_revision_id" uuid,
	"proposed_by_runtime_job_id" uuid,
	"approved_by_actor_id" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brainstorming_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision_id" uuid NOT NULL,
	"source_ref" jsonb NOT NULL,
	"development_plan_id" uuid NOT NULL,
	"development_plan_revision_id" uuid,
	"development_plan_item_id" uuid NOT NULL,
	"workflow_id" uuid,
	"codex_session_id" uuid,
	"development_plan_item_revision_id" uuid NOT NULL,
	"leader_actor_id" uuid,
	"leader_delegate_actor_ids" jsonb,
	"status" text,
	"current_round_id" text,
	"latest_summary_revision_id" uuid,
	"approved_summary_revision_id" uuid,
	"closed_at" timestamp with time zone,
	"context_manifest_id" uuid NOT NULL,
	"context_manifest_revision_id" uuid NOT NULL,
	"questions" jsonb NOT NULL,
	"answers" jsonb NOT NULL,
	"decisions" jsonb NOT NULL,
	"approval_state" text NOT NULL,
	"boundary_summary_id" uuid,
	"approver_actor_id" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_plan_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_plan_id" uuid NOT NULL,
	"development_plan_item_id" uuid NOT NULL,
	"workflow_id" uuid,
	"codex_session_id" uuid,
	"codex_session_turn_id" uuid,
	"based_on_spec_revision_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"summary" text NOT NULL,
	"content" text NOT NULL,
	"structured_document" jsonb,
	"author_actor_id" uuid,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"development_plan_item_id" uuid NOT NULL,
	"workflow_id" uuid,
	"status" text NOT NULL,
	"current_revision_id" uuid,
	"approved_revision_id" uuid,
	"approved_by_actor_id" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "code_review_handoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" jsonb NOT NULL,
	"execution_id" uuid NOT NULL,
	"development_plan_item_id" uuid NOT NULL,
	"execution_plan_revision_id" uuid NOT NULL,
	"reviewer_actor_id" uuid NOT NULL,
	"status" text NOT NULL,
	"summary" text NOT NULL,
	"changed_surfaces" jsonb NOT NULL,
	"verification_evidence_refs" jsonb NOT NULL,
	"approved_by_actor_id" uuid,
	"approved_at" timestamp with time zone,
	"decision_rationale" text,
	"audited_exception" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" jsonb NOT NULL,
	"development_plan_item_id" uuid NOT NULL,
	"development_plan_item_ref" jsonb NOT NULL,
	"execution_plan_revision_id" uuid NOT NULL,
	"execution_plan_revision_ref" jsonb NOT NULL,
	"approved_spec_revision_id" uuid NOT NULL,
	"approved_spec_revision_ref" jsonb NOT NULL,
	"status" text NOT NULL,
	"worker_state" text,
	"current_step" text,
	"stale" boolean,
	"blocked" boolean,
	"last_event_at" timestamp with time zone,
	"last_event_summary" text,
	"evidence_refs" jsonb NOT NULL,
	"runtime_evidence_refs" jsonb NOT NULL,
	"interrupt_history" jsonb NOT NULL,
	"continuation_history" jsonb NOT NULL,
	"pr_refs" jsonb NOT NULL,
	"diff_refs" jsonb NOT NULL,
	"test_evidence_refs" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qa_handoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" jsonb NOT NULL,
	"code_review_handoff_id" uuid NOT NULL,
	"execution_id" uuid NOT NULL,
	"source_ref" jsonb NOT NULL,
	"development_plan_item_id" uuid NOT NULL,
	"development_plan_item_ref" jsonb NOT NULL,
	"approved_spec_revision_ref" jsonb NOT NULL,
	"approved_execution_plan_revision_ref" jsonb NOT NULL,
	"status" text NOT NULL,
	"acceptance_criteria" jsonb NOT NULL,
	"test_strategy" text NOT NULL,
	"verification_evidence_refs" jsonb NOT NULL,
	"known_risks" jsonb NOT NULL,
	"changed_surfaces" jsonb NOT NULL,
	"release_impact" text NOT NULL,
	"blocked_by_actor_id" uuid,
	"accepted_by_actor_id" uuid,
	"rationale" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_package_dependencies" (
	"package_id" uuid NOT NULL,
	"depends_on_package_id" uuid NOT NULL,
	"dependency_type" text,
	"reason" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	CONSTRAINT "execution_package_dependencies_package_id_depends_on_package_id_pk" PRIMARY KEY("package_id","depends_on_package_id")
);
--> statement-breakpoint
CREATE TABLE "execution_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid,
	"work_item_id" uuid NOT NULL,
	"development_plan_item_id" uuid,
	"workflow_id" uuid,
	"codex_session_id" uuid,
	"codex_session_turn_id" uuid,
	"execution_id" uuid,
	"spec_id" uuid NOT NULL,
	"spec_revision_id" uuid NOT NULL,
	"execution_plan_id" uuid,
	"execution_plan_revision_id" uuid,
	"plan_id" uuid NOT NULL,
	"plan_revision_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"repo_id" text NOT NULL,
	"objective" text NOT NULL,
	"owner_actor_id" uuid NOT NULL,
	"reviewer_actor_id" uuid NOT NULL,
	"qa_owner_actor_id" uuid NOT NULL,
	"phase" "execution_package_phase" NOT NULL,
	"activity_state" "execution_package_activity_state" NOT NULL,
	"gate_state" "execution_package_gate_state" NOT NULL,
	"resolution" "execution_package_resolution" NOT NULL,
	"required_checks" jsonb NOT NULL,
	"required_test_gates" jsonb NOT NULL,
	"required_artifact_kinds" jsonb NOT NULL,
	"allowed_paths" jsonb NOT NULL,
	"forbidden_paths" jsonb NOT NULL,
	"source_mutation_policy" text DEFAULT 'path_policy_scoped' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"execution_package_set_id" text,
	"execution_package_version" integer,
	"generation_key" text,
	"package_key" text,
	"sequence" integer,
	"manifest_digest" text,
	"validation_strategy" text,
	"validation_strategy_version" integer,
	"validation_rationale" text,
	"validation_approved_by" uuid,
	"validation_approved_at" timestamp with time zone,
	"validation_evidence_refs" jsonb,
	"validation_public_summary" text,
	"policy_snapshot_status" text,
	"policy_snapshot_version" integer,
	"package_policy_snapshot" jsonb,
	"integration_readiness" jsonb,
	"current_run_session_id" uuid,
	"last_run_session_id" uuid,
	"current_review_packet_id" uuid,
	"current_release_id" uuid,
	"last_failure_summary" text,
	"blocked_reason" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_package_id" uuid NOT NULL,
	"workflow_id" uuid,
	"codex_session_id" uuid,
	"codex_session_turn_id" uuid,
	"requested_by_actor_id" uuid NOT NULL,
	"status" "run_session_status" NOT NULL,
	"executor_type" text,
	"executor_result" jsonb,
	"run_spec" jsonb,
	"runtime_metadata" jsonb,
	"changed_files" jsonb NOT NULL,
	"check_results" jsonb NOT NULL,
	"artifacts" jsonb NOT NULL,
	"log_refs" jsonb NOT NULL,
	"summary" text,
	"failure_kind" text,
	"failure_reason" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "run_events" (
	"id" text PRIMARY KEY NOT NULL,
	"run_session_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"cursor" text NOT NULL,
	"event_type" text NOT NULL,
	"source" text NOT NULL,
	"visibility" text NOT NULL,
	"summary" text NOT NULL,
	"payload" jsonb NOT NULL,
	"raw_ref" jsonb,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_event_counters" (
	"run_session_id" text PRIMARY KEY NOT NULL,
	"next_sequence" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_commands" (
	"id" text PRIMARY KEY NOT NULL,
	"run_session_id" text NOT NULL,
	"command_type" text NOT NULL,
	"status" text NOT NULL,
	"actor_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"target_thread_id" text,
	"target_turn_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"claimed_by_worker_id" text,
	"claimed_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"failure_reason" text,
	"driver_ack" jsonb
);
--> statement-breakpoint
CREATE TABLE "run_worker_leases" (
	"id" text PRIMARY KEY NOT NULL,
	"run_session_id" text NOT NULL,
	"worker_id" text NOT NULL,
	"lease_token" text NOT NULL,
	"heartbeat_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	CONSTRAINT "run_worker_leases_run_session_id_unique" UNIQUE("run_session_id")
);
--> statement-breakpoint
CREATE TABLE "review_packets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_session_id" uuid NOT NULL,
	"execution_package_id" uuid NOT NULL,
	"workflow_id" uuid,
	"codex_session_id" uuid,
	"codex_session_turn_id" uuid,
	"reviewer_actor_id" uuid NOT NULL,
	"spec_revision_id" uuid NOT NULL,
	"plan_revision_id" uuid NOT NULL,
	"status" "review_packet_status" NOT NULL,
	"decision" "review_packet_decision" NOT NULL,
	"summary" text,
	"changed_files" jsonb NOT NULL,
	"check_result_summary" text NOT NULL,
	"self_review" jsonb NOT NULL,
	"independent_ai_review" jsonb,
	"test_mapping" jsonb,
	"risk_notes" jsonb NOT NULL,
	"reviewed_by_actor_id" uuid,
	"reviewed_at" timestamp with time zone,
	"requested_changes" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"object_type" text NOT NULL,
	"object_id" text NOT NULL,
	"trace_subject_type" text,
	"trace_subject_id" text,
	"artifact_type" text,
	"ref" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"object_type" text NOT NULL,
	"object_id" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"decided_by_actor_id" uuid,
	"decision_type" text,
	"outcome" "decision_value",
	"decision" "decision_value" NOT NULL,
	"summary" text NOT NULL,
	"rationale" text,
	"evidence_refs" jsonb,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "object_events" (
	"id" text PRIMARY KEY NOT NULL,
	"object_type" text NOT NULL,
	"object_id" text NOT NULL,
	"event_type" text NOT NULL,
	"actor_type" text,
	"actor_id" text,
	"reason" text,
	"payload" jsonb,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "status_histories" (
	"id" text PRIMARY KEY NOT NULL,
	"object_type" text NOT NULL,
	"object_id" text NOT NULL,
	"field_name" text,
	"from_status" text,
	"to_status" text NOT NULL,
	"from_value" text,
	"to_value" text,
	"actor_type" text,
	"actor_id" text,
	"reason" text,
	"context" jsonb,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trace_artifact_refs" (
	"id" text PRIMARY KEY NOT NULL,
	"trace_event_id" text NOT NULL,
	"artifact_id" text,
	"ref" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trace_events" (
	"id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"actor_id" text,
	"summary" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trace_links" (
	"id" text PRIMARY KEY NOT NULL,
	"trace_event_id" text NOT NULL,
	"relationship" "trace_link_relationship" NOT NULL,
	"object_type" text NOT NULL,
	"object_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "release_evidences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"key" text NOT NULL,
	"title" text,
	"description" text,
	"evidence_type" "release_evidence_type" NOT NULL,
	"artifact_id" uuid,
	"summary" text NOT NULL,
	"object_ref" jsonb,
	"redacted" boolean NOT NULL,
	"status" "release_evidence_status" NOT NULL,
	"visibility" text NOT NULL,
	"source_type" text,
	"labels" text[] NOT NULL,
	"extra" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"created_by_actor_id" uuid NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by_actor_id" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "release_execution_packages" (
	"release_id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"link_order" integer NOT NULL,
	CONSTRAINT "release_execution_packages_release_id_package_id_pk" PRIMARY KEY("release_id","package_id")
);
--> statement-breakpoint
CREATE TABLE "release_work_items" (
	"release_id" uuid NOT NULL,
	"work_item_id" uuid NOT NULL,
	"link_order" integer NOT NULL,
	CONSTRAINT "release_work_items_release_id_work_item_id_pk" PRIMARY KEY("release_id","work_item_id")
);
--> statement-breakpoint
CREATE TABLE "releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"phase" "release_phase" NOT NULL,
	"activity_state" "release_activity_state" NOT NULL,
	"gate_state" "release_gate_state" NOT NULL,
	"resolution" "release_resolution" NOT NULL,
	"release_owner_actor_id" uuid NOT NULL,
	"release_type" "release_type" NOT NULL,
	"scope_summary" text,
	"risk_summary" jsonb,
	"rollout_strategy" text,
	"rollback_plan" text,
	"observation_plan" text,
	"current_review_packet_ids" jsonb,
	"current_run_session_ids" jsonb,
	"rollout_started_at" timestamp with time zone,
	"rollout_completed_at" timestamp with time zone,
	"observed_until" timestamp with time zone,
	"visibility" text NOT NULL,
	"source_type" text,
	"labels" text[] NOT NULL,
	"extra" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"created_by_actor_id" uuid NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by_actor_id" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "automation_action_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"action_type" text NOT NULL,
	"target_object_type" text NOT NULL,
	"target_object_id" text NOT NULL,
	"workflow_id" uuid,
	"codex_session_id" uuid,
	"codex_session_turn_id" uuid,
	"target_revision_id" text,
	"target_version" integer,
	"target_status" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"automation_scope" text NOT NULL,
	"automation_settings_version" integer NOT NULL,
	"capability_fingerprint" text NOT NULL,
	"precondition_fingerprint" text NOT NULL,
	"action_input_json" jsonb NOT NULL,
	"status" text NOT NULL,
	"claim_token" text,
	"attempt" integer NOT NULL,
	"locked_until" timestamp with time zone,
	"last_heartbeat_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone,
	"retryable" boolean,
	"result_json" jsonb,
	"metadata_json" jsonb,
	"reason" text,
	"error_code" text,
	"error_message" text,
	"policy_digest" text,
	"created_by" text,
	"claimed_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	CONSTRAINT "automation_action_runs_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "automation_project_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"repo_id" text,
	"preset" text NOT NULL,
	"capabilities_json" jsonb NOT NULL,
	"capability_fingerprint" text NOT NULL,
	"scope_type" text NOT NULL,
	"version" integer NOT NULL,
	"enabled_by" text,
	"enabled_at" timestamp with time zone,
	"updated_by" text,
	"updated_at" timestamp with time zone,
	"reason" text,
	"evidence_refs" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "command_idempotency_records" (
	"id" text PRIMARY KEY NOT NULL,
	"command_name" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"target_object_type" text NOT NULL,
	"target_object_id" text NOT NULL,
	"target_revision_id" text,
	"target_version" integer,
	"precondition_json" jsonb,
	"precondition_fingerprint" text,
	"actor_scope" text,
	"result_json" jsonb,
	"status" text NOT NULL,
	"locked_until" timestamp with time zone,
	"last_heartbeat_at" timestamp with time zone,
	"claim_token" text,
	"created_by" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	CONSTRAINT "command_idempotency_records_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "execution_package_generation_packages" (
	"execution_package_set_id" text NOT NULL,
	"execution_package_id" text NOT NULL,
	"plan_revision_id" text NOT NULL,
	"generation_key" text NOT NULL,
	"package_key" text NOT NULL,
	"sequence" integer NOT NULL,
	"manifest_digest" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_package_generation_runs" (
	"execution_package_set_id" text PRIMARY KEY NOT NULL,
	"plan_revision_id" text NOT NULL,
	"generation_key" text NOT NULL,
	"version" integer NOT NULL,
	"generator_version" text,
	"policy_digest" text,
	"manifest_digest" text,
	"expected_package_count" integer,
	"expected_package_keys" jsonb,
	"status" text NOT NULL,
	"result_json" jsonb,
	"locked_until" timestamp with time zone,
	"last_heartbeat_at" timestamp with time zone,
	"claim_token" text,
	"superseded_by" text,
	"superseded_at" timestamp with time zone,
	"superseded_reason" text,
	"supersede_command_id" text,
	"evidence_refs" jsonb,
	"next_generation_key" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "manual_path_hold_idempotency_records" (
	"idempotency_key" text PRIMARY KEY NOT NULL,
	"hold_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manual_path_holds" (
	"id" text PRIMARY KEY NOT NULL,
	"object_type" text NOT NULL,
	"object_id" text NOT NULL,
	"scope_key" text NOT NULL,
	"status" text NOT NULL,
	"reason_code" text NOT NULL,
	"reason" text NOT NULL,
	"source_automation_action_id" text,
	"evidence_refs" jsonb NOT NULL,
	"requested_by" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	"metadata_json" jsonb
);
--> statement-breakpoint
CREATE TABLE "internal_artifact_objects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"artifact_id" text NOT NULL,
	"ref" text NOT NULL,
	"storage_key" text NOT NULL,
	"kind" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"digest" text NOT NULL,
	"visibility" text NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_digest" text NOT NULL,
	"metadata_json" jsonb NOT NULL,
	"created_by_actor_type" text NOT NULL,
	"created_by_actor_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "codex_credential_binding_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"binding_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"status" text NOT NULL,
	"payload_digest" text NOT NULL,
	"secret_payload_json" jsonb NOT NULL,
	"created_by_actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codex_credential_bindings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"repo_id" text,
	"provider" text NOT NULL,
	"purpose" text NOT NULL,
	"active_version_id" uuid,
	"created_by_actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codex_launch_leases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lease_request_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"target_kind" text NOT NULL,
	"project_id" uuid NOT NULL,
	"repo_id" text,
	"launch_attempt" integer NOT NULL,
	"action_type" text,
	"action_attempt" integer,
	"action_claim_token_hash" text,
	"precondition_fingerprint" text,
	"execution_package_id" uuid,
	"run_worker_lease_id" text,
	"run_worker_lease_token_hash" text,
	"run_session_status" text,
	"run_session_updated_at" timestamp with time zone,
	"execution_package_version" integer,
	"worker_id" uuid,
	"status" text NOT NULL,
	"lease_token_hash" text NOT NULL,
	"runtime_profile_revision_id" uuid NOT NULL,
	"runtime_profile_digest" text NOT NULL,
	"credential_binding_id" uuid NOT NULL,
	"credential_binding_version_id" uuid NOT NULL,
	"credential_payload_digest" text NOT NULL,
	"docker_image_digest" text NOT NULL,
	"network_policy_digest" text NOT NULL,
	"network_provider_config_digest" text,
	"materialization_request_hash" text,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"materialized_at" timestamp with time zone,
	"terminalized_at" timestamp with time zone,
	"terminal_reason_code" text,
	"terminal_evidence_summary_json" jsonb,
	"terminal_runtime_job_id" text,
	"terminal_idempotency_key" text
);
--> statement-breakpoint
CREATE TABLE "codex_launch_token_envelopes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"runtime_job_id" uuid NOT NULL,
	"launch_lease_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"key_id" text NOT NULL,
	"algorithm" text NOT NULL,
	"ciphertext" text NOT NULL,
	"encryption_nonce" text NOT NULL,
	"aad_json" jsonb NOT NULL,
	"aad_digest" text NOT NULL,
	"envelope_digest" text NOT NULL,
	"status" text NOT NULL,
	"claim_request_id" text,
	"claim_request_digest" text,
	"claimed_worker_session_digest" text,
	"claimed_key_id" text,
	"claimed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codex_pending_workspace_bundles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"bundle_id" text NOT NULL,
	"runtime_job_id" uuid,
	"run_session_id" text NOT NULL,
	"execution_package_id" text NOT NULL,
	"run_worker_lease_id" text NOT NULL,
	"status" text NOT NULL,
	"pending_artifact_ref" text NOT NULL,
	"internal_artifact_object_id" uuid,
	"archive_digest" text NOT NULL,
	"manifest_digest" text NOT NULL,
	"archive_bytes_base64" text,
	"size_bytes" integer NOT NULL,
	"workspace_acquisition_digest" text NOT NULL,
	"workspace_acquisition_json" jsonb NOT NULL,
	"request_digest" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codex_runtime_job_artifacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"runtime_job_id" uuid NOT NULL,
	"artifact_idempotency_key" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"digest" text NOT NULL,
	"internal_ref" text NOT NULL,
	"internal_artifact_object_id" uuid,
	"size_bytes" integer NOT NULL,
	"metadata_json" jsonb NOT NULL,
	"request_digest" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codex_runtime_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_request_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"workflow_id" uuid,
	"codex_session_id" uuid,
	"codex_session_turn_id" uuid,
	"target_kind" text NOT NULL,
	"project_id" uuid NOT NULL,
	"repo_id" text,
	"worker_id" uuid NOT NULL,
	"launch_lease_id" uuid NOT NULL,
	"launch_attempt" integer NOT NULL,
	"status" text NOT NULL,
	"input_digest" text NOT NULL,
	"input_json" jsonb NOT NULL,
	"workspace_acquisition_digest" text,
	"workspace_acquisition_json" jsonb,
	"runtime_profile_revision_id" uuid NOT NULL,
	"runtime_profile_digest" text NOT NULL,
	"credential_binding_id" uuid NOT NULL,
	"credential_binding_version_id" uuid NOT NULL,
	"credential_payload_digest" text NOT NULL,
	"docker_image_digest" text NOT NULL,
	"network_policy_digest" text NOT NULL,
	"network_provider_config_digest" text,
	"envelope_digest" text NOT NULL,
	"accept_idempotency_key" text,
	"accept_request_digest" text,
	"accepted_at" timestamp with time zone,
	"accepted_worker_session_digest" text,
	"accepted_session_public_key_id" text,
	"accepted_session_public_key_expires_at" timestamp with time zone,
	"accepted_session_epoch" integer,
	"materializing_at" timestamp with time zone,
	"materialization_request_id" text,
	"materialization_request_digest" text,
	"start_idempotency_key" text,
	"start_request_digest" text,
	"runtime_evidence_digest" text,
	"launch_materialization_digest" text,
	"started_at" timestamp with time zone,
	"last_event_at" timestamp with time zone,
	"cancel_requested_at" timestamp with time zone,
	"cancel_idempotency_key" text,
	"cancel_request_digest" text,
	"drain_requested_at" timestamp with time zone,
	"terminal_idempotency_key" text,
	"terminal_request_digest" text,
	"terminal_at" timestamp with time zone,
	"terminal_status" text,
	"terminal_reason_code" text,
	"terminal_result_json" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codex_runtime_profile_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"status" text NOT NULL,
	"environment" text NOT NULL,
	"docker_image" text NOT NULL,
	"docker_image_digest" text NOT NULL,
	"target_kind" text NOT NULL,
	"source_access_mode" text NOT NULL,
	"codex_config_toml" text NOT NULL,
	"codex_config_digest" text NOT NULL,
	"expected_effective_config_digest" text NOT NULL,
	"effective_config_assertions" jsonb NOT NULL,
	"app_server_required" boolean NOT NULL,
	"allowed_driver_kind" text NOT NULL,
	"network_policy" jsonb NOT NULL,
	"resource_limits" jsonb NOT NULL,
	"docker_policy" jsonb NOT NULL,
	"allowed_scopes" jsonb NOT NULL,
	"profile_digest" text NOT NULL,
	"created_by_actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codex_runtime_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"environment" text NOT NULL,
	"target_kind" text NOT NULL,
	"active_revision_id" uuid,
	"created_by_actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codex_runtime_setup_nonces" (
	"setup_nonce_hash" text PRIMARY KEY NOT NULL,
	"request_signature_hash" text NOT NULL,
	"actor_id" text NOT NULL,
	"actor_class" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codex_worker_bootstrap_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"worker_identity" text NOT NULL,
	"bootstrap_token_hash" text NOT NULL,
	"bootstrap_token_version" integer NOT NULL,
	"status" text NOT NULL,
	"allowed_scopes_json" jsonb NOT NULL,
	"allowed_capabilities_json" jsonb NOT NULL,
	"created_by_actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "codex_worker_registrations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"worker_identity" text NOT NULL,
	"status" text NOT NULL,
	"version" text NOT NULL,
	"control_channel_status" text NOT NULL,
	"session_token_hash" text NOT NULL,
	"session_token_expires_at" timestamp with time zone NOT NULL,
	"session_epoch" integer DEFAULT 1 NOT NULL,
	"bootstrap_token_hash" text NOT NULL,
	"bootstrap_token_version" integer NOT NULL,
	"allowed_scopes_json" jsonb NOT NULL,
	"capabilities_json" jsonb NOT NULL,
	"capability_ceiling_json" jsonb NOT NULL,
	"host_worker_uid" integer NOT NULL,
	"host_worker_gid" integer NOT NULL,
	"lease_count" integer NOT NULL,
	"max_concurrency" integer NOT NULL,
	"labels_json" jsonb NOT NULL,
	"session_public_key_id" text NOT NULL,
	"session_public_key_algorithm" text NOT NULL,
	"session_public_key_material" text NOT NULL,
	"session_public_key_created_at" timestamp with time zone NOT NULL,
	"session_public_key_expires_at" timestamp with time zone NOT NULL,
	"registered_at" timestamp with time zone NOT NULL,
	"last_heartbeat_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "codex_worker_session_nonces" (
	"id" uuid PRIMARY KEY NOT NULL,
	"worker_id" uuid NOT NULL,
	"session_token_hash" text NOT NULL,
	"nonce_hash" text NOT NULL,
	"session_epoch" integer NOT NULL,
	"request_binding_digest" text NOT NULL,
	"replay_key_hash" text NOT NULL,
	"nonce_timestamp" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "actors" ADD CONSTRAINT "actors_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_repos" ADD CONSTRAINT "project_repos_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_actor_id_actors_id_fk" FOREIGN KEY ("owner_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_driver_actor_id_actors_id_fk" FOREIGN KEY ("driver_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_revisions" ADD CONSTRAINT "spec_revisions_workflow_id_plan_item_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."plan_item_workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_revisions" ADD CONSTRAINT "spec_revisions_codex_session_id_codex_sessions_id_fk" FOREIGN KEY ("codex_session_id") REFERENCES "public"."codex_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_revisions" ADD CONSTRAINT "spec_revisions_codex_session_turn_id_codex_session_turns_id_fk" FOREIGN KEY ("codex_session_turn_id") REFERENCES "public"."codex_session_turns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_revisions" ADD CONSTRAINT "spec_revisions_author_actor_id_actors_id_fk" FOREIGN KEY ("author_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specs" ADD CONSTRAINT "specs_workflow_id_plan_item_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."plan_item_workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specs" ADD CONSTRAINT "specs_approved_by_actor_id_actors_id_fk" FOREIGN KEY ("approved_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_revisions" ADD CONSTRAINT "plan_revisions_author_actor_id_actors_id_fk" FOREIGN KEY ("author_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_approved_by_actor_id_actors_id_fk" FOREIGN KEY ("approved_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_manifests" ADD CONSTRAINT "context_manifests_boundary_approver_actor_id_actors_id_fk" FOREIGN KEY ("boundary_approver_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_plan_item_revisions" ADD CONSTRAINT "development_plan_item_revisions_development_plan_item_id_development_plan_items_id_fk" FOREIGN KEY ("development_plan_item_id") REFERENCES "public"."development_plan_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_plan_item_revisions" ADD CONSTRAINT "development_plan_item_revisions_development_plan_id_development_plans_id_fk" FOREIGN KEY ("development_plan_id") REFERENCES "public"."development_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_plan_item_revisions" ADD CONSTRAINT "development_plan_item_revisions_edited_by_actor_id_actors_id_fk" FOREIGN KEY ("edited_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_plan_items" ADD CONSTRAINT "development_plan_items_development_plan_id_development_plans_id_fk" FOREIGN KEY ("development_plan_id") REFERENCES "public"."development_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_plan_items" ADD CONSTRAINT "development_plan_items_driver_actor_id_actors_id_fk" FOREIGN KEY ("driver_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_plan_items" ADD CONSTRAINT "development_plan_items_reviewer_actor_id_actors_id_fk" FOREIGN KEY ("reviewer_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_plan_items" ADD CONSTRAINT "development_plan_items_leader_actor_id_actors_id_fk" FOREIGN KEY ("leader_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_plan_revisions" ADD CONSTRAINT "development_plan_revisions_development_plan_id_development_plans_id_fk" FOREIGN KEY ("development_plan_id") REFERENCES "public"."development_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_plan_revisions" ADD CONSTRAINT "development_plan_revisions_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_plan_source_links" ADD CONSTRAINT "development_plan_source_links_development_plan_id_development_plans_id_fk" FOREIGN KEY ("development_plan_id") REFERENCES "public"."development_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_plan_source_links" ADD CONSTRAINT "development_plan_source_links_created_by_actor_id_actors_id_fk" FOREIGN KEY ("created_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_plans" ADD CONSTRAINT "development_plans_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_session_leases" ADD CONSTRAINT "codex_session_leases_codex_session_id_codex_sessions_id_fk" FOREIGN KEY ("codex_session_id") REFERENCES "public"."codex_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_session_snapshots" ADD CONSTRAINT "codex_session_snapshots_codex_session_id_codex_sessions_id_fk" FOREIGN KEY ("codex_session_id") REFERENCES "public"."codex_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_session_snapshots" ADD CONSTRAINT "codex_session_snapshots_created_by_actor_id_actors_id_fk" FOREIGN KEY ("created_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_session_stale_terminalization_attempts" ADD CONSTRAINT "codex_session_stale_terminalization_attempts_codex_session_id_codex_sessions_id_fk" FOREIGN KEY ("codex_session_id") REFERENCES "public"."codex_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_session_stale_terminalization_attempts" ADD CONSTRAINT "codex_session_stale_terminalization_attempts_codex_session_turn_id_codex_session_turns_id_fk" FOREIGN KEY ("codex_session_turn_id") REFERENCES "public"."codex_session_turns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_session_turns" ADD CONSTRAINT "codex_session_turns_codex_session_id_codex_sessions_id_fk" FOREIGN KEY ("codex_session_id") REFERENCES "public"."codex_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_session_turns" ADD CONSTRAINT "codex_session_turns_workflow_id_plan_item_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."plan_item_workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_session_turns" ADD CONSTRAINT "codex_session_turns_created_by_actor_id_actors_id_fk" FOREIGN KEY ("created_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_sessions" ADD CONSTRAINT "codex_sessions_created_by_actor_id_actors_id_fk" FOREIGN KEY ("created_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_readiness_records" ADD CONSTRAINT "execution_readiness_records_workflow_id_plan_item_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."plan_item_workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_readiness_records" ADD CONSTRAINT "execution_readiness_records_development_plan_id_development_plans_id_fk" FOREIGN KEY ("development_plan_id") REFERENCES "public"."development_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_readiness_records" ADD CONSTRAINT "execution_readiness_records_development_plan_item_id_development_plan_items_id_fk" FOREIGN KEY ("development_plan_item_id") REFERENCES "public"."development_plan_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_readiness_records" ADD CONSTRAINT "execution_readiness_records_codex_session_id_codex_sessions_id_fk" FOREIGN KEY ("codex_session_id") REFERENCES "public"."codex_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_readiness_records" ADD CONSTRAINT "execution_readiness_records_codex_session_turn_id_codex_session_turns_id_fk" FOREIGN KEY ("codex_session_turn_id") REFERENCES "public"."codex_session_turns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_readiness_records" ADD CONSTRAINT "execution_readiness_records_created_by_actor_id_actors_id_fk" FOREIGN KEY ("created_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_item_workflow_transitions" ADD CONSTRAINT "plan_item_workflow_transitions_workflow_id_plan_item_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."plan_item_workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_item_workflow_transitions" ADD CONSTRAINT "plan_item_workflow_transitions_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_item_workflow_transitions" ADD CONSTRAINT "plan_item_workflow_transitions_codex_session_id_codex_sessions_id_fk" FOREIGN KEY ("codex_session_id") REFERENCES "public"."codex_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_item_workflows" ADD CONSTRAINT "plan_item_workflows_development_plan_id_development_plans_id_fk" FOREIGN KEY ("development_plan_id") REFERENCES "public"."development_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_item_workflows" ADD CONSTRAINT "plan_item_workflows_development_plan_item_id_development_plan_items_id_fk" FOREIGN KEY ("development_plan_item_id") REFERENCES "public"."development_plan_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_item_workflows" ADD CONSTRAINT "plan_item_workflows_created_by_actor_id_actors_id_fk" FOREIGN KEY ("created_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_manual_decisions" ADD CONSTRAINT "workflow_manual_decisions_workflow_id_plan_item_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."plan_item_workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_manual_decisions" ADD CONSTRAINT "workflow_manual_decisions_codex_session_id_codex_sessions_id_fk" FOREIGN KEY ("codex_session_id") REFERENCES "public"."codex_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_manual_decisions" ADD CONSTRAINT "workflow_manual_decisions_selected_codex_session_id_codex_sessions_id_fk" FOREIGN KEY ("selected_codex_session_id") REFERENCES "public"."codex_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_manual_decisions" ADD CONSTRAINT "workflow_manual_decisions_created_by_actor_id_actors_id_fk" FOREIGN KEY ("created_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boundary_answers" ADD CONSTRAINT "boundary_answers_session_id_brainstorming_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."brainstorming_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boundary_answers" ADD CONSTRAINT "boundary_answers_round_id_boundary_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."boundary_rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boundary_decisions" ADD CONSTRAINT "boundary_decisions_session_id_brainstorming_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."brainstorming_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boundary_decisions" ADD CONSTRAINT "boundary_decisions_round_id_boundary_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."boundary_rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boundary_questions" ADD CONSTRAINT "boundary_questions_session_id_brainstorming_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."brainstorming_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boundary_questions" ADD CONSTRAINT "boundary_questions_round_id_boundary_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."boundary_rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boundary_rounds" ADD CONSTRAINT "boundary_rounds_session_id_brainstorming_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."brainstorming_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boundary_rounds" ADD CONSTRAINT "boundary_rounds_codex_session_turn_id_codex_session_turns_id_fk" FOREIGN KEY ("codex_session_turn_id") REFERENCES "public"."codex_session_turns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boundary_summaries" ADD CONSTRAINT "boundary_summaries_brainstorming_session_id_brainstorming_sessions_id_fk" FOREIGN KEY ("brainstorming_session_id") REFERENCES "public"."brainstorming_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boundary_summaries" ADD CONSTRAINT "boundary_summaries_development_plan_id_development_plans_id_fk" FOREIGN KEY ("development_plan_id") REFERENCES "public"."development_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boundary_summaries" ADD CONSTRAINT "boundary_summaries_development_plan_item_id_development_plan_items_id_fk" FOREIGN KEY ("development_plan_item_id") REFERENCES "public"."development_plan_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boundary_summaries" ADD CONSTRAINT "boundary_summaries_approved_by_actor_id_actors_id_fk" FOREIGN KEY ("approved_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boundary_summary_revisions" ADD CONSTRAINT "boundary_summary_revisions_boundary_summary_id_boundary_summaries_id_fk" FOREIGN KEY ("boundary_summary_id") REFERENCES "public"."boundary_summaries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boundary_summary_revisions" ADD CONSTRAINT "boundary_summary_revisions_brainstorming_session_id_brainstorming_sessions_id_fk" FOREIGN KEY ("brainstorming_session_id") REFERENCES "public"."brainstorming_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boundary_summary_revisions" ADD CONSTRAINT "boundary_summary_revisions_source_round_id_boundary_rounds_id_fk" FOREIGN KEY ("source_round_id") REFERENCES "public"."boundary_rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boundary_summary_revisions" ADD CONSTRAINT "boundary_summary_revisions_development_plan_id_development_plans_id_fk" FOREIGN KEY ("development_plan_id") REFERENCES "public"."development_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boundary_summary_revisions" ADD CONSTRAINT "boundary_summary_revisions_development_plan_item_id_development_plan_items_id_fk" FOREIGN KEY ("development_plan_item_id") REFERENCES "public"."development_plan_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boundary_summary_revisions" ADD CONSTRAINT "boundary_summary_revisions_workflow_id_plan_item_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."plan_item_workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boundary_summary_revisions" ADD CONSTRAINT "boundary_summary_revisions_codex_session_id_codex_sessions_id_fk" FOREIGN KEY ("codex_session_id") REFERENCES "public"."codex_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boundary_summary_revisions" ADD CONSTRAINT "boundary_summary_revisions_codex_session_turn_id_codex_session_turns_id_fk" FOREIGN KEY ("codex_session_turn_id") REFERENCES "public"."codex_session_turns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boundary_summary_revisions" ADD CONSTRAINT "boundary_summary_revisions_development_plan_item_revision_id_development_plan_item_revisions_id_fk" FOREIGN KEY ("development_plan_item_revision_id") REFERENCES "public"."development_plan_item_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boundary_summary_revisions" ADD CONSTRAINT "boundary_summary_revisions_approved_by_actor_id_actors_id_fk" FOREIGN KEY ("approved_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brainstorming_sessions" ADD CONSTRAINT "brainstorming_sessions_development_plan_id_development_plans_id_fk" FOREIGN KEY ("development_plan_id") REFERENCES "public"."development_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brainstorming_sessions" ADD CONSTRAINT "brainstorming_sessions_development_plan_item_id_development_plan_items_id_fk" FOREIGN KEY ("development_plan_item_id") REFERENCES "public"."development_plan_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brainstorming_sessions" ADD CONSTRAINT "brainstorming_sessions_workflow_id_plan_item_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."plan_item_workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brainstorming_sessions" ADD CONSTRAINT "brainstorming_sessions_codex_session_id_codex_sessions_id_fk" FOREIGN KEY ("codex_session_id") REFERENCES "public"."codex_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brainstorming_sessions" ADD CONSTRAINT "brainstorming_sessions_leader_actor_id_actors_id_fk" FOREIGN KEY ("leader_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brainstorming_sessions" ADD CONSTRAINT "brainstorming_sessions_approver_actor_id_actors_id_fk" FOREIGN KEY ("approver_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_plan_revisions" ADD CONSTRAINT "execution_plan_revisions_execution_plan_id_execution_plans_id_fk" FOREIGN KEY ("execution_plan_id") REFERENCES "public"."execution_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_plan_revisions" ADD CONSTRAINT "execution_plan_revisions_development_plan_item_id_development_plan_items_id_fk" FOREIGN KEY ("development_plan_item_id") REFERENCES "public"."development_plan_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_plan_revisions" ADD CONSTRAINT "execution_plan_revisions_workflow_id_plan_item_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."plan_item_workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_plan_revisions" ADD CONSTRAINT "execution_plan_revisions_codex_session_id_codex_sessions_id_fk" FOREIGN KEY ("codex_session_id") REFERENCES "public"."codex_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_plan_revisions" ADD CONSTRAINT "execution_plan_revisions_codex_session_turn_id_codex_session_turns_id_fk" FOREIGN KEY ("codex_session_turn_id") REFERENCES "public"."codex_session_turns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_plan_revisions" ADD CONSTRAINT "execution_plan_revisions_based_on_spec_revision_id_spec_revisions_id_fk" FOREIGN KEY ("based_on_spec_revision_id") REFERENCES "public"."spec_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_plan_revisions" ADD CONSTRAINT "execution_plan_revisions_author_actor_id_actors_id_fk" FOREIGN KEY ("author_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_plans" ADD CONSTRAINT "execution_plans_development_plan_item_id_development_plan_items_id_fk" FOREIGN KEY ("development_plan_item_id") REFERENCES "public"."development_plan_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_plans" ADD CONSTRAINT "execution_plans_workflow_id_plan_item_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."plan_item_workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_plans" ADD CONSTRAINT "execution_plans_approved_by_actor_id_actors_id_fk" FOREIGN KEY ("approved_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_review_handoffs" ADD CONSTRAINT "code_review_handoffs_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_review_handoffs" ADD CONSTRAINT "code_review_handoffs_development_plan_item_id_development_plan_items_id_fk" FOREIGN KEY ("development_plan_item_id") REFERENCES "public"."development_plan_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_review_handoffs" ADD CONSTRAINT "code_review_handoffs_execution_plan_revision_id_execution_plan_revisions_id_fk" FOREIGN KEY ("execution_plan_revision_id") REFERENCES "public"."execution_plan_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_review_handoffs" ADD CONSTRAINT "code_review_handoffs_reviewer_actor_id_actors_id_fk" FOREIGN KEY ("reviewer_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_review_handoffs" ADD CONSTRAINT "code_review_handoffs_approved_by_actor_id_actors_id_fk" FOREIGN KEY ("approved_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_development_plan_item_id_development_plan_items_id_fk" FOREIGN KEY ("development_plan_item_id") REFERENCES "public"."development_plan_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_execution_plan_revision_id_execution_plan_revisions_id_fk" FOREIGN KEY ("execution_plan_revision_id") REFERENCES "public"."execution_plan_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_approved_spec_revision_id_spec_revisions_id_fk" FOREIGN KEY ("approved_spec_revision_id") REFERENCES "public"."spec_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qa_handoffs" ADD CONSTRAINT "qa_handoffs_code_review_handoff_id_code_review_handoffs_id_fk" FOREIGN KEY ("code_review_handoff_id") REFERENCES "public"."code_review_handoffs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qa_handoffs" ADD CONSTRAINT "qa_handoffs_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qa_handoffs" ADD CONSTRAINT "qa_handoffs_development_plan_item_id_development_plan_items_id_fk" FOREIGN KEY ("development_plan_item_id") REFERENCES "public"."development_plan_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qa_handoffs" ADD CONSTRAINT "qa_handoffs_blocked_by_actor_id_actors_id_fk" FOREIGN KEY ("blocked_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qa_handoffs" ADD CONSTRAINT "qa_handoffs_accepted_by_actor_id_actors_id_fk" FOREIGN KEY ("accepted_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_packages" ADD CONSTRAINT "execution_packages_workflow_id_plan_item_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."plan_item_workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_packages" ADD CONSTRAINT "execution_packages_codex_session_id_codex_sessions_id_fk" FOREIGN KEY ("codex_session_id") REFERENCES "public"."codex_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_packages" ADD CONSTRAINT "execution_packages_codex_session_turn_id_codex_session_turns_id_fk" FOREIGN KEY ("codex_session_turn_id") REFERENCES "public"."codex_session_turns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_packages" ADD CONSTRAINT "execution_packages_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_packages" ADD CONSTRAINT "execution_packages_owner_actor_id_actors_id_fk" FOREIGN KEY ("owner_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_packages" ADD CONSTRAINT "execution_packages_reviewer_actor_id_actors_id_fk" FOREIGN KEY ("reviewer_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_packages" ADD CONSTRAINT "execution_packages_qa_owner_actor_id_actors_id_fk" FOREIGN KEY ("qa_owner_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_sessions" ADD CONSTRAINT "run_sessions_workflow_id_plan_item_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."plan_item_workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_sessions" ADD CONSTRAINT "run_sessions_codex_session_id_codex_sessions_id_fk" FOREIGN KEY ("codex_session_id") REFERENCES "public"."codex_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_sessions" ADD CONSTRAINT "run_sessions_codex_session_turn_id_codex_session_turns_id_fk" FOREIGN KEY ("codex_session_turn_id") REFERENCES "public"."codex_session_turns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_sessions" ADD CONSTRAINT "run_sessions_requested_by_actor_id_actors_id_fk" FOREIGN KEY ("requested_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_packets" ADD CONSTRAINT "review_packets_workflow_id_plan_item_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."plan_item_workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_packets" ADD CONSTRAINT "review_packets_codex_session_id_codex_sessions_id_fk" FOREIGN KEY ("codex_session_id") REFERENCES "public"."codex_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_packets" ADD CONSTRAINT "review_packets_codex_session_turn_id_codex_session_turns_id_fk" FOREIGN KEY ("codex_session_turn_id") REFERENCES "public"."codex_session_turns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_packets" ADD CONSTRAINT "review_packets_reviewer_actor_id_actors_id_fk" FOREIGN KEY ("reviewer_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_packets" ADD CONSTRAINT "review_packets_reviewed_by_actor_id_actors_id_fk" FOREIGN KEY ("reviewed_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_decided_by_actor_id_actors_id_fk" FOREIGN KEY ("decided_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_evidences" ADD CONSTRAINT "release_evidences_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_evidences" ADD CONSTRAINT "release_evidences_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_evidences" ADD CONSTRAINT "release_evidences_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_evidences" ADD CONSTRAINT "release_evidences_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_evidences" ADD CONSTRAINT "release_evidences_created_by_actor_id_actors_id_fk" FOREIGN KEY ("created_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_evidences" ADD CONSTRAINT "release_evidences_updated_by_actor_id_actors_id_fk" FOREIGN KEY ("updated_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_execution_packages" ADD CONSTRAINT "release_execution_packages_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_execution_packages" ADD CONSTRAINT "release_execution_packages_package_id_execution_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."execution_packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_work_items" ADD CONSTRAINT "release_work_items_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_work_items" ADD CONSTRAINT "release_work_items_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_release_owner_actor_id_actors_id_fk" FOREIGN KEY ("release_owner_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_created_by_actor_id_actors_id_fk" FOREIGN KEY ("created_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_updated_by_actor_id_actors_id_fk" FOREIGN KEY ("updated_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_action_runs" ADD CONSTRAINT "automation_action_runs_workflow_id_plan_item_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."plan_item_workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_action_runs" ADD CONSTRAINT "automation_action_runs_codex_session_id_codex_sessions_id_fk" FOREIGN KEY ("codex_session_id") REFERENCES "public"."codex_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_action_runs" ADD CONSTRAINT "automation_action_runs_codex_session_turn_id_codex_session_turns_id_fk" FOREIGN KEY ("codex_session_turn_id") REFERENCES "public"."codex_session_turns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_credential_binding_versions" ADD CONSTRAINT "codex_credential_binding_versions_binding_id_codex_credential_bindings_id_fk" FOREIGN KEY ("binding_id") REFERENCES "public"."codex_credential_bindings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_credential_bindings" ADD CONSTRAINT "codex_credential_bindings_profile_id_codex_runtime_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."codex_runtime_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_launch_leases" ADD CONSTRAINT "codex_launch_leases_worker_id_codex_worker_registrations_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."codex_worker_registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_launch_leases" ADD CONSTRAINT "codex_launch_leases_runtime_profile_revision_id_codex_runtime_profile_revisions_id_fk" FOREIGN KEY ("runtime_profile_revision_id") REFERENCES "public"."codex_runtime_profile_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_launch_leases" ADD CONSTRAINT "codex_launch_leases_credential_binding_id_codex_credential_bindings_id_fk" FOREIGN KEY ("credential_binding_id") REFERENCES "public"."codex_credential_bindings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_launch_leases" ADD CONSTRAINT "codex_launch_leases_credential_binding_version_id_codex_credential_binding_versions_id_fk" FOREIGN KEY ("credential_binding_version_id") REFERENCES "public"."codex_credential_binding_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_launch_token_envelopes" ADD CONSTRAINT "codex_launch_token_envelopes_runtime_job_id_codex_runtime_jobs_id_fk" FOREIGN KEY ("runtime_job_id") REFERENCES "public"."codex_runtime_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_launch_token_envelopes" ADD CONSTRAINT "codex_launch_token_envelopes_launch_lease_id_codex_launch_leases_id_fk" FOREIGN KEY ("launch_lease_id") REFERENCES "public"."codex_launch_leases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_launch_token_envelopes" ADD CONSTRAINT "codex_launch_token_envelopes_worker_id_codex_worker_registrations_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."codex_worker_registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_pending_workspace_bundles" ADD CONSTRAINT "codex_pending_workspace_bundles_runtime_job_id_codex_runtime_jobs_id_fk" FOREIGN KEY ("runtime_job_id") REFERENCES "public"."codex_runtime_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_pending_workspace_bundles" ADD CONSTRAINT "codex_pending_workspace_bundles_internal_artifact_object_id_internal_artifact_objects_id_fk" FOREIGN KEY ("internal_artifact_object_id") REFERENCES "public"."internal_artifact_objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_runtime_job_artifacts" ADD CONSTRAINT "codex_runtime_job_artifacts_runtime_job_id_codex_runtime_jobs_id_fk" FOREIGN KEY ("runtime_job_id") REFERENCES "public"."codex_runtime_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_runtime_job_artifacts" ADD CONSTRAINT "codex_runtime_job_artifacts_internal_artifact_object_id_internal_artifact_objects_id_fk" FOREIGN KEY ("internal_artifact_object_id") REFERENCES "public"."internal_artifact_objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_runtime_jobs" ADD CONSTRAINT "codex_runtime_jobs_workflow_id_plan_item_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."plan_item_workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_runtime_jobs" ADD CONSTRAINT "codex_runtime_jobs_codex_session_id_codex_sessions_id_fk" FOREIGN KEY ("codex_session_id") REFERENCES "public"."codex_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_runtime_jobs" ADD CONSTRAINT "codex_runtime_jobs_codex_session_turn_id_codex_session_turns_id_fk" FOREIGN KEY ("codex_session_turn_id") REFERENCES "public"."codex_session_turns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_runtime_jobs" ADD CONSTRAINT "codex_runtime_jobs_worker_id_codex_worker_registrations_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."codex_worker_registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_runtime_jobs" ADD CONSTRAINT "codex_runtime_jobs_launch_lease_id_codex_launch_leases_id_fk" FOREIGN KEY ("launch_lease_id") REFERENCES "public"."codex_launch_leases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_runtime_jobs" ADD CONSTRAINT "codex_runtime_jobs_runtime_profile_revision_id_codex_runtime_profile_revisions_id_fk" FOREIGN KEY ("runtime_profile_revision_id") REFERENCES "public"."codex_runtime_profile_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_runtime_jobs" ADD CONSTRAINT "codex_runtime_jobs_credential_binding_id_codex_credential_bindings_id_fk" FOREIGN KEY ("credential_binding_id") REFERENCES "public"."codex_credential_bindings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_runtime_jobs" ADD CONSTRAINT "codex_runtime_jobs_credential_binding_version_id_codex_credential_binding_versions_id_fk" FOREIGN KEY ("credential_binding_version_id") REFERENCES "public"."codex_credential_binding_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_runtime_profile_revisions" ADD CONSTRAINT "codex_runtime_profile_revisions_profile_id_codex_runtime_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."codex_runtime_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_worker_session_nonces" ADD CONSTRAINT "codex_worker_session_nonces_worker_id_codex_worker_registrations_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."codex_worker_registrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dpi_revisions_item_revision_unique" ON "development_plan_item_revisions" USING btree ("development_plan_item_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "development_plan_revisions_plan_revision_unique" ON "development_plan_revisions" USING btree ("development_plan_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "codex_session_leases_one_active_per_session_idx" ON "codex_session_leases" USING btree ("codex_session_id") WHERE "codex_session_leases"."status" = 'active';--> statement-breakpoint
CREATE INDEX "codex_session_leases_session_epoch_idx" ON "codex_session_leases" USING btree ("codex_session_id","lease_epoch");--> statement-breakpoint
CREATE INDEX "codex_session_leases_worker_status_idx" ON "codex_session_leases" USING btree ("worker_id","status");--> statement-breakpoint
CREATE INDEX "codex_session_leases_expires_at_idx" ON "codex_session_leases" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "codex_session_snapshots_session_sequence_unique" ON "codex_session_snapshots" USING btree ("codex_session_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "codex_session_snapshots_artifact_ref_unique" ON "codex_session_snapshots" USING btree ("artifact_ref");--> statement-breakpoint
CREATE INDEX "codex_session_snapshots_session_created_idx" ON "codex_session_snapshots" USING btree ("codex_session_id","created_at");--> statement-breakpoint
CREATE INDEX "codex_session_stale_terminalization_attempts_session_idx" ON "codex_session_stale_terminalization_attempts" USING btree ("codex_session_id","created_at");--> statement-breakpoint
CREATE INDEX "codex_session_stale_terminalization_attempts_turn_idx" ON "codex_session_stale_terminalization_attempts" USING btree ("codex_session_turn_id");--> statement-breakpoint
CREATE INDEX "codex_session_turns_session_created_idx" ON "codex_session_turns" USING btree ("codex_session_id","created_at");--> statement-breakpoint
CREATE INDEX "codex_session_turns_workflow_created_idx" ON "codex_session_turns" USING btree ("workflow_id","created_at");--> statement-breakpoint
CREATE INDEX "codex_session_turns_runtime_job_idx" ON "codex_session_turns" USING btree ("runtime_job_id");--> statement-breakpoint
CREATE INDEX "codex_session_turns_action_run_idx" ON "codex_session_turns" USING btree ("automation_action_run_id");--> statement-breakpoint
CREATE INDEX "codex_sessions_owner_idx" ON "codex_sessions" USING btree ("owner_type","owner_id");--> statement-breakpoint
CREATE INDEX "codex_sessions_owner_role_idx" ON "codex_sessions" USING btree ("owner_id","role");--> statement-breakpoint
CREATE INDEX "codex_sessions_thread_digest_idx" ON "codex_sessions" USING btree ("codex_thread_id_digest");--> statement-breakpoint
CREATE INDEX "codex_sessions_latest_snapshot_idx" ON "codex_sessions" USING btree ("latest_snapshot_id");--> statement-breakpoint
CREATE INDEX "codex_sessions_active_lease_idx" ON "codex_sessions" USING btree ("active_lease_id");--> statement-breakpoint
CREATE UNIQUE INDEX "codex_sessions_one_active_per_workflow_idx" ON "codex_sessions" USING btree ("owner_id") WHERE "codex_sessions"."role" = 'active' and "codex_sessions"."status" <> 'archived';--> statement-breakpoint
CREATE INDEX "execution_readiness_records_workflow_idx" ON "execution_readiness_records" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "execution_readiness_records_item_idx" ON "execution_readiness_records" USING btree ("development_plan_item_id");--> statement-breakpoint
CREATE INDEX "execution_readiness_records_session_idx" ON "execution_readiness_records" USING btree ("codex_session_id");--> statement-breakpoint
CREATE INDEX "execution_readiness_records_plan_revision_idx" ON "execution_readiness_records" USING btree ("approved_implementation_plan_revision_id");--> statement-breakpoint
CREATE INDEX "plan_item_workflow_transitions_workflow_created_idx" ON "plan_item_workflow_transitions" USING btree ("workflow_id","created_at");--> statement-breakpoint
CREATE INDEX "plan_item_workflow_transitions_evidence_idx" ON "plan_item_workflow_transitions" USING btree ("evidence_object_type","evidence_object_id");--> statement-breakpoint
CREATE INDEX "plan_item_workflow_transitions_session_idx" ON "plan_item_workflow_transitions" USING btree ("codex_session_id");--> statement-breakpoint
CREATE INDEX "plan_item_workflows_item_idx" ON "plan_item_workflows" USING btree ("development_plan_id","development_plan_item_id");--> statement-breakpoint
CREATE INDEX "plan_item_workflows_active_session_idx" ON "plan_item_workflows" USING btree ("active_codex_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_item_workflows_one_active_per_item_idx" ON "plan_item_workflows" USING btree ("development_plan_item_id") WHERE "plan_item_workflows"."status" <> 'archived';--> statement-breakpoint
CREATE INDEX "workflow_manual_decisions_workflow_created_idx" ON "workflow_manual_decisions" USING btree ("workflow_id","created_at");--> statement-breakpoint
CREATE INDEX "workflow_manual_decisions_session_idx" ON "workflow_manual_decisions" USING btree ("codex_session_id");--> statement-breakpoint
CREATE INDEX "workflow_manual_decisions_kind_created_idx" ON "workflow_manual_decisions" USING btree ("kind","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "boundary_revisions_summary_revision_unique" ON "boundary_summary_revisions" USING btree ("boundary_summary_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "execution_plan_revisions_plan_revision_unique" ON "execution_plan_revisions" USING btree ("execution_plan_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "run_sessions_one_active_per_package" ON "run_sessions" USING btree ("execution_package_id") WHERE "run_sessions"."status" in ('queued','running','waiting_for_input','stalled','resuming','cancel_requested');--> statement-breakpoint
CREATE UNIQUE INDEX "review_packets_one_open_per_package" ON "review_packets" USING btree ("execution_package_id") WHERE "review_packets"."status" in ('draft','ready','in_review','escalated');--> statement-breakpoint
CREATE UNIQUE INDEX "release_evidences_org_key_uq" ON "release_evidences" USING btree ("org_id","key");--> statement-breakpoint
CREATE INDEX "release_evidences_release_idx" ON "release_evidences" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX "release_evidences_type_idx" ON "release_evidences" USING btree ("evidence_type");--> statement-breakpoint
CREATE INDEX "release_execution_packages_release_order_idx" ON "release_execution_packages" USING btree ("release_id","link_order");--> statement-breakpoint
CREATE INDEX "release_execution_packages_package_idx" ON "release_execution_packages" USING btree ("package_id");--> statement-breakpoint
CREATE INDEX "release_work_items_release_order_idx" ON "release_work_items" USING btree ("release_id","link_order");--> statement-breakpoint
CREATE INDEX "release_work_items_work_item_idx" ON "release_work_items" USING btree ("work_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "releases_org_key_uq" ON "releases" USING btree ("org_id","key");--> statement-breakpoint
CREATE INDEX "releases_project_phase_idx" ON "releases" USING btree ("project_id","phase");--> statement-breakpoint
CREATE INDEX "releases_owner_phase_idx" ON "releases" USING btree ("release_owner_actor_id","phase");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_project_settings_project_scope" ON "automation_project_settings" USING btree ("project_id") WHERE "automation_project_settings"."repo_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "automation_project_settings_repo_scope" ON "automation_project_settings" USING btree ("project_id","repo_id") WHERE "automation_project_settings"."repo_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "execution_package_generation_package_id" ON "execution_package_generation_packages" USING btree ("execution_package_set_id","execution_package_id");--> statement-breakpoint
CREATE UNIQUE INDEX "execution_package_generation_package_key" ON "execution_package_generation_packages" USING btree ("plan_revision_id","generation_key","package_key");--> statement-breakpoint
CREATE UNIQUE INDEX "execution_package_generation_runs_key" ON "execution_package_generation_runs" USING btree ("plan_revision_id","generation_key");--> statement-breakpoint
CREATE UNIQUE INDEX "execution_package_generation_runs_current_succeeded" ON "execution_package_generation_runs" USING btree ("plan_revision_id") WHERE "execution_package_generation_runs"."status" = 'succeeded';--> statement-breakpoint
CREATE UNIQUE INDEX "manual_path_holds_active_scope" ON "manual_path_holds" USING btree ("object_type","object_id","scope_key") WHERE "manual_path_holds"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "manual_path_holds_source_action" ON "manual_path_holds" USING btree ("source_automation_action_id") WHERE "manual_path_holds"."source_automation_action_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "internal_artifact_objects_ref_idx" ON "internal_artifact_objects" USING btree ("ref");--> statement-breakpoint
CREATE UNIQUE INDEX "internal_artifact_objects_owner_idempotency_idx" ON "internal_artifact_objects" USING btree ("owner_type","owner_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "internal_artifact_objects_owner_kind_artifact_idx" ON "internal_artifact_objects" USING btree ("owner_type","owner_id","kind","artifact_id");--> statement-breakpoint
CREATE INDEX "internal_artifact_objects_owner_kind_created_idx" ON "internal_artifact_objects" USING btree ("owner_type","owner_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "internal_artifact_objects_storage_key_idx" ON "internal_artifact_objects" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "internal_artifact_objects_digest_content_type_idx" ON "internal_artifact_objects" USING btree ("digest","content_type");--> statement-breakpoint
CREATE UNIQUE INDEX "codex_credential_binding_versions_binding_version_idx" ON "codex_credential_binding_versions" USING btree ("binding_id","version_number");--> statement-breakpoint
CREATE INDEX "codex_credential_binding_versions_active_idx" ON "codex_credential_binding_versions" USING btree ("binding_id","status");--> statement-breakpoint
CREATE INDEX "codex_credential_bindings_scope_idx" ON "codex_credential_bindings" USING btree ("project_id","repo_id","profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "codex_launch_leases_request_idx" ON "codex_launch_leases" USING btree ("lease_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "codex_launch_leases_target_attempt_idx" ON "codex_launch_leases" USING btree ("project_id",coalesce("repo_id", ''),"target_type","target_id","launch_attempt");--> statement-breakpoint
CREATE INDEX "codex_launch_leases_worker_status_idx" ON "codex_launch_leases" USING btree ("worker_id","status");--> statement-breakpoint
CREATE INDEX "codex_launch_leases_target_fence_idx" ON "codex_launch_leases" USING btree ("target_type","target_id","target_kind");--> statement-breakpoint
CREATE UNIQUE INDEX "codex_launch_token_envelopes_runtime_job_idx" ON "codex_launch_token_envelopes" USING btree ("runtime_job_id");--> statement-breakpoint
CREATE INDEX "codex_launch_token_envelopes_worker_status_idx" ON "codex_launch_token_envelopes" USING btree ("worker_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "codex_pending_workspace_bundles_bundle_idx" ON "codex_pending_workspace_bundles" USING btree ("bundle_id");--> statement-breakpoint
CREATE INDEX "codex_pending_workspace_bundles_run_worker_lease_idx" ON "codex_pending_workspace_bundles" USING btree ("run_worker_lease_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "codex_runtime_job_artifacts_job_digest_idx" ON "codex_runtime_job_artifacts" USING btree ("runtime_job_id","digest","content_type");--> statement-breakpoint
CREATE UNIQUE INDEX "codex_runtime_job_artifacts_idempotency_idx" ON "codex_runtime_job_artifacts" USING btree ("runtime_job_id","artifact_idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "codex_runtime_jobs_job_request_idx" ON "codex_runtime_jobs" USING btree ("job_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "codex_runtime_jobs_target_attempt_idx" ON "codex_runtime_jobs" USING btree ("project_id",coalesce("repo_id", ''),"target_type","target_id","launch_attempt");--> statement-breakpoint
CREATE INDEX "codex_runtime_jobs_worker_status_idx" ON "codex_runtime_jobs" USING btree ("worker_id","status");--> statement-breakpoint
CREATE INDEX "codex_runtime_jobs_recovery_idx" ON "codex_runtime_jobs" USING btree ("status","expires_at","last_event_at");--> statement-breakpoint
CREATE UNIQUE INDEX "codex_runtime_profile_revisions_profile_revision_idx" ON "codex_runtime_profile_revisions" USING btree ("profile_id","revision_number");--> statement-breakpoint
CREATE INDEX "codex_runtime_profile_revisions_active_lookup_idx" ON "codex_runtime_profile_revisions" USING btree ("target_kind","status");--> statement-breakpoint
CREATE INDEX "codex_runtime_profiles_target_kind_idx" ON "codex_runtime_profiles" USING btree ("target_kind");--> statement-breakpoint
CREATE INDEX "codex_runtime_setup_nonces_expires_at_idx" ON "codex_runtime_setup_nonces" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "codex_worker_bootstrap_tokens_hash_idx" ON "codex_worker_bootstrap_tokens" USING btree ("bootstrap_token_hash","bootstrap_token_version");--> statement-breakpoint
CREATE INDEX "codex_worker_bootstrap_tokens_identity_idx" ON "codex_worker_bootstrap_tokens" USING btree ("worker_identity","status");--> statement-breakpoint
CREATE UNIQUE INDEX "codex_worker_registrations_identity_idx" ON "codex_worker_registrations" USING btree ("worker_identity");--> statement-breakpoint
CREATE INDEX "codex_worker_registrations_availability_idx" ON "codex_worker_registrations" USING btree ("status","control_channel_status");--> statement-breakpoint
CREATE UNIQUE INDEX "codex_worker_session_nonces_worker_session_nonce_idx" ON "codex_worker_session_nonces" USING btree ("worker_id","session_token_hash","nonce_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "codex_worker_session_nonces_worker_epoch_nonce_idx" ON "codex_worker_session_nonces" USING btree ("worker_id","session_epoch","nonce_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "codex_worker_session_nonces_replay_key_idx" ON "codex_worker_session_nonces" USING btree ("replay_key_hash");

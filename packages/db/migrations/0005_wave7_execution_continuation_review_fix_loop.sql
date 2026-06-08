CREATE TABLE "execution_continuation_lineages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"run_session_id" uuid NOT NULL,
	"codex_session_id" uuid NOT NULL,
	"queued_action_id" uuid NOT NULL,
	"continuation_kind" text NOT NULL,
	"previous_runtime_job_id" uuid NOT NULL,
	"new_runtime_job_id" uuid,
	"codex_session_turn_id" uuid,
	"previous_capsule_digest" text NOT NULL,
	"expected_input_capsule_digest" text NOT NULL,
	"previous_codex_session_lease_id" uuid NOT NULL,
	"previous_run_worker_lease_id" text,
	"created_by_actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_session_attempt_lineages" (
	"run_session_id" uuid PRIMARY KEY NOT NULL,
	"workflow_id" uuid NOT NULL,
	"codex_session_id" uuid NOT NULL,
	"attempt_kind" text NOT NULL,
	"previous_run_session_id" uuid,
	"previous_review_packet_id" uuid,
	"review_response_id" uuid,
	"created_by_actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_packet_evidence_refs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_packet_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"ref_kind" text NOT NULL,
	"visibility" text NOT NULL,
	"display_text" text NOT NULL,
	"url" text,
	"internal_object_ref" text,
	"digest" text NOT NULL,
	"created_by_actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"codex_session_id" uuid NOT NULL,
	"codex_session_turn_id" uuid NOT NULL,
	"review_packet_id" uuid NOT NULL,
	"previous_run_session_id" uuid NOT NULL,
	"status" text NOT NULL,
	"content_digest" text,
	"rendered_markdown_artifact_ref" text,
	"created_by_actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "codex_session_stale_terminalization_attempts" ADD COLUMN "workflow_id" uuid;--> statement-breakpoint
ALTER TABLE "codex_session_stale_terminalization_attempts" ADD COLUMN "run_session_id" uuid;--> statement-breakpoint
ALTER TABLE "codex_session_stale_terminalization_attempts" ADD COLUMN "runtime_job_id" uuid;--> statement-breakpoint
ALTER TABLE "codex_session_stale_terminalization_attempts" ADD COLUMN "expected_workflow_status" text;--> statement-breakpoint
ALTER TABLE "codex_session_stale_terminalization_attempts" ADD COLUMN "actual_workflow_status" text;--> statement-breakpoint
ALTER TABLE "codex_session_stale_terminalization_attempts" ADD COLUMN "expected_run_session_status" text;--> statement-breakpoint
ALTER TABLE "codex_session_stale_terminalization_attempts" ADD COLUMN "actual_run_session_status" text;--> statement-breakpoint
ALTER TABLE "codex_session_stale_terminalization_attempts" ADD COLUMN "expected_run_session_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "codex_session_stale_terminalization_attempts" ADD COLUMN "actual_run_session_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "codex_session_stale_terminalization_attempts" ADD COLUMN "expected_codex_thread_id_digest" text;--> statement-breakpoint
ALTER TABLE "codex_session_turns" ADD COLUMN "plan_item_workflow_action_id" uuid;--> statement-breakpoint
ALTER TABLE "review_packets" ADD COLUMN "superseded_by_review_packet_id" uuid;--> statement-breakpoint
ALTER TABLE "review_packets" ADD COLUMN "current_digest" text;--> statement-breakpoint
ALTER TABLE "execution_continuation_lineages" ADD CONSTRAINT "execution_continuation_lineages_workflow_id_plan_item_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."plan_item_workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_continuation_lineages" ADD CONSTRAINT "execution_continuation_lineages_run_session_id_run_sessions_id_fk" FOREIGN KEY ("run_session_id") REFERENCES "public"."run_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_continuation_lineages" ADD CONSTRAINT "execution_continuation_lineages_codex_session_id_codex_sessions_id_fk" FOREIGN KEY ("codex_session_id") REFERENCES "public"."codex_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_continuation_lineages" ADD CONSTRAINT "execution_continuation_lineages_queued_action_id_plan_item_workflow_queued_actions_id_fk" FOREIGN KEY ("queued_action_id") REFERENCES "public"."plan_item_workflow_queued_actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_continuation_lineages" ADD CONSTRAINT "execution_continuation_lineages_codex_session_turn_id_codex_session_turns_id_fk" FOREIGN KEY ("codex_session_turn_id") REFERENCES "public"."codex_session_turns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_continuation_lineages" ADD CONSTRAINT "execution_continuation_lineages_previous_codex_session_lease_id_codex_session_leases_id_fk" FOREIGN KEY ("previous_codex_session_lease_id") REFERENCES "public"."codex_session_leases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_continuation_lineages" ADD CONSTRAINT "execution_continuation_lineages_created_by_actor_id_actors_id_fk" FOREIGN KEY ("created_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_session_attempt_lineages" ADD CONSTRAINT "run_session_attempt_lineages_run_session_id_run_sessions_id_fk" FOREIGN KEY ("run_session_id") REFERENCES "public"."run_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_session_attempt_lineages" ADD CONSTRAINT "run_session_attempt_lineages_workflow_id_plan_item_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."plan_item_workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_session_attempt_lineages" ADD CONSTRAINT "run_session_attempt_lineages_codex_session_id_codex_sessions_id_fk" FOREIGN KEY ("codex_session_id") REFERENCES "public"."codex_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_session_attempt_lineages" ADD CONSTRAINT "run_session_attempt_lineages_previous_run_session_id_run_sessions_id_fk" FOREIGN KEY ("previous_run_session_id") REFERENCES "public"."run_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_session_attempt_lineages" ADD CONSTRAINT "run_session_attempt_lineages_previous_review_packet_id_review_packets_id_fk" FOREIGN KEY ("previous_review_packet_id") REFERENCES "public"."review_packets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_session_attempt_lineages" ADD CONSTRAINT "run_session_attempt_lineages_review_response_id_review_responses_id_fk" FOREIGN KEY ("review_response_id") REFERENCES "public"."review_responses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_session_attempt_lineages" ADD CONSTRAINT "run_session_attempt_lineages_created_by_actor_id_actors_id_fk" FOREIGN KEY ("created_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_packet_evidence_refs" ADD CONSTRAINT "review_packet_evidence_refs_review_packet_id_review_packets_id_fk" FOREIGN KEY ("review_packet_id") REFERENCES "public"."review_packets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_packet_evidence_refs" ADD CONSTRAINT "review_packet_evidence_refs_workflow_id_plan_item_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."plan_item_workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_packet_evidence_refs" ADD CONSTRAINT "review_packet_evidence_refs_created_by_actor_id_actors_id_fk" FOREIGN KEY ("created_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_responses" ADD CONSTRAINT "review_responses_workflow_id_plan_item_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."plan_item_workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_responses" ADD CONSTRAINT "review_responses_codex_session_id_codex_sessions_id_fk" FOREIGN KEY ("codex_session_id") REFERENCES "public"."codex_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_responses" ADD CONSTRAINT "review_responses_codex_session_turn_id_codex_session_turns_id_fk" FOREIGN KEY ("codex_session_turn_id") REFERENCES "public"."codex_session_turns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_responses" ADD CONSTRAINT "review_responses_review_packet_id_review_packets_id_fk" FOREIGN KEY ("review_packet_id") REFERENCES "public"."review_packets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_responses" ADD CONSTRAINT "review_responses_created_by_actor_id_actors_id_fk" FOREIGN KEY ("created_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "execution_continuation_lineages_workflow_created_idx" ON "execution_continuation_lineages" USING btree ("workflow_id","created_at","queued_action_id");--> statement-breakpoint
CREATE INDEX "execution_continuation_lineages_run_session_idx" ON "execution_continuation_lineages" USING btree ("run_session_id");--> statement-breakpoint
CREATE INDEX "run_session_attempt_lineages_workflow_created_idx" ON "run_session_attempt_lineages" USING btree ("workflow_id","created_at","run_session_id");--> statement-breakpoint
CREATE INDEX "review_packet_evidence_refs_packet_created_idx" ON "review_packet_evidence_refs" USING btree ("review_packet_id","created_at","id");--> statement-breakpoint
CREATE INDEX "review_packet_evidence_refs_workflow_created_idx" ON "review_packet_evidence_refs" USING btree ("workflow_id","created_at");--> statement-breakpoint
CREATE INDEX "review_responses_workflow_created_idx" ON "review_responses" USING btree ("workflow_id","created_at","id");--> statement-breakpoint
CREATE INDEX "review_responses_packet_created_idx" ON "review_responses" USING btree ("review_packet_id","created_at");--> statement-breakpoint
ALTER TABLE "codex_session_stale_terminalization_attempts" ADD CONSTRAINT "codex_session_stale_terminalization_attempts_workflow_id_plan_item_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."plan_item_workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_session_turns" ADD CONSTRAINT "codex_session_turns_plan_item_workflow_action_id_plan_item_workflow_queued_actions_id_fk" FOREIGN KEY ("plan_item_workflow_action_id") REFERENCES "public"."plan_item_workflow_queued_actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "codex_session_stale_terminalization_attempts_workflow_idx" ON "codex_session_stale_terminalization_attempts" USING btree ("workflow_id","created_at");--> statement-breakpoint
CREATE INDEX "codex_session_stale_terminalization_attempts_run_idx" ON "codex_session_stale_terminalization_attempts" USING btree ("run_session_id");--> statement-breakpoint
CREATE INDEX "codex_session_turns_workflow_action_idx" ON "codex_session_turns" USING btree ("plan_item_workflow_action_id");--> statement-breakpoint
CREATE UNIQUE INDEX "run_sessions_one_active_execution_per_codex_session" ON "run_sessions" USING btree ("codex_session_id") WHERE "run_sessions"."codex_session_id" is not null and "run_sessions"."status" in ('queued','running','waiting_for_input','stalled','resuming','cancel_requested');--> statement-breakpoint
CREATE UNIQUE INDEX "codex_runtime_jobs_one_active_run_execution_per_codex_session" ON "codex_runtime_jobs" USING btree ("codex_session_id") WHERE "codex_runtime_jobs"."target_kind" = 'run_execution' and "codex_runtime_jobs"."codex_session_id" is not null and "codex_runtime_jobs"."input_json"->>'schema_version' = 'codex_run_execution_workload.v1' and "codex_runtime_jobs"."status" in ('queued','accepted','materializing','running');

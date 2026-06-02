DROP TABLE IF EXISTS "codex_session_snapshots";--> statement-breakpoint
DROP INDEX IF EXISTS "codex_sessions_latest_snapshot_idx";--> statement-breakpoint
ALTER TABLE "codex_sessions" DROP COLUMN IF EXISTS "latest_snapshot_id";--> statement-breakpoint
ALTER TABLE "codex_sessions" DROP COLUMN IF EXISTS "latest_snapshot_digest";--> statement-breakpoint
ALTER TABLE "codex_sessions" DROP COLUMN IF EXISTS "forked_from_snapshot_id";--> statement-breakpoint
ALTER TABLE "codex_sessions" ADD COLUMN "latest_capsule_id" uuid;--> statement-breakpoint
ALTER TABLE "codex_sessions" ADD COLUMN "latest_capsule_digest" text;--> statement-breakpoint
ALTER TABLE "codex_sessions" ADD COLUMN "base_memory_bundle_ref" text;--> statement-breakpoint
ALTER TABLE "codex_sessions" ADD COLUMN "base_memory_bundle_digest" text;--> statement-breakpoint
ALTER TABLE "codex_sessions" ADD COLUMN "latest_memory_bundle_ref" text;--> statement-breakpoint
ALTER TABLE "codex_sessions" ADD COLUMN "latest_memory_bundle_digest" text;--> statement-breakpoint
ALTER TABLE "codex_sessions" ADD COLUMN "latest_environment_manifest_ref" text;--> statement-breakpoint
ALTER TABLE "codex_sessions" ADD COLUMN "latest_environment_manifest_digest" text;--> statement-breakpoint
ALTER TABLE "codex_sessions" ADD COLUMN "forked_from_capsule_id" uuid;--> statement-breakpoint
ALTER TABLE "codex_session_turns" DROP COLUMN IF EXISTS "expected_previous_snapshot_digest";--> statement-breakpoint
ALTER TABLE "codex_session_turns" DROP COLUMN IF EXISTS "output_snapshot_id";--> statement-breakpoint
ALTER TABLE "codex_session_turns" DROP COLUMN IF EXISTS "output_snapshot_digest";--> statement-breakpoint
ALTER TABLE "codex_session_turns" ADD COLUMN "expected_input_capsule_digest" text;--> statement-breakpoint
ALTER TABLE "codex_session_turns" ADD COLUMN "input_capsule_id" uuid;--> statement-breakpoint
ALTER TABLE "codex_session_turns" ADD COLUMN "input_capsule_digest" text;--> statement-breakpoint
ALTER TABLE "codex_session_turns" ADD COLUMN "output_capsule_id" uuid;--> statement-breakpoint
ALTER TABLE "codex_session_turns" ADD COLUMN "output_capsule_digest" text;--> statement-breakpoint
ALTER TABLE "codex_session_turns" ADD COLUMN "base_memory_bundle_ref" text;--> statement-breakpoint
ALTER TABLE "codex_session_turns" ADD COLUMN "base_memory_bundle_digest" text;--> statement-breakpoint
ALTER TABLE "codex_session_turns" ADD COLUMN "input_memory_bundle_ref" text;--> statement-breakpoint
ALTER TABLE "codex_session_turns" ADD COLUMN "input_memory_bundle_digest" text;--> statement-breakpoint
ALTER TABLE "codex_session_turns" ADD COLUMN "output_memory_bundle_ref" text;--> statement-breakpoint
ALTER TABLE "codex_session_turns" ADD COLUMN "output_memory_bundle_digest" text;--> statement-breakpoint
ALTER TABLE "codex_session_turns" ADD COLUMN "memory_delta_artifact_ref" text;--> statement-breakpoint
ALTER TABLE "codex_session_turns" ADD COLUMN "memory_delta_digest" text;--> statement-breakpoint
ALTER TABLE "codex_session_turns" ADD COLUMN "input_environment_manifest_ref" text;--> statement-breakpoint
ALTER TABLE "codex_session_turns" ADD COLUMN "input_environment_manifest_digest" text;--> statement-breakpoint
ALTER TABLE "codex_session_turns" ADD COLUMN "output_environment_manifest_ref" text;--> statement-breakpoint
ALTER TABLE "codex_session_turns" ADD COLUMN "output_environment_manifest_digest" text;--> statement-breakpoint
ALTER TABLE "codex_session_stale_terminalization_attempts" DROP COLUMN IF EXISTS "expected_previous_snapshot_digest";--> statement-breakpoint
ALTER TABLE "codex_session_stale_terminalization_attempts" DROP COLUMN IF EXISTS "attempted_output_snapshot_digest";--> statement-breakpoint
ALTER TABLE "codex_session_stale_terminalization_attempts" ADD COLUMN "expected_input_capsule_digest" text;--> statement-breakpoint
ALTER TABLE "codex_session_stale_terminalization_attempts" ADD COLUMN "attempted_output_capsule_digest" text;--> statement-breakpoint
CREATE TABLE "codex_runtime_capsules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"codex_session_id" uuid NOT NULL,
	"created_from_turn_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"artifact_ref" text NOT NULL,
	"digest" text NOT NULL,
	"size_bytes" text NOT NULL,
	"manifest_digest" text NOT NULL,
	"thread_state_digest" text NOT NULL,
	"memory_state_digest" text NOT NULL,
	"environment_manifest_digest" text NOT NULL,
	"codex_thread_id_digest" text NOT NULL,
	"codex_cli_version" text NOT NULL,
	"app_server_protocol_digest" text NOT NULL,
	"runtime_profile_revision_id" uuid NOT NULL,
	"trusted_runtime_manifest_digest" text NOT NULL,
	"credential_binding_lineage_digest" text NOT NULL,
	"created_by_actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);--> statement-breakpoint
ALTER TABLE "codex_runtime_capsules" ADD CONSTRAINT "codex_runtime_capsules_codex_session_id_codex_sessions_id_fk" FOREIGN KEY ("codex_session_id") REFERENCES "public"."codex_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_runtime_capsules" ADD CONSTRAINT "codex_runtime_capsules_created_from_turn_id_codex_session_turns_id_fk" FOREIGN KEY ("created_from_turn_id") REFERENCES "public"."codex_session_turns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_runtime_capsules" ADD CONSTRAINT "codex_runtime_capsules_created_by_actor_id_actors_id_fk" FOREIGN KEY ("created_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "codex_runtime_capsules_session_sequence_unique" ON "codex_runtime_capsules" USING btree ("codex_session_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "codex_runtime_capsules_artifact_ref_unique" ON "codex_runtime_capsules" USING btree ("artifact_ref");--> statement-breakpoint
CREATE INDEX "codex_runtime_capsules_session_created_idx" ON "codex_runtime_capsules" USING btree ("codex_session_id","created_at");--> statement-breakpoint
CREATE INDEX "codex_runtime_capsules_turn_idx" ON "codex_runtime_capsules" USING btree ("created_from_turn_id");--> statement-breakpoint
CREATE INDEX "codex_sessions_latest_capsule_idx" ON "codex_sessions" USING btree ("latest_capsule_id");

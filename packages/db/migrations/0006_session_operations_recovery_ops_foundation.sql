CREATE TABLE "capsule_retention_pins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"capsule_id" uuid NOT NULL,
	"capsule_digest" text NOT NULL,
	"pin_state" text NOT NULL,
	"pin_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"referenced_object_type" text NOT NULL,
	"referenced_object_id" text NOT NULL,
	"reference_relation" text NOT NULL,
	"referenced_by" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checked_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_item_session_health" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"organization_id" uuid,
	"workflow_id" uuid NOT NULL,
	"development_plan_id" uuid,
	"development_plan_item_id" uuid NOT NULL,
	"codex_session_id" uuid NOT NULL,
	"state" text NOT NULL,
	"severity" text NOT NULL,
	"reason_code" text,
	"summary" text NOT NULL,
	"projection_digest" text NOT NULL,
	"safe_projection_json" jsonb NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_recovery_records" (
	"id" text PRIMARY KEY NOT NULL,
	"operation_idempotency_key" text NOT NULL,
	"operation" text NOT NULL,
	"result" text NOT NULL,
	"result_code" text NOT NULL,
	"reason" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"development_plan_item_id" uuid NOT NULL,
	"codex_session_id" uuid NOT NULL,
	"before_state" text NOT NULL,
	"after_state" text NOT NULL,
	"before_projection_digest" text NOT NULL,
	"after_projection_digest" text NOT NULL,
	"predicate_summary" jsonb NOT NULL,
	"affected_lease_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"affected_queued_action_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"affected_turn_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"affected_runtime_job_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"affected_run_session_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"affected_capsule_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"object_event_id" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan_item_session_health" ADD CONSTRAINT "plan_item_session_health_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_item_session_health" ADD CONSTRAINT "plan_item_session_health_workflow_id_plan_item_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."plan_item_workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_item_session_health" ADD CONSTRAINT "plan_item_session_health_development_plan_id_development_plans_id_fk" FOREIGN KEY ("development_plan_id") REFERENCES "public"."development_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_item_session_health" ADD CONSTRAINT "plan_item_session_health_development_plan_item_id_development_plan_items_id_fk" FOREIGN KEY ("development_plan_item_id") REFERENCES "public"."development_plan_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_item_session_health" ADD CONSTRAINT "plan_item_session_health_codex_session_id_codex_sessions_id_fk" FOREIGN KEY ("codex_session_id") REFERENCES "public"."codex_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_recovery_records" ADD CONSTRAINT "session_recovery_records_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_recovery_records" ADD CONSTRAINT "session_recovery_records_workflow_id_plan_item_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."plan_item_workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_recovery_records" ADD CONSTRAINT "session_recovery_records_development_plan_item_id_development_plan_items_id_fk" FOREIGN KEY ("development_plan_item_id") REFERENCES "public"."development_plan_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_recovery_records" ADD CONSTRAINT "session_recovery_records_codex_session_id_codex_sessions_id_fk" FOREIGN KEY ("codex_session_id") REFERENCES "public"."codex_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "capsule_retention_pins_capsule_reference_idx" ON "capsule_retention_pins" USING btree ("capsule_id","referenced_object_type","referenced_object_id","reference_relation");--> statement-breakpoint
CREATE INDEX "capsule_retention_pins_capsule_idx" ON "capsule_retention_pins" USING btree ("capsule_id");--> statement-breakpoint
CREATE INDEX "capsule_retention_pins_state_idx" ON "capsule_retention_pins" USING btree ("pin_state");--> statement-breakpoint
CREATE INDEX "capsule_retention_pins_reference_idx" ON "capsule_retention_pins" USING btree ("referenced_object_type","referenced_object_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_item_session_health_workflow_session_idx" ON "plan_item_session_health" USING btree ("workflow_id","codex_session_id");--> statement-breakpoint
CREATE INDEX "plan_item_session_health_project_idx" ON "plan_item_session_health" USING btree ("project_id","state","severity");--> statement-breakpoint
CREATE INDEX "plan_item_session_health_state_idx" ON "plan_item_session_health" USING btree ("state","severity");--> statement-breakpoint
CREATE INDEX "plan_item_session_health_item_idx" ON "plan_item_session_health" USING btree ("development_plan_item_id");--> statement-breakpoint
CREATE INDEX "plan_item_session_health_session_idx" ON "plan_item_session_health" USING btree ("codex_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_recovery_records_operation_idempotency_key_idx" ON "session_recovery_records" USING btree ("operation_idempotency_key");--> statement-breakpoint
CREATE INDEX "session_recovery_records_workflow_idx" ON "session_recovery_records" USING btree ("workflow_id","created_at");--> statement-breakpoint
CREATE INDEX "session_recovery_records_item_idx" ON "session_recovery_records" USING btree ("development_plan_item_id","created_at");--> statement-breakpoint
CREATE INDEX "session_recovery_records_session_idx" ON "session_recovery_records" USING btree ("codex_session_id");--> statement-breakpoint
CREATE INDEX "session_recovery_records_created_idx" ON "session_recovery_records" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "session_recovery_records_result_idx" ON "session_recovery_records" USING btree ("operation","result");

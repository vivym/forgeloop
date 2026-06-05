CREATE TABLE IF NOT EXISTS "plan_item_workflow_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workflow_id" uuid NOT NULL REFERENCES "plan_item_workflows"("id"),
  "codex_session_id" uuid NOT NULL REFERENCES "codex_sessions"("id"),
  "actor_id" uuid NOT NULL REFERENCES "actors"("id"),
  "action" text NOT NULL,
  "body_markdown" text NOT NULL,
  "created_queued_action_id" uuid,
  "client_message_id" text,
  "created_at" timestamp with time zone NOT NULL
);

CREATE TABLE IF NOT EXISTS "plan_item_workflow_queued_actions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workflow_id" uuid NOT NULL REFERENCES "plan_item_workflows"("id"),
  "codex_session_id" uuid NOT NULL REFERENCES "codex_sessions"("id"),
  "kind" text NOT NULL,
  "status" text NOT NULL,
  "source_revision_id" uuid,
  "change_request_id" uuid,
  "created_from_message_id" uuid REFERENCES "plan_item_workflow_messages"("id"),
  "expected_input_capsule_digest" text,
  "context_preview_digest" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "codex_session_turn_id" uuid,
  "output_capsule_id" uuid,
  "output_capsule_digest" text,
  "output_capsule_sequence" integer,
  "codex_thread_id_digest" text,
  "blocked_reason_code" text,
  "created_by_actor_id" uuid NOT NULL REFERENCES "actors"("id"),
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE TABLE IF NOT EXISTS "plan_item_workflow_artifact_change_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workflow_id" uuid NOT NULL REFERENCES "plan_item_workflows"("id"),
  "artifact_type" text NOT NULL,
  "revision_id" uuid NOT NULL,
  "reason_markdown" text NOT NULL,
  "created_queued_action_id" uuid,
  "requested_by_actor_id" uuid NOT NULL REFERENCES "actors"("id"),
  "created_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "plan_item_workflow_messages_workflow_created_idx"
  ON "plan_item_workflow_messages" ("workflow_id", "created_at");

CREATE INDEX IF NOT EXISTS "plan_item_workflow_messages_session_idx"
  ON "plan_item_workflow_messages" ("codex_session_id");

CREATE INDEX IF NOT EXISTS "plan_item_workflow_queued_actions_workflow_status_idx"
  ON "plan_item_workflow_queued_actions" ("workflow_id", "status");

CREATE INDEX IF NOT EXISTS "plan_item_workflow_queued_actions_session_idx"
  ON "plan_item_workflow_queued_actions" ("codex_session_id");

CREATE INDEX IF NOT EXISTS "plan_item_workflow_queued_actions_turn_idx"
  ON "plan_item_workflow_queued_actions" ("codex_session_turn_id");

CREATE UNIQUE INDEX IF NOT EXISTS "plan_item_workflow_queued_actions_active_idempotency_idx"
  ON "plan_item_workflow_queued_actions" ("workflow_id", "idempotency_key")
  WHERE "status" in ('queued', 'running');

CREATE INDEX IF NOT EXISTS "plan_item_workflow_artifact_change_requests_workflow_created_idx"
  ON "plan_item_workflow_artifact_change_requests" ("workflow_id", "created_at");

CREATE INDEX IF NOT EXISTS "plan_item_workflow_artifact_change_requests_revision_idx"
  ON "plan_item_workflow_artifact_change_requests" ("artifact_type", "revision_id");

ALTER TABLE "execution_readiness_records"
  ADD COLUMN IF NOT EXISTS "invalidated_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "invalidated_reason" text;

CREATE INDEX IF NOT EXISTS "execution_readiness_records_workflow_invalidated_idx"
  ON "execution_readiness_records" ("workflow_id", "invalidated_at");

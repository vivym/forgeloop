CREATE UNIQUE INDEX IF NOT EXISTS "run_sessions_one_active_execution_per_codex_session"
ON "run_sessions" ("codex_session_id")
WHERE "codex_session_id" IS NOT NULL
  AND "status" IN ('queued','running','waiting_for_input','stalled','resuming','cancel_requested');--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "codex_runtime_jobs_one_active_run_execution_per_codex_session"
ON "codex_runtime_jobs" ("codex_session_id")
WHERE "target_kind" = 'run_execution'
  AND "codex_session_id" IS NOT NULL
  AND "status" IN ('queued','accepted','materializing','running');--> statement-breakpoint
-- Workflow-owned lineage non-null and first-class-vs-payload equality remain repository guards.
-- The payload fields live inside JSONB and must be validated with the same code path used by worker entrypoints.

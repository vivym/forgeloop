ALTER TABLE "codex_sessions" ADD COLUMN "runner_worker_id" uuid;--> statement-breakpoint
ALTER TABLE "codex_sessions" ADD COLUMN "runner_launch_lease_id" uuid;--> statement-breakpoint
ALTER TABLE "codex_sessions" ADD COLUMN "runner_runtime_job_id" uuid;--> statement-breakpoint
ALTER TABLE "codex_sessions" ADD COLUMN "runner_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "codex_sessions_runner_worker_idx" ON "codex_sessions" USING btree ("runner_worker_id");--> statement-breakpoint
CREATE INDEX "codex_sessions_runner_launch_lease_idx" ON "codex_sessions" USING btree ("runner_launch_lease_id");--> statement-breakpoint

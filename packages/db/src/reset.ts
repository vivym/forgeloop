import { Pool } from 'pg';

const disposableNamePattern = /(?:test|tmp|forgeloop_dev)/i;
const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export const resettableTables = [
  'codex_runtime_setup_nonces',
  'codex_worker_session_nonces',
  'codex_runtime_job_artifacts',
  'codex_launch_token_envelopes',
  'codex_pending_workspace_bundles',
  'codex_runtime_jobs',
  'codex_launch_leases',
  'codex_worker_registrations',
  'codex_worker_bootstrap_tokens',
  'codex_credential_binding_versions',
  'codex_credential_bindings',
  'codex_runtime_profile_revisions',
  'codex_runtime_profiles',
  'automation_action_runs',
  'execution_package_generation_packages',
  'execution_package_generation_runs',
  'command_idempotency_records',
  'manual_path_hold_idempotency_records',
  'manual_path_holds',
  'automation_project_settings',
  'trace_artifact_refs',
  'trace_links',
  'trace_events',
  'release_evidences',
  'release_execution_packages',
  'release_work_items',
  'releases',
  'decisions',
  'artifacts',
  'status_histories',
  'object_events',
  'qa_handoffs',
  'code_review_handoffs',
  'review_packets',
  'run_worker_leases',
  'run_commands',
  'run_event_counters',
  'run_events',
  'run_sessions',
  'execution_package_dependencies',
  'execution_packages',
  'executions',
  'execution_plan_revisions',
  'execution_plans',
  'attachments',
  'tasks',
  'plan_revisions',
  'plans',
  'boundary_summary_revisions',
  'boundary_summaries',
  'brainstorming_sessions',
  'context_manifests',
  'development_plan_item_revisions',
  'development_plan_items',
  'development_plan_source_links',
  'development_plan_revisions',
  'development_plans',
  'spec_revisions',
  'specs',
  'work_items',
  'project_repos',
  'projects',
  'actors',
  'organizations',
] as const;

export function assertResettableDatabaseUrl(databaseUrl: string, env: NodeJS.ProcessEnv = process.env): void {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('Could not parse database URL; refusing to reset database.');
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error(`Could not parse PostgreSQL database URL; refusing to reset database.`);
  }

  const hostname = parsed.hostname.toLowerCase();
  const databaseName = parsed.pathname.replace(/^\//, '');
  const isLocal = localHosts.has(hostname);
  const isDisposableName = disposableNamePattern.test(databaseName);

  if (!isLocal) {
    throw new Error(`Refusing to reset database on non-local host ${parsed.hostname}.`);
  }

  if (isDisposableName) {
    return;
  }

  if (env.FORGELOOP_CONFIRM_DB_RESET === '1') {
    return;
  }

  throw new Error(
    `Refusing to reset local database "${databaseName}" without FORGELOOP_CONFIRM_DB_RESET=1 because its name is not disposable.`,
  );
}

export async function resetForgeloopDatabase(databaseUrl: string): Promise<void> {
  assertResettableDatabaseUrl(databaseUrl);
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const tableList = resettableTables.map((table) => `"${table}"`).join(', ');
    await pool.query(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);
  } finally {
    await pool.end();
  }
}

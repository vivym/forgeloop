export interface AutomationRuntimeSnapshotDto {
  generated_at: string;
  projects: [];
  repos: [];
  work_items_requiring_plan: [];
  plan_revisions_requiring_packages: [];
  recent_action_runs: [];
  run_enqueue_disabled_reason: 'run_enqueue_disabled_by_scope';
}

export interface AutomationActionResponseDto {
  action: null;
}

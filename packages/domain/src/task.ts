import type { AttachmentRef, ObjectRef } from '@forgeloop/contracts';

export type TaskStatus = 'draft' | 'ready' | 'in_progress' | 'blocked' | 'review' | 'done' | 'cancelled';
export type TaskStaleState = 'current' | 'stale_spec' | 'stale_plan' | 'stale_parent' | 'manual_exception';

export interface Task {
  id: string;
  project_id: string;
  title: string;
  narrative_markdown: string;
  execution_brief: string;
  acceptance_checklist: string[];
  status: TaskStatus;
  parent_ref?: ObjectRef;
  controlling_spec_revision_id?: string;
  controlling_plan_revision_id?: string;
  stale_state: TaskStaleState;
  audited_exception?: {
    exception_id: string;
    actor_id: string;
    reason: string;
    risk: 'low' | 'medium' | 'high' | 'critical';
    rollback_plan: string;
    verification_ref: { type: 'audited_exception_decision'; id: string };
    supporting_attachment_refs: AttachmentRef[];
    release_impact: 'none' | 'release_scoped';
    created_at: string;
  };
  created_at: string;
  updated_at: string;
}

export function canGenerateRuntimePackageForTask(task: Task): boolean {
  return (
    task.stale_state === 'current' &&
    task.controlling_spec_revision_id !== undefined &&
    task.controlling_plan_revision_id !== undefined
  );
}

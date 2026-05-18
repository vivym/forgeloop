import type { CockpitResponse, ExecutionPackage, ReviewPacket, RunSession, SpecPlan, TimelineEntry, WorkItem } from '../../shared/api/types';

export interface WorkItemDetailViewModel {
  workItem: WorkItem;
  spec: SpecPlan | null;
  plan: SpecPlan | null;
  packages: ExecutionPackage[];
  runs: RunSession[];
  reviews: ReviewPacket[];
  timeline: TimelineEntry[];
}

export const fallbackWorkItem = (workItemId: string): WorkItem => ({
  id: workItemId,
  project_id: 'project-web-product',
  kind: 'requirement',
  title: workItemId === 'wi-1' ? 'Improve release cockpit' : 'Work item',
  goal: 'Clarify the product outcome and move the work item through planning.',
  success_criteria: ['Brief is captured', 'Validation path is visible', 'Evidence is attached before release'],
  priority: 'P0',
  risk: 'medium',
  owner_actor_id: 'actor-owner',
  phase: 'briefing',
  activity_state: 'active',
  gate_state: 'open',
  resolution: 'unresolved',
});

export const formatValue = (value: string | undefined, fallback = 'Not set') =>
  value === undefined || value.trim().length === 0
    ? fallback
    : value
        .split(/[_ -]+/)
        .filter(Boolean)
        .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
        .join(' ');

export const createWorkItemDetailViewModel = (
  workItemId: string,
  cockpit: CockpitResponse | undefined,
  timeline: TimelineEntry[] | undefined,
): WorkItemDetailViewModel => ({
  workItem: cockpit?.work_item ?? fallbackWorkItem(workItemId),
  spec: cockpit?.current_spec ?? null,
  plan: cockpit?.current_plan ?? null,
  packages: cockpit?.packages ?? [],
  runs: cockpit?.run_sessions ?? [],
  reviews: cockpit?.review_packets ?? [],
  timeline: timeline ?? [],
});

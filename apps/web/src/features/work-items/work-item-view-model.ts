import type { CockpitResponse, ExecutionPackage, ReviewPacket, RunSession, SpecPlan, TimelineEntry, WorkItem } from '../../shared/api/types';

export interface WorkItemDetailViewModel {
  workItem: WorkItem | null;
  spec: SpecPlan | null;
  plan: SpecPlan | null;
  packages: ExecutionPackage[];
  runs: RunSession[];
  reviews: ReviewPacket[];
  timeline: TimelineEntry[];
}

export const formatValue = (value: string | undefined, fallback = 'Not set') =>
  value === undefined || value.trim().length === 0
    ? fallback
    : value
        .split(/[_ -]+/)
        .filter(Boolean)
        .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
        .join(' ');

export const createWorkItemDetailViewModel = (cockpit: CockpitResponse | undefined, timeline: TimelineEntry[] | undefined): WorkItemDetailViewModel => ({
  workItem: cockpit?.work_item ?? null,
  spec: cockpit?.current_spec ?? null,
  plan: cockpit?.current_plan ?? null,
  packages: cockpit?.packages ?? [],
  runs: cockpit?.run_sessions ?? [],
  reviews: cockpit?.review_packets ?? [],
  timeline: timeline ?? [],
});

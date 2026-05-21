import type { ProductLaneId, WorkItemKind } from '../../shared/api/types';

export interface ProductLaneDefinition {
  id: ProductLaneId;
  label: string;
  description: string;
}

export const defaultProductLaneId: ProductLaneId = 'requirements';

export const productLanes = [
  { id: 'requirements', label: 'Requirements', description: 'Requirement intake and planning progression.' },
  { id: 'bugs', label: 'Bugs', description: 'Bug triage, repair planning, verification, and regression follow-up.' },
  { id: 'tech-debt', label: 'Tech Debt', description: 'Debt scoping, refactor planning, risk control, and validation.' },
  { id: 'initiatives', label: 'Initiatives', description: 'Strategic work intake and requirement breakdown readiness.' },
  { id: 'spec-approver', label: 'Spec Approver', description: 'Spec and Plan approval attention.' },
  { id: 'execution-owner', label: 'Execution Owner', description: 'Package readiness, runs, and package blockers.' },
  { id: 'reviewer', label: 'Reviewer', description: 'Review packet decisions and evidence gaps.' },
  { id: 'qa-test-owner', label: 'QA / Test Owner', description: 'Test strategy gaps, QA gates, and acceptance.' },
  { id: 'release-owner', label: 'Release Owner', description: 'Release readiness, blockers, and gates.' },
  { id: 'manager', label: 'Manager', description: 'Read-only delivery health and bottleneck drill-down.' },
] as const satisfies readonly ProductLaneDefinition[];

export const productLaneIds = productLanes.map((lane) => lane.id);

const productLaneIdSet = new Set<string>(productLaneIds);

export const supportedProductLaneSearchParams = [
  'project_id',
  'actor_id',
  'driver_actor_id',
  'owner_actor_id',
  'reviewer_actor_id',
  'qa_owner_actor_id',
  'release_owner_actor_id',
  'cursor',
  'limit',
  'kind',
  'phase',
  'status',
  'gate_state',
  'resolution',
  'risk',
  'blocked',
  'stale',
] as const;

export function parseProductLaneId(value: string | undefined): ProductLaneId | undefined {
  return value !== undefined && productLaneIdSet.has(value) ? (value as ProductLaneId) : undefined;
}

export function productLaneDefinition(laneId: ProductLaneId) {
  return productLanes.find((lane) => lane.id === laneId) ?? productLanes[0];
}

export function laneForWorkItemKind(kind: WorkItemKind): ProductLaneId {
  switch (kind) {
    case 'requirement':
      return 'requirements';
    case 'bug':
      return 'bugs';
    case 'tech_debt':
      return 'tech-debt';
    case 'initiative':
      return 'initiatives';
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unsupported Work Item kind: ${exhaustive}`);
    }
  }
}

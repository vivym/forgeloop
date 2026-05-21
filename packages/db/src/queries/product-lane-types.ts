import type { ProductLaneId, ProductLaneItem } from '@forgeloop/contracts';
import type { WorkItemKind } from '@forgeloop/domain';

export const productLaneQueryKeys = [
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

export type ProductLaneQueryKey = (typeof productLaneQueryKeys)[number];

export type ProductLaneFilterValue = string | number | boolean | undefined;
export type ProductLaneFilterInput = Partial<Record<ProductLaneQueryKey, ProductLaneFilterValue>> & { project_id: string };

export const workItemKindByLane = {
  requirements: 'requirement',
  bugs: 'bug',
  'tech-debt': 'tech_debt',
  initiatives: 'initiative',
} as const satisfies Partial<Record<ProductLaneId, WorkItemKind>>;

export const productLaneByWorkItemKind = {
  requirement: 'requirements',
  bug: 'bugs',
  tech_debt: 'tech-debt',
  initiative: 'initiatives',
} as const satisfies Record<WorkItemKind, ProductLaneId>;

export type ProductLaneActorFilterKey =
  | 'driver_actor_id'
  | 'owner_actor_id'
  | 'reviewer_actor_id'
  | 'qa_owner_actor_id'
  | 'release_owner_actor_id';

export interface ProductLaneMetadata {
  label: string;
  description: string;
  applied_filters: readonly ProductLaneQueryKey[];
  actor_filter?: ProductLaneActorFilterKey;
}

const workItemTypeLaneFilters = [
  'project_id',
  'cursor',
  'limit',
  'kind',
  'actor_id',
  'driver_actor_id',
  'phase',
  'status',
  'gate_state',
  'risk',
  'blocked',
  'stale',
] as const satisfies readonly ProductLaneQueryKey[];

export const productLaneMetadata: Record<ProductLaneId, ProductLaneMetadata> = {
  requirements: {
    label: 'Requirements',
    description: 'Requirement work items that need product definition, spec, plan, execution, or release follow-through.',
    applied_filters: workItemTypeLaneFilters,
    actor_filter: 'driver_actor_id',
  },
  bugs: {
    label: 'Bugs',
    description: 'Bug work items and linked delivery objects that need repair, review, evidence, or release attention.',
    applied_filters: workItemTypeLaneFilters,
    actor_filter: 'driver_actor_id',
  },
  'tech-debt': {
    label: 'Tech Debt',
    description: 'Tech debt work items and linked validation blockers that need refactor scope, plan, or package attention.',
    applied_filters: workItemTypeLaneFilters,
    actor_filter: 'driver_actor_id',
  },
  initiatives: {
    label: 'Initiatives',
    description: 'Initiatives that need product shaping, split readiness, and linked requirement drill-down.',
    applied_filters: workItemTypeLaneFilters,
    actor_filter: 'driver_actor_id',
  },
  'spec-approver': {
    label: 'Spec Approver',
    description: 'Specs and plans waiting for approval or changes-requested follow-up.',
    applied_filters: ['project_id', 'cursor', 'limit', 'actor_id', 'kind', 'phase', 'status', 'risk', 'blocked', 'stale'],
  },
  'execution-owner': {
    label: 'Execution Owner',
    description: 'Execution packages that need readiness, run, blocker, or review handoff action.',
    applied_filters: [
      'project_id',
      'cursor',
      'limit',
      'actor_id',
      'owner_actor_id',
      'kind',
      'phase',
      'status',
      'gate_state',
      'resolution',
      'risk',
      'blocked',
      'stale',
    ],
    actor_filter: 'owner_actor_id',
  },
  reviewer: {
    label: 'Reviewer',
    description: 'Open review packets that need review decisions or evidence drill-down.',
    applied_filters: ['project_id', 'cursor', 'limit', 'actor_id', 'reviewer_actor_id', 'kind', 'status', 'resolution', 'risk', 'blocked', 'stale'],
    actor_filter: 'reviewer_actor_id',
  },
  'qa-test-owner': {
    label: 'QA / Test Owner',
    description: 'Test strategy, validation evidence, and release acceptance gaps that need QA attention.',
    applied_filters: [
      'project_id',
      'cursor',
      'limit',
      'actor_id',
      'qa_owner_actor_id',
      'kind',
      'phase',
      'status',
      'gate_state',
      'risk',
      'blocked',
      'stale',
    ],
    actor_filter: 'qa_owner_actor_id',
  },
  'release-owner': {
    label: 'Release Owner',
    description: 'Releases and linked blockers that need rollout, evidence, approval, or observation attention.',
    applied_filters: [
      'project_id',
      'cursor',
      'limit',
      'actor_id',
      'release_owner_actor_id',
      'kind',
      'phase',
      'status',
      'gate_state',
      'resolution',
      'risk',
      'blocked',
      'stale',
    ],
    actor_filter: 'release_owner_actor_id',
  },
  manager: {
    label: 'Manager',
    description: 'Read-only lane health summaries for bottlenecks, risk, stale work, and delivery degradation.',
    applied_filters: ['project_id', 'cursor', 'limit', 'kind', 'phase', 'status', 'gate_state', 'resolution', 'risk', 'blocked', 'stale'],
  },
};

export interface ProductLaneFilterConflict {
  key: ProductLaneQueryKey;
  message: string;
}

export interface ParsedProductLaneFilters {
  project_id: string;
  lane_id: ProductLaneId;
  applied: Partial<Record<ProductLaneQueryKey, Exclude<ProductLaneFilterValue, undefined>>>;
  unsupported_filters: ProductLaneQueryKey[];
  conflicts: ProductLaneFilterConflict[];
}

export type ProductLaneFilterSubject = {
  project_id: string;
  actor_id_values?: readonly string[] | undefined;
  driver_actor_id?: string | undefined;
  driver_actor_id_values?: readonly string[] | undefined;
  owner_actor_id?: string | undefined;
  owner_actor_id_values?: readonly string[] | undefined;
  reviewer_actor_id?: string | undefined;
  reviewer_actor_id_values?: readonly string[] | undefined;
  qa_owner_actor_id?: string | undefined;
  qa_owner_actor_id_values?: readonly string[] | undefined;
  release_owner_actor_id?: string | undefined;
  release_owner_actor_id_values?: readonly string[] | undefined;
  kind_values?: readonly string[] | undefined;
  phase_values?: readonly string[] | undefined;
  status_values?: readonly string[] | undefined;
  gate_state_values?: readonly string[] | undefined;
  resolution_values?: readonly string[] | undefined;
  risk_values?: readonly string[] | undefined;
  blocked: boolean;
  stale: boolean;
};

export type ProductLaneProjectionItem = ProductLaneItem & ProductLaneFilterSubject;

export const laneForWorkItemKind = (kind: WorkItemKind): ProductLaneId => productLaneByWorkItemKind[kind];

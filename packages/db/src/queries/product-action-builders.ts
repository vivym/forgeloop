import {
  productActionSchema,
  type ProductAction,
  type ProductActionPriority,
  type ProductActionTarget,
  type ProductLaneId,
  type ProductObjectType,
  type ObjectRef,
} from '@forgeloop/contracts';

interface ProductActionBaseInput {
  id: string;
  laneId: ProductLaneId;
  priority: ProductActionPriority;
  label: string;
  description?: string;
  enabled?: boolean;
  disabledReason?: string;
  blockedReason?: string;
}

export interface NavigateActionInput extends ProductActionBaseInput {
  target: ProductActionTarget;
}

interface CommandActionInput extends ProductActionBaseInput {
  target?: ProductActionTarget;
}

interface WorkItemCommandInput extends CommandActionInput {
  scopeRef: WorkItemScopeRef;
}

export interface GeneratePackagesActionInput extends WorkItemCommandInput {
  planRevisionId: string;
}

export interface MarkPackageReadyActionInput extends WorkItemCommandInput {
  packageId: string;
  expectedPackageVersion: number;
}

export interface RunPackageActionInput extends WorkItemCommandInput {
  packageId: string;
}

type WorkItemScopeRef = Extract<ObjectRef, { type: 'initiative' | 'requirement' | 'bug' | 'tech_debt' }>;

const optionalActionFields = (input: ProductActionBaseInput) => ({
  ...(input.description === undefined ? {} : { description: input.description }),
  ...(input.disabledReason === undefined ? {} : { disabled_reason: input.disabledReason }),
  ...(input.blockedReason === undefined ? {} : { blocked_reason: input.blockedReason }),
});

const actionBase = (input: ProductActionBaseInput) => ({
  id: input.id,
  lane_id: input.laneId,
  priority: input.priority,
  label: input.label,
  enabled: input.enabled ?? true,
  ...optionalActionFields(input),
});

export const objectTarget = (objectType: ProductObjectType, objectId: string, href: string): ProductActionTarget => ({
  kind: 'object',
  object_type: objectType,
  object_id: objectId,
  href,
});

const productLaneRouteHref: Record<ProductLaneId, string> = {
  requirements: '/requirements',
  bugs: '/bugs',
  'tech-debt': '/tech-debt',
  initiatives: '/initiatives',
  'spec-approver': '/specs-plans',
  'execution-owner': '/executions',
  reviewer: '/code-review-handoffs',
  'qa-test-owner': '/reports/quality',
  'release-owner': '/releases',
  manager: '/dashboard',
};

export const laneTarget = (laneId: ProductLaneId): ProductActionTarget => ({
  kind: 'route',
  href: productLaneRouteHref[laneId],
});

export const routeTarget = (href: string): ProductActionTarget => ({
  kind: 'route',
  href,
});

export const workItemScopeRef = (workItem: { id: string; kind: WorkItemScopeRef['type']; title?: string }): WorkItemScopeRef => ({
  type: workItem.kind,
  id: workItem.id,
  ...(workItem.title === undefined ? {} : { title: workItem.title }),
});

export const navigateAction = (input: NavigateActionInput): ProductAction =>
  productActionSchema.parse({
    ...actionBase(input),
    kind: 'navigate',
    target: input.target,
  });

export const generatePackagesAction = (input: GeneratePackagesActionInput): ProductAction =>
  productActionSchema.parse({
    ...actionBase(input),
    kind: 'command',
    ...(input.target === undefined ? {} : { target: input.target }),
    command: {
      type: 'generate_packages',
      object_type: 'plan_revision',
      object_id: input.planRevisionId,
      scope_ref: input.scopeRef,
      plan_revision_id: input.planRevisionId,
    },
  });

export const markPackageReadyAction = (input: MarkPackageReadyActionInput): ProductAction =>
  productActionSchema.parse({
    ...actionBase(input),
    kind: 'command',
    ...(input.target === undefined ? {} : { target: input.target }),
    command: {
      type: 'mark_package_ready',
      object_type: 'execution_package',
      object_id: input.packageId,
      scope_ref: input.scopeRef,
      package_id: input.packageId,
      expected_package_version: input.expectedPackageVersion,
    },
  });

export const runPackageAction = (input: RunPackageActionInput): ProductAction =>
  productActionSchema.parse({
    ...actionBase(input),
    kind: 'command',
    ...(input.target === undefined ? {} : { target: input.target }),
    command: {
      type: 'run_package',
      object_type: 'execution_package',
      object_id: input.packageId,
      scope_ref: input.scopeRef,
      package_id: input.packageId,
    },
  });

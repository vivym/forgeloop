import {
  productActionSchema,
  type ProductAction,
  type ProductActionPriority,
  type ProductActionTarget,
  type ProductLaneId,
  type ProductObjectType,
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
  workItemId: string;
}

export interface GenerateSpecDraftActionInput extends WorkItemCommandInput {
  specId: string;
}

export interface GeneratePlanDraftActionInput extends WorkItemCommandInput {
  planId: string;
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

export const laneTarget = (laneId: ProductLaneId, href = `/lanes/${laneId}`): ProductActionTarget => ({
  kind: 'lane',
  lane_id: laneId,
  href,
});

export const navigateAction = (input: NavigateActionInput): ProductAction =>
  productActionSchema.parse({
    ...actionBase(input),
    kind: 'navigate',
    target: input.target,
  });

export const generateSpecDraftAction = (input: GenerateSpecDraftActionInput): ProductAction =>
  productActionSchema.parse({
    ...actionBase(input),
    kind: 'command',
    ...(input.target === undefined ? {} : { target: input.target }),
    command: {
      type: 'generate_spec_draft',
      object_type: 'spec',
      object_id: input.specId,
      work_item_id: input.workItemId,
      spec_id: input.specId,
    },
  });

export const generatePlanDraftAction = (input: GeneratePlanDraftActionInput): ProductAction =>
  productActionSchema.parse({
    ...actionBase(input),
    kind: 'command',
    ...(input.target === undefined ? {} : { target: input.target }),
    command: {
      type: 'generate_plan_draft',
      object_type: 'plan',
      object_id: input.planId,
      work_item_id: input.workItemId,
      plan_id: input.planId,
    },
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
      work_item_id: input.workItemId,
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
      work_item_id: input.workItemId,
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
      work_item_id: input.workItemId,
      package_id: input.packageId,
    },
  });

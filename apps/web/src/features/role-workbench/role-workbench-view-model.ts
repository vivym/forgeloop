import type { RoleWorkbenchResponse, WorkItem } from '../../shared/api/types';
import { productRoleToWorkbenchId, type ProductRole } from './role-labels';

export interface RoleQueueItemViewModel {
  id: string;
  title: string;
  objectId: string;
  objectType: string;
  kind: string;
  surface: string;
  state: string;
  risk: string;
  backendActions: RoleQueueActionViewModel[];
}

export interface RoleQueueActionViewModel {
  label: string;
  state: string;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

const asString = (value: unknown) => (typeof value === 'string' && value.trim().length > 0 ? value : undefined);

const titleCase = (value: string | undefined, fallback: string) =>
  value === undefined
    ? fallback
    : value
        .split(/[_ -]+/)
        .filter(Boolean)
        .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
        .join(' ');

const toBackendActions = (value: unknown): RoleQueueActionViewModel[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(asRecord)
    .map((action) => {
      const label = asString(action.label);
      if (label === undefined) {
        return undefined;
      }

      const method = asString(action.method)?.toUpperCase();
      const enabled = action.enabled === false ? false : true;
      const state = enabled ? (method === 'GET' ? 'Read signal' : 'Available from the object page') : 'Unavailable';
      return { label, state };
    })
    .filter((action): action is RoleQueueActionViewModel => action !== undefined);
};

const toRoleQueueItem = (item: unknown): RoleQueueItemViewModel => {
  const record = asRecord(item);
  const object = asRecord(record.object);
  const packageState = asRecord(record.package_state);
  const workItem = record as Partial<WorkItem>;
  const objectType = asString(object.type) ?? asString(record.object_type) ?? 'work_item';
  const objectId = asString(object.id) ?? asString(record.object_id) ?? asString(record.id) ?? 'unknown';

  return {
    id: asString(record.id) ?? objectId,
    title: asString(record.title) ?? asString(object.title) ?? 'Untitled work item',
    objectId,
    objectType: titleCase(objectType, 'Work item'),
    kind: titleCase(asString(record.kind) ?? workItem.kind, 'Work item'),
    surface: titleCase(asString(packageState.surface_type) ?? asString(record.surface_type), 'Product surface'),
    state: titleCase(asString(record.status) ?? asString(record.phase) ?? asString(record.gate_state), 'Ready for owner'),
    risk: titleCase(asString(record.risk), 'Unspecified'),
    backendActions: toBackendActions(record.actions),
  };
};

export const workItemOwnerRole: ProductRole = 'Work Item Owner';
export const workItemOwnerWorkbenchId = productRoleToWorkbenchId(workItemOwnerRole);

export const createRoleWorkbenchViewModel = (response: RoleWorkbenchResponse | undefined) => {
  const items = response?.items?.map(toRoleQueueItem) ?? [];

  return {
    activeRole: workItemOwnerRole,
    workbenchId: workItemOwnerWorkbenchId,
    total: items.length,
    items,
    selectedItem: items[0],
  };
};

import type { ProductLaneResponse } from '@forgeloop/contracts';
import type { ProductLaneId } from '@forgeloop/contracts';

import {
  productLaneMetadata,
  productLaneQueryKeys,
  workItemKindByLane,
  type ParsedProductLaneFilters,
  type ProductLaneFilterInput,
  type ProductLaneProjectionItem,
  type ProductLaneQueryKey,
} from './product-lane-types';

const defaultLimit = 50;

const hasSuppliedValue = (value: unknown): boolean => value !== undefined;

const valueEquals = (left: unknown, right: unknown): boolean => String(left) === String(right);

const matchesAny = (actual: string | undefined, alternatives: readonly string[] | undefined, expected: unknown): boolean => {
  const expectedString = String(expected);
  return (alternatives ?? (actual === undefined ? [] : [actual])).includes(expectedString);
};

const matchesActor = (
  actual: string | undefined,
  alternatives: readonly string[] | undefined,
  expected: unknown,
): boolean => matchesAny(actual, alternatives, expected);

const normalizedBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return undefined;
};

export const resolveLaneFilters = (laneId: ProductLaneId, query: ProductLaneFilterInput): ParsedProductLaneFilters => {
  const metadata = productLaneMetadata[laneId];
  const supported = new Set<ProductLaneQueryKey>(metadata.applied_filters);
  const applied: ParsedProductLaneFilters['applied'] = { project_id: query.project_id };
  const conflicts: ParsedProductLaneFilters['conflicts'] = [];
  const unsupported_filters: ProductLaneQueryKey[] = [];
  const canonicalKind = workItemKindByLane[laneId as keyof typeof workItemKindByLane];

  for (const key of productLaneQueryKeys) {
    const value = query[key];
    if (!hasSuppliedValue(value)) {
      continue;
    }
    if (!supported.has(key)) {
      unsupported_filters.push(key);
      continue;
    }
    applied[key] = value as Exclude<typeof value, undefined>;
  }

  if (canonicalKind !== undefined) {
    if (query.kind !== undefined && query.kind !== canonicalKind) {
      conflicts.push({ key: 'kind', message: `Lane ${laneId} only accepts kind=${canonicalKind}.` });
    }
    applied.kind = canonicalKind;
  }

  if (metadata.actor_filter !== undefined && query.actor_id !== undefined && query[metadata.actor_filter] !== undefined) {
    if (!valueEquals(query.actor_id, query[metadata.actor_filter])) {
      conflicts.push({
        key: 'actor_id',
        message: `actor_id must match ${metadata.actor_filter} for lane ${laneId}.`,
      });
    }
  }

  return {
    project_id: query.project_id,
    lane_id: laneId,
    applied,
    unsupported_filters,
    conflicts,
  };
};

export const matchesProductLaneFilters = (item: ProductLaneProjectionItem, filters: ParsedProductLaneFilters): boolean => {
  const applied = filters.applied;
  const actorFilter = productLaneMetadata[filters.lane_id].actor_filter;

  if (item.project_id !== filters.project_id) {
    return false;
  }
  if (applied.actor_id !== undefined) {
    if (actorFilter === undefined) {
      if (!matchesActor(undefined, item.actor_id_values, applied.actor_id)) {
        return false;
      }
    } else if (!matchesActor(item[actorFilter], item[`${actorFilter}_values`], applied.actor_id)) {
      return false;
    }
  }
  if (applied.driver_actor_id !== undefined && !matchesActor(item.driver_actor_id, item.driver_actor_id_values, applied.driver_actor_id)) {
    return false;
  }
  if (
    applied.execution_owner_actor_id !== undefined &&
    !matchesActor(item.execution_owner_actor_id, item.execution_owner_actor_id_values, applied.execution_owner_actor_id)
  ) {
    return false;
  }
  if (
    applied.reviewer_actor_id !== undefined &&
    !matchesActor(item.reviewer_actor_id, item.reviewer_actor_id_values, applied.reviewer_actor_id)
  ) {
    return false;
  }
  if (
    applied.qa_owner_actor_id !== undefined &&
    !matchesActor(item.qa_owner_actor_id, item.qa_owner_actor_id_values, applied.qa_owner_actor_id)
  ) {
    return false;
  }
  if (
    applied.release_owner_actor_id !== undefined &&
    !matchesActor(item.release_owner_actor_id, item.release_owner_actor_id_values, applied.release_owner_actor_id)
  ) {
    return false;
  }
  if (applied.kind !== undefined && !matchesAny(item.kind, item.kind_values, applied.kind)) {
    return false;
  }
  if (applied.phase !== undefined && !matchesAny(item.phase, item.phase_values, applied.phase)) {
    return false;
  }
  if (applied.status !== undefined && !matchesAny(item.status, item.status_values, applied.status)) {
    return false;
  }
  if (applied.gate_state !== undefined && !matchesAny(item.gate_state, item.gate_state_values, applied.gate_state)) {
    return false;
  }
  if (applied.resolution !== undefined && !matchesAny(item.resolution, item.resolution_values, applied.resolution)) {
    return false;
  }
  if (applied.risk !== undefined && !matchesAny(item.risk, item.risk_values, applied.risk)) {
    return false;
  }
  if (applied.blocked !== undefined && item.blocked !== normalizedBoolean(applied.blocked)) {
    return false;
  }
  if (applied.stale !== undefined && item.stale !== normalizedBoolean(applied.stale)) {
    return false;
  }

  return true;
};

export const toProductLaneResponseItem = (item: ProductLaneProjectionItem): ProductLaneResponse['items'][number] => ({
  id: item.id,
  title: item.title,
  object: item.object,
  ...(item.parent === undefined ? {} : { parent: item.parent }),
  ...(item.kind === undefined ? {} : { kind: item.kind }),
  ...(item.surface_type === undefined ? {} : { surface_type: item.surface_type }),
  ...(item.phase === undefined ? {} : { phase: item.phase }),
  ...(item.status === undefined ? {} : { status: item.status }),
  ...(item.gate_state === undefined ? {} : { gate_state: item.gate_state }),
  ...(item.resolution === undefined ? {} : { resolution: item.resolution }),
  ...(item.risk === undefined ? {} : { risk: item.risk }),
  ...(item.driver_actor_id === undefined ? {} : { driver_actor_id: item.driver_actor_id }),
  ...(item.execution_owner_actor_id === undefined ? {} : { execution_owner_actor_id: item.execution_owner_actor_id }),
  ...(item.reviewer_actor_id === undefined ? {} : { reviewer_actor_id: item.reviewer_actor_id }),
  ...(item.qa_owner_actor_id === undefined ? {} : { qa_owner_actor_id: item.qa_owner_actor_id }),
  ...(item.release_owner_actor_id === undefined ? {} : { release_owner_actor_id: item.release_owner_actor_id }),
  updated_at: item.updated_at,
  actions: item.actions,
});

export const paginateProductLaneItems = (
  items: readonly ProductLaneProjectionItem[],
  filters: ParsedProductLaneFilters,
): Pick<ProductLaneResponse, 'items' | 'next_cursor'> => {
  const cursor = filters.applied.cursor;
  const cursorIndex = cursor === undefined ? -1 : items.findIndex((item) => item.id === cursor);
  const start = cursorIndex >= 0 ? cursorIndex + 1 : 0;
  const limit = typeof filters.applied.limit === 'number' ? filters.applied.limit : defaultLimit;
  const page = items.slice(start, start + limit);
  const nextItem = items[start + limit];

  return {
    items: page.map(toProductLaneResponseItem),
    ...(nextItem === undefined ? {} : { next_cursor: page[page.length - 1]?.id }),
  };
};

export const buildProductLaneResponse = (
  laneId: ProductLaneId,
  items: readonly ProductLaneProjectionItem[],
  filters: ParsedProductLaneFilters,
): ProductLaneResponse => {
  const filteredItems = items.filter((item) => matchesProductLaneFilters(item, filters));
  const page = paginateProductLaneItems(filteredItems, filters);
  const metadata = productLaneMetadata[laneId];

  return {
    lane_id: laneId,
    label: metadata.label,
    description: metadata.description,
    items: page.items,
    unsupported_filters: filters.unsupported_filters,
    summary: {
      total: filteredItems.length,
      blocked: filteredItems.filter((item) => item.blocked).length,
      high_risk: filteredItems.filter((item) => item.risk === 'high' || item.risk_values?.includes('high')).length,
      stale: filteredItems.filter((item) => item.stale).length,
    },
    ...(page.next_cursor === undefined ? {} : { next_cursor: page.next_cursor }),
  };
};

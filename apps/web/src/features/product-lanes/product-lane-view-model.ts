import type { ProductLaneItem, ProductLaneResponse } from '../../shared/api/types';
import { primaryActionForItem, sortProductActions } from '../product-actions/product-actions';

export interface ProductLaneRow {
  id: string;
  title: string;
  objectLabel: string;
  kind: string;
  state: string;
  risk: string;
  updatedAge: string;
  primaryActionLabel: string;
  item: ProductLaneItem;
}

export interface ProductLaneViewModel {
  rows: ProductLaneRow[];
  selectedItem: ProductLaneItem | undefined;
}

export function createProductLaneViewModel(
  response: ProductLaneResponse | undefined,
  input: { currentSelectedId?: string | undefined; requestedSelectedId?: string | undefined } = {},
): ProductLaneViewModel {
  const items = response?.items ?? [];
  const selectedItem =
    findItem(items, input.requestedSelectedId) ?? findItem(items, input.currentSelectedId) ?? items[0];

  return {
    rows: items.map(toRow),
    selectedItem,
  };
}

function toRow(item: ProductLaneItem): ProductLaneRow {
  const sortedActions = sortProductActions(item.actions);
  const primaryAction = primaryActionForItem({ actions: sortedActions });

  return {
    id: item.id,
    title: item.title,
    objectLabel: titleCase(item.object.type),
    kind: titleCase(item.kind ?? item.surface_type ?? item.object.type),
    state: titleCase(item.status ?? item.phase ?? item.gate_state ?? item.resolution ?? 'ready'),
    risk: titleCase(item.risk ?? 'not recorded'),
    updatedAge: formatUpdatedAge(item.updated_at),
    primaryActionLabel: primaryAction?.label ?? 'No primary action',
    item: { ...item, actions: sortedActions },
  };
}

function findItem(items: readonly ProductLaneItem[], itemId: string | undefined) {
  return itemId === undefined ? undefined : items.find((item) => item.id === itemId);
}

function titleCase(value: string) {
  return value
    .split(/[_ -]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}

function formatUpdatedAge(value: string) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }

  const days = Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
  if (days === 0) {
    return 'Today';
  }
  if (days === 1) {
    return '1 day ago';
  }
  return `${days} days ago`;
}

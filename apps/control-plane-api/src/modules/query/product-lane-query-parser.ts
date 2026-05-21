import { BadRequestException } from '@nestjs/common';
import { productLaneIdSchema, type ProductLaneId } from '@forgeloop/contracts';
import {
  productLaneQueryKeys,
  resolveLaneFilters,
  workItemKindByLane,
  type ParsedProductLaneFilters,
  type ProductLaneQueryKey,
} from '@forgeloop/db';
import { z } from 'zod';

type RawQuery = Record<string, string | string[] | undefined>;

const productLaneWorkItemKindSchema = z.enum(['initiative', 'requirement', 'bug', 'tech_debt']);

const assertKnownKeys = (raw: RawQuery, knownKeys: readonly string[]): void => {
  const known = new Set(knownKeys);
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) {
      throw new BadRequestException(`Unknown query parameter: ${key}`);
    }
  }
};

const stringValue = (raw: RawQuery, key: string): string | undefined => {
  const value = raw[key];
  if (value === undefined) {
    return undefined;
  }
  if (Array.isArray(value)) {
    throw new BadRequestException(`Query parameter ${key} must be supplied once`);
  }
  if (typeof value !== 'string') {
    throw new BadRequestException(`Query parameter ${key} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new BadRequestException(`Query parameter ${key} must not be empty`);
  }
  return trimmed;
};

const requiredString = (raw: RawQuery, key: string): string => {
  const value = stringValue(raw, key);
  if (value === undefined) {
    throw new BadRequestException(`Query parameter ${key} is required`);
  }
  return value;
};

const optionalString = (raw: RawQuery, key: string): string | undefined => stringValue(raw, key);

const parseLimit = (value: string | undefined): number => {
  if (value === undefined) {
    return 50;
  }
  if (!/^-?\d+$/.test(value)) {
    throw new BadRequestException('limit must be an integer');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new BadRequestException('limit must be a safe integer');
  }
  if (parsed < 1) {
    return 1;
  }
  if (parsed > 100) {
    return 100;
  }
  return parsed;
};

const parseBoolean = (value: string | undefined, key: string): boolean | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  throw new BadRequestException(`Query parameter ${key} must be true or false`);
};

export function parseProductLaneIdOrThrowBadRequest(value: string): ProductLaneId {
  const parsed = productLaneIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException('Invalid product lane id.');
  }
  return parsed.data;
}

export function parseWorkItemKindOrThrowBadRequest(value: string | undefined): z.infer<typeof productLaneWorkItemKindSchema> | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = productLaneWorkItemKindSchema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException('Invalid Work Item kind.');
  }
  return parsed.data;
}

export function parseProductLaneQuery(laneId: ProductLaneId, raw: RawQuery): ParsedProductLaneFilters {
  assertKnownKeys(raw, productLaneQueryKeys);
  const resolved = resolveLaneFilters(laneId, {
    project_id: requiredString(raw, 'project_id'),
    limit: parseLimit(optionalString(raw, 'limit')),
    blocked: parseBoolean(optionalString(raw, 'blocked'), 'blocked'),
    stale: parseBoolean(optionalString(raw, 'stale'), 'stale'),
    actor_id: optionalString(raw, 'actor_id'),
    driver_actor_id: optionalString(raw, 'driver_actor_id'),
    owner_actor_id: optionalString(raw, 'owner_actor_id'),
    reviewer_actor_id: optionalString(raw, 'reviewer_actor_id'),
    qa_owner_actor_id: optionalString(raw, 'qa_owner_actor_id'),
    release_owner_actor_id: optionalString(raw, 'release_owner_actor_id'),
    cursor: optionalString(raw, 'cursor'),
    kind: parseWorkItemKindOrThrowBadRequest(optionalString(raw, 'kind')),
    phase: optionalString(raw, 'phase'),
    status: optionalString(raw, 'status'),
    gate_state: optionalString(raw, 'gate_state'),
    resolution: optionalString(raw, 'resolution'),
    risk: optionalString(raw, 'risk'),
  });
  if (resolved.conflicts.length > 0) {
    throw new BadRequestException({ message: 'Conflicting product lane filters.', conflicts: resolved.conflicts });
  }
  if (laneId in workItemKindByLane && resolved.unsupported_filters.includes('owner_actor_id')) {
    throw new BadRequestException('owner_actor_id is not supported for this product lane.');
  }
  return resolved;
}

export function parseWorkItemCockpitQuery(raw: RawQuery): { lane?: ProductLaneId } {
  assertKnownKeys(raw, ['lane']);
  const lane = optionalString(raw, 'lane');
  return lane === undefined ? {} : { lane: parseProductLaneIdOrThrowBadRequest(lane) };
}

export type { RawQuery, ProductLaneQueryKey };

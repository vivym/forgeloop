import type { ListProductQuery } from '../../shared/api/types';

export const roleLensValues = ['all', 'product', 'tech-lead', 'developer', 'reviewer', 'qa', 'release', 'manager'] as const;
export type RoleLens = (typeof roleLensValues)[number];

export type RoleLensActorFilter = Pick<
  ListProductQuery,
  'driver_actor_id' | 'execution_owner_actor_id' | 'reviewer_actor_id' | 'qa_owner_actor_id' | 'release_owner_actor_id'
>;

export function parseRoleLens(value: string | null | undefined): RoleLens {
  return roleLensValues.includes(value as RoleLens) ? (value as RoleLens) : 'all';
}

export function roleLensActorFilter(role: RoleLens, actorId: string | undefined): Partial<RoleLensActorFilter> {
  if (actorId === undefined || role === 'all' || role === 'manager') return {};
  if (role === 'product') return { driver_actor_id: actorId };
  if (role === 'developer') return { execution_owner_actor_id: actorId };
  if (role === 'reviewer' || role === 'tech-lead') return { reviewer_actor_id: actorId };
  if (role === 'qa') return { qa_owner_actor_id: actorId };
  if (role === 'release') return { release_owner_actor_id: actorId };
  return {};
}

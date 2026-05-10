import type { PublicReleaseSummary } from '@forgeloop/contracts';
import type {
  ExecutionPackage,
  Release,
  ReleaseResolvedExecutionPackageLink,
  ReleaseResolvedWorkItemLink,
  WorkItem,
} from '@forgeloop/domain';
import { publicReleaseSummarySchema } from '@forgeloop/contracts';
import type { P0Repository } from '@forgeloop/db';

const releaseTypes = new Set(['normal', 'hotfix', 'emergency', 'gray']);

const hasText = (value: string | undefined): value is string => value !== undefined && value.trim().length > 0;

const isVisible = (object: { archived_at?: string; deleted_at?: string }): boolean =>
  object.archived_at === undefined && object.deleted_at === undefined;

export const resolveReleaseWorkItemLinks = async (
  repository: P0Repository,
  release: Release,
): Promise<ReleaseResolvedWorkItemLink[]> =>
  Promise.all(
    release.work_item_ids.map(async (workItemId) => {
      const workItem = await repository.getWorkItem(workItemId);
      if (workItem === undefined) {
        return { object_id: workItemId, status: 'missing' };
      }
      if (workItem.project_id !== release.project_id) {
        return { object_id: workItemId, status: 'unauthorized', reason: 'project_mismatch', work_item: workItem };
      }
      if (workItem.archived_at !== undefined) {
        return { object_id: workItemId, status: 'archived', work_item: workItem };
      }
      if (workItem.deleted_at !== undefined) {
        return { object_id: workItemId, status: 'deleted', work_item: workItem };
      }
      return { object_id: workItemId, status: 'resolved', work_item: workItem };
    }),
  );

export const resolveReleaseExecutionPackageLinks = async (
  repository: P0Repository,
  release: Release,
): Promise<ReleaseResolvedExecutionPackageLink[]> =>
  Promise.all(
    release.execution_package_ids.map(async (executionPackageId) => {
      const executionPackage = await repository.getExecutionPackage(executionPackageId);
      if (executionPackage === undefined) {
        return { object_id: executionPackageId, status: 'missing' };
      }
      if (executionPackage.project_id !== release.project_id) {
        return {
          object_id: executionPackageId,
          status: 'unauthorized',
          reason: 'project_mismatch',
          execution_package: executionPackage,
        };
      }
      if (executionPackage.archived_at !== undefined) {
        return { object_id: executionPackageId, status: 'archived', execution_package: executionPackage };
      }
      if (executionPackage.deleted_at !== undefined) {
        return { object_id: executionPackageId, status: 'deleted', execution_package: executionPackage };
      }
      return { object_id: executionPackageId, status: 'resolved', execution_package: executionPackage };
    }),
  );

export const resolvedReleaseWorkItems = (links: readonly ReleaseResolvedWorkItemLink[]): WorkItem[] =>
  links.flatMap((link) => (link.status === 'resolved' && link.work_item !== undefined && isVisible(link.work_item) ? [link.work_item] : []));

export const resolvedReleaseExecutionPackages = (
  links: readonly ReleaseResolvedExecutionPackageLink[],
): ExecutionPackage[] =>
  links.flatMap((link) =>
    link.status === 'resolved' && link.execution_package !== undefined && isVisible(link.execution_package)
      ? [link.execution_package]
      : [],
  );

export const serializePublicReleaseSummary = (
  release: Release,
  workItems: readonly WorkItem[],
  executionPackages: readonly ExecutionPackage[],
): PublicReleaseSummary =>
  publicReleaseSummarySchema.parse({
    id: release.id,
    ...(hasText(release.key) ? { key: release.key } : {}),
    org_id: release.org_id,
    project_id: release.project_id,
    title: release.title,
    ...(hasText(release.scope_summary) ? { scope_summary: release.scope_summary } : {}),
    ...(hasText(release.release_owner_actor_id) ? { release_owner_actor_id: release.release_owner_actor_id } : {}),
    ...(release.release_type !== undefined && releaseTypes.has(release.release_type)
      ? { release_type: release.release_type }
      : {}),
    phase: release.phase,
    activity_state: release.activity_state,
    gate_state: release.gate_state,
    resolution: release.resolution,
    work_item_ids: workItems.map((workItem) => workItem.id),
    execution_package_ids: executionPackages.map((executionPackage) => executionPackage.id),
    ...(hasText(release.rollout_strategy) ? { rollout_strategy: release.rollout_strategy } : {}),
    ...(hasText(release.rollback_plan) ? { rollback_plan: release.rollback_plan } : {}),
    ...(hasText(release.observation_plan) ? { observation_plan: release.observation_plan } : {}),
    created_by_actor_id: release.created_by_actor_id,
    ...(hasText(release.updated_by_actor_id) ? { updated_by_actor_id: release.updated_by_actor_id } : {}),
    created_at: release.created_at,
    updated_at: release.updated_at,
    ...(hasText(release.closed_at) ? { closed_at: release.closed_at } : {}),
  });

export const publicReleaseSummaryFor = async (
  repository: P0Repository,
  release: Release,
): Promise<PublicReleaseSummary> => {
  const [workItemLinks, executionPackageLinks] = await Promise.all([
    resolveReleaseWorkItemLinks(repository, release),
    resolveReleaseExecutionPackageLinks(repository, release),
  ]);
  return serializePublicReleaseSummary(
    release,
    resolvedReleaseWorkItems(workItemLinks),
    resolvedReleaseExecutionPackages(executionPackageLinks),
  );
};

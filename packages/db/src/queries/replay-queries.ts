import type { PublicReplayEntry } from '@forgeloop/contracts';

import type { P0Repository } from '../repositories/p0-repository';
import { serializePublicArtifactRef, serializePublicReplayEntry } from './public-evidence-serialization';

export type TimelineEntry = PublicReplayEntry;

export async function getObjectReplayTimeline(
  repository: P0Repository,
  objectType: string,
  objectId: string,
): Promise<PublicReplayEntry[] | undefined> {
  if (objectType !== 'work_item') {
    return undefined;
  }

  const workItem = await repository.getWorkItem(objectId);
  if (workItem === undefined) {
    return undefined;
  }

  const objectRefs: Array<{ objectType: string; objectId: string }> = [{ objectType: 'work_item', objectId: workItem.id }];
  if (workItem.current_spec_id !== undefined) {
    objectRefs.push({ objectType: 'spec', objectId: workItem.current_spec_id });
    for (const revision of await repository.listSpecRevisions(workItem.current_spec_id)) {
      objectRefs.push({ objectType: 'spec_revision', objectId: revision.id });
    }
  }
  if (workItem.current_plan_id !== undefined) {
    objectRefs.push({ objectType: 'plan', objectId: workItem.current_plan_id });
    for (const revision of await repository.listPlanRevisions(workItem.current_plan_id)) {
      objectRefs.push({ objectType: 'plan_revision', objectId: revision.id });
    }
  }
  for (const executionPackage of await repository.listExecutionPackagesForWorkItem(workItem.id)) {
    objectRefs.push({ objectType: 'execution_package', objectId: executionPackage.id });
    for (const runSession of await repository.listRunSessionsForPackage(executionPackage.id)) {
      objectRefs.push({ objectType: 'run_session', objectId: runSession.id });
    }
    for (const reviewPacket of await repository.listReviewPacketsForPackage(executionPackage.id)) {
      objectRefs.push({ objectType: 'review_packet', objectId: reviewPacket.id });
    }
  }

  const entries: PublicReplayEntry[] = [];
  for (const ref of objectRefs) {
    for (const item of await repository.listObjectEvents(ref.objectId, ref.objectType)) {
      entries.push(
        serializePublicReplayEntry({
          id: item.id,
          source: 'object_event',
          object_type: item.object_type,
          object_id: item.object_id,
          summary: item.event_type,
          created_at: item.created_at,
          payload: item,
        }),
      );
    }
    for (const item of await repository.listStatusHistory(ref.objectId, ref.objectType)) {
      entries.push(
        serializePublicReplayEntry({
          id: item.id,
          source: 'status_history',
          object_type: item.object_type,
          object_id: item.object_id,
          summary: `${item.from_status ?? 'none'} -> ${item.to_status}`,
          created_at: item.created_at,
          payload: item,
        }),
      );
    }
    for (const item of await repository.listDecisionsForObject(ref.objectType, ref.objectId)) {
      entries.push(
        serializePublicReplayEntry({
          id: item.id,
          source: 'decision',
          object_type: item.object_type,
          object_id: item.object_id,
          summary: item.summary,
          created_at: item.created_at,
          payload: item,
        }),
      );
    }
    for (const item of await repository.listArtifactsForObject(ref.objectType, ref.objectId)) {
      const publicArtifactRef = serializePublicArtifactRef(item.ref);
      if (publicArtifactRef === undefined) {
        continue;
      }
      entries.push(
        serializePublicReplayEntry({
          id: item.id,
          source: 'artifact',
          object_type: item.object_type,
          object_id: item.object_id,
          summary: publicArtifactRef.name,
          created_at: item.created_at,
          payload: publicArtifactRef,
        }),
      );
    }
  }

  return entries.sort((left, right) => left.created_at.localeCompare(right.created_at));
}

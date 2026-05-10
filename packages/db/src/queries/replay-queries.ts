import type { PublicReplayEntry } from '@forgeloop/contracts';
import { selectReleaseReviewPacket, type Artifact, type ExecutionPackage, type ReleaseEvidence } from '@forgeloop/domain';

import type { P0Repository } from '../repositories/p0-repository';
import { serializePublicArtifactRef, serializePublicReplayEntry } from './public-evidence-serialization';

export type TimelineEntry = PublicReplayEntry;

type ObjectRef = { objectType: string; objectId: string };
type ObservationLink = {
  object_type: string;
  object_id: string;
  relationship?: string;
};

const byUpdatedAtDesc = <T extends { updated_at?: string; created_at: string; id: string }>(left: T, right: T): number => {
  const leftTime = Date.parse(left.updated_at ?? left.created_at);
  const rightTime = Date.parse(right.updated_at ?? right.created_at);
  return rightTime - leftTime || right.id.localeCompare(left.id);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isVisible = (object: { archived_at?: string; deleted_at?: string }): boolean =>
  object.archived_at === undefined && object.deleted_at === undefined;

const visibilityKey = (objectType: string, objectId: string): string => `${objectType}\0${objectId}`;

const addObjectRef = (refs: ObjectRef[], seen: Set<string>, ref: ObjectRef): void => {
  const key = visibilityKey(ref.objectType, ref.objectId);
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  refs.push(ref);
};

const observationLinksFor = (evidence: ReleaseEvidence): ObservationLink[] => {
  const observation = isRecord(evidence.extra) ? evidence.extra.observation : undefined;
  if (!isRecord(observation) || !Array.isArray(observation.links)) {
    return [];
  }

  return observation.links.filter((link): link is ObservationLink => {
    if (!isRecord(link)) {
      return false;
    }
    return typeof link.object_type === 'string' && typeof link.object_id === 'string';
  });
};

const latestRunSessionForPackage = async (
  repository: P0Repository,
  releaseCurrentRunSessionIds: readonly string[] | undefined,
  executionPackage: ExecutionPackage,
) => {
  const runSessions = await repository.listRunSessionsForPackage(executionPackage.id);

  return (
    runSessions.find((runSession) => releaseCurrentRunSessionIds?.includes(runSession.id) === true) ??
    runSessions.find((runSession) => runSession.id === executionPackage.current_run_session_id) ??
    runSessions.find((runSession) => runSession.id === executionPackage.last_run_session_id) ??
    [...runSessions].sort(byUpdatedAtDesc)[0]
  );
};

const artifactForEvidence = async (
  repository: P0Repository,
  evidence: ReleaseEvidence,
): Promise<Artifact | undefined> => {
  const artifacts = await repository.listArtifactsForObject('release_evidence', evidence.id);
  if (evidence.artifact_id === undefined) {
    return artifacts[0];
  }
  return artifacts.find((artifact) => artifact.id === evidence.artifact_id) ?? artifacts[0];
};

const filterEvidencePublicRefs = (
  evidence: ReleaseEvidence,
  publicVisibilityByRef: ReadonlyMap<string, boolean>,
): { evidence: ReleaseEvidence; omittedUnsafeLink: boolean } => {
  let publicEvidence: ReleaseEvidence = evidence;
  let omittedUnsafeLink = false;
  if (
    evidence.object_ref !== undefined &&
    publicVisibilityByRef.get(visibilityKey(evidence.object_ref.object_type, evidence.object_ref.object_id)) !== true
  ) {
    const { object_ref: _objectRef, ...withoutObjectRef } = publicEvidence;
    publicEvidence = withoutObjectRef;
    omittedUnsafeLink = true;
  }

  const extra = evidence.extra;
  const observation = isRecord(extra) ? extra.observation : undefined;
  if (!isRecord(extra) || !isRecord(observation) || !Array.isArray(observation.links)) {
    return { evidence: publicEvidence, omittedUnsafeLink };
  }

  const publicLinks = observation.links.filter((link) => {
    if (!isRecord(link) || typeof link.object_type !== 'string' || typeof link.object_id !== 'string') {
      return false;
    }
    return publicVisibilityByRef.get(visibilityKey(link.object_type, link.object_id)) === true;
  });
  omittedUnsafeLink = omittedUnsafeLink || publicLinks.length !== observation.links.length;

  return {
    evidence: {
      ...publicEvidence,
      extra: {
        ...extra,
        observation: {
          ...observation,
          ...(publicLinks.length > 0 ? { links: publicLinks } : { links: undefined }),
        },
      },
    },
    omittedUnsafeLink,
  };
};

const appendSerializedReplayEntries = async (
  repository: P0Repository,
  entries: PublicReplayEntry[],
  objectRefs: readonly ObjectRef[],
  visibleRefKeys?: Set<string>,
): Promise<void> => {
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
      visibleRefKeys?.add(visibilityKey('decision', item.id));
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
      visibleRefKeys?.add(visibilityKey('artifact', item.id));
    }
  }
};

const getWorkItemReplayTimeline = async (
  repository: P0Repository,
  objectId: string,
): Promise<PublicReplayEntry[] | undefined> => {
  const workItem = await repository.getWorkItem(objectId);
  if (workItem === undefined) {
    return undefined;
  }

  const objectRefs: ObjectRef[] = [];
  const seenObjectRefs = new Set<string>();
  addObjectRef(objectRefs, seenObjectRefs, { objectType: 'work_item', objectId: workItem.id });
  if (workItem.current_spec_id !== undefined) {
    addObjectRef(objectRefs, seenObjectRefs, { objectType: 'spec', objectId: workItem.current_spec_id });
    for (const revision of await repository.listSpecRevisions(workItem.current_spec_id)) {
      addObjectRef(objectRefs, seenObjectRefs, { objectType: 'spec_revision', objectId: revision.id });
    }
  }
  if (workItem.current_plan_id !== undefined) {
    addObjectRef(objectRefs, seenObjectRefs, { objectType: 'plan', objectId: workItem.current_plan_id });
    for (const revision of await repository.listPlanRevisions(workItem.current_plan_id)) {
      addObjectRef(objectRefs, seenObjectRefs, { objectType: 'plan_revision', objectId: revision.id });
    }
  }
  for (const executionPackage of await repository.listExecutionPackagesForWorkItem(workItem.id)) {
    addObjectRef(objectRefs, seenObjectRefs, { objectType: 'execution_package', objectId: executionPackage.id });
    for (const runSession of await repository.listRunSessionsForPackage(executionPackage.id)) {
      addObjectRef(objectRefs, seenObjectRefs, { objectType: 'run_session', objectId: runSession.id });
    }
    for (const reviewPacket of await repository.listReviewPacketsForPackage(executionPackage.id)) {
      addObjectRef(objectRefs, seenObjectRefs, { objectType: 'review_packet', objectId: reviewPacket.id });
    }
  }

  const entries: PublicReplayEntry[] = [];
  await appendSerializedReplayEntries(repository, entries, objectRefs);

  return entries.sort((left, right) => left.created_at.localeCompare(right.created_at));
};

const getReleaseReplayTimeline = async (
  repository: P0Repository,
  objectId: string,
): Promise<PublicReplayEntry[] | undefined> => {
  const release = await repository.getRelease(objectId);
  if (release === undefined) {
    return undefined;
  }

  const entries: PublicReplayEntry[] = [];
  const objectRefs: ObjectRef[] = [];
  const seenObjectRefs = new Set<string>();
  addObjectRef(objectRefs, seenObjectRefs, { objectType: 'release', objectId: release.id });
  const workItems = (
    await Promise.all(
      release.work_item_ids.map(async (workItemId) => {
        const workItem = await repository.getWorkItem(workItemId);
        return workItem !== undefined && workItem.project_id === release.project_id && isVisible(workItem) ? workItem : undefined;
      }),
    )
  ).filter((workItem): workItem is NonNullable<typeof workItem> => workItem !== undefined);
  const executionPackages = (
    await Promise.all(
      release.execution_package_ids.map(async (executionPackageId) => {
        const executionPackage = await repository.getExecutionPackage(executionPackageId);
        return executionPackage !== undefined && executionPackage.project_id === release.project_id && isVisible(executionPackage)
          ? executionPackage
          : undefined;
      }),
    )
  ).filter((executionPackage): executionPackage is ExecutionPackage => executionPackage !== undefined);

  for (const workItem of workItems) {
    addObjectRef(objectRefs, seenObjectRefs, { objectType: 'work_item', objectId: workItem.id });
  }
  for (const executionPackage of executionPackages) {
    addObjectRef(objectRefs, seenObjectRefs, { objectType: 'execution_package', objectId: executionPackage.id });
  }

  const selectedRunSessions = (
    await Promise.all(
      executionPackages.map((executionPackage) =>
        latestRunSessionForPackage(repository, release.current_run_session_ids, executionPackage),
      ),
    )
  ).filter((runSession): runSession is NonNullable<typeof runSession> => runSession !== undefined);
  const allReviewPackets = (
    await Promise.all(
      executionPackages.map((executionPackage) => repository.listReviewPacketsForPackage(executionPackage.id)),
    )
  ).flat();
  const selectedReviewPackets = executionPackages.flatMap((executionPackage) => {
    const selected = selectReleaseReviewPacket(release, executionPackage, allReviewPackets);
    return selected === undefined ? [] : [selected];
  });

  for (const runSession of selectedRunSessions) {
    addObjectRef(objectRefs, seenObjectRefs, { objectType: 'run_session', objectId: runSession.id });
  }
  for (const reviewPacket of selectedReviewPackets) {
    addObjectRef(objectRefs, seenObjectRefs, { objectType: 'review_packet', objectId: reviewPacket.id });
  }

  const visibleRefKeys = new Set(objectRefs.map((ref) => visibilityKey(ref.objectType, ref.objectId)));
  await appendSerializedReplayEntries(repository, entries, objectRefs, visibleRefKeys);

  const evidences = await repository.listReleaseEvidences(release.id);
  const artifactsByEvidenceId = new Map(
    await Promise.all(evidences.map(async (evidence) => [evidence.id, await artifactForEvidence(repository, evidence)] as const)),
  );
  const publicArtifactIds = new Set(
    evidences.flatMap((evidence) => {
      const artifact = artifactsByEvidenceId.get(evidence.id);
      if (artifact === undefined || evidence.artifact_id === undefined || serializePublicArtifactRef(artifact.ref) === undefined) {
        return [];
      }
      return [evidence.artifact_id];
    }),
  );
  const visibleRefs = new Map<string, boolean>();
  for (const key of visibleRefKeys) {
    visibleRefs.set(key, true);
  }
  for (const artifactId of publicArtifactIds) {
    visibleRefs.set(visibilityKey('artifact', artifactId), true);
  }

  for (const evidence of evidences) {
    const unsafeEvidenceRefs = [
      ...(evidence.object_ref === undefined
        ? []
        : [{ object_type: evidence.object_ref.object_type, object_id: evidence.object_ref.object_id }]),
      ...observationLinksFor(evidence),
    ];
    for (const link of unsafeEvidenceRefs) {
      const key = visibilityKey(link.object_type, link.object_id);
      if (!visibleRefs.has(key)) {
        visibleRefs.set(key, false);
      }
    }

    const { evidence: publicEvidenceInput, omittedUnsafeLink } = filterEvidencePublicRefs(evidence, visibleRefs);
    const artifact = artifactsByEvidenceId.get(evidence.id);
    entries.push(
      serializePublicReplayEntry({
        id: evidence.id,
        source: 'release_evidence',
        object_type: 'release',
        object_id: release.id,
        summary: evidence.summary,
        created_at: evidence.created_at,
        payload: artifact === undefined ? { evidence: publicEvidenceInput } : { evidence: publicEvidenceInput, artifact },
      }),
    );

    if (omittedUnsafeLink) {
      entries.push(
        serializePublicReplayEntry({
          id: `${evidence.id}:unsafe_or_redacted_evidence_backlink`,
          source: 'object_event',
          object_type: 'release',
          object_id: release.id,
          summary: 'unsafe_or_redacted_evidence_backlink',
          created_at: evidence.created_at,
          payload: {
            id: `${evidence.id}:unsafe_or_redacted_evidence_backlink`,
            object_type: 'release',
            object_id: release.id,
            event_type: 'unsafe_or_redacted_evidence_backlink',
            actor_type: 'system',
            reason: 'public_projection',
            payload: {
              release_id: release.id,
              artifact_id: evidence.artifact_id,
              blocker_codes: ['unsafe_or_redacted_evidence_backlink'],
              summary: 'Observation evidence contains a backlink that cannot be publicly projected.',
            },
            metadata: {},
            created_at: evidence.created_at,
          },
        }),
      );
    }
  }

  return entries.sort((left, right) => left.created_at.localeCompare(right.created_at));
};

export async function getObjectReplayTimeline(
  repository: P0Repository,
  objectType: string,
  objectId: string,
): Promise<PublicReplayEntry[] | undefined> {
  if (objectType === 'work_item') {
    return getWorkItemReplayTimeline(repository, objectId);
  }

  if (objectType === 'release') {
    return getReleaseReplayTimeline(repository, objectId);
  }

  return undefined;
}

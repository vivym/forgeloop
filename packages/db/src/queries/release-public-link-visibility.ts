import type {
  Artifact,
  Decision,
  ExecutionPackage,
  Release,
  ReleaseEvidence,
  ReleasePublicLinkVisibility,
  ReviewPacket,
  RunSession,
  WorkItem,
} from '@forgeloop/domain';

import type { P0Repository } from '../repositories/p0-repository';
import { serializePublicArtifactRef, serializePublicDecision } from './public-evidence-serialization';

type ObservationLink = {
  object_type: string;
  object_id: string;
  relationship?: string;
};

type VisibleObjectRef = {
  objectType: string;
  objectId: string;
};

export type ReleasePublicLinkVisibilityInput = {
  repository: P0Repository;
  release: Release;
  workItems: readonly WorkItem[];
  executionPackages: readonly ExecutionPackage[];
  runSessions: readonly RunSession[];
  reviewPackets: readonly ReviewPacket[];
  evidences: readonly ReleaseEvidence[];
  artifactsByEvidenceId: ReadonlyMap<string, Artifact | undefined>;
};

export const releasePublicVisibilityKey = (objectType: string, objectId: string): string => `${objectType}\0${objectId}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

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

const publicRefsFor = (evidence: ReleaseEvidence): ObservationLink[] => [
  ...(evidence.object_ref === undefined
    ? []
    : [
        {
          object_type: evidence.object_ref.object_type,
          object_id: evidence.object_ref.object_id,
          relationship: evidence.object_ref.relationship,
        },
      ]),
  ...observationLinksFor(evidence),
];

const visibleObjectRefsFor = (
  input: ReleasePublicLinkVisibilityInput,
  publicArtifactIds: ReadonlySet<string>,
): VisibleObjectRef[] => [
  { objectType: 'release', objectId: input.release.id },
  ...input.workItems.map((item) => ({ objectType: 'work_item', objectId: item.id })),
  ...input.executionPackages.map((item) => ({ objectType: 'execution_package', objectId: item.id })),
  ...input.runSessions.map((item) => ({ objectType: 'run_session', objectId: item.id })),
  ...input.reviewPackets.map((item) => ({ objectType: 'review_packet', objectId: item.id })),
  ...[...publicArtifactIds].map((artifactId) => ({ objectType: 'artifact', objectId: artifactId })),
];

const collectPublicDecisionIds = async (
  repository: P0Repository,
  objectRefs: readonly VisibleObjectRef[],
): Promise<Set<string>> => {
  const seenObjects = new Set<string>();
  const decisions = (
    await Promise.all(
      objectRefs.flatMap((ref) => {
        const key = releasePublicVisibilityKey(ref.objectType, ref.objectId);
        if (seenObjects.has(key)) {
          return [];
        }
        seenObjects.add(key);
        return [repository.listDecisionsForObject(ref.objectType, ref.objectId)];
      }),
    )
  ).flat();

  return new Set(
    decisions.flatMap((decision: Decision) => {
      try {
        return [serializePublicDecision(decision).id];
      } catch {
        return [];
      }
    }),
  );
};

export const buildReleasePublicLinkVisibility = async (
  input: ReleasePublicLinkVisibilityInput,
): Promise<ReleasePublicLinkVisibility[]> => {
  const visibilityByRef = new Map<string, ReleasePublicLinkVisibility>();
  const workItemIds = new Set(input.workItems.map((item) => item.id));
  const executionPackageIds = new Set(input.executionPackages.map((item) => item.id));
  const runSessionIds = new Set(input.runSessions.map((item) => item.id));
  const reviewPacketIds = new Set(input.reviewPackets.map((item) => item.id));
  const evidenceIds = new Set(input.evidences.map((item) => item.id));
  const publicArtifactIds = new Set(
    input.evidences.flatMap((evidence) => {
      const artifact = input.artifactsByEvidenceId.get(evidence.id);
      if (
        artifact === undefined ||
        evidence.artifact_id === undefined ||
        artifact.id !== evidence.artifact_id ||
        serializePublicArtifactRef(artifact.ref) === undefined
      ) {
        return [];
      }
      return [evidence.artifact_id];
    }),
  );
  const decisionIds = await collectPublicDecisionIds(input.repository, visibleObjectRefsFor(input, publicArtifactIds));

  for (const evidence of input.evidences) {
    for (const link of publicRefsFor(evidence)) {
      const key = releasePublicVisibilityKey(link.object_type, link.object_id);
      if (visibilityByRef.has(key)) {
        continue;
      }

      const publicLink =
        (link.object_type === 'release' && link.object_id === input.release.id) ||
        (link.object_type === 'work_item' && workItemIds.has(link.object_id)) ||
        (link.object_type === 'execution_package' && executionPackageIds.has(link.object_id)) ||
        (link.object_type === 'run_session' && runSessionIds.has(link.object_id)) ||
        (link.object_type === 'review_packet' && reviewPacketIds.has(link.object_id)) ||
        (link.object_type === 'release_evidence' && evidenceIds.has(link.object_id)) ||
        (link.object_type === 'artifact' && publicArtifactIds.has(link.object_id)) ||
        (link.object_type === 'decision' && decisionIds.has(link.object_id));

      visibilityByRef.set(key, {
        object_type: link.object_type,
        object_id: link.object_id,
        public: publicLink,
      });
    }
  }

  return [...visibilityByRef.values()];
};

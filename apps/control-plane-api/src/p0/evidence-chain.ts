import type {
  ArtifactRef,
  EvidenceChainItem,
  EvidenceChainObjectRef,
  EvidenceChainObjectType,
  EvidenceChainProjectionGapCode,
  EvidenceChainResponse,
  EvidenceChainRiskFlag,
  RequiredCheckSpec,
} from '@forgeloop/contracts';
import {
  deriveRequiredArtifactPresence,
  type Decision,
  type ExecutionPackage,
  type ObjectEvent,
  type ReviewPacket,
  type RunEvent,
  type RunSession,
  type StatusHistory,
  type WorkItem,
} from '@forgeloop/domain';
import type { P0Repository, TraceEventRecord, TraceLinkRecord } from '@forgeloop/db';

import { artifactRedactionReason, serializePublicArtifactRef } from './run-session-serialization';

type ProjectionInput = {
  reviewPacketId?: string;
  generatedAt: string;
};

type PackageEvidence = {
  executionPackage: ExecutionPackage;
  runs: RunSession[];
  reviewPackets: ReviewPacket[];
};

type TraceProjection = {
  events: TraceEventRecord[];
  linksByTraceEventId: Map<string, TraceLinkRecord[]>;
  supersededRunIds: Set<string>;
  replacedReviewPacketIds: Set<string>;
  linkedRunIds: Set<string>;
  traceArtifactRefCount: number;
};

type PendingItem = EvidenceChainItem & { order: number };

const supportedObjectTypes = new Set<EvidenceChainObjectType>([
  'work_item',
  'execution_package',
  'run_session',
  'review_packet',
  'artifact',
  'decision',
  'required_check',
  'trace_event',
]);

const uniq = <T>(values: Iterable<T>): T[] => [...new Set(values)];

const riskFlags = (...flags: Array<EvidenceChainRiskFlag | undefined>): EvidenceChainRiskFlag[] => uniq(flags.filter(Boolean) as EvidenceChainRiskFlag[]);

const objectRef = (
  objectType: EvidenceChainObjectType,
  objectId: string,
  relationship?: EvidenceChainObjectRef['relationship'],
): EvidenceChainObjectRef => ({
  object_type: objectType,
  object_id: objectId,
  ...(relationship === undefined ? {} : { relationship }),
});

const traceLinkRef = (link: TraceLinkRecord): EvidenceChainObjectRef | undefined => {
  if (!supportedObjectTypes.has(link.object_type as EvidenceChainObjectType)) {
    return undefined;
  }

  return objectRef(link.object_type as EvidenceChainObjectType, link.object_id, link.relationship);
};

const createdAtDesc = <T extends { created_at: string; id: string }>(left: T, right: T): number =>
  right.created_at.localeCompare(left.created_at) || left.id.localeCompare(right.id);

const latestPacket = (reviewPackets: ReviewPacket[]): ReviewPacket | undefined =>
  [...reviewPackets].filter((packet) => packet.status !== 'archived').sort(createdAtDesc)[0];

const currentPacketFor = (
  executionPackage: ExecutionPackage,
  reviewPackets: ReviewPacket[],
  gaps: Set<EvidenceChainProjectionGapCode>,
): ReviewPacket | undefined => {
  const nonArchived = reviewPackets.filter((packet) => packet.status !== 'archived');
  if (executionPackage.last_run_session_id === undefined) {
    gaps.add('missing_last_run_session');
    return latestPacket(nonArchived);
  }

  return nonArchived.find((packet) => packet.run_session_id === executionPackage.last_run_session_id);
};

const artifactKey = (runSessionId: string, artifact: ArtifactRef, index: number): string =>
  `${runSessionId}:${artifact.kind}:${artifact.name}:${artifact.digest ?? index}`;

const runArtifactRefCount = (runs: RunSession[]): number =>
  runs.reduce((count, runSession) => count + runSession.artifacts.length + runSession.log_refs.length, 0);

type DomainObjectRef = {
  objectType: EvidenceChainObjectType;
  objectId: string;
};

const failedRequiredCheckIds = (requiredChecks: RequiredCheckSpec[], runSession: RunSession): string[] =>
  requiredChecks.flatMap((requiredCheck) => {
    if (!requiredCheck.blocks_review) {
      return [];
    }

    const result = runSession.check_results.find((check) => check.check_id === requiredCheck.check_id);
    return result?.status === 'succeeded' ? [] : [requiredCheck.check_id];
  });

const runRiskFlags = (runSession: RunSession, supersededRunIds: Set<string>, failedCheckIds: string[]): EvidenceChainRiskFlag[] =>
  riskFlags(
    supersededRunIds.has(runSession.id) ? 'superseded_run' : undefined,
    failedCheckIds.length > 0 ? 'failed_required_check' : undefined,
  );

const reviewPacketRiskFlags = (
  reviewPacket: ReviewPacket,
  executionPackage: ExecutionPackage,
  replacedReviewPacketIds: Set<string>,
): EvidenceChainRiskFlag[] =>
  riskFlags(
    reviewPacket.decision === 'changes_requested' ? 'changes_requested' : undefined,
    reviewPacket.decision !== 'approved' ? 'unapproved_review_packet' : undefined,
    replacedReviewPacketIds.has(reviewPacket.id) ||
      (executionPackage.last_run_session_id !== undefined && reviewPacket.run_session_id !== executionPackage.last_run_session_id)
      ? 'stale_review_packet'
      : undefined,
  );

const decisionRiskFlags = (decision: Decision): EvidenceChainRiskFlag[] =>
  decision.decision === 'changes_requested' ? ['changes_requested'] : [];

const replacementDetails = (traceEvent: TraceEventRecord): EvidenceChainItem['details'] | undefined => {
  if (traceEvent.event_type !== 'run_replacement_recorded') {
    return undefined;
  }

  const payload = traceEvent.payload;
  return {
    replacement: {
      ...(typeof payload.new_run_session_id === 'string' ? { new_run_session_id: payload.new_run_session_id } : {}),
      ...(typeof payload.previous_run_session_id === 'string' ? { previous_run_session_id: payload.previous_run_session_id } : {}),
      ...(typeof payload.new_review_packet_id === 'string' ? { new_review_packet_id: payload.new_review_packet_id } : {}),
      ...(typeof payload.previous_review_packet_id === 'string' ? { previous_review_packet_id: payload.previous_review_packet_id } : {}),
    },
  };
};

const itemOrder = (item: EvidenceChainItem, currentRunIds: Set<string>, supersededRunIds: Set<string>): number => {
  const ids = [item.subject.object_id, ...item.links.map((link) => link.object_id)];
  if (ids.some((id) => currentRunIds.has(id))) {
    return 0;
  }
  if (item.source === 'trace_event') {
    return 1;
  }
  if (ids.some((id) => supersededRunIds.has(id))) {
    return 2;
  }
  return 3;
};

const publicRunEventItem = (runEvent: RunEvent, runSession: RunSession, executionPackage: ExecutionPackage): EvidenceChainItem => ({
  id: `evidence-item:run-event:${runEvent.id}`,
  source: 'run_event',
  subject: objectRef('run_session', runSession.id, 'generated_by'),
  summary: runEvent.summary,
  created_at: runEvent.created_at,
  visibility: 'public',
  links: [
    objectRef('execution_package', executionPackage.id, 'belongs_to'),
    objectRef('work_item', executionPackage.work_item_id, 'belongs_to'),
  ],
  risk_flags: [],
  redacted: false,
  details: { run_status: runSession.status },
});

const statusHistoryItem = (statusHistory: StatusHistory): EvidenceChainItem => ({
  id: `evidence-item:status-history:${statusHistory.id}`,
  source: 'status_history',
  subject: objectRef(statusHistory.object_type as EvidenceChainObjectType, statusHistory.object_id),
  summary: `${statusHistory.from_status ?? 'none'} -> ${statusHistory.to_status}`,
  created_at: statusHistory.created_at,
  visibility: 'public',
  links: [],
  risk_flags: [],
  redacted: false,
});

const objectEventItem = (objectEvent: ObjectEvent): EvidenceChainItem => ({
  id: `evidence-item:object-event:${objectEvent.id}`,
  source: 'object_event',
  subject: objectRef(objectEvent.object_type as EvidenceChainObjectType, objectEvent.object_id),
  summary: objectEvent.event_type,
  created_at: objectEvent.created_at,
  visibility: 'public',
  links: [],
  risk_flags: [],
  redacted: false,
});

const redactionItem = (input: {
  id: string;
  source: EvidenceChainItem['source'];
  objectType: EvidenceChainObjectType;
  objectId: string;
  summary: string;
  createdAt: string;
  links: EvidenceChainObjectRef[];
  reason: NonNullable<NonNullable<EvidenceChainItem['details']>['redaction_reason']>;
}): EvidenceChainItem => ({
  id: input.id,
  source: input.source,
  subject: objectRef(input.objectType, input.objectId, 'redacted_from'),
  summary: input.summary,
  created_at: input.createdAt,
  visibility: 'public',
  links: input.links,
  risk_flags: ['redacted_evidence'],
  redacted: true,
  details: { redaction_reason: input.reason },
});

const loadTraceProjection = async (repository: P0Repository, runs: RunSession[]): Promise<TraceProjection> => {
  const events = (
    await Promise.all(runs.map((runSession) => repository.listTraceEventsForSubject('run_session', runSession.id)))
  ).flat();
  const linksByTraceEventId = new Map<string, TraceLinkRecord[]>();
  const supersededRunIds = new Set<string>();
  const replacedReviewPacketIds = new Set<string>();
  const linkedRunIds = new Set<string>();
  let traceArtifactRefCount = 0;

  for (const event of events) {
    const links = await repository.listTraceLinks(event.id);
    linksByTraceEventId.set(event.id, links);
    for (const link of links) {
      if (link.object_type === 'run_session') {
        linkedRunIds.add(link.object_id);
      }
      if (link.relationship === 'supersedes' && link.object_type === 'run_session') {
        supersededRunIds.add(link.object_id);
      }
      if (link.relationship === 'replaces' && link.object_type === 'review_packet') {
        replacedReviewPacketIds.add(link.object_id);
      }
    }
    traceArtifactRefCount += (await repository.listTraceArtifactRefs(event.id)).length;
  }

  return { events, linksByTraceEventId, supersededRunIds, replacedReviewPacketIds, linkedRunIds, traceArtifactRefCount };
};

const loadPackageEvidence = async (repository: P0Repository, workItemId: string): Promise<PackageEvidence[]> => {
  const executionPackages = await repository.listExecutionPackagesForWorkItem(workItemId);
  return Promise.all(
    executionPackages.map(async (executionPackage) => ({
      executionPackage,
      runs: await repository.listRunSessionsForPackage(executionPackage.id),
      reviewPackets: await repository.listReviewPacketsForPackage(executionPackage.id),
    })),
  );
};

const domainObjectRefs = (workItem: WorkItem, evidence: PackageEvidence[]): DomainObjectRef[] => {
  const refs: DomainObjectRef[] = [{ objectType: 'work_item', objectId: workItem.id }];
  for (const item of evidence) {
    refs.push({ objectType: 'execution_package', objectId: item.executionPackage.id });
    for (const runSession of item.runs) {
      refs.push({ objectType: 'run_session', objectId: runSession.id });
    }
    for (const reviewPacket of item.reviewPackets) {
      refs.push({ objectType: 'review_packet', objectId: reviewPacket.id });
    }
  }

  return refs;
};

export const buildEvidenceChain = async (
  repository: P0Repository,
  workItem: WorkItem,
  input: ProjectionInput,
): Promise<EvidenceChainResponse | undefined> => {
  const packageEvidence = await loadPackageEvidence(repository, workItem.id);
  const allReviewPackets = packageEvidence.flatMap((evidence) => evidence.reviewPackets);
  const gaps = new Set<EvidenceChainProjectionGapCode>();
  let selectedReviewPackets: ReviewPacket[];

  if (input.reviewPacketId !== undefined) {
    const reviewPacket = allReviewPackets.find((packet) => packet.id === input.reviewPacketId);
    if (reviewPacket === undefined) {
      return undefined;
    }
    selectedReviewPackets = [reviewPacket];
  } else {
    selectedReviewPackets = packageEvidence.flatMap(({ executionPackage, reviewPackets }) => {
      const packet = currentPacketFor(executionPackage, reviewPackets, gaps);
      return packet === undefined ? [] : [packet];
    });
  }

  const selectedReviewPacketIds = new Set(selectedReviewPackets.map((packet) => packet.id));
  const selectedPackageIds = new Set(
    input.reviewPacketId === undefined
      ? packageEvidence.map((evidence) => evidence.executionPackage.id)
      : selectedReviewPackets.map((packet) => packet.execution_package_id),
  );
  const scopedEvidence = packageEvidence.filter((evidence) => selectedPackageIds.has(evidence.executionPackage.id));
  const runs = scopedEvidence.flatMap((evidence) => evidence.runs);
  const reviewPackets = scopedEvidence.flatMap((evidence) => evidence.reviewPackets.filter((packet) => packet.status !== 'archived'));
  const selectedRunIds = new Set(selectedReviewPackets.map((packet) => packet.run_session_id));
  const trace = await loadTraceProjection(repository, runs);

  if (trace.events.length === 0) {
    gaps.add('missing_trace_events');
  }
  if (runArtifactRefCount(runs) > trace.traceArtifactRefCount) {
    gaps.add('missing_trace_artifact_refs');
  }

  const historicalRunsWithoutLinks = runs.filter(
    (run) => !selectedRunIds.has(run.id) && !trace.supersededRunIds.has(run.id) && !trace.linkedRunIds.has(run.id),
  );
  if (historicalRunsWithoutLinks.length > 0) {
    gaps.add('missing_supersession_links');
  }

  const items: PendingItem[] = [];
  const artifactIds = new Set<string>();
  const representedRunIds = new Set(runs.map((run) => run.id));
  const representedReviewPacketIds = new Set(reviewPackets.map((packet) => packet.id));
  const decisionIds = new Set<string>();
  const addItem = (item: EvidenceChainItem): void => {
    items.push({ ...item, order: itemOrder(item, selectedRunIds, trace.supersededRunIds) });
  };

  for (const traceEvent of trace.events) {
    const links = (trace.linksByTraceEventId.get(traceEvent.id) ?? []).flatMap((link) => {
      const ref = traceLinkRef(link);
      return ref === undefined ? [] : [ref];
    });
    const details = replacementDetails(traceEvent);
    addItem({
      id: `evidence-item:trace-event:${traceEvent.id}`,
      source: 'trace_event',
      subject: objectRef('trace_event', traceEvent.id),
      summary: traceEvent.summary,
      created_at: traceEvent.created_at,
      visibility: 'public',
      links,
      risk_flags: [],
      redacted: false,
      ...(details === undefined ? {} : { details }),
    });
  }

  for (const evidence of scopedEvidence) {
    for (const runSession of evidence.runs) {
      const selectedRun = selectedRunIds.has(runSession.id);
      const failedCheckIds = selectedRun ? failedRequiredCheckIds(evidence.executionPackage.required_checks, runSession) : [];
      const runFlags = runRiskFlags(runSession, trace.supersededRunIds, failedCheckIds);
      addItem({
        id: `evidence-item:run-session:${runSession.id}`,
        source: 'object_event',
        subject: objectRef('run_session', runSession.id, 'generated_by'),
        summary: runSession.summary ?? `Run ${runSession.status}.`,
        created_at: runSession.finished_at ?? runSession.updated_at,
        visibility: 'public',
        links: [
          objectRef('execution_package', evidence.executionPackage.id, 'belongs_to'),
          objectRef('work_item', evidence.executionPackage.work_item_id, 'belongs_to'),
        ],
        risk_flags: runFlags,
        redacted: false,
        details: {
          run_status: runSession.status,
          required_check_ids: evidence.executionPackage.required_checks.map((check) => check.check_id),
          ...(failedCheckIds.length === 0 ? {} : { failed_check_ids: failedCheckIds }),
        },
      });

      const missingArtifactKinds = deriveRequiredArtifactPresence(evidence.executionPackage, runSession).missing_artifact_kinds;
      if (selectedRun && missingArtifactKinds.length > 0) {
        addItem({
          id: `evidence-item:missing-artifacts:${runSession.id}`,
          source: 'artifact',
          subject: objectRef('run_session', runSession.id),
          summary: `Missing required artifacts: ${missingArtifactKinds.join(', ')}.`,
          created_at: runSession.updated_at,
          visibility: 'public',
          links: [objectRef('execution_package', evidence.executionPackage.id, 'belongs_to')],
          risk_flags: ['missing_required_artifact'],
          redacted: false,
          details: { missing_artifact_kinds: missingArtifactKinds },
        });
      }

      for (const [index, artifact] of runSession.artifacts.entries()) {
        const key = artifactKey(runSession.id, artifact, index);
        artifactIds.add(key);
        const redactionReason = artifactRedactionReason(artifact);
        if (redactionReason !== undefined) {
          addItem(
            redactionItem({
              id: `evidence-item:redacted-artifact:${key}`,
              source: 'artifact',
              objectType: 'artifact',
              objectId: key,
              summary: `${artifact.kind} artifact redacted from public evidence.`,
              createdAt: runSession.updated_at,
              links: [objectRef('run_session', runSession.id, 'generated_by')],
              reason: redactionReason,
            }),
          );
          continue;
        }

        const publicArtifact = serializePublicArtifactRef(artifact);
        if (publicArtifact !== undefined) {
          addItem({
            id: `evidence-item:artifact:${key}`,
            source: 'artifact',
            subject: objectRef('artifact', key, 'generated_by'),
            summary: `Artifact ${publicArtifact.kind}: ${publicArtifact.name}.`,
            created_at: runSession.updated_at,
            visibility: 'public',
            links: [objectRef('run_session', runSession.id, 'generated_by')],
            risk_flags: [],
            redacted: false,
          });
        }
      }

      for (const [index, artifact] of runSession.log_refs.entries()) {
        const key = artifactKey(runSession.id, artifact, index);
        artifactIds.add(key);
        addItem(
          redactionItem({
            id: `evidence-item:redacted-log:${key}`,
            source: 'artifact',
            objectType: 'artifact',
            objectId: key,
            summary: 'Logs artifact redacted from public evidence.',
            createdAt: runSession.updated_at,
            links: [objectRef('run_session', runSession.id, 'generated_by')],
            reason: 'logs_artifact',
          }),
        );
      }

      for (const runEvent of await repository.listRunEvents(runSession.id)) {
        if (runEvent.visibility === 'public') {
          addItem(publicRunEventItem(runEvent, runSession, evidence.executionPackage));
        } else {
          addItem(
            redactionItem({
              id: `evidence-item:redacted-run-event:${runEvent.id}`,
              source: 'run_event',
              objectType: 'run_session',
              objectId: runSession.id,
              summary: 'Internal run event redacted from public evidence.',
              createdAt: runEvent.created_at,
              links: [objectRef('run_session', runSession.id, 'generated_by')],
              reason: runEvent.raw_ref === undefined ? 'internal_payload' : 'internal_event',
            }),
          );
        }
      }

      for (const artifact of await repository.listArtifactsForObject('run_session', runSession.id)) {
        artifactIds.add(artifact.id);
        const redactionReason = artifactRedactionReason(artifact.ref);
        if (redactionReason !== undefined) {
          addItem(
            redactionItem({
              id: `evidence-item:redacted-artifact-record:${artifact.id}`,
              source: 'artifact',
              objectType: 'artifact',
              objectId: artifact.id,
              summary: `${artifact.ref.kind} artifact redacted from public evidence.`,
              createdAt: artifact.created_at,
              links: [objectRef('run_session', runSession.id, 'generated_by')],
              reason: redactionReason,
            }),
          );
        } else {
          const publicArtifact = serializePublicArtifactRef(artifact.ref);
          if (publicArtifact !== undefined) {
            addItem({
              id: `evidence-item:artifact-record:${artifact.id}`,
              source: 'artifact',
              subject: objectRef('artifact', artifact.id, 'generated_by'),
              summary: `Artifact ${publicArtifact.kind}: ${publicArtifact.name}.`,
              created_at: artifact.created_at,
              visibility: 'public',
              links: [objectRef(artifact.object_type as EvidenceChainObjectType, artifact.object_id, 'generated_by')],
              risk_flags: [],
              redacted: false,
            });
          }
        }
      }
    }

    for (const reviewPacket of evidence.reviewPackets.filter((packet) => packet.status !== 'archived')) {
      const flags = reviewPacketRiskFlags(reviewPacket, evidence.executionPackage, trace.replacedReviewPacketIds);
      addItem({
        id: `evidence-item:review-packet:${reviewPacket.id}`,
        source: 'review_packet',
        subject: objectRef('review_packet', reviewPacket.id, selectedReviewPacketIds.has(reviewPacket.id) ? 'supports' : undefined),
        summary: reviewPacket.summary ?? reviewPacket.check_result_summary,
        created_at: reviewPacket.updated_at,
        visibility: 'public',
        links: [
          objectRef('run_session', reviewPacket.run_session_id, 'generated_by'),
          objectRef('execution_package', reviewPacket.execution_package_id, 'belongs_to'),
        ],
        risk_flags: flags,
        redacted: false,
        details: reviewPacket.decision === 'none' ? undefined : { decision: reviewPacket.decision },
      });

      for (const decision of await repository.listDecisionsForObject('review_packet', reviewPacket.id)) {
        decisionIds.add(decision.id);
        addItem({
          id: `evidence-item:decision:${decision.id}`,
          source: 'decision',
          subject: objectRef('decision', decision.id, 'supports'),
          summary: decision.summary,
          created_at: decision.created_at,
          visibility: 'public',
          links: [objectRef('review_packet', reviewPacket.id, 'belongs_to')],
          risk_flags: decisionRiskFlags(decision),
          redacted: false,
          details: { decision: decision.decision },
        });
      }
    }
  }

  for (const ref of domainObjectRefs(workItem, scopedEvidence)) {
    for (const statusHistory of await repository.listStatusHistory(ref.objectId, ref.objectType)) {
      addItem(statusHistoryItem(statusHistory));
    }
    for (const objectEvent of await repository.listObjectEvents(ref.objectId, ref.objectType)) {
      addItem(objectEventItem(objectEvent));
    }
  }

  const partial = gaps.size > 0;
  const responseLevelFlags = riskFlags(items.length === 0 ? 'no_evidence' : undefined, partial ? 'projection_partial' : undefined);
  const sortedItems = items
    .sort((left, right) => left.order - right.order || right.created_at.localeCompare(left.created_at) || left.id.localeCompare(right.id))
    .map(({ order: _order, ...item }) => item);
  const itemFlags = sortedItems.flatMap((item) => item.risk_flags);

  return {
    work_item_id: workItem.id,
    generated_at: input.generatedAt,
    focus: {
      selection: input.reviewPacketId === undefined ? 'current' : 'explicit',
      review_packet_ids: selectedReviewPackets.map((packet) => packet.id),
    },
    projection: {
      source: trace.events.length > 0 ? 'mixed' : 'read_time',
      version: 1,
      partial,
      gaps: [...gaps],
    },
    summary: {
      total_items: sortedItems.length,
      run_count: representedRunIds.size,
      review_packet_count: representedReviewPacketIds.size,
      decision_count: decisionIds.size,
      artifact_count: artifactIds.size,
      risk_flags: riskFlags(...itemFlags, ...responseLevelFlags),
      redacted_count: sortedItems.filter((item) => item.redacted).length,
    },
    items: sortedItems,
  };
};

import type {
  ArtifactRef,
  CreateReleaseEvidenceBody,
  EvidenceChainItem,
  EvidenceChainResponse,
  ReleaseBlocker,
  ReleaseEvidenceObjectRef,
  RoleWorkbenchId,
} from './api';
export { renderableRunEvents } from '@forgeloop/contracts';

export const roleWorkbenchTabs = [
  { id: 'intake', label: 'Intake' },
  { id: 'spec-approver', label: 'Spec Approver' },
  { id: 'execution-owner', label: 'Execution Owner' },
  { id: 'reviewer', label: 'Reviewer' },
  { id: 'qa-test-owner', label: 'QA/Test Owner' },
  { id: 'release-owner', label: 'Release Owner' },
  { id: 'manager-health', label: 'Manager Health' },
] as const satisfies ReadonlyArray<{ id: RoleWorkbenchId; label: string }>;

export const createRoleWorkbenchRequestGate = () => {
  let currentRequestId = 0;
  return {
    begin: () => {
      currentRequestId += 1;
      return currentRequestId;
    },
    invalidate: () => {
      currentRequestId += 1;
    },
    isCurrent: (requestId: number) => requestId === currentRequestId,
  };
};

type RoleWorkbenchProjectionItem = Record<string, unknown> & {
  id?: unknown;
  object?: unknown;
  title?: unknown;
  summary?: unknown;
};

const roleWorkbenchDetailFields = [
  ['project_id', 'project'],
  ['kind', 'kind'],
  ['phase', 'phase'],
  ['status', 'status'],
  ['risk', 'risk'],
  ['owner_actor_id', 'owner'],
  ['reviewer_actor_id', 'reviewer'],
  ['qa_owner_actor_id', 'qa'],
  ['release_owner_actor_id', 'release owner'],
  ['decision', 'decision'],
  ['changed_file_count', 'changed files'],
] as const;

export const roleWorkbenchItemTitle = (item: RoleWorkbenchProjectionItem): string => {
  if (typeof item.title === 'string' && item.title.trim()) return item.title;
  if (typeof item.summary === 'string' && item.summary.trim()) return item.summary;
  if (typeof item.id === 'string' && item.id.trim()) return item.id;
  return 'Untitled item';
};

export const roleWorkbenchObjectLabel = (item: RoleWorkbenchProjectionItem): string => {
  const object = item.object;
  if (isObjectRef(object)) return `${labelForToken(object.type)} / ${object.id}`;
  if (typeof item.id === 'string' && item.id.trim()) return `item / ${item.id}`;
  return 'item / unknown';
};

export const roleWorkbenchItemDetailLabels = (item: RoleWorkbenchProjectionItem): string[] =>
  roleWorkbenchDetailFields.flatMap(([field, label]) => {
    const value = item[field];
    if (typeof value === 'string' && value.trim()) return [`${label}: ${value}`];
    if (typeof value === 'number' || typeof value === 'boolean') return [`${label}: ${String(value)}`];
    return [];
  });

const isObjectRef = (value: unknown): value is { type: string; id: string } =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  typeof (value as { type?: unknown }).type === 'string' &&
  typeof (value as { id?: unknown }).id === 'string';

export function isActiveCockpit(cockpit: { work_item?: { id?: string } | null }, selectedWorkItemId: string): boolean {
  return Boolean(selectedWorkItemId && cockpit.work_item?.id === selectedWorkItemId);
}

const releaseBlockerCategoryOrder = ['structural', 'risk', 'evidence', 'planning'] as const;

export interface ReleaseBlockerGroup {
  id: ReleaseBlocker['category'];
  label: string;
  blockers: ReleaseBlocker[];
}

export const groupReleaseBlockers = (blockers: ReleaseBlocker[]): ReleaseBlockerGroup[] =>
  releaseBlockerCategoryOrder
    .map((category) => ({
      id: category,
      label: releaseNextActionLabel(category),
      blockers: blockers.filter((blocker) => blocker.category === category),
    }))
    .filter((group) => group.blockers.length > 0);

export const releaseNextActionLabel = (action: string): string => {
  const label = action.replace(/_/g, ' ').trim();
  return label ? `${label[0]?.toUpperCase()}${label.slice(1)}` : '';
};

export interface BuildObservationEvidencePayloadInput {
  actorId: string;
  summary: string;
  severity: 'info' | 'warning' | 'failure';
  observedAt: string;
  source?: 'human' | 'script';
  links?: ReleaseEvidenceObjectRef[];
  metrics?: Record<string, string | number | boolean | null>;
  notes?: string;
  idempotencyKey?: string;
  redacted?: boolean;
}

const releaseObservationLinkObjectTypes = new Set([
  'work_item',
  'execution_package',
  'run_session',
  'review_packet',
  'artifact',
  'decision',
  'release',
]);

export const buildObservationEvidencePayload = (input: BuildObservationEvidencePayloadInput): CreateReleaseEvidenceBody => {
  const links = (input.links ?? []).filter((link) => releaseObservationLinkObjectTypes.has(link.object_type));
  return {
    actor_id: input.actorId,
    ...(input.idempotencyKey ? { idempotency_key: input.idempotencyKey } : {}),
    evidence_type: 'observation_note',
    summary: input.summary,
    extra: {
      observation: {
        source: input.source ?? 'human',
        severity: input.severity,
        summary: input.summary,
        observed_at: input.observedAt,
        actor_id: input.actorId,
        ...(links.length ? { links } : {}),
        ...(input.metrics ? { metrics: input.metrics } : {}),
        ...(input.notes ? { notes: input.notes } : {}),
      },
    },
    redacted: input.redacted ?? false,
    status: 'current',
  };
};

const runEventMergeKey = (event: { id: string; cursor?: string }): string =>
  event.cursor === undefined ? `id:${event.id}` : `cursor:${event.cursor}`;

export const appendRunEvents = <T extends { id: string; sequence: number; cursor?: string }>(current: T[], incoming: T[]): T[] =>
  [...new Map([...current, ...incoming].map((event) => [runEventMergeKey(event), event])).values()].sort(
    (left, right) => left.sequence - right.sequence,
  );

export const nextRunEventCursor = (events: Array<{ cursor?: string }>): string | undefined =>
  [...events].reverse().find((event) => event.cursor !== undefined)?.cursor;

export const latestContinuationNotice = (
  events: Array<{ payload?: Record<string, unknown> }>,
): string | undefined => {
  const continuity = [...events].reverse().find(
    (item) => {
      const value = item.payload?.continuity;
      if (value === 'resume_fallback' || value === 'thread_continuation') return true;
      return isContinuityObject(value) && (value.fallback !== undefined || value.thread_id !== undefined || value.turn_id !== undefined);
    },
  )?.payload?.continuity;
  if (isContinuityObject(continuity)) {
    if (continuity.fallback !== undefined && continuity.fallback !== false && continuity.fallback !== '') {
      return 'Continuation resumed through fallback; live subagent continuity is not guaranteed.';
    }
    if (continuity.thread_id !== undefined || continuity.turn_id !== undefined) {
      return 'Continuation started as a new turn; live subagent continuity is not guaranteed.';
    }
  }
  if (continuity === 'resume_fallback') {
    return 'Continuation resumed through fallback; live subagent continuity is not guaranteed.';
  }
  if (continuity === 'thread_continuation') {
    return 'Continuation started as a new turn; live subagent continuity is not guaranteed.';
  }
  return undefined;
};

const isContinuityObject = (value: unknown): value is { fallback?: unknown; thread_id?: unknown; turn_id?: unknown } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const visibleRunArtifacts = <T extends { kind?: string; raw_ref?: unknown }>(artifacts: T[]): T[] =>
  artifacts.filter((artifact) => artifact.kind !== 'logs' && artifact.raw_ref === undefined);

export const runArtifactsForDetail = <T extends { kind?: string; raw_ref?: unknown }>(run: {
  artifacts?: T[];
  log_refs?: T[];
}): T[] => visibleRunArtifacts(run.artifacts ?? []);

export const runArtifactDisplayLabel = (artifact: Pick<ArtifactRef, 'kind' | 'name'>): string =>
  [artifact.kind ?? 'artifact', artifact.name].filter(Boolean).join(': ');

export const evidenceChainSummaryMetrics = (response: EvidenceChainResponse | null | undefined): Array<{ label: string; value: string }> => {
  const summary = response?.summary;
  return [
    { label: 'Items', value: String(summary?.total_items ?? 0) },
    { label: 'Runs', value: String(summary?.run_count ?? 0) },
    { label: 'Reviews', value: String(summary?.review_packet_count ?? 0) },
    { label: 'Decisions', value: String(summary?.decision_count ?? 0) },
    { label: 'Artifacts', value: String(summary?.artifact_count ?? 0) },
    { label: 'Redacted', value: String(summary?.redacted_count ?? 0) },
  ];
};

export interface EvidenceChainItemGroup {
  id: 'current' | 'history';
  label: string;
  items: EvidenceChainItem[];
}

export const groupEvidenceChainItems = (response: EvidenceChainResponse | null | undefined): EvidenceChainItemGroup[] => {
  if (!response) return [];
  const focusReviewPacketIds = new Set(response.focus.review_packet_ids);
  const currentObjectKeys = currentFocusObjectKeys(response, focusReviewPacketIds);
  const current: EvidenceChainItem[] = [];
  const history: EvidenceChainItem[] = [];

  for (const item of response.items) {
    if (isCurrentFocusEvidence(item, currentObjectKeys)) current.push(item);
    else history.push(item);
  }

  const groups: EvidenceChainItemGroup[] = [
    { id: 'current', label: 'Current focus', items: current },
    { id: 'history', label: 'Superseded / history', items: history },
  ];
  return groups.filter((group) => group.items.length > 0);
};

export interface EvidenceChainDisplayItem {
  id: string;
  sourceLabel: string;
  subjectLabel: string;
  summary: string;
  createdAt: string;
  riskLabels: string[];
  linkLabels: string[];
  redactionLabel?: string;
  detailLabels: string[];
}

export const evidenceChainDisplayItem = (item: EvidenceChainItem): EvidenceChainDisplayItem => {
  const redactionReason = item.details?.redaction_reason;
  return {
    id: item.id,
    sourceLabel: labelForToken(item.source),
    subjectLabel: objectRefLabel(item.subject),
    summary: item.summary,
    createdAt: item.created_at,
    riskLabels: item.risk_flags.map(labelForToken),
    linkLabels: item.links.map(objectRefLabel),
    ...(item.redacted ? { redactionLabel: `Redacted${redactionReason ? `: ${labelForToken(redactionReason)}` : ''}` } : {}),
    detailLabels: evidenceDetailLabels(item),
  };
};

const currentFocusObjectKeys = (response: EvidenceChainResponse, focusReviewPacketIds: Set<string>): Set<string> => {
  const keys = new Set([...focusReviewPacketIds].map((id) => objectKey('review_packet', id)));

  for (const item of response.items) {
    const refs = [item.subject, ...item.links];
    if (!refs.some((ref) => ref.object_type === 'review_packet' && focusReviewPacketIds.has(ref.object_id))) continue;

    for (const ref of refs) {
      if (ref.object_type === 'review_packet' || ref.object_type === 'run_session') {
        keys.add(objectKey(ref.object_type, ref.object_id));
      }
    }
  }

  return keys;
};

const isCurrentFocusEvidence = (item: EvidenceChainItem, currentObjectKeys: Set<string>): boolean => {
  if (currentObjectKeys.size === 0) return !isHistoryEvidence(item);
  if (currentObjectKeys.has(objectKey(item.subject.object_type, item.subject.object_id))) return true;
  return item.links.some((link) => currentObjectKeys.has(objectKey(link.object_type, link.object_id)));
};

const isHistoryEvidence = (item: EvidenceChainItem): boolean =>
  item.risk_flags.some((flag) => flag === 'superseded_run' || flag === 'stale_review_packet' || flag === 'changes_requested');

const objectKey = (objectType: string, objectId: string): string => `${objectType}:${objectId}`;

const labelForToken = (value: string): string => value.replace(/_/g, ' ');

const objectRefLabel = (ref: EvidenceChainItem['subject']): string =>
  `${labelForToken(ref.object_type)}: ${ref.object_id}${ref.relationship ? ` (${labelForToken(ref.relationship)})` : ''}`;

const evidenceDetailLabels = (item: EvidenceChainItem): string[] => {
  const details = item.details;
  if (!details) return [];

  const labels: string[] = [];
  if (details.decision) labels.push(`decision: ${labelForToken(details.decision)}`);
  if (details.run_status) labels.push(`run: ${labelForToken(details.run_status)}`);
  if (details.missing_artifact_kinds?.length) labels.push(`missing: ${details.missing_artifact_kinds.map(labelForToken).join(', ')}`);
  if (details.failed_check_ids?.length) labels.push(`failed checks: ${details.failed_check_ids.join(', ')}`);
  if (details.required_check_ids?.length) labels.push(`required checks: ${details.required_check_ids.join(', ')}`);
  if (details.projection_gap_codes?.length) labels.push(`gaps: ${details.projection_gap_codes.map(labelForToken).join(', ')}`);
  if (details.replacement?.new_run_session_id && details.replacement.previous_run_session_id) {
    labels.push(`replaces run: ${details.replacement.previous_run_session_id}`);
  }
  if (details.replacement?.new_review_packet_id && details.replacement.previous_review_packet_id) {
    labels.push(`replaces review: ${details.replacement.previous_review_packet_id}`);
  }
  return labels;
};

const payloadText = (payload: Record<string, unknown> | undefined, keys: string[]): string | undefined => {
  if (payload === undefined) return undefined;
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  }
  return undefined;
};

export const latestPlanStep = (events: Array<{ event_type?: string; payload?: Record<string, unknown> }>): string | undefined => {
  const planEvent = [...events].reverse().find((event) => event.event_type === 'plan_updated');
  return payloadText(planEvent?.payload, ['current_step', 'plan_step', 'step', 'status']);
};

export const workerLeaseLabel = (
  metadata: { worker_id?: string; worker_lease_status?: string } | undefined,
  events: Array<{ event_type?: string; payload?: Record<string, unknown> }>,
): string => {
  if (metadata?.worker_id !== undefined) {
    return `${metadata.worker_id} / ${metadata.worker_lease_status ?? 'status unavailable'}`;
  }

  const leaseEvent = [...events].reverse().find(
    (event) => event.event_type === 'worker_lease_acquired' || event.event_type === 'watchdog_heartbeat',
  );
  const workerId = payloadText(leaseEvent?.payload, ['worker_id', 'workerId']);
  if (!workerId) return 'none';

  const leaseStatus = payloadText(leaseEvent?.payload, ['lease_status', 'leaseStatus', 'status']);
  return `${workerId} / ${leaseStatus ?? 'status unavailable'}`;
};

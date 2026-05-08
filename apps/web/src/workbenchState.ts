import type { ArtifactRef, EvidenceChainItem, EvidenceChainResponse } from './api';

export function isActiveCockpit(cockpit: { work_item?: { id?: string } | null }, selectedWorkItemId: string): boolean {
  return Boolean(selectedWorkItemId && cockpit.work_item?.id === selectedWorkItemId);
}

export const appendRunEvents = <T extends { id: string; sequence: number }>(current: T[], incoming: T[]): T[] =>
  [...new Map([...current, ...incoming].map((event) => [event.id, event])).values()].sort(
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
  const current: EvidenceChainItem[] = [];
  const history: EvidenceChainItem[] = [];

  for (const item of response.items) {
    if (isCurrentFocusEvidence(item, focusReviewPacketIds)) current.push(item);
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

const isCurrentFocusEvidence = (item: EvidenceChainItem, focusReviewPacketIds: Set<string>): boolean => {
  if (focusReviewPacketIds.size === 0) return !isHistoryEvidence(item);
  if (item.subject.object_type === 'review_packet' && focusReviewPacketIds.has(item.subject.object_id)) return true;
  return item.links.some((link) => link.object_type === 'review_packet' && focusReviewPacketIds.has(link.object_id));
};

const isHistoryEvidence = (item: EvidenceChainItem): boolean =>
  item.risk_flags.some((flag) => flag === 'superseded_run' || flag === 'stale_review_packet' || flag === 'changes_requested');

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

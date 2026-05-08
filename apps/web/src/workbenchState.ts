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

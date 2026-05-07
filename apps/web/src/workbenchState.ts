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
    (item) => item.payload?.continuity === 'resume_fallback' || item.payload?.continuity === 'thread_continuation',
  )?.payload?.continuity;
  if (continuity === 'resume_fallback') {
    return 'Continuation resumed through fallback; live subagent continuity is not guaranteed.';
  }
  if (continuity === 'thread_continuation') {
    return 'Continuation started as a new turn; live subagent continuity is not guaranteed.';
  }
  return undefined;
};

export const visibleRunArtifacts = <T extends { kind?: string; raw_ref?: unknown }>(artifacts: T[]): T[] =>
  artifacts.filter((artifact) => artifact.kind !== 'logs' && artifact.raw_ref === undefined);

import type { RunEventType, RunEventVisibility } from './api.js';

export type TimelineRenderMode = 'visible' | 'hidden';

export type TimelineClassifiableRunEvent = {
  event_type?: RunEventType | string;
  visibility?: RunEventVisibility | string;
};

export type TimelineClassification = {
  mode: TimelineRenderMode;
  reason?: 'internal' | 'low_signal';
};

const lowSignalTimelineEventTypes = new Set<string>(['watchdog_heartbeat', 'worker_lease_acquired']);

export const classifyRunEventForTimeline = (event: TimelineClassifiableRunEvent): TimelineClassification => {
  if (event.visibility !== 'public') return { mode: 'hidden', reason: 'internal' };
  if (event.event_type !== undefined && lowSignalTimelineEventTypes.has(event.event_type)) {
    return { mode: 'hidden', reason: 'low_signal' };
  }
  return { mode: 'visible' };
};

export const renderableRunEvents = <T extends TimelineClassifiableRunEvent>(events: T[]): T[] =>
  events.filter((event) => classifyRunEventForTimeline(event).mode === 'visible');

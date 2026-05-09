import { describe, expect, it } from 'vitest';

import { classifyRunEventForTimeline, renderableRunEvents } from '@forgeloop/contracts';

describe('run event timeline rendering classifier', () => {
  it('hides internal events and low-signal public operational events by default', () => {
    expect(classifyRunEventForTimeline({ event_type: 'agent_message_delta', visibility: 'public' }).mode).toBe('visible');
    expect(classifyRunEventForTimeline({ event_type: 'user_input', visibility: 'public' }).mode).toBe('visible');
    expect(classifyRunEventForTimeline({ event_type: 'waiting_for_input', visibility: 'public' }).mode).toBe('visible');
    expect(classifyRunEventForTimeline({ event_type: 'watchdog_heartbeat', visibility: 'public' }).mode).toBe('hidden');
    expect(classifyRunEventForTimeline({ event_type: 'worker_lease_acquired', visibility: 'public' }).mode).toBe('hidden');
    expect(classifyRunEventForTimeline({ event_type: 'agent_message_delta', visibility: 'internal' }).mode).toBe('hidden');
  });

  it('filters renderable events without changing the public stream contract', () => {
    const events = [
      { id: 'event-1', event_type: 'watchdog_heartbeat', visibility: 'public' },
      { id: 'event-2', event_type: 'agent_message_completed', visibility: 'public' },
    ];

    expect(renderableRunEvents(events).map((event) => event.id)).toEqual(['event-2']);
  });
});

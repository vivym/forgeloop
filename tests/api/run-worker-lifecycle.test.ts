import { describe, expect, it, vi } from 'vitest';

import { RunWorkerLifecycleService } from '../../apps/control-plane-api/src/p0/run-worker-lifecycle.service';

describe('run worker lifecycle', () => {
  it('coalesces overlapping drains and catches drain failures', async () => {
    vi.useFakeTimers();
    try {
      let releaseFirstDrain: (() => void) | undefined;
      const drainOnce = vi
        .fn<() => Promise<void>>()
        .mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              releaseFirstDrain = resolve;
            }),
        )
        .mockRejectedValueOnce(new Error('recoverable drain failure'));
      const service = new RunWorkerLifecycleService({ drainOnce } as never);

      service.onModuleInit();
      await vi.advanceTimersByTimeAsync(3_000);
      expect(drainOnce).toHaveBeenCalledTimes(1);

      releaseFirstDrain?.();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(2_999);
      expect(drainOnce).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(drainOnce).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(3_000);
      expect(drainOnce).toHaveBeenCalledTimes(3);

      service.onModuleDestroy();
    } finally {
      vi.useRealTimers();
    }
  });
});

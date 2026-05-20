import { setTimeout as delay } from 'node:timers/promises';

import { describe, expect, it } from 'vitest';

import { CodexAppServerJsonRpcClient } from '../../packages/codex-runtime/src/index';

describe('CodexAppServerJsonRpcClient', () => {
  it('does not leak notification listeners while idle', async () => {
    const warnings: Error[] = [];
    const onWarning = (warning: Error): void => {
      if (warning.name === 'MaxListenersExceededWarning') {
        warnings.push(warning);
      }
    };
    process.on('warning', onWarning);
    try {
      const client = new CodexAppServerJsonRpcClient({ writeLine: async () => {} });
      const iterator = client.notifications()[Symbol.asyncIterator]();
      const pendingNext = iterator.next();

      await delay(700);
      client.closeWithError(new Error('stop'));
      await expect(pendingNext).rejects.toThrow(/stop/);
      expect(warnings).toEqual([]);
    } finally {
      process.off('warning', onWarning);
    }
  });
});

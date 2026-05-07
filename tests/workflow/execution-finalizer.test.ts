import { describe, expect, it } from 'vitest';
import { InMemoryP0Repository } from '../../packages/db/src';
import { finalizePackageRunWithExecutorResult } from '../../packages/workflow/src';
import {
  seedReadyStartedPackageRun,
  succeededExecutorResult,
  succeededSelfReview,
} from '../helpers/p0-runtime-fixtures';

describe('execution finalizer', () => {
  it('is idempotent when retrying a succeeded executor result after partial persistence', async () => {
    const repo = new InMemoryP0Repository();
    const context = await seedReadyStartedPackageRun(repo);
    const result = succeededExecutorResult(context.runSession.id);

    const first = await finalizePackageRunWithExecutorResult({
      repository: repo,
      runSessionId: context.runSession.id,
      executorResult: result,
      selfReview: async () => succeededSelfReview(),
      now: () => '2026-05-07T00:00:00.000Z',
    });
    const second = await finalizePackageRunWithExecutorResult({
      repository: repo,
      runSessionId: context.runSession.id,
      executorResult: result,
      selfReview: async () => succeededSelfReview(),
      now: () => '2026-05-07T00:00:01.000Z',
    });

    expect(second).toEqual(first);
    expect(await repo.listReviewPacketsForPackage(context.executionPackage.id)).toHaveLength(1);
  });
});

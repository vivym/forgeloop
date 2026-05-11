import { beforeEach, describe, expect, it, vi } from 'vitest';

const pgMock = vi.hoisted(() => ({
  clientConstructor: vi.fn(function Client() {
    return {
      connect: vi.fn(),
      query: vi.fn(),
      end: vi.fn(),
    };
  }),
}));

vi.mock('pg', () => ({
  Client: pgMock.clientConstructor,
}));

import {
  classifyDurableDogfoodError,
  createDatabase,
  databaseNameForDogfoodTimestamp,
  dropDatabase,
  planDurableDogfoodDatabase,
  sanitizeDatabaseTargetForReport,
} from '../../scripts/dogfood/durable-postgres';

describe('shared durable dogfood postgres helper', () => {
  beforeEach(() => {
    pgMock.clientConstructor.mockClear();
  });

  it('uses a resettable tmp database name for disposable dogfood databases', () => {
    expect(databaseNameForDogfoodTimestamp(1_778_256_000_000)).toBe('forgeloop_tmp_dogfood_1778256000000');
  });

  it('plans disposable databases with resettable names', () => {
    const plan = planDurableDogfoodDatabase({
      env: {},
      dockerCandidate: {
        containerId: 'container-1',
        host: '127.0.0.1',
        port: 15432,
        user: 'forgeloop',
        password: 'secret',
        defaultDatabase: 'postgres',
      },
      timestamp: 1_778_256_000_000,
    });

    expect(plan.databaseName).toBe('forgeloop_tmp_dogfood_1778256000000');
    expect(plan.cleanup).toEqual({ dropDatabase: true });
  });

  it('redacts database target details for reports', () => {
    expect(
      sanitizeDatabaseTargetForReport('postgresql://user:secret@127.0.0.1:5432/forgeloop_tmp_dogfood_1778256000000'),
    ).toEqual({
      host: '127.0.0.1',
      database: 'forgeloop_tmp_dogfood_1778256000000',
      redacted: true,
    });
  });

  it('classifies unavailable and unsafe targets as blocked but schema push failures as failed', () => {
    expect(classifyDurableDogfoodError({ code: 'missing_database' })).toEqual({ status: 'BLOCKED with reason' });
    expect(classifyDurableDogfoodError({ code: 'database_reset_refused' })).toEqual({ status: 'BLOCKED with reason' });
    expect(classifyDurableDogfoodError({ code: 'schema_push_failed' })).toEqual({ status: 'FAILED' });
  });

  it('refuses to create or drop a database before connecting when the target is unsafe', async () => {
    const unsafePlan = {
      kind: 'docker_temp_db' as const,
      databaseUrl: 'postgresql://user:secret@db.example.com:5432/production',
      adminUrl: 'postgresql://user:secret@db.example.com:5432/postgres',
      databaseName: 'production',
      cleanup: { dropDatabase: true },
      containerId: 'container-1',
    };

    await expect(createDatabase(unsafePlan)).rejects.toThrow(/Refusing to reset database on non-local host/);
    await expect(dropDatabase(unsafePlan)).rejects.toThrow(/Refusing to reset database on non-local host/);
    expect(pgMock.clientConstructor).not.toHaveBeenCalled();
  });
});

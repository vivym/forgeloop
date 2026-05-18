import { describe, expect, it } from 'vitest';

import {
  discoverDockerPostgresCandidate,
  planDurableDogfoodDatabase,
  providedDatabaseUrlFromEnv,
  startDisposablePostgres,
} from '../../scripts/dogfood/durable-postgres';
import { parseDurableDogfoodReport } from '../../scripts/delivery-durable-dogfood';

const dockerInspect = [
  {
    Id: 'container-1',
    Config: {
      Env: ['POSTGRES_USER=forgeloop', 'POSTGRES_PASSWORD=secret', 'POSTGRES_DB=forgeloop'],
    },
    NetworkSettings: {
      Ports: {
        '5432/tcp': [{ HostIp: '0.0.0.0', HostPort: '15432' }],
      },
    },
  },
];

describe('delivery durable dogfood script helpers', () => {
  it('parses FORGELOOP_DATABASE_URL from the environment', () => {
    expect(providedDatabaseUrlFromEnv({ FORGELOOP_DATABASE_URL: '  postgresql://user:pass@localhost:5432/forgeloop  ' })).toBe(
      'postgresql://user:pass@localhost:5432/forgeloop',
    );
    expect(providedDatabaseUrlFromEnv({ FORGELOOP_DATABASE_URL: '   ' })).toBeUndefined();
  });

  it('discovers a Docker Postgres candidate from docker ps and inspect shaped data', () => {
    const candidate = discoverDockerPostgresCandidate(
      [{ ID: 'container-1', Image: 'postgres:16-alpine', Names: 'forgeloop-postgres', Ports: '0.0.0.0:15432->5432/tcp' }],
      dockerInspect,
    );

    expect(candidate).toEqual({
      containerId: 'container-1',
      host: '127.0.0.1',
      port: 15432,
      user: 'forgeloop',
      password: 'secret',
      defaultDatabase: 'forgeloop',
    });
  });

  it('discovers a Docker Postgres candidate when ps has a short ID and inspect has the full ID', () => {
    const fullId = '7f6d2f1a9c0b1234567890abcdef1234567890abcdef1234567890abcdef1234';
    const candidate = discoverDockerPostgresCandidate(
      [{ ID: '7f6d2f1a9c0b', Image: 'postgres:16-alpine', Names: 'forgeloop-postgres', Ports: '0.0.0.0:15432->5432/tcp' }],
      [
        {
          ...dockerInspect[0],
          Id: fullId,
        },
      ],
    );

    expect(candidate).toMatchObject({
      containerId: fullId,
      host: '127.0.0.1',
      port: 15432,
      user: 'forgeloop',
      password: 'secret',
      defaultDatabase: 'forgeloop',
    });
  });

  it('removes a disposable container when startup readiness fails after docker run succeeds', async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const runner = async (command: string, args: string[]) => {
      calls.push({ command, args });
      if (args[0] === 'run') {
        return { stdout: 'container-started\n', stderr: '' };
      }
      if (args[0] === 'rm') {
        return { stdout: '', stderr: '' };
      }
      throw new Error('not ready');
    };

    await expect(startDisposablePostgres(runner, 1_778_256_000_000, { maxAttempts: 1, retryDelayMs: 0 })).rejects.toThrow(
      /Timed out waiting for disposable Postgres container/,
    );

    expect(calls).toContainEqual({ command: 'docker', args: ['rm', '-f', 'container-started'] });
  });

  it('refuses to proceed when no DB URL and no Docker candidate exist', () => {
    expect(() =>
      planDurableDogfoodDatabase({
        env: {},
        dockerCandidate: undefined,
        timestamp: 1_778_256_000_000,
      }),
    ).toThrow(/Set FORGELOOP_DATABASE_URL/);
  });

  it('marks a Docker-discovered temporary database for cleanup', () => {
    const plan = planDurableDogfoodDatabase({
      env: {},
      dockerCandidate: {
        containerId: 'container-1',
        host: '127.0.0.1',
        port: 15432,
        user: 'forgeloop',
        password: 'secret',
        defaultDatabase: 'forgeloop',
      },
      timestamp: 1_778_256_000_000,
    });

    expect(plan.kind).toBe('docker_temp_db');
    expect(plan.databaseName).toBe('forgeloop_tmp_dogfood_1778256000000');
    expect(plan.cleanup).toEqual({ dropDatabase: true });
    expect(plan.databaseUrl).toBe('postgresql://forgeloop:secret@127.0.0.1:15432/forgeloop_tmp_dogfood_1778256000000');
  });

  it('does not mark an externally provided DB for cleanup', () => {
    const plan = planDurableDogfoodDatabase({
      env: { FORGELOOP_DATABASE_URL: 'postgresql://user:pass@localhost:5432/external' },
      dockerCandidate: {
        containerId: 'container-1',
        host: '127.0.0.1',
        port: 15432,
        user: 'forgeloop',
        password: 'secret',
        defaultDatabase: 'forgeloop',
      },
      timestamp: 1_778_256_000_000,
    });

    expect(plan.kind).toBe('provided');
    expect(plan.databaseUrl).toBe('postgresql://user:pass@localhost:5432/external');
    expect(plan.cleanup).toEqual({ dropDatabase: false, removeContainer: false });
  });

  it('verifies report text contains durable PASS markers', () => {
    const reportText = `
# Delivery Loop Verification

- DB schema push: PASSED
- Durable public API actor header auth: PASSED
- Durable SSE stream-token auth: PASSED
- Durable repository restart recovery: PASSED
`;

    expect(parseDurableDogfoodReport(reportText)).toEqual({
      dbSchemaPushPassed: true,
      durablePublicApiAuthPassed: true,
      durableSseAuthPassed: true,
      durableRepositoryRecoveryPassed: true,
    });
  });
});

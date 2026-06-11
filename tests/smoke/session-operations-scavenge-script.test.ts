import { createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { runSessionOperationsScavenge } from '../../scripts/session-operations-scavenge';

const env = {
  FORGELOOP_API_BASE_URL: 'http://api.local/',
  FORGELOOP_ACTOR_ID: 'operator-1',
  FORGELOOP_ACTOR_CLASS: 'human_admin',
  FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET: 'secret-1',
};

const makeTempJson = (value: unknown): { dir: string; file: string } => {
  const dir = mkdtempSync(join(tmpdir(), 'forgeloop-session-operations-scavenge-'));
  const file = join(dir, 'input.json');
  writeFileSync(file, JSON.stringify(value), 'utf8');
  return { dir, file };
};

const responseOk = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('session operations scavenge script', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the public Session Operations API and not direct repository writes', () => {
    const source = readFileSync('scripts/session-operations-scavenge.ts', 'utf8');

    expect(source).toContain('/session-operations/scavenge');
    expect(source).not.toContain('@forgeloop/db');
    expect(source).not.toContain('new InMemoryDeliveryRepository');
    expect(source).not.toContain('DrizzleDeliveryRepository');
  });

  it('requires signed actor/operator context inputs', () => {
    const source = readFileSync('scripts/session-operations-scavenge.ts', 'utf8');

    expect(source).toContain('FORGELOOP_ACTOR_ID');
    expect(source).toContain('FORGELOOP_ACTOR_CLASS');
    expect(source).toContain('FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET');
  });

  it('supports execute-mode reason and idempotency prefix inputs', () => {
    const source = readFileSync('scripts/session-operations-scavenge.ts', 'utf8');

    expect(source).toContain('--reason');
    expect(source).toContain('--operation-idempotency-key-prefix');
    expect(source).toContain('reason is required when mode is execute');
    expect(source).toContain('operation-idempotency-key-prefix is required when mode is execute');
  });

  it('sends dry-run filters under the API filters field with signed actor headers', async () => {
    const { dir, file } = makeTempJson({ state: 'blocked_stale_lease', limit: 10 });
    const fetchMock = vi.fn(async () => responseOk({ mode: 'dry_run', candidates: [], results: [] }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      await runSessionOperationsScavenge(['--mode=dry_run', `--filters-file=${file}`], env);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    const timestamp = headers['x-forgeloop-actor-timestamp'];
    const signature = createHmac('sha256', env.FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET)
      .update([env.FORGELOOP_ACTOR_ID, env.FORGELOOP_ACTOR_CLASS, '', timestamp].join('\n'))
      .digest('base64url');

    expect(url).toBe('http://api.local/session-operations/scavenge');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      mode: 'dry_run',
      filters: { state: 'blocked_stale_lease', limit: 10 },
    });
    expect(headers).toEqual(
      expect.objectContaining({
        'content-type': 'application/json',
        'x-forgeloop-actor-id': env.FORGELOOP_ACTOR_ID,
        'x-forgeloop-actor-class': env.FORGELOOP_ACTOR_CLASS,
        'x-forgeloop-actor-signature': signature,
      }),
    );
  });

  it('fails execute mode before HTTP when candidate entries are malformed', async () => {
    const { dir, file } = makeTempJson([{ codex_session_id: 'session-1' }]);
    const fetchMock = vi.fn(async () => responseOk({ mode: 'execute', candidates: [], results: [] }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      await expect(
        runSessionOperationsScavenge(
          [
            '--mode=execute',
            '--confirm-execute',
            '--reason=Operator-reviewed stale control cleanup.',
            '--operation-idempotency-key-prefix=scavenge-ticket-1',
            `--candidates-file=${file}`,
          ],
          env,
        ),
      ).rejects.toThrow('candidate_predicate');
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

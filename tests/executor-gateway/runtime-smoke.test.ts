import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { executorResultSchema } from '@forgeloop/contracts';

import { createRunSpec } from '../executor/test-fixtures';

const getAvailablePort = async (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address === 'string' || address === null) {
        server.close(() => reject(new Error('Unable to allocate an executor smoke test port')));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });

const stopProcess = async (child: ChildProcessWithoutNullStreams): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    }, 1_000).unref();
  });
};

const startRuntimeGateway = async () => {
  const port = await getAvailablePort();
  const child = spawn('pnpm', ['exec', 'tsx', 'src/main.ts'], {
    cwd: 'apps/executor-gateway',
    env: { ...process.env, PORT: String(port) },
  });
  const output: string[] = [];
  child.stdout.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => output.push(chunk.toString()));

  return { child, port, logs: () => output.join('') };
};

describe('executor gateway runtime smoke', () => {
  let child: ChildProcessWithoutNullStreams | undefined;

  afterEach(async () => {
    if (child !== undefined) {
      await stopProcess(child);
      child = undefined;
    }
  });

  it('starts under tsx with explicit Nest injection and accepts a mock execution', async () => {
    const runtime = await startRuntimeGateway();
    child = runtime.child;
    const runSpec = createRunSpec({
      executor_type: 'mock',
      run_session_id: 'runtime-smoke-run',
      idempotency_key: 'runtime-smoke-idem',
    });

    let response: request.Response | undefined;
    let lastError: unknown;
    const startedAt = Date.now();

    while (Date.now() - startedAt < 8_000) {
      try {
        response = await request(`http://127.0.0.1:${runtime.port}`).post('/internal/executions').send(runSpec);
        break;
      } catch (error) {
        lastError = error;
        await delay(100);
      }
    }

    if (response === undefined) {
      throw lastError instanceof Error ? lastError : new Error(`Gateway did not start. Logs:\n${runtime.logs()}`);
    }

    expect(response.status).toBe(201);
    expect(executorResultSchema.parse(response.body.result).run_session_id).toBe('runtime-smoke-run');
  }, 12_000);
});

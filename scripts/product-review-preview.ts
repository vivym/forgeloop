import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { productArchitectureDemoSeedId } from '../apps/control-plane-api/src/modules/core/product-architecture-demo-seed';

export const productArchitectureSeedId = productArchitectureDemoSeedId;

export function productReviewPreviewEnv({ apiPort, webPort }: { apiPort: number; webPort: number }) {
  return {
    FORGELOOP_DEMO_SEED_ID: productArchitectureSeedId,
    FORGELOOP_REPOSITORY_MODE: 'memory',
    VITE_FORGELOOP_API_URL: `http://127.0.0.1:${apiPort}`,
    VITE_FORGELOOP_PROJECT_ID: productArchitectureSeedId,
    VITE_FORGELOOP_QUERY_RETRY: 'false',
    FORGELOOP_WEB_PORT: String(webPort),
  } satisfies Record<string, string>;
}

export function productReviewPreviewProcessEnv(
  parentEnv: NodeJS.ProcessEnv,
  ports: { apiPort: number; webPort: number },
) {
  const envWithoutDatabaseUrls = Object.fromEntries(
    Object.entries(parentEnv).filter(([key]) => key !== 'DATABASE_URL' && key !== 'FORGELOOP_DATABASE_URL'),
  ) as NodeJS.ProcessEnv;

  return {
    ...envWithoutDatabaseUrls,
    ...productReviewPreviewEnv(ports),
    PORT: String(ports.apiPort),
  } satisfies NodeJS.ProcessEnv;
}

export function renderProductReviewPreviewSummary({ apiUrl, webUrl }: { apiUrl: string; webUrl: string }) {
  return [`Seed: ${productArchitectureSeedId}`, `API: ${apiUrl}`, `Web: ${webUrl}`].join('\n');
}

async function main() {
  const apiPort = await freePort();
  const webPort = await freePort();
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const webUrl = `http://127.0.0.1:${webPort}`;
  const env = productReviewPreviewProcessEnv(process.env, { apiPort, webPort });

  const apiProcess = spawnManaged('pnpm', ['--filter', '@forgeloop/control-plane-api', 'start:dev'], env);
  const webProcess = spawnManaged('pnpm', ['--filter', '@forgeloop/web', 'dev', '--host', '127.0.0.1', '--port', String(webPort)], env);

  const stop = () => {
    stopProcess(apiProcess);
    stopProcess(webProcess);
  };
  process.once('SIGINT', () => {
    stop();
    process.exit(130);
  });
  process.once('SIGTERM', () => {
    stop();
    process.exit(143);
  });

  console.log(renderProductReviewPreviewSummary({ apiUrl, webUrl }));
}

function spawnManaged(command: string, args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  return spawn(command, args, {
    cwd: resolve('.'),
    env,
    stdio: 'inherit',
  });
}

function stopProcess(child: ChildProcess) {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
  }
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address !== null && typeof address === 'object') resolvePort(address.port);
        else reject(new Error('Could not allocate a local preview port'));
      });
    });
  });
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

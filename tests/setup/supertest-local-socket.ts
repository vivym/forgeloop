import { existsSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import request from 'supertest';
import { afterAll } from 'vitest';

type SupertestServer = Server & {
  address(): ReturnType<Server['address']>;
  listen(path: string): Server;
};

type SupertestWithServer = request.Test & {
  _forgeloopWaitForListening?: boolean;
  _server?: Server;
  emit(eventName: string | symbol, ...args: unknown[]): boolean;
};

const isServer = (app: Parameters<typeof originalServerAddress>[0]): app is SupertestServer =>
  typeof app !== 'string' && 'address' in app && 'listen' in app;

const socketRoot = mkdtempSync(join(tmpdir(), 'forgeloop-supertest-'));
let socketCounter = 0;
const socketPaths = new Set<string>();
const originalServerAddress = request.Test.prototype.serverAddress;
const originalEnd = request.Test.prototype.end;

request.Test.prototype.serverAddress = function serverAddress(app: Parameters<typeof originalServerAddress>[0], path: string) {
  if (!isServer(app)) {
    return originalServerAddress.call(this, app, path);
  }

  const address = app.address();
  if (app.listening === true && typeof address === 'string' && existsSync(address)) {
    return `http+unix://${encodeURIComponent(address)}${path}`;
  }
  if (app.listening === true && address !== null) {
    return originalServerAddress.call(this, app, path);
  }

  socketCounter += 1;
  const socketPath = join(socketRoot, `supertest-${process.pid}-${socketCounter}.sock`);
  socketPaths.add(socketPath);
  const test = this as SupertestWithServer;
  test._server = app.listen(socketPath);
  test._forgeloopWaitForListening = true;
  return `http+unix://${encodeURIComponent(socketPath)}${path}`;
};

request.Test.prototype.end = function end(...args: Parameters<typeof originalEnd>) {
  const test = this as SupertestWithServer;
  if (test._forgeloopWaitForListening !== true || test._server?.listening === true) {
    return originalEnd.apply(this, args);
  }

  const server = test._server;
  if (server === undefined) {
    return originalEnd.apply(this, args);
  }

  const callback = args[0];
  server.once('listening', () => {
    originalEnd.apply(this, args);
  });
  server.once('error', (error: Error) => {
    if (callback !== undefined) {
      callback(error, {} as request.Response);
      return;
    }
    test.emit('error', error);
  });
  return this;
};

afterAll(async () => {
  request.Test.prototype.serverAddress = originalServerAddress;
  request.Test.prototype.end = originalEnd;
  await Promise.all(
    Array.from(socketPaths, (socketPath) =>
      rm(socketPath, { force: true }).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }),
    ),
  );
  await rm(socketRoot, { recursive: true, force: true });
});

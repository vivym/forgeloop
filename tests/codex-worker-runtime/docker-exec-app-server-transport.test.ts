import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CodexAppServerDockerExecTransport } from '../../packages/codex-worker-runtime/src/docker-exec-app-server-transport';

describe('CodexAppServerDockerExecTransport', () => {
  it('proxies JSON-RPC through docker exec without putting socket details in an endpoint URL', async () => {
    const root = await mkdtemp(join(tmpdir(), 'forgeloop-docker-exec-transport-'));
    const argsPath = join(root, 'args.json');
    const fakeDocker = join(root, 'fake-docker.js');
    await writeFile(
      fakeDocker,
      `#!/usr/bin/env node
const crypto = require('node:crypto');
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(argsPath)}, JSON.stringify(process.argv.slice(2)));
const rpcPath = ${JSON.stringify(join(root, 'rpc.jsonl'))};
let buffer = '';
let upgraded = false;
const acceptKey = key => crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
const frame = payload => {
  const body = Buffer.from(payload, 'utf8');
  if (body.length >= 126) throw new Error('test_frame_too_large');
  return Buffer.concat([Buffer.from([0x81, body.length]), body]);
};
const decode = input => {
  const source = Buffer.from(input, 'binary');
  if (source.length < 2) return undefined;
  const masked = (source[1] & 0x80) !== 0;
  let length = source[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (source.length < offset + 2) return undefined;
    length = source.readUInt16BE(offset);
    offset += 2;
  }
  if (!masked || source.length < offset + 4 + length) return undefined;
  const mask = source.subarray(offset, offset + 4);
  const encoded = source.subarray(offset + 4, offset + 4 + length);
  const decoded = Buffer.alloc(encoded.length);
  for (let index = 0; index < encoded.length; index += 1) decoded[index] = encoded[index] ^ mask[index % 4];
  return { payload: decoded.toString('utf8'), remaining: source.subarray(offset + 4 + length).toString('binary') };
};
process.stdin.setEncoding('binary');
process.stdin.on('data', chunk => {
  buffer += chunk;
  if (!upgraded) {
    const headerEnd = buffer.indexOf('\\r\\n\\r\\n');
    if (headerEnd === -1) return;
    const headers = buffer.slice(0, headerEnd);
    const key = headers.match(/^Sec-WebSocket-Key: (.+)$/im)?.[1]?.trim();
    if (!key) process.exit(2);
    process.stdout.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      'Sec-WebSocket-Accept: ' + acceptKey(key),
      '',
      ''
    ].join('\\r\\n'));
    buffer = buffer.slice(headerEnd + 4);
    upgraded = true;
  }
  let decoded = decode(buffer);
  while (decoded) {
    const message = JSON.parse(decoded.payload);
    fs.appendFileSync(rpcPath, JSON.stringify(message) + '\\n');
    buffer = decoded.remaining;
    if (message.id !== undefined) {
      process.stdout.write(frame(JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        result: message.method === 'config/read'
          ? { config: { approval_policy: 'never' } }
          : { ok: true }
      })));
    }
    decoded = decode(buffer);
  }
});
`,
      { mode: 0o700 },
    );
    await chmod(fakeDocker, 0o700);

    const transport = new CodexAppServerDockerExecTransport({
      dockerBin: fakeDocker,
      containerId: 'container-1',
      socketContainerPath: '/run/forgeloop/codex.sock',
      handshakeTimeoutMs: 30_000,
    });
    try {
      await transport.initialize();
      await expect(transport.request('config/read', { includeLayers: false })).resolves.toEqual({
        config: { approval_policy: 'never' },
      });
    } finally {
      await transport.close();
    }

    await expect(readFile(argsPath, 'utf8').then(JSON.parse)).resolves.toEqual([
      'exec',
      '-i',
      'container-1',
      'codex',
      'app-server',
      'proxy',
      '--sock',
      '/run/forgeloop/codex.sock',
    ]);
    await expect(readFile(join(root, 'rpc.jsonl'), 'utf8')).resolves.toContain('"experimentalApi":true');
  });

  it('times out a docker exec proxy that never completes websocket upgrade', async () => {
    const root = await mkdtemp(join(tmpdir(), 'forgeloop-docker-exec-transport-hang-'));
    const fakeDocker = join(root, 'fake-docker.js');
    await writeFile(
      fakeDocker,
      `#!/usr/bin/env node
process.stdin.resume();
setInterval(() => {}, 1000);
`,
      { mode: 0o700 },
    );
    await chmod(fakeDocker, 0o700);

    const transport = new CodexAppServerDockerExecTransport({
      dockerBin: fakeDocker,
      containerId: 'container-1',
      socketContainerPath: '/run/forgeloop/codex.sock',
      handshakeTimeoutMs: 50,
    });
    try {
      await expect(transport.initialize()).rejects.toThrow(/codex_app_server_unavailable/);
    } finally {
      await transport.close().catch(() => undefined);
    }
  });
});

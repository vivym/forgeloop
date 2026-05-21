import { execFile as execFileCallback } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { CodexAppServerEndpointTransport, effectiveConfigFromResponse } from '../../packages/codex-runtime/src/index';

const execFile = promisify(execFileCallback);
const runDockerSmoke = process.env.FORGELOOP_RUN_REAL_DOCKER_SMOKE === '1';
const runCodexSmoke = process.env.FORGELOOP_RUN_REAL_CODEX_APP_SERVER_SMOKE === '1';
const dockerBin = process.env.FORGELOOP_DOCKER_BIN ?? 'docker';
const digestPattern = /^sha256:[a-f0-9]{64}$/;

const requiredEnv = (key: string): string => {
  const value = process.env[key]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`${key}_required_for_real_codex_smoke`);
  }
  return value;
};

describe.skipIf(!runDockerSmoke)('real Docker mechanics smoke', () => {
  it('talks to the configured Docker daemon', async () => {
    const { stdout } = await execFile(dockerBin, ['version', '--format', '{{.Server.Version}}'], { timeout: 20_000 });

    expect(stdout.trim().length).toBeGreaterThan(0);
  });
});

describe.skipIf(!runCodexSmoke)('real Dockerized Codex app-server smoke', () => {
  it('starts a pinned Codex app-server container and reads effective config over the task socket', async () => {
    const image = requiredEnv('FORGELOOP_REAL_CODEX_DOCKER_IMAGE');
    const imageDigest = requiredEnv('FORGELOOP_REAL_CODEX_DOCKER_IMAGE_DIGEST');
    if (!digestPattern.test(imageDigest)) {
      throw new Error('FORGELOOP_REAL_CODEX_DOCKER_IMAGE_DIGEST_must_be_pinned_sha256_digest');
    }
    const root = await mkdtemp(join(tmpdir(), 'forgeloop-real-codex-'));
    const codexHome = join(root, 'codex-home');
    const runDir = join(root, 'run');
    const socketPath = join(runDir, 'codex.sock');
    const containerName = `forgeloop-real-codex-${randomUUID()}`;
    await mkdir(codexHome, { recursive: true, mode: 0o700 });
    await mkdir(runDir, { recursive: true, mode: 0o700 });
    await writeFile(join(codexHome, 'config.toml'), 'approval_policy = "never"\n', { mode: 0o600 });
    await writeFile(join(codexHome, 'auth.json'), '{}\n', { mode: 0o600 });

    try {
      await execFile(
        dockerBin,
        [
          'run',
          '--rm',
          '--detach',
          '--name',
          containerName,
          '--network',
          'none',
          '--security-opt',
          'no-new-privileges',
          '--cap-drop',
          'ALL',
          '--env',
          'CODEX_HOME=/codex-home',
          '--volume',
          `${codexHome}:/codex-home:ro`,
          '--volume',
          `${runDir}:/run/forgeloop:rw`,
          `${image}@${imageDigest}`,
          'codex',
          'app-server',
          '--socket',
          '/run/forgeloop/codex.sock',
        ],
        { timeout: 30_000 },
      );
      const deadline = Date.now() + 15_000;
      while (Date.now() <= deadline) {
        const stat = await lstat(socketPath).catch(() => undefined);
        if (stat?.isSocket() === true) {
          break;
        }
        await delay(100);
      }
      expect((await lstat(socketPath)).isSocket()).toBe(true);
      const transport = new CodexAppServerEndpointTransport(`unix:${socketPath}`);
      try {
        await transport.initialize();
        let effectiveConfig: Record<string, unknown> | undefined;
        for (const method of ['getEffectiveConfig', 'codex/getEffectiveConfig', 'effective_config']) {
          try {
            const response = await transport.request(method, {});
            const parsed = effectiveConfigFromResponse(response);
            if (parsed !== undefined) {
              effectiveConfig = parsed as Record<string, unknown>;
              break;
            }
          } catch {
            // Try the next known effective-config method name.
          }
        }
        expect(effectiveConfig).toBeDefined();
      } finally {
        await transport.close().catch(() => undefined);
      }
    } finally {
      await execFile(dockerBin, ['rm', '-f', containerName], { timeout: 20_000 }).catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });
});

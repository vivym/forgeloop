import { execFile as execFileCallback } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { AppServerGenerationDriver, effectiveConfigFromResponse, type CodexGenerationRuntimeSafety } from '../../packages/codex-runtime/src/index';
import { CodexAppServerDockerExecTransport } from '../../packages/codex-worker-runtime/src/docker-exec-app-server-transport';

const execFile = promisify(execFileCallback);
const runDockerSmoke = process.env.FORGELOOP_RUN_REAL_DOCKER_SMOKE === '1';
const runCodexSmoke = process.env.FORGELOOP_RUN_REAL_CODEX_APP_SERVER_SMOKE === '1';
const runCodexGenerationSmoke = process.env.FORGELOOP_RUN_REAL_CODEX_APP_SERVER_GENERATION_SMOKE === '1';
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
  it('starts a pinned Codex app-server container and reads effective config through docker exec proxy', async () => {
    const image = requiredEnv('FORGELOOP_REAL_CODEX_DOCKER_IMAGE');
    const imageDigest = requiredEnv('FORGELOOP_REAL_CODEX_DOCKER_IMAGE_DIGEST');
    if (!digestPattern.test(imageDigest)) {
      throw new Error('FORGELOOP_REAL_CODEX_DOCKER_IMAGE_DIGEST_must_be_pinned_sha256_digest');
    }
    const root = await mkdtemp(join(tmpdir(), 'forgeloop-real-codex-'));
    const codexHome = join(root, 'codex-home');
    const containerName = `forgeloop-real-codex-${randomUUID()}`;
    await mkdir(codexHome, { recursive: true, mode: 0o700 });
    await writeFile(join(codexHome, 'config.toml'), 'approval_policy = "never"\n', { mode: 0o600 });
    await writeFile(join(codexHome, 'auth.json'), '{}\n', { mode: 0o600 });
    const hostUid = process.getuid?.();
    const hostGid = process.getgid?.();

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
          ...(hostUid === undefined || hostGid === undefined ? [] : ['--user', `${hostUid}:${hostGid}`]),
          '--security-opt',
          'no-new-privileges',
          '--cap-drop',
          'ALL',
          '--read-only',
          '--env',
          'CODEX_HOME=/codex-home',
          '--env',
          'HOME=/codex-home',
          '--tmpfs',
          `/codex-home:rw,noexec,nosuid,nodev,uid=${hostUid ?? 0},gid=${hostGid ?? 0},mode=700`,
          '--volume',
          `${codexHome}:/codex-seed:ro`,
          '--tmpfs',
          `/run/forgeloop:rw,noexec,nosuid,nodev,uid=${hostUid ?? 0},gid=${hostGid ?? 0},mode=700`,
          '--tmpfs',
          `/tmp:rw,nosuid,nodev,uid=${hostUid ?? 0},gid=${hostGid ?? 0},mode=1777`,
          `${image}@${imageDigest}`,
          'sh',
          '-ceu',
          'cp /codex-seed/config.toml /codex-home/config.toml && cp /codex-seed/auth.json /codex-home/auth.json && chmod 600 /codex-home/config.toml /codex-home/auth.json && exec "$@"',
          'forgeloop-codex-entrypoint',
          'codex',
          'app-server',
          '--listen',
          'unix:///run/forgeloop/codex.sock',
        ],
        { timeout: 30_000 },
      );
      const deadline = Date.now() + 15_000;
      let effectiveConfig: Record<string, unknown> | undefined;
      while (Date.now() <= deadline) {
        const transport = new CodexAppServerDockerExecTransport({
          dockerBin,
          containerId: containerName,
          socketContainerPath: '/run/forgeloop/codex.sock',
        });
        try {
          await transport.initialize();
          const response = await transport.request('config/read', { includeLayers: false });
          const parsed = effectiveConfigFromResponse(response);
          if (parsed !== undefined) {
            effectiveConfig = parsed as Record<string, unknown>;
            await transport.close().catch(() => undefined);
            break;
          }
        } catch {
          // App-server may not have created its container-local socket yet.
        } finally {
          await transport.close().catch(() => undefined);
        }
        await delay(100);
      }
      expect(effectiveConfig).toBeDefined();
    } finally {
      await execFile(dockerBin, ['rm', '-f', containerName], { timeout: 20_000 }).catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!runCodexGenerationSmoke)('real Dockerized Codex app-server generation smoke', () => {
  it('runs a generation turn through docker exec with isolated local Codex auth/config', async () => {
    const image = requiredEnv('FORGELOOP_REAL_CODEX_DOCKER_IMAGE');
    const imageDigest = requiredEnv('FORGELOOP_REAL_CODEX_DOCKER_IMAGE_DIGEST');
    if (!digestPattern.test(imageDigest)) {
      throw new Error('FORGELOOP_REAL_CODEX_DOCKER_IMAGE_DIGEST_must_be_pinned_sha256_digest');
    }
    const root = await mkdtemp(join(tmpdir(), 'forgeloop-real-codex-generation-'));
    const codexHome = join(root, 'codex-home');
    const hostCodexHome = process.env.FORGELOOP_REAL_CODEX_HOME ?? join(homedir(), '.codex');
    const containerName = `forgeloop-real-codex-generation-${randomUUID()}`;
    await mkdir(codexHome, { recursive: true, mode: 0o700 });
    await cp(join(hostCodexHome, 'config.toml'), join(codexHome, 'config.toml'));
    await cp(join(hostCodexHome, 'auth.json'), join(codexHome, 'auth.json'));
    await chmod(join(codexHome, 'config.toml'), 0o600);
    await chmod(join(codexHome, 'auth.json'), 0o600);
    const hostUid = process.getuid?.();
    const hostGid = process.getgid?.();

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
          'bridge',
          ...(hostUid === undefined || hostGid === undefined ? [] : ['--user', `${hostUid}:${hostGid}`]),
          '--security-opt',
          'no-new-privileges',
          '--cap-drop',
          'ALL',
          '--read-only',
          '--env',
          'CODEX_HOME=/codex-home',
          '--env',
          'HOME=/codex-home',
          '--tmpfs',
          `/codex-home:rw,noexec,nosuid,nodev,uid=${hostUid ?? 0},gid=${hostGid ?? 0},mode=700`,
          '--volume',
          `${codexHome}:/codex-seed:ro`,
          '--tmpfs',
          `/run/forgeloop:rw,noexec,nosuid,nodev,uid=${hostUid ?? 0},gid=${hostGid ?? 0},mode=700`,
          '--tmpfs',
          `/tmp:rw,nosuid,nodev,uid=${hostUid ?? 0},gid=${hostGid ?? 0},mode=1777`,
          `${image}@${imageDigest}`,
          'sh',
          '-ceu',
          'cp /codex-seed/config.toml /codex-home/config.toml && cp /codex-seed/auth.json /codex-home/auth.json && chmod 600 /codex-home/config.toml /codex-home/auth.json && exec "$@"',
          'forgeloop-codex-entrypoint',
          'codex',
          'app-server',
          '--listen',
          'unix:///run/forgeloop/codex.sock',
        ],
        { timeout: 30_000 },
      );

      let transport: CodexAppServerDockerExecTransport | undefined;
      const deadline = Date.now() + 15_000;
      while (Date.now() <= deadline) {
        const candidate = new CodexAppServerDockerExecTransport({
          dockerBin,
          containerId: containerName,
          socketContainerPath: '/run/forgeloop/codex.sock',
        });
        try {
          await candidate.initialize();
          transport = candidate;
          break;
        } catch {
          await candidate.close().catch(() => undefined);
        }
        await delay(100);
      }
      if (transport === undefined) {
        throw new Error('codex_app_server_unavailable');
      }
      const safety: CodexGenerationRuntimeSafety = {
        taskKind: 'plan_draft',
        actionRunId: 'real-codex-generation-smoke',
        projectId: 'project-1',
        repoIds: ['repo-1'],
        artifactRoot: '/artifacts',
        policyDigests: { 'repo-1': 'sha256:policy' },
        async createGenerationLease(input) {
          return { lease_id: 'lease-1', expires_at: input.expiresAt };
        },
        async consumeGenerationCommand() {},
      };
      const driver = new AppServerGenerationDriver({ transport, runtimeSafety: safety });
      const output = await driver.generate({
        taskKind: 'plan_draft',
        prompt: 'Return exactly this JSON and nothing else: {"forgeloop_generation_driver_probe":true}',
        outputSchemaVersion: 'plan_draft.v1',
        timeoutMs: 90_000,
        outputLimitBytes: 16_384,
        rawNotificationLimitBytes: 262_144,
      });
      await transport.close().catch(() => undefined);

      expect(output.extractedJson).toEqual({ forgeloop_generation_driver_probe: true });
    } finally {
      await execFile(dockerBin, ['rm', '-f', containerName], { timeout: 20_000 }).catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);
});

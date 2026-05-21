import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

import type { DockerCommand } from './docker-command.js';

export interface StartedDockerContainer {
  containerId: string;
  containerIdDigest: string;
  socketHostPath: string;
  appServerEndpoint?: string;
  labels?: Record<string, string>;
  stop(): Promise<void>;
}

export interface DockerRunner {
  start(input: DockerCommand): Promise<StartedDockerContainer>;
  listByLabel(labels: Record<string, string>): Promise<StartedDockerContainer[]>;
  run?(input: DockerCommand): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

const digest = (value: string): string => `sha256:${createHash('sha256').update(value).digest('hex')}`;

export class CliDockerRunner implements DockerRunner {
  constructor(private readonly dockerBin = 'docker') {}

  async start(input: DockerCommand): Promise<StartedDockerContainer> {
    const child = spawn(input.executable, input.args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    const errorChunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => errorChunks.push(chunk));
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    if (code !== 0) {
      throw new Error('codex_worker_docker_unavailable');
    }

    const containerId = Buffer.concat(chunks).toString('utf8').trim();
    const appServerEndpoint =
      input.internal?.websocketContainerPort === undefined ? undefined : await this.#inspectPublishedEndpoint(containerId, input.internal.websocketContainerPort);
    return {
      containerId,
      containerIdDigest: digest(containerId),
      socketHostPath: String(input.internal?.socketHostPath ?? ''),
      ...(appServerEndpoint === undefined ? {} : { appServerEndpoint }),
      stop: async () => {
        await new Promise<void>((resolve) => {
          const stop = spawn(input.executable, ['rm', '-f', containerId], { stdio: 'ignore' });
          stop.once('exit', () => resolve());
          stop.once('error', () => resolve());
        });
      },
    };
  }

  async listByLabel(labels: Record<string, string>): Promise<StartedDockerContainer[]> {
    const args = ['ps', '-aq'];
    for (const [key, value] of Object.entries(labels)) {
      args.push('--filter', `label=${key}=${value}`);
    }
    const child = spawn(this.dockerBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', () => resolve());
    });
    const containerIds = Buffer.concat(chunks)
      .toString('utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const inspected = await Promise.all(containerIds.map((containerId) => this.#inspectLabels(containerId).then((actualLabels) => ({ containerId, actualLabels }))));
    return inspected.map(({ containerId, actualLabels }) => ({
        containerId,
        containerIdDigest: digest(containerId),
        socketHostPath: '',
        labels: actualLabels,
        stop: async () => {
          await new Promise<void>((resolve) => {
            const stop = spawn(this.dockerBin, ['rm', '-f', containerId], { stdio: 'ignore' });
            stop.once('exit', () => resolve());
            stop.once('error', () => resolve());
          });
        },
      }));
  }

  async #inspectPublishedEndpoint(containerId: string, containerPort: number): Promise<string> {
    const child = spawn(this.dockerBin, ['port', containerId, `${containerPort}/tcp`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    const code = await new Promise<number | null>((resolve) => {
      child.once('error', () => resolve(1));
      child.once('exit', resolve);
    });
    if (code !== 0) {
      throw new Error('codex_worker_docker_unavailable');
    }
    const endpoint = Buffer.concat(chunks)
      .toString('utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .at(0);
    if (endpoint === undefined) {
      throw new Error('codex_worker_docker_unavailable');
    }
    const lastColon = endpoint.lastIndexOf(':');
    const port = lastColon === -1 ? undefined : endpoint.slice(lastColon + 1);
    if (port === undefined || !/^\d+$/.test(port)) {
      throw new Error('codex_worker_docker_unavailable');
    }
    return `ws://127.0.0.1:${port}`;
  }

  async run(input: DockerCommand): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const child = spawn(input.executable, input.args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    const errorChunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => errorChunks.push(chunk));
    const exitCode = await new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => resolve(code ?? 1));
    });
    return {
      exitCode,
      stdout: Buffer.concat(chunks).toString('utf8'),
      stderr: Buffer.concat(errorChunks).toString('utf8'),
    };
  }

  async #inspectLabels(containerId: string): Promise<Record<string, string>> {
    const child = spawn(this.dockerBin, ['inspect', '--format', '{{json .Config.Labels}}', containerId], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    const code = await new Promise<number | null>((resolve) => {
      child.once('error', () => resolve(1));
      child.once('exit', resolve);
    });
    if (code !== 0) {
      return {};
    }
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {};
      }
      return Object.fromEntries(
        Object.entries(parsed).flatMap(([key, value]) => (typeof value === 'string' ? [[key, value]] : [])),
      );
    } catch {
      return {};
    }
  }
}

import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { dirname } from 'node:path';

import type { DockerCommand } from './docker-command.js';
import type { DockerRunner, StartedDockerContainer } from './docker-runner.js';

const digest = (value: string): string => `sha256:${createHash('sha256').update(value).digest('hex')}`;

export class FakeDockerRunner implements DockerRunner {
  readonly startedCommands: DockerCommand[] = [];
  readonly stoppedContainerDigests: string[] = [];
  #listedContainers: StartedDockerContainer[] = [];

  constructor(
    readonly options: {
      effectiveConfig?: Record<string, unknown>;
    } = {},
  ) {}

  async start(input: DockerCommand): Promise<StartedDockerContainer> {
    this.startedCommands.push(input);
    const containerId = `fake-container-${this.startedCommands.length}`;
    const containerIdDigest = digest(containerId);
    const socketHostPath = input.internal?.socketHostPath ?? '';
    const appServerEndpoint =
      input.internal?.websocketContainerPort === undefined ? undefined : `ws://127.0.0.1:${input.internal.websocketContainerPort}`;
    let socketServer: Server | undefined;
    if (socketHostPath.length > 0) {
      await mkdir(dirname(socketHostPath), { recursive: true });
      socketServer = createServer();
      await new Promise<void>((resolve, reject) => {
        socketServer?.once('error', reject);
        socketServer?.listen(socketHostPath, resolve);
      });
    }
    return {
      containerId,
      containerIdDigest,
      socketHostPath,
      ...(appServerEndpoint === undefined ? {} : { appServerEndpoint }),
      stop: async () => {
        this.stoppedContainerDigests.push(containerIdDigest);
        await new Promise<void>((resolve) => {
          if (socketServer === undefined) {
            resolve();
            return;
          }
          socketServer.close(() => resolve());
        });
      },
    };
  }

  async listByLabel(): Promise<StartedDockerContainer[]> {
    return this.#listedContainers;
  }

  async run(input: DockerCommand): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    this.startedCommands.push(input);
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  addListedContainer(container: Omit<StartedDockerContainer, 'stop'> & { stop?: () => Promise<void> }): void {
    this.#listedContainers.push({
      ...container,
      stop: async () => {
        this.stoppedContainerDigests.push(container.containerIdDigest);
        await container.stop?.();
      },
    });
  }
}

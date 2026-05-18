import { createHash } from 'node:crypto';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ArtifactRef } from '@forgeloop/contracts';
import type { ArtifactWriter } from './artifact-writer.js';

export interface CodexRawLogStore {
  appendRawNotification(input: {
    runSessionId: string;
    source: 'app_server' | 'exec_fallback';
    payload: unknown;
  }): Promise<{ raw_ref: Record<string, unknown> }>;
  finalizeLogsArtifact(runSessionId: string): Promise<ArtifactRef | undefined>;
}

export interface LocalCodexRawLogStoreOptions {
  artifactRoot?: string;
  artifactWriter?: Pick<ArtifactWriter, 'writeText'>;
}

export class LocalCodexRawLogStore implements CodexRawLogStore {
  readonly #artifactRoot: string | undefined;
  readonly #artifactWriter: Pick<ArtifactWriter, 'writeText'> | undefined;
  readonly #digests = new Map<string, ReturnType<typeof createHash>>();
  readonly #counts = new Map<string, number>();
  readonly #bufferedLines = new Map<string, string[]>();

  constructor(options: LocalCodexRawLogStoreOptions) {
    this.#artifactRoot = options.artifactRoot;
    this.#artifactWriter = options.artifactWriter;
  }

  async appendRawNotification(input: {
    runSessionId: string;
    source: 'app_server' | 'exec_fallback';
    payload: unknown;
  }): Promise<{ raw_ref: Record<string, unknown> }> {
    const count = (this.#counts.get(input.runSessionId) ?? 0) + 1;
    this.#counts.set(input.runSessionId, count);

    const line = `${JSON.stringify({
      source: input.source,
      payload: input.payload,
    })}\n`;

    if (this.#artifactWriter !== undefined) {
      const lines = this.#bufferedLines.get(input.runSessionId) ?? [];
      lines.push(line);
      this.#bufferedLines.set(input.runSessionId, lines);
      return {
        raw_ref: {
          kind: 'codex_raw_notification',
          source: input.source,
          line: count,
        },
      };
    }

    if (this.#artifactRoot === undefined) {
      throw new Error('LocalCodexRawLogStore requires artifactRoot or artifactWriter.');
    }

    const runDirectory = join(this.#artifactRoot, input.runSessionId);
    const logPath = join(runDirectory, 'codex-raw.ndjson');
    await mkdir(runDirectory, { recursive: true });
    await writeFile(logPath, line, { flag: 'a' });

    let digest = this.#digests.get(input.runSessionId);
    if (digest === undefined) {
      digest = createHash('sha256');
      this.#digests.set(input.runSessionId, digest);
    }
    digest.update(line);

    return {
      raw_ref: {
        kind: 'codex_raw_notification',
        source: input.source,
        local_ref: logPath,
        line: count,
      },
    };
  }

  async finalizeLogsArtifact(runSessionId: string): Promise<ArtifactRef | undefined> {
    if (this.#artifactWriter !== undefined) {
      const lines = this.#bufferedLines.get(runSessionId);
      if (lines === undefined || lines.length === 0) {
        return undefined;
      }
      this.#bufferedLines.delete(runSessionId);
      this.#counts.delete(runSessionId);
      return this.#artifactWriter.writeText({
        kind: 'logs',
        name: 'codex-raw.ndjson',
        contentType: 'application/x-ndjson',
        content: lines.join(''),
        visibility: 'internal',
      });
    }

    if (this.#artifactRoot === undefined) {
      return undefined;
    }

    const logPath = join(this.#artifactRoot, runSessionId, 'codex-raw.ndjson');
    try {
      const stats = await stat(logPath);
      if (!stats.isFile()) {
        return undefined;
      }
    } catch {
      return undefined;
    }

    const digest = this.#digests.get(runSessionId)?.digest('hex');
    if (digest !== undefined) {
      this.#digests.delete(runSessionId);
    }

    const artifact: ArtifactRef = {
      kind: 'logs',
      name: 'codex-raw.ndjson',
      content_type: 'application/x-ndjson',
      local_ref: logPath,
    };

    if (digest !== undefined) {
      artifact.digest = `sha256:${digest}`;
    }

    return artifact;
  }
}

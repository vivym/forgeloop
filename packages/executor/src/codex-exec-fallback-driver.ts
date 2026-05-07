import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

import type { ExecutorFailure } from '../../contracts/src/executor.js';

import { normalizeCodexExecJsonLine } from './codex-event-normalizer.js';
import type { CodexRawLogStore } from './codex-raw-log-store.js';
import type {
  CodexDriverStartInput,
  CodexDriverStreamItem,
  CodexSessionDriver,
  RunRuntimeMetadata,
} from './codex-session-driver.js';

export const buildCodexExecArgs = (input: { prompt: string; threadId?: string }): string[] =>
  input.threadId === undefined
    ? ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', input.prompt]
    : ['exec', 'resume', input.threadId, '--json', '--dangerously-bypass-approvals-and-sandbox', input.prompt];

export interface CodexExecFallbackDriverOptions {
  codexBinary?: string;
  rawLogStore?: CodexRawLogStore;
}

const failureFromExit = (code: number | null, signal: NodeJS.Signals | null): ExecutorFailure => ({
  kind: 'executor_process_failed',
  message: signal === null ? `Codex exec exited with code ${code ?? 'unknown'}` : `Codex exec exited on signal ${signal}`,
  retryable: true,
});

export class CodexExecFallbackDriver implements CodexSessionDriver {
  readonly kind = 'exec_fallback' as const;
  readonly #codexBinary: string;
  readonly #rawLogStore: CodexRawLogStore | undefined;

  constructor(options: CodexExecFallbackDriverOptions = {}) {
    this.#codexBinary = options.codexBinary ?? 'codex';
    this.#rawLogStore = options.rawLogStore;
  }

  async *startRun(input: CodexDriverStartInput): AsyncIterable<CodexDriverStreamItem> {
    yield* this.#runCodexExec(input, buildCodexExecArgs({ prompt: input.runSpec.objective }));
  }

  async *resumeRun(input: CodexDriverStartInput): AsyncIterable<CodexDriverStreamItem> {
    const threadId = input.runtimeMetadata?.codex_thread_id;
    if (threadId === undefined) {
      yield {
        kind: 'terminal',
        status: 'failed',
        summary: 'Cannot resume Codex exec fallback without a thread id.',
        failure: {
          kind: 'executor_error',
          message: 'Missing runtimeMetadata.codex_thread_id for Codex exec resume.',
          retryable: false,
        },
      };
      return;
    }

    yield* this.#runCodexExec(input, buildCodexExecArgs({ prompt: input.runSpec.objective, threadId }));
  }

  async sendInput(input: {
    message: string;
    runtimeMetadata: RunRuntimeMetadata;
    targetTurnId?: string;
  }): Promise<Record<string, unknown>> {
    const threadId = input.runtimeMetadata.codex_thread_id;
    if (threadId === undefined) {
      throw new Error('Cannot continue Codex exec fallback without runtimeMetadata.codex_thread_id.');
    }

    const args = buildCodexExecArgs({ prompt: input.message, threadId });
    const child = spawn(this.#codexBinary, args, {
      stdio: ['ignore', 'ignore', 'ignore'],
    });

    return {
      continuity: 'resume_fallback',
      threadId,
      pid: child.pid,
      args,
    };
  }

  async cancelRun(input: { runtimeMetadata: RunRuntimeMetadata }): Promise<Record<string, unknown>> {
    return {
      acknowledged: true,
      continuity: 'exec_fallback_cancel_not_supported',
      threadId: input.runtimeMetadata.codex_thread_id,
    };
  }

  async *#runCodexExec(input: CodexDriverStartInput, args: string[]): AsyncIterable<CodexDriverStreamItem> {
    const child = spawn(this.#codexBinary, args, {
      cwd: input.workspacePath,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const lines = createInterface({ input: child.stdout });
    const stderrLines = createInterface({ input: child.stderr });
    let stderr = '';

    stderrLines.on('line', (line) => {
      stderr = stderr.length === 0 ? line : `${stderr}\n${line}`;
    });

    for await (const line of lines) {
      const rawRef = await this.#rawLogStore?.appendRawNotification({
        runSessionId: input.runSpec.run_session_id,
        source: 'exec_fallback',
        payload: line,
      });

      for (const event of normalizeCodexExecJsonLine(line)) {
        if (rawRef !== undefined) {
          event.raw_ref = rawRef.raw_ref;
        }
        yield { kind: 'event', event };
      }
    }

    const terminal = await new Promise<CodexDriverStreamItem>((resolve) => {
      child.once('close', (code, signal) => {
        if (code === 0 && signal === null) {
          resolve({
            kind: 'terminal',
            status: 'succeeded',
            summary: 'Codex exec fallback completed.',
          });
          return;
        }

        resolve({
          kind: 'terminal',
          status: 'failed',
          summary: 'Codex exec fallback failed.',
          failure: {
            ...failureFromExit(code, signal),
            message: stderr.length > 0 ? stderr : failureFromExit(code, signal).message,
          },
        });
      });
    });

    yield terminal;
  }
}

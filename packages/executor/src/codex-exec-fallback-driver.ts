import type { ExecutorFailure } from '@forgeloop/contracts';
import type { RunRuntimeMetadata } from '@forgeloop/domain';

import type {
  CodexDriverStartInput,
  CodexDriverStreamItem,
  CodexSessionDriver,
} from './codex-session-driver.js';
import type { LocalCodexRuntimeSafety } from './local-codex-preflight.js';
import {
  materializeTrustedToolchainCommand,
  structuredCommandDigest,
  type StructuredCommandSpec,
} from './structured-command.js';

export const buildCodexExecArgs = (input: { promptRef: string; threadId?: string }): string[] =>
  input.threadId === undefined
    ? ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', '--prompt-artifact', input.promptRef]
    : ['exec', 'resume', input.threadId, '--json', '--dangerously-bypass-approvals-and-sandbox', '--prompt-artifact', input.promptRef];

export interface CodexExecFallbackDriverOptions {
  runtimeSafety?: LocalCodexRuntimeSafety;
}

interface FrozenFallbackPolicy {
  mode?: string;
  command?: StructuredCommandSpec;
}

const fallbackDeniedFailure = (): ExecutorFailure => ({
  kind: 'executor_error',
  message: 'fallback_denied_by_policy: codex_exec fallback is not allowed by the frozen runtime policy.',
  retryable: false,
});

const fallbackProcessFailure = (summary: string): ExecutorFailure => ({
  kind: 'executor_process_failed',
  message: summary,
  retryable: true,
});

const artifactRefString = (artifact: { storage_uri?: string | undefined; local_ref?: string | undefined; name: string }): string => {
  const ref = artifact.storage_uri ?? artifact.local_ref;
  if (ref === undefined) {
    throw new Error(`Artifact ${artifact.name} does not have a storage_uri or local_ref.`);
  }
  return ref;
};

export class CodexExecFallbackDriver implements CodexSessionDriver {
  readonly kind = 'exec_fallback' as const;
  readonly #runtimeSafety: LocalCodexRuntimeSafety | undefined;

  constructor(options: CodexExecFallbackDriverOptions = {}) {
    this.#runtimeSafety = options.runtimeSafety;
  }

  async *startRun(input: CodexDriverStartInput): AsyncIterable<CodexDriverStreamItem> {
    yield* this.#runCodexExec(input, input.runSpec.objective);
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

    yield* this.#runCodexExec(input, input.runSpec.objective, threadId);
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

    throw new Error(`fallback_denied_by_policy: governed exec fallback continuation is not available for thread ${threadId}.`);
  }

  async cancelRun(input: { runtimeMetadata: RunRuntimeMetadata }): Promise<Record<string, unknown>> {
    return {
      acknowledged: true,
      continuity: 'exec_fallback_cancel_not_supported',
      threadId: input.runtimeMetadata.codex_thread_id,
    };
  }

  async *#runCodexExec(input: CodexDriverStartInput, prompt: string, threadId?: string): AsyncIterable<CodexDriverStreamItem> {
    const runtimeSafety = this.#runtimeSafety;
    const fallbackPolicy = runtimeSafety?.frozenSnapshot?.fallback_policy as FrozenFallbackPolicy | undefined;
    if (runtimeSafety === undefined || fallbackPolicy?.mode !== 'codex_exec' || fallbackPolicy.command === undefined) {
      const failure = fallbackDeniedFailure();
      yield {
        kind: 'terminal',
        status: 'failed',
        summary: failure.message,
        failure,
      };
      return;
    }

    try {
      const promptArtifact = await runtimeSafety.artifactWriter.writeText({
        kind: 'raw_metadata',
        name: 'codex-exec-fallback-prompt.txt',
        contentType: 'text/plain',
        content: prompt,
        visibility: 'internal',
      });
      const promptRef = artifactRefString(promptArtifact);
      const commandContext = {
        ...runtimeSafety.hookCommandContext,
        workspaceRoot: input.workspacePath,
      };
      const command = materializeTrustedToolchainCommand({
        command: {
          ...fallbackPolicy.command,
          args: buildCodexExecArgs({ promptRef, ...(threadId === undefined ? {} : { threadId }) }),
          visibility: 'internal',
        },
        toolchain: commandContext.trustedToolchains,
        workspaceRoot: input.workspacePath,
        artifactRoot: commandContext.artifactRoot,
        hardCaps: {
          hardMaxTimeoutMs: commandContext.resourceLimits.timeout_ms,
          hardMaxOutputLimitBytes: commandContext.resourceLimits.run_output_limit_bytes,
        },
      });
      const commandDigest = structuredCommandDigest({
        command,
        resource_limit_digest: commandContext.resourceLimitDigest,
        run_id: commandContext.runId,
        workspace_root: commandContext.workspaceRoot,
        artifact_root: commandContext.artifactRoot,
        sandbox_output_root_policy: commandContext.sandboxOutputRootPolicy,
        artifact_quota_policy: commandContext.artifactQuotaPolicy,
      });
      const result = await runtimeSafety.runGovernor.run({
        scope: 'run',
        command,
        bindings: {
          ...commandContext,
          commandId: 'fallback:codex_exec',
          commandDigest,
        },
        outputImporter: runtimeSafety.artifactWriter,
        sandboxOutputArtifacts: {
          stdout: { kind: 'logs', name: 'codex-exec-fallback-stdout.txt', visibility: 'internal' },
          stderr: { kind: 'logs', name: 'codex-exec-fallback-stderr.txt', visibility: 'internal' },
        },
        ...(runtimeSafety.mockRunContext === undefined ? {} : { mockRunContext: runtimeSafety.mockRunContext }),
      });

      if (result.timed_out || result.exit_code !== 0) {
        const failure = fallbackProcessFailure(result.public_summary);
        yield {
          kind: 'terminal',
          status: result.timed_out ? 'cancelled' : 'failed',
          summary: result.public_summary,
          failure,
        };
        return;
      }

      yield {
        kind: 'terminal',
        status: 'succeeded',
        summary: result.public_summary,
      };
    } catch {
      const failure = fallbackProcessFailure('Codex exec fallback failed.');
      yield {
        kind: 'terminal',
        status: 'failed',
        summary: 'Codex exec fallback failed.',
        failure,
      };
    }
  }
}

import { setTimeout as delay } from 'node:timers/promises';

import { describe, expect, it, vi } from 'vitest';

import {
  createCodexGenerationRuntime,
  type CodexAppServerTransport,
} from '../../packages/codex-runtime/src/index';

const planInput = {
  actionRunId: 'action-1',
  projectId: 'project-1',
  repoIds: ['repo-main'],
  promptVersion: 'plan-draft.app-server.v1',
  outputSchemaVersion: 'plan_draft.v1',
  policyDigests: { 'repo-main': 'sha256:policy' },
  context: {
    work_item: { id: 'work-1', title: 'Runtime', goal: 'Generate Plan', success_criteria: ['Plan exists'] },
    spec_revision: { id: 'spec-rev-1', risk_notes: ['Keep gates'] },
  },
};

const validPlanJson = JSON.stringify({
  schema_version: 'plan_draft.v1',
  summary: 'Plan summary',
  content: 'Plan body',
  implementation_summary: 'Implement safely',
  split_strategy: 'Split by package boundary',
  dependency_order: ['api', 'tests'],
  test_matrix: ['pnpm test tests/api'],
  risk_mitigations: ['Keep writes scoped'],
  rollback_notes: 'Revert package commits',
});

describe('createCodexGenerationRuntime', () => {
  it('uses app-server transport and action-scoped safety for Plan generation', async () => {
    const endpoints: string[] = [];
    const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
    const transportFactory = vi.fn((endpoint: string): CodexAppServerTransport => {
      endpoints.push(endpoint);
      return {
        async request(method, params) {
          requests.push({ method, params });
          if (method === 'thread/start') {
            return { threadId: 'thread-1', effectiveConfig: { sandboxPolicy: { type: 'readOnly' } } };
          }
          return { turnId: 'turn-1', effectiveConfig: { sandboxPolicy: { type: 'readOnly' } } };
        },
        notifications: async function* () {
          yield { type: 'assistant_message_delta', delta: validPlanJson };
          yield { type: 'turn_completed', status: 'completed' };
        },
        async close() {},
      };
    });
    const runtime = createCodexGenerationRuntime({
      mode: 'app_server',
      appServerEndpoint: 'unix:/tmp/codex-app-server.sock',
      artifactRoot: '/tmp/forgeloop-artifacts',
      timeoutMs: 250,
      outputLimitBytes: 4_096,
      rawNotificationLimitBytes: 8_192,
      transportFactory,
    });

    const result = await runtime.generatePlanDraft(planInput);

    expect(result).toMatchObject({
      taskKind: 'plan_draft',
      promptVersion: 'plan-draft.app-server.v1',
      outputSchemaVersion: 'plan_draft.v1',
      generated: { schema_version: 'plan_draft.v1', dependency_order: ['api', 'tests'] },
    });
    expect(endpoints).toEqual(['unix:/tmp/codex-app-server.sock']);
    expect(requests.map((request) => request.method)).toEqual(['thread/start', 'turn/start']);
    expect(requests[0]?.params).toMatchObject({ approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly' } });
  });

  it('maps app-server schema-invalid Plan output to generated_output_schema_invalid', async () => {
    const runtime = createCodexGenerationRuntime({
      mode: 'app_server',
      appServerEndpoint: 'unix:/tmp/codex-app-server.sock',
      artifactRoot: '/tmp/forgeloop-artifacts',
      timeoutMs: 250,
      outputLimitBytes: 4_096,
      rawNotificationLimitBytes: 8_192,
      transportFactory: () => ({
        async request(method) {
          if (method === 'thread/start') {
            return { threadId: 'thread-1', effectiveConfig: { sandboxPolicy: { type: 'readOnly' } } };
          }
          return { turnId: 'turn-1', effectiveConfig: { sandboxPolicy: { type: 'readOnly' } } };
        },
        notifications: async function* () {
          yield { type: 'assistant_message_delta', delta: '{"schema_version":"plan_draft.v1","summary":"missing fields"}' };
          yield { type: 'turn_completed', status: 'completed' };
        },
        async close() {},
      }),
    });

    await expect(runtime.generatePlanDraft(planInput)).rejects.toMatchObject({
      code: 'generated_output_schema_invalid',
      retryable: true,
      publicResultJson: { status: 422, code: 'generated_output_schema_invalid' },
    });
  });

  it('maps ambiguous app-server JSON output to a public retryable generated output error', async () => {
    const runtime = createCodexGenerationRuntime({
      mode: 'app_server',
      appServerEndpoint: 'unix:/tmp/codex-app-server.sock',
      artifactRoot: '/tmp/forgeloop-artifacts',
      timeoutMs: 250,
      outputLimitBytes: 4_096,
      rawNotificationLimitBytes: 8_192,
      transportFactory: () => ({
        async request(method) {
          if (method === 'thread/start') {
            return { threadId: 'thread-1', effectiveConfig: { sandboxPolicy: { type: 'readOnly' } } };
          }
          return { turnId: 'turn-1', effectiveConfig: { sandboxPolicy: { type: 'readOnly' } } };
        },
        notifications: async function* () {
          yield { type: 'assistant_message_delta', delta: '{"a":1}{"b":2}' };
          yield { type: 'turn_completed', status: 'completed' };
        },
        async close() {},
      }),
    });

    await expect(runtime.generatePlanDraft(planInput)).rejects.toMatchObject({
      code: 'generated_output_ambiguous',
      retryable: true,
      publicResultJson: { status: 422, code: 'generated_output_ambiguous' },
    });
  });

  it('maps deterministic app-server output limits to public non-retryable errors', async () => {
    const runtime = createCodexGenerationRuntime({
      mode: 'app_server',
      appServerEndpoint: 'unix:/tmp/codex-app-server.sock',
      artifactRoot: '/tmp/forgeloop-artifacts',
      timeoutMs: 250,
      outputLimitBytes: 32,
      rawNotificationLimitBytes: 8_192,
      transportFactory: () => ({
        async request(method) {
          if (method === 'thread/start') {
            return { threadId: 'thread-1', effectiveConfig: { sandboxPolicy: { type: 'readOnly' } } };
          }
          return { turnId: 'turn-1', effectiveConfig: { sandboxPolicy: { type: 'readOnly' } } };
        },
        notifications: async function* () {
          yield { type: 'assistant_message_delta', delta: '{"schema_version":"plan_draft.v1","summary":"' };
          yield { type: 'assistant_message_delta', delta: 'x'.repeat(80) };
          yield { type: 'turn_completed', status: 'completed' };
        },
        async close() {},
      }),
    });

    await expect(runtime.generatePlanDraft(planInput)).rejects.toMatchObject({
      code: 'generated_output_too_large',
      retryable: false,
      publicResultJson: { status: 422, code: 'generated_output_too_large' },
    });
  });

  it('enforces runtime-level generation concurrency', async () => {
    const runtime = createCodexGenerationRuntime({
      mode: 'app_server',
      appServerEndpoint: 'unix:/tmp/codex-app-server.sock',
      artifactRoot: '/tmp/forgeloop-artifacts',
      timeoutMs: 100,
      maxConcurrency: 1,
      transportFactory: () => ({
        async request(method) {
          if (method === 'thread/start') {
            return { threadId: 'thread-1', effectiveConfig: { sandboxPolicy: { type: 'readOnly' } } };
          }
          return { turnId: 'turn-1', effectiveConfig: { sandboxPolicy: { type: 'readOnly' } } };
        },
        notifications: async function* () {
          await new Promise(() => undefined);
        },
        async close() {},
      }),
    });

    const firstGeneration = runtime.generatePlanDraft(planInput);
    await delay(5);
    await expect(runtime.generatePlanDraft(planInput)).rejects.toThrow(/codex_generation_concurrency_limit_exceeded/);
    await expect(firstGeneration).rejects.toThrow(/codex_generation_timeout/);
  });

  it('blocks app-server runtime when action policy digests are missing', async () => {
    const runtime = createCodexGenerationRuntime({
      mode: 'app_server',
      appServerEndpoint: 'unix:/tmp/codex-app-server.sock',
      artifactRoot: '/tmp/forgeloop-artifacts',
      transportFactory: () => {
        throw new Error('transport should not be created before safety validation');
      },
    });

    await expect(runtime.generatePlanDraft({ ...planInput, policyDigests: {} })).rejects.toThrow(
      /codex_generation_safety_unavailable/,
    );
  });
});

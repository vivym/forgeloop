import { setTimeout as delay } from 'node:timers/promises';

import { describe, expect, it, vi } from 'vitest';

import {
  createCodexGenerationRuntime,
  type CodexAppServerTransport,
} from '../../packages/codex-runtime/src/index';
import { extractSingleJsonObject } from '../../packages/codex-runtime/src/json-output';
import {
  validateGeneratedExecutionPlanRevision,
  validateGeneratedSpecRevision,
} from '../../packages/codex-runtime/src/payloads';

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

const boundaryInput = {
  ...planInput,
  promptVersion: 'boundary-round.app-server.v1',
  outputSchemaVersion: 'boundary_round_result.v1',
  context: {
    session_id: 'boundary-session-1',
    round_id: 'round-1',
    transcript: [],
  },
};

const validBoundaryJson = JSON.stringify({
  schema_version: 'boundary_round_result.v1',
  session_id: 'boundary-session-1',
  round_id: 'round-1',
  questions: [{ text: 'Confirm API scope?', required: true }],
  proposed_decisions: [{ text: 'Keep execution out of scope.' }],
  needs_leader_input: true,
  public_summary: 'Generated boundary round.',
  artifacts: [],
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
    expect(requests[0]?.params).toMatchObject({ approvalPolicy: 'never', sandbox: 'read-only' });
  });

  it('uses app-server transport for Boundary Brainstorming round generation', async () => {
    const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
    const runtime = createCodexGenerationRuntime({
      mode: 'app_server',
      appServerEndpoint: 'unix:/tmp/codex-app-server.sock',
      artifactRoot: '/tmp/forgeloop-artifacts',
      timeoutMs: 250,
      outputLimitBytes: 4_096,
      rawNotificationLimitBytes: 8_192,
      transportFactory: (): CodexAppServerTransport => ({
        async request(method, params) {
          requests.push({ method, params });
          if (method === 'thread/start') {
            return { threadId: 'thread-1', effectiveConfig: { sandboxPolicy: { type: 'readOnly' } } };
          }
          return { turnId: 'turn-1', effectiveConfig: { sandboxPolicy: { type: 'readOnly' } } };
        },
        notifications: async function* () {
          yield { type: 'assistant_message_delta', delta: validBoundaryJson };
          yield { type: 'turn_completed', status: 'completed' };
        },
        async close() {},
      }),
    });

    const result = await runtime.generateBoundaryBrainstormingRound(boundaryInput);

    expect(result).toMatchObject({
      taskKind: 'boundary_brainstorming_round',
      promptVersion: 'boundary-round.app-server.v1',
      outputSchemaVersion: 'boundary_round_result.v1',
      generated: { schema_version: 'boundary_round_result.v1', session_id: 'boundary-session-1' },
    });
    const turnInput = requests[1]?.params.input;
    expect(turnInput).toEqual([expect.objectContaining({ text: expect.any(String) })]);
    const promptText = Array.isArray(turnInput) && typeof turnInput[0]?.text === 'string' ? turnInput[0].text : '';
    expect(promptText).toContain('Return exactly one JSON object');
    expect(promptText).toContain('"schema_version": "boundary_round_result.v1"');
    expect(promptText).toContain('"session_id"');
    expect(promptText).toContain('"round_id"');
    expect(promptText).toContain('"questions"');
    expect(promptText).toContain('"context": {');
    expect(promptText).toContain('"session_id": "boundary-session-1"');
    expect(promptText).toContain('"round_id": "round-1"');
  });

  it('keeps Boundary Brainstorming start contracts question-first even when Leader input says rebase', async () => {
    const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
    const runtime = createCodexGenerationRuntime({
      mode: 'app_server',
      appServerEndpoint: 'unix:/tmp/codex-app-server.sock',
      artifactRoot: '/tmp/forgeloop-artifacts',
      timeoutMs: 250,
      outputLimitBytes: 4_096,
      rawNotificationLimitBytes: 8_192,
      transportFactory: (): CodexAppServerTransport => ({
        async request(method, params) {
          requests.push({ method, params });
          if (method === 'thread/start') {
            return { threadId: 'thread-1', effectiveConfig: { sandboxPolicy: { type: 'readOnly' } } };
          }
          return { turnId: 'turn-1', effectiveConfig: { sandboxPolicy: { type: 'readOnly' } } };
        },
        notifications: async function* () {
          yield { type: 'assistant_message_delta', delta: validBoundaryJson };
          yield { type: 'turn_completed', status: 'completed' };
        },
        async close() {},
      }),
    });

    await runtime.generateBoundaryBrainstormingRound({
      ...boundaryInput,
      context: {
        ...boundaryInput.context,
        operation: 'start',
        leader_input: {
          summary: 'Rebase the strict Codex runtime dogfood boundary after the Development Plan Item revision changed.',
        },
      },
    });

    const turnInput = requests[1]?.params.input;
    const promptText = Array.isArray(turnInput) && typeof turnInput[0]?.text === 'string' ? turnInput[0].text : '';
    expect(promptText).toContain('"needs_leader_input": true');
    expect(promptText).not.toContain('"summary_proposal"');
  });

  it('places exact product-generation JSON contract after request context', async () => {
    const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
    const runtime = createCodexGenerationRuntime({
      mode: 'app_server',
      appServerEndpoint: 'unix:/tmp/codex-app-server.sock',
      artifactRoot: '/tmp/forgeloop-artifacts',
      timeoutMs: 250,
      outputLimitBytes: 4_096,
      rawNotificationLimitBytes: 8_192,
      transportFactory: (): CodexAppServerTransport => ({
        async request(method, params) {
          requests.push({ method, params });
          if (method === 'thread/start') {
            return { threadId: 'thread-1', effectiveConfig: { sandboxPolicy: { type: 'readOnly' } } };
          }
          return { turnId: 'turn-1', effectiveConfig: { sandboxPolicy: { type: 'readOnly' } } };
        },
        notifications: async function* () {
          yield {
            type: 'assistant_message_delta',
            delta: JSON.stringify({
              schema_version: 'spec_revision.v1',
              development_plan_item_id: 'item-1',
              boundary_summary_revision_id: 'boundary-summary-revision-1',
              summary: 'Generated Spec revision',
              content_markdown: 'Implement the approved boundary.',
              problem_context: 'The Development Plan Item needs a Spec revision.',
              scope_in: ['Spec generation'],
              scope_out: ['Execution'],
              acceptance_criteria: ['Draft Spec revision is created'],
              test_strategy: ['API writer tests'],
              risks: ['Stale boundary'],
              assumptions: ['Leader approved boundary summary'],
              unresolved_questions: [],
              public_summary: 'Generated a Spec revision.',
            }),
          };
          yield { type: 'turn_completed', status: 'completed' };
        },
        async close() {},
      }),
    });

    await runtime.generateDevelopmentPlanItemSpecRevision({
      ...planInput,
      promptVersion: 'development-plan-item-spec-revision.app-server.v1',
      outputSchemaVersion: 'spec_revision.v1',
      context: {
        development_plan_item: { id: 'item-1' },
        boundary_brainstorming: { approved_summary_revision_id: 'boundary-summary-revision-1' },
      },
    });

    const turnInput = requests[1]?.params.input;
    const promptText = Array.isArray(turnInput) && typeof turnInput[0]?.text === 'string' ? turnInput[0].text : '';
    expect(promptText.indexOf('Request context JSON:')).toBeLessThan(promptText.indexOf('Output schema contract:'));
    expect(promptText).toContain('Return exactly the JSON object below.');
    expect(promptText).toContain('"boundary_summary_revision_id": "boundary-summary-revision-1"');
    expect(promptText).not.toContain('"boundary_summary_revision_id": "boundary-summary-revision-id"');
    expect(promptText.trim()).toMatch(/"public_summary": "Spec revision generated for reviewer approval\."\s*}\s*$/);
    const contractText = promptText.slice(promptText.indexOf('Output schema contract:'));
    const contractJson = contractText.slice(contractText.indexOf('{'));
    expect(() => validateGeneratedSpecRevision(extractSingleJsonObject(contractJson))).not.toThrow();
  });

  it('uses approved Spec revision id from the signed context in Implementation Plan Doc contracts', async () => {
    const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
    const runtime = createCodexGenerationRuntime({
      mode: 'app_server',
      appServerEndpoint: 'unix:/tmp/codex-app-server.sock',
      artifactRoot: '/tmp/forgeloop-artifacts',
      timeoutMs: 250,
      outputLimitBytes: 4_096,
      rawNotificationLimitBytes: 8_192,
      transportFactory: (): CodexAppServerTransport => ({
        async request(method, params) {
          requests.push({ method, params });
          if (method === 'thread/start') {
            return { threadId: 'thread-1', effectiveConfig: { sandboxPolicy: { type: 'readOnly' } } };
          }
          return { turnId: 'turn-1', effectiveConfig: { sandboxPolicy: { type: 'readOnly' } } };
        },
        notifications: async function* () {
          yield {
            type: 'assistant_message_delta',
            delta: JSON.stringify({
              schema_version: 'execution_plan_revision.v1',
              development_plan_item_id: 'item-1',
              based_on_spec_revision_id: 'spec-revision-1',
              summary: 'Generated Implementation Plan Doc revision',
              content_markdown: 'Implement the approved Spec.',
              implementation_sequence: ['Update scoped implementation'],
              validation_strategy: ['Run focused tests'],
              allowed_paths: ['docs/superpowers/reports'],
              forbidden_paths: ['apps'],
              required_checks: [{ check_id: 'focused-tests', command: 'pnpm test', timeout_seconds: 120, blocks_review: true }],
              rollback_notes: 'Revert scoped changes if validation fails.',
              handoff_criteria: ['Required checks pass'],
              public_summary: 'Generated an Implementation Plan Doc revision.',
            }),
          };
          yield { type: 'turn_completed', status: 'completed' };
        },
        async close() {},
      }),
    });

    await runtime.generateDevelopmentPlanItemExecutionPlanRevision({
      ...planInput,
      promptVersion: 'development-plan-item-execution-plan-revision.app-server.v1',
      outputSchemaVersion: 'execution_plan_revision.v1',
      context: {
        development_plan_item: { id: 'item-1' },
        approved_spec_revision: { id: 'spec-revision-1' },
        path_policy: {
          allowed_paths: ['packages/codex-runtime/src/**'],
          forbidden_paths: ['packages/db/migrations/**'],
        },
      },
    });

    const turnInput = requests[1]?.params.input;
    const promptText = Array.isArray(turnInput) && typeof turnInput[0]?.text === 'string' ? turnInput[0].text : '';
    expect(promptText).toContain('"based_on_spec_revision_id": "spec-revision-1"');
    expect(promptText).not.toContain('"based_on_spec_revision_id": "approved-spec-revision-id"');
    expect(promptText).toContain('"packages/codex-runtime/src/**"');
    expect(promptText).toContain('"packages/db/migrations/**"');
    expect(promptText).not.toContain('"docs/**"');
    expect(promptText).not.toContain('"apps"');
    expect(promptText).toContain('"timeout_seconds": 120');
    expect(promptText).not.toContain('"timeout_seconds": 600');
    const contractText = promptText.slice(promptText.indexOf('Output schema contract:'));
    const contractJson = contractText.slice(contractText.indexOf('{'));
    expect(() => validateGeneratedExecutionPlanRevision(extractSingleJsonObject(contractJson))).not.toThrow();
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

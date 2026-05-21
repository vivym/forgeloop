import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import {
  AppServerGenerationDriver,
  type CodexAppServerTransport,
  type CodexGenerationRuntimeSafety,
} from '../../packages/codex-runtime/src/index';

const execFile = promisify(execFileCallback);
const runSchemaSmoke = process.env.FORGELOOP_RUN_REAL_CODEX_APP_SERVER_SCHEMA === '1';
const codexBin = process.env.FORGELOOP_CODEX_BIN ?? 'codex';

const readJson = async (path: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;

const fakeSafety = (): CodexGenerationRuntimeSafety => ({
  taskKind: 'plan_draft',
  actionRunId: 'schema-smoke-action',
  projectId: 'schema-smoke-project',
  repoIds: ['schema-smoke-repo'],
  artifactRoot: '/tmp/forgeloop-schema-smoke-artifacts',
  policyDigests: { 'schema-smoke-repo': 'sha256:policy' },
  async createGenerationLease(input) {
    return { lease_id: 'schema-smoke-lease', expires_at: input.expiresAt };
  },
  async consumeGenerationCommand() {},
});

describe.skipIf(!runSchemaSmoke)('real Codex app-server generated schema smoke', () => {
  it('typechecks ForgeLoop request shapes against generated Codex app-server bindings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'forgeloop-codex-app-server-schema-'));
    const schemaDir = join(root, 'schema');
    const tsDir = join(root, 'ts');
    await mkdir(schemaDir, { recursive: true });
    await mkdir(tsDir, { recursive: true });

    try {
      const { stdout: version } = await execFile(codexBin, ['--version'], { timeout: 20_000 });
      expect(version.trim()).toMatch(/^codex-cli 0\.132\./);
      await execFile(codexBin, ['app-server', 'generate-json-schema', '--out', schemaDir], { timeout: 30_000 });
      await execFile(codexBin, ['app-server', 'generate-ts', '--out', tsDir], { timeout: 30_000 });

      const threadStart = await readJson(join(schemaDir, 'v2', 'ThreadStartParams.json'));
      const turnStart = await readJson(join(schemaDir, 'v2', 'TurnStartParams.json'));
      const configRead = await readJson(join(schemaDir, 'v2', 'ConfigReadParams.json'));
      expect(Object.keys((threadStart.properties as Record<string, unknown>) ?? {})).toContain('sandbox');
      expect(Object.keys((threadStart.properties as Record<string, unknown>) ?? {})).not.toContain('sandboxPolicy');
      expect(Object.keys((turnStart.properties as Record<string, unknown>) ?? {})).toContain('sandboxPolicy');
      expect(turnStart.required).toEqual(['input', 'threadId']);
      expect(Object.keys((configRead.properties as Record<string, unknown>) ?? {})).toContain('includeLayers');

      const sandboxModeSource = await readFile(join(tsDir, 'v2', 'SandboxMode.ts'), 'utf8');
      const sandboxPolicySource = await readFile(join(tsDir, 'v2', 'SandboxPolicy.ts'), 'utf8');
      const userInputSource = await readFile(join(tsDir, 'v2', 'UserInput.ts'), 'utf8');
      const serverNotificationSource = await readFile(join(tsDir, 'ServerNotification.ts'), 'utf8');
      expect(sandboxModeSource).toContain('"read-only"');
      expect(sandboxModeSource).toContain('"danger-full-access"');
      expect(sandboxPolicySource).toContain('{ "type": "readOnly", networkAccess: boolean, }');
      expect(userInputSource).toContain('{ "type": "text", text: string,');
      expect(userInputSource).toContain('text_elements: Array<TextElement>');
      expect(serverNotificationSource).toContain('"method": "item/agentMessage/delta"');
      expect(serverNotificationSource).toContain('"method": "turn/completed"');
      expect(serverNotificationSource).toContain('"method": "thread/status/changed"');

      const capturedRequests: Array<{ method: string; params: Record<string, unknown> }> = [];
      const transport: CodexAppServerTransport = {
        async request(method, params) {
          capturedRequests.push({ method, params });
          if (method === 'thread/start') {
            return { threadId: 'thread-1', effectiveConfig: { sandbox: 'read-only', approvalPolicy: 'never' } };
          }
          if (method === 'turn/start') {
            return { turnId: 'turn-1', effectiveConfig: { sandboxPolicy: { type: 'readOnly', networkAccess: false } } };
          }
          if (method === 'turn/interrupt') {
            return { acknowledged: true };
          }
          return {};
        },
        notifications: async function* () {
          yield { method: 'item/agentMessage/delta', params: { delta: '{"schema_version":"plan_draft.v1","summary":"ok"}' } };
          yield { method: 'turn/completed', params: { turn: { status: 'completed' } } };
        },
      };
      const driver = new AppServerGenerationDriver({ transport, runtimeSafety: fakeSafety() });
      await driver.generate({
        taskKind: 'plan_draft',
        prompt: '{}',
        outputSchemaVersion: 'plan_draft.v1',
        timeoutMs: 10_000,
      });
      expect(capturedRequests.map((request) => request.method)).toEqual(['thread/start', 'turn/start']);

      const contractPath = join(root, 'forgeloop-request-contract.ts');
      await writeFile(
        contractPath,
        `
import type { ThreadStartParams } from './ts/v2/ThreadStartParams';
import type { TurnStartParams } from './ts/v2/TurnStartParams';
import type { ConfigReadParams } from './ts/v2/ConfigReadParams';
import type { UserInput } from './ts/v2/UserInput';

const input: Array<UserInput> = [{ type: 'text', text: '{}', text_elements: [] }];
const threadStart = { approvalPolicy: 'never', sandbox: 'read-only' } satisfies ThreadStartParams;
const actualThreadStart = ${JSON.stringify(capturedRequests[0]?.params, null, 2)} satisfies ThreadStartParams;
const turnStart = {
  threadId: 'thread-1',
  input,
  approvalPolicy: 'never',
  sandboxPolicy: { type: 'readOnly', networkAccess: false },
} satisfies TurnStartParams;
const actualTurnStart = ${JSON.stringify(capturedRequests[1]?.params, null, 2)} satisfies TurnStartParams;
const configRead = { includeLayers: false } satisfies ConfigReadParams;

const invalidThreadStart = {
  approvalPolicy: 'never',
  // @ts-expect-error thread/start accepts sandbox, not turn-level sandboxPolicy.
  sandboxPolicy: { type: 'readOnly', networkAccess: false },
} satisfies ThreadStartParams;
const invalidTurnStart = {
  threadId: 'thread-1',
  input,
  approvalPolicy: 'never',
  // @ts-expect-error readOnly SandboxPolicy requires an explicit networkAccess boolean.
  sandboxPolicy: { type: 'readOnly' },
} satisfies TurnStartParams;
const invalidInput: Array<UserInput> = [
  // @ts-expect-error text input requires text_elements.
  { type: 'text', text: '{}' },
];
// @ts-expect-error config/read requires includeLayers.
const invalidConfigRead = {} satisfies ConfigReadParams;
void threadStart;
void actualThreadStart;
void turnStart;
void actualTurnStart;
void configRead;
void invalidThreadStart;
void invalidTurnStart;
void invalidInput;
void invalidConfigRead;
`,
      );
      await execFile(
        'pnpm',
        [
          'exec',
          'tsc',
          '--noEmit',
          '--strict',
          '--target',
          'ES2022',
          '--module',
          'ESNext',
          '--moduleResolution',
          'bundler',
          '--skipLibCheck',
          contractPath,
        ],
        { timeout: 30_000 },
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

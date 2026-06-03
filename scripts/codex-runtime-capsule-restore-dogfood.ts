import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  assertCodexRuntimeCapsulePublicReportSafe,
  buildInternalArtifactRef,
  codexAppConnectorManifestDigest,
  codexCanonicalDigest,
  codexMemoryBundleDigest,
  codexMemoryBundleManifestSchema,
  codexMemoryDeltaManifestSchema,
  type CodexGenerationWorkloadV1,
  type CodexLaunchMaterialization,
  type CodexRuntimeJob,
  type InternalArtifactKind,
} from '@forgeloop/domain';
import {
  CodexAppServerStdioTransport,
  createRemoteCodexWorkerClient,
  createRemoteWorkerCapsuleManager,
  sealCodexLaunchTokenEnvelope,
  type CapsuleComponentArtifactReader,
  type CodexRuntimeCapsuleArtifactWriter,
  type CodexRuntimeCapsuleDiscoveryReport,
  type SealedEnvelope,
} from '@forgeloop/codex-worker-runtime';
import {
  createCodexGenerationRuntime,
  type CodexAppServerTransport,
  type GeneratedSpecDraftV1,
} from '@forgeloop/codex-runtime';
import { runCodexRuntimeCapsuleDiscoveryDogfood } from './codex-runtime-capsule-discovery';

export const codexRuntimeCapsuleRestoreDogfoodCommand =
  'tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/codex-runtime-capsule-restore-dogfood.ts';

export const codexRuntimeCapsuleRestoreReportPath = 'test-results/codex-runtime-capsule-restore-report.json';

type EnvLike = Record<string, string | undefined>;
type RestoreDogfoodMode = 'real' | 'fake';
type RestoreCheckStatus = 'passed';
type RestoreReasonCode = 'codex_runtime_capsule_restore_credentials_unavailable';

const execFile = promisify(execFileCallback);

interface PassedRestoreScenarioResult {
  scenario_kind: 'fake_cross_worker_restore' | 'real_cross_worker_restore';
  orchestration_path: 'remote_worker_client';
  discovery_report_digest: string;
  codex_cli_version_digest: string;
  app_server_protocol_digest: string;
  worker_root_count: 2;
  restore_checks: {
    thread_locator_digest_continuity: RestoreCheckStatus;
    memory_output_input_digest_continuity: RestoreCheckStatus;
    memory_delta_replay: RestoreCheckStatus;
    environment_manifest_digest_continuity: RestoreCheckStatus;
    second_capsule_packaged: RestoreCheckStatus;
  };
  orchestration_checks: {
    restore_before_app_server_start: RestoreCheckStatus;
    locator_repaired_before_resume: RestoreCheckStatus;
    resumed_without_thread_start: RestoreCheckStatus;
    packaged_before_terminalize: RestoreCheckStatus;
    terminal_result_capsule_fields: RestoreCheckStatus;
  };
  terminal_result_digest: string;
  terminal_result_capsule_digest: string;
  memory_delta_replay_operation_counts: Record<'add' | 'modify' | 'delete' | 'rename', number>;
  memory_delta_operation_counts: Record<'add' | 'modify' | 'delete' | 'rename', number>;
  memory_input_digest: string;
  memory_output_digest: string;
  resumed_memory_input_digest: string;
  environment_manifest_digest: string;
  first_capsule_digest: string;
  second_capsule_digest: string;
  package_sequence_count: 2;
  public_safety: {
    raw_runtime_material: 'excluded';
    report_value_policy: 'digests_status_codes_only';
  };
}

export type CodexRuntimeCapsuleRestoreReport =
  | {
      schema_version: 'codex_runtime_capsule_restore_report.v1';
      status: 'skip';
      reason_code: RestoreReasonCode;
    }
  | {
      schema_version: 'codex_runtime_capsule_restore_report.v1';
      status: 'blocked';
      blocker_codes: string[];
    }
  | ({
      schema_version: 'codex_runtime_capsule_restore_report.v1';
      status: 'passed';
      report_path: string;
    } & PassedRestoreScenarioResult);

export interface CodexRuntimeCapsuleRestoreDogfoodDependencies {
  mode?: RestoreDogfoodMode;
  env?: EnvLike;
  credentialsAvailable?: () => Promise<boolean>;
  discoveryReport?: () => Promise<CodexRuntimeCapsuleDiscoveryReport>;
  executeRestoreScenario?: (input: { discoveryReport: CodexRuntimeCapsuleDiscoveryReport }) => Promise<PassedRestoreScenarioResult>;
}

interface StoredArtifact {
  bytes: Uint8Array;
  digest: string;
}

class InMemoryCapsuleArtifactStore implements CodexRuntimeCapsuleArtifactWriter, CapsuleComponentArtifactReader {
  readonly artifacts = new Map<string, StoredArtifact>();

  async write(input: {
    kind: InternalArtifactKind;
    ownerId: string;
    artifactId: string;
    content: Uint8Array;
    digest: string;
  }): Promise<{ ref: string; digest: string; size_bytes: string }> {
    const ref = buildInternalArtifactRef({
      kind: input.kind,
      owner_type: 'codex_session',
      owner_id: input.ownerId,
      artifact_id: input.artifactId,
    });
    this.artifacts.set(ref, { bytes: input.content, digest: input.digest });
    return {
      ref,
      digest: input.digest,
      size_bytes: String(input.content.byteLength),
    };
  }

  async read(ref: string, expectedDigest: string): Promise<Uint8Array> {
    const artifact = this.artifacts.get(ref);
    if (artifact === undefined) {
      throw new Error('codex runtime capsule restore fake artifact missing');
    }
    if (artifact.digest !== expectedDigest) {
      throw new Error('codex runtime capsule restore fake artifact digest mismatch');
    }
    return artifact.bytes;
  }

  seed(input: { ref: string; bytes: Uint8Array; digest: string }): void {
    this.artifacts.set(input.ref, { bytes: input.bytes, digest: input.digest });
  }

  async uploadInternalArtifact(input: {
    kind: InternalArtifactKind;
    ownerType: 'codex_session';
    ownerId: string;
    visibility: 'private';
    contentType: string;
    bytes: Uint8Array;
    idempotencyKey: string;
    metadataJson?: Record<string, unknown>;
    maxSizeBytes?: number;
  }): Promise<{ ref: string; digest: string; size_bytes: string }> {
    void input.ownerType;
    void input.visibility;
    void input.contentType;
    void input.idempotencyKey;
    void input.maxSizeBytes;
    const artifactId = String(input.metadataJson?.artifact_id ?? `${input.kind}-${this.artifacts.size + 1}`);
    const digestValue = rawBytesDigest(input.bytes);
    return this.write({
      kind: input.kind,
      ownerId: input.ownerId,
      artifactId,
      content: input.bytes,
      digest: digestValue,
    });
  }

  async downloadInternalArtifact(input: { ref: string; expectedDigest: string; maxSizeBytes?: number }): Promise<Uint8Array> {
    void input.maxSizeBytes;
    return this.read(input.ref, input.expectedDigest);
  }
}

class RecordingInMemoryCapsuleArtifactStore extends InMemoryCapsuleArtifactStore {
  readonly uploadedKinds: InternalArtifactKind[] = [];

  async uploadInternalArtifact(input: Parameters<InMemoryCapsuleArtifactStore['uploadInternalArtifact']>[0]): Promise<{ ref: string; digest: string; size_bytes: string }> {
    this.uploadedKinds.push(input.kind);
    return super.uploadInternalArtifact(input);
  }
}

const reportSchemaVersion = 'codex_runtime_capsule_restore_report.v1';
const safeCodePattern = /^[a-z0-9_]+$/;

const optionalEnv = (env: EnvLike, key: string): string | undefined => {
  const value = env[key]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
};

const codexBin = (env: EnvLike): string => optionalEnv(env, 'FORGELOOP_CODEX_BIN') ?? 'codex';

const execCodex = async (env: EnvLike, args: readonly string[], options?: { cwd?: string }): Promise<string> => {
  const { stdout } = await execFile(codexBin(env), [...args], {
    cwd: options?.cwd,
    env: { ...process.env, ...env },
    maxBuffer: 1024 * 1024 * 10,
    timeout: 30_000,
  });
  return stdout.trim();
};

const modeFromEnv = (env: EnvLike): RestoreDogfoodMode =>
  optionalEnv(env, 'FORGELOOP_CODEX_RUNTIME_CAPSULE_RESTORE_MODE') === 'fake' ? 'fake' : 'real';

const defaultCredentialsAvailable = async (mode: RestoreDogfoodMode, env: EnvLike): Promise<boolean> =>
  mode === 'fake' || optionalEnv(env, 'FORGELOOP_ENABLE_REAL_CODEX_RESTORE_DOGFOOD') === '1';

const sanitizeBlockerCodes = (codes: readonly string[]): string[] => {
  const sanitized = codes.map((code) => (safeCodePattern.test(code) ? code : 'codex_runtime_capsule_restore_unknown_blocker'));
  return [...new Set(sanitized)].sort((left, right) => left.localeCompare(right));
};

const fakeDiscoveryReport = (): CodexRuntimeCapsuleDiscoveryReport => ({
  schema_version: 'codex_runtime_capsule_discovery_report.v1',
  status: 'passed',
  codex_cli_version_digest: codexCanonicalDigest('fake-codex 1.0.0'),
  app_server_protocol_digest: codexCanonicalDigest({ protocol: 'fake-app-server-v1' }),
  path_mutation_counts: {
    thread_state_allowed: 1,
    memory_state_allowed: 1,
    environment_component: 1,
    generated_environment: 0,
    forbidden: 0,
    forbidden_whole_db: 0,
    unknown: 0,
  },
  observed_mutation_count: 3,
  blocker_codes: [],
});

const digest = (value: unknown): string => codexCanonicalDigest(value);
const rawBytesDigest = (bytes: Uint8Array): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const codexThreadIdDigest = (threadId: string): string =>
  codexCanonicalDigest({ kind: 'codex_app_server_thread_id', thread_id: threadId });

const collectRegularFiles = async (root: string, relativePrefix = ''): Promise<{ relativePath: string; content: string }[]> => {
  const entries = await readdir(join(root, relativePrefix), { withFileTypes: true });
  const files = await Promise.all(
    entries
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(async (entry) => {
        const relativePath = relativePrefix.length === 0 ? entry.name : `${relativePrefix}/${entry.name}`;
        if (entry.isDirectory()) {
          return collectRegularFiles(root, relativePath);
        }
        if (!entry.isFile()) {
          return [];
        }
        return [{ relativePath, content: await readFile(join(root, relativePath), 'utf8') }];
      }),
  );
  return files.flat();
};

const appServerProtocolDigest = async (env: EnvLike): Promise<string> => {
  const schemaRoot = await mkdtemp(join(tmpdir(), 'forgeloop-codex-restore-schema-'));
  try {
    await execCodex(env, ['app-server', 'generate-json-schema', '--out', schemaRoot]);
    const files = await collectRegularFiles(schemaRoot);
    return digest({
      generated_json_schema_files: files.map((file) => ({
        relative_path: file.relativePath,
        content_digest: digest(file.content),
      })),
    });
  } finally {
    await rm(schemaRoot, { force: true, recursive: true });
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const writeRelativeFile = async (root: string, relativePath: string, content: string): Promise<void> => {
  const path = join(root, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
};

const removeTrustedRuntimeMaterial = async (codexHomeRoot: string): Promise<void> => {
  await Promise.all([
    rm(join(codexHomeRoot, 'auth.json'), { force: true }),
    rm(join(codexHomeRoot, 'config.toml'), { force: true }),
  ]);
};

const operationCounts = (
  operations: readonly { op: 'add' | 'modify' | 'delete' | 'rename' }[],
): Record<'add' | 'modify' | 'delete' | 'rename', number> =>
  operations.reduce(
    (acc, operation) => ({ ...acc, [operation.op]: acc[operation.op] + 1 }),
    { add: 0, modify: 0, delete: 0, rename: 0 },
  );

const parseJsonArtifact = async <T>(input: {
  artifactStore: InMemoryCapsuleArtifactStore;
  ref: string;
  digest: string;
  parse: (value: unknown) => T;
}): Promise<T> =>
  input.parse(JSON.parse(Buffer.from(await input.artifactStore.read(input.ref, input.digest)).toString('utf8')) as unknown);

const verifyDeleteRenameDeltaReplay = async (input: {
  artifactStore: InMemoryCapsuleArtifactStore;
  baseMemoryRef: string;
  baseMemoryDigest: string;
  outputMemoryRef: string;
  outputMemoryDigest: string;
  deltaRef: string;
  deltaDigest: string;
}): Promise<Record<'add' | 'modify' | 'delete' | 'rename', number>> => {
  const [baseMemoryBundle, outputMemoryBundle, memoryDelta] = await Promise.all([
    parseJsonArtifact({
      artifactStore: input.artifactStore,
      ref: input.baseMemoryRef,
      digest: input.baseMemoryDigest,
      parse: (value) => codexMemoryBundleManifestSchema.parse(value),
    }),
    parseJsonArtifact({
      artifactStore: input.artifactStore,
      ref: input.outputMemoryRef,
      digest: input.outputMemoryDigest,
      parse: (value) => codexMemoryBundleManifestSchema.parse(value),
    }),
    parseJsonArtifact({
      artifactStore: input.artifactStore,
      ref: input.deltaRef,
      digest: input.deltaDigest,
      parse: (value) => codexMemoryDeltaManifestSchema.parse(value),
    }),
  ]);
  if (
    codexMemoryBundleDigest(baseMemoryBundle) !== input.baseMemoryDigest ||
    codexMemoryBundleDigest(outputMemoryBundle) !== input.outputMemoryDigest ||
    memoryDelta.input_bundle_digest !== input.baseMemoryDigest ||
    memoryDelta.output_bundle_digest !== input.outputMemoryDigest
  ) {
    throw new Error('codex runtime capsule restore memory delta replay digest mismatch');
  }
  const counts = operationCounts(memoryDelta.operations);
  if (counts.add !== 0 || counts.modify !== 0 || counts.delete !== 1 || counts.rename !== 1) {
    throw new Error('codex runtime capsule restore delete/rename replay coverage missing');
  }

  const baseEntries = new Map(baseMemoryBundle.entries.map((entry) => [entry.relative_path, entry]));
  const outputEntries = new Map(outputMemoryBundle.entries.map((entry) => [entry.relative_path, entry]));
  for (const operation of memoryDelta.operations) {
    if (operation.op === 'delete') {
      const before = baseEntries.get(operation.relative_path);
      if (before?.content_digest !== operation.before_digest || outputEntries.has(operation.relative_path)) {
        throw new Error('codex runtime capsule restore delete replay mismatch');
      }
    } else if (operation.op === 'rename') {
      const before = baseEntries.get(operation.from_relative_path);
      const after = outputEntries.get(operation.to_relative_path);
      if (
        before?.content_digest !== operation.before_digest ||
        after?.content_digest !== operation.after_digest ||
        outputEntries.has(operation.from_relative_path)
      ) {
        throw new Error('codex runtime capsule restore rename replay mismatch');
      }
    }
  }
  return counts;
};

const generatedSpecPayload = (summary: string): GeneratedSpecDraftV1 => ({
  schema_version: 'spec_draft.v1',
  summary,
  content: `${summary} content`,
  background: 'Runtime capsule restore dogfood background.',
  goals: ['Prove worker-orchestrated restore.'],
  scope_in: ['remote worker orchestration'],
  scope_out: ['raw runtime material'],
  acceptance_criteria: ['terminal result includes capsule evidence'],
  risk_notes: ['public report must stay digest-only'],
  test_strategy_summary: 'smoke test',
});

const generationSignedContext = (input: { actionRunId: string; phase: string; digestSeed: string }): Record<string, unknown> => ({
  context_version: 'codex_runtime_capsule_restore_dogfood.v1',
  action_run_id: input.actionRunId,
  phase: input.phase,
  digest_seed: input.digestSeed,
});

const generationWorkload = (input: {
  runtimeJobId: string;
  actionRunId: string;
  phase: string;
  signedContext: Record<string, unknown>;
  codexSessionRuntimeContext: Record<string, unknown>;
  codexSessionTerminalization: Record<string, unknown>;
}): CodexGenerationWorkloadV1 => ({
  schema_version: 'codex_generation_workload.v1',
  runtime_job_id: input.runtimeJobId,
  action_run_id: input.actionRunId,
  task_kind: 'spec_draft',
  prompt_version: 'codex-runtime-capsule-restore-dogfood',
  output_schema_version: 'spec_draft.v1',
  signed_context_ref: `artifact://codex-runtime-jobs/${input.runtimeJobId}/workload/context`,
  signed_context_digest: digest(input.signedContext),
  prompt_template_digest: digest({ prompt: 'codex-runtime-capsule-restore-dogfood', phase: input.phase }),
  created_at: '2026-06-03T00:00:00.000Z',
  expires_at: '2026-06-03T00:10:00.000Z',
  codex_session_runtime_context: input.codexSessionRuntimeContext as unknown as CodexGenerationWorkloadV1['codex_session_runtime_context'],
  codex_session_terminalization: input.codexSessionTerminalization as unknown as CodexGenerationWorkloadV1['codex_session_terminalization'],
});

const runtimeJobFor = (input: { runtimeJobId: string; workload: CodexGenerationWorkloadV1 }): CodexRuntimeJob => ({
  id: input.runtimeJobId,
  job_request_id: `${input.runtimeJobId}-request`,
  target_type: 'automation_action_run',
  target_id: input.workload.action_run_id,
  target_kind: 'generation',
  project_id: 'project-restore',
  repo_id: 'repo-restore',
  worker_id: 'worker-restore',
  launch_lease_id: `lease-${input.runtimeJobId}`,
  launch_attempt: 1,
  status: 'queued',
  input_digest: digest(input.workload),
  input_json: input.workload as unknown as Record<string, unknown>,
  expires_at: '2026-06-03T00:10:00.000Z',
  created_at: '2026-06-03T00:00:00.000Z',
  updated_at: '2026-06-03T00:00:00.000Z',
});

const materializationFor = (input: {
  runtimeJobId: string;
  targetId: string;
  codexConfigToml?: string;
}): CodexLaunchMaterialization => ({
  launch_target: {
    target_type: 'automation_action_run',
    target_id: input.targetId,
    target_kind: 'generation',
    project_id: 'project-restore',
    repo_id: 'repo-restore',
  },
  lease_id: `lease-${input.runtimeJobId}`,
  expires_at: '2026-06-03T00:10:00.000Z',
  materialized_at: '2026-06-03T00:00:01.000Z',
  resolved_credentials: [
    {
      binding_id: 'credential-restore',
      binding_version_id: 'credential-restore-v1',
      payload: {},
      payload_digest: digest({ credential: 'empty' }),
    },
  ],
  profile_revision: {
    id: 'runtime-profile-revision-restore',
    profile_id: 'runtime-profile-restore',
    revision_number: 1,
    status: 'active',
    environment: 'test',
    docker_image: 'ghcr.io/forgeloop/codex',
    docker_image_digest: digest({ image: 'restore' }),
    target_kind: 'generation',
    source_access_mode: 'artifact_only',
    codex_config_toml: input.codexConfigToml ?? 'approval_policy = "never"',
    codex_config_digest: digest(input.codexConfigToml ?? 'approval_policy = "never"'),
    expected_effective_config_digest: digest({ approval_policy: 'never' }),
    effective_config_assertions: {
      target_kind: 'generation',
      approval_policy: 'never',
      source_write_policy: 'artifact_only',
      forbidden_writable_roots: ['workspace'],
    },
    app_server_required: true,
    allowed_driver_kind: 'app_server',
    network_policy: { mode: 'disabled' },
    resource_limits: {
      cpu_ms: 1000,
      memory_mb: 512,
      pids: 64,
      fds: 128,
      workspace_bytes: 0,
      artifact_bytes: 100_000,
      timeout_ms: 60_000,
      output_limit_bytes: 100_000,
      run_output_limit_bytes: 100_000,
    },
    docker_policy: {
      app_server_only: true,
      rootless: true,
      read_only_rootfs: true,
      no_new_privileges: true,
      drop_capabilities: ['ALL'],
    },
    allowed_scopes: [{ project_id: 'project-restore', repo_id: 'repo-restore' }],
    profile_digest: digest({ profile: 'restore' }),
    created_by_actor_id: 'actor-restore',
    created_at: '2026-06-03T00:00:00.000Z',
  },
});

const recordingAppServerTransport = (input: {
  events: string[];
  codexHomeHostPath: string;
  threadId: string;
  generated: GeneratedSpecDraftV1;
  mutateCodexHome?: () => Promise<void>;
}): CodexAppServerTransport => ({
  initialize: async () => {
    await removeTrustedRuntimeMaterial(input.codexHomeHostPath);
  },
  request: async (method) => {
    input.events.push(method);
    if (method === 'thread/start' || method === 'thread/resume') {
      return {
        thread_id: input.threadId,
        config: { approval_policy: 'never', sandbox: 'read-only', writable_roots: [] },
      };
    }
    if (method === 'turn/start') {
      await input.mutateCodexHome?.();
      return {
        turn_id: `turn-${input.events.filter((event) => event === 'turn/start').length}`,
        config: { approval_policy: 'never', sandbox_policy: 'read-only', writable_roots: [] },
      };
    }
    return {};
  },
  notifications: async function* () {
    yield { method: 'item/agentMessage/delta', params: { delta: JSON.stringify(input.generated) } };
    yield { method: 'turn/completed', params: { turn: { status: 'completed' } } };
  },
  close: async () => undefined,
});

const instrumentedAppServerTransport = (input: {
  base: CodexAppServerTransport;
  mutateCodexHome: () => Promise<void>;
}): CodexAppServerTransport => {
  const transport: CodexAppServerTransport = {
    initialize: async () => input.base.initialize?.(),
    request: async (method, params) => {
      const response = await input.base.request(method, params);
      if (method === 'turn/start') {
        await input.mutateCodexHome();
      }
      return response;
    },
    close: async () => input.base.close?.(),
  };
  if (input.base.notifications !== undefined) {
    transport.notifications = () => input.base.notifications!();
  }
  return transport;
};

interface OrchestratedRestoreScenarioInput {
  discoveryReport: CodexRuntimeCapsuleDiscoveryReport;
  scenarioKind: 'fake_cross_worker_restore' | 'real_cross_worker_restore';
  env?: EnvLike;
  codexCliVersion: string;
  appServerProtocolDigest: string;
  createTransport?: (input: {
    events: string[];
    codexHomeHostPath: string;
    threadId: string;
    generated: GeneratedSpecDraftV1;
    mutateCodexHome: () => Promise<void>;
  }) => CodexAppServerTransport;
}

const seedBaseMemoryArtifact = (input: {
  store: InMemoryCapsuleArtifactStore;
  codexSessionId: string;
  ref: string;
  content: string;
  sourcePolicyDigest: string;
}): string => {
  const bundle = codexMemoryBundleManifestSchema.parse({
    schema_version: 'codex_memory_bundle_manifest.v1',
    bundle_id: 'memory-base',
    codex_session_id: input.codexSessionId,
    source_policy_digest: input.sourcePolicyDigest,
    entries: [
      {
        relative_path: 'memories/delete-me.md',
        source_kind: 'session_memory',
        content_digest: digest('delete digest input\n'),
        size_bytes: String(Buffer.byteLength('delete digest input\n')),
        content: 'delete digest input\n',
        operation: 'present',
      },
      {
        relative_path: 'memories/rename-source.md',
        source_kind: 'session_memory',
        content_digest: digest('rename digest input\n'),
        size_bytes: String(Buffer.byteLength('rename digest input\n')),
        content: 'rename digest input\n',
        operation: 'present',
      },
      {
        relative_path: 'memories/stable.md',
        source_kind: 'session_memory',
        content_digest: digest(input.content),
        size_bytes: String(Buffer.byteLength(input.content)),
        content: input.content,
        operation: 'present',
      },
    ],
  });
  const bundleDigest = codexMemoryBundleDigest(bundle);
  input.store.seed({ ref: input.ref, bytes: Buffer.from(JSON.stringify(bundle), 'utf8'), digest: bundleDigest });
  return bundleDigest;
};

const assertEventOrder = (events: readonly string[], before: string, after: string): void => {
  const beforeIndex = events.indexOf(before);
  const afterIndex = events.indexOf(after);
  if (beforeIndex < 0 || afterIndex < 0 || beforeIndex >= afterIndex) {
    throw new Error(`codex runtime capsule restore orchestration order failed: ${before} before ${after}`);
  }
};

const runOrchestratedCrossWorkerRestoreScenario = async (
  input: OrchestratedRestoreScenarioInput,
): Promise<PassedRestoreScenarioResult> => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'forgeloop-capsule-worker-restore-'));
  try {
    const codexSessionId = 'codex-session-restore';
    const threadId = 'thread-orchestrated-restore';
    const threadDigest = codexThreadIdDigest(threadId);
    const workerTempRoot = join(tempRoot, 'worker-temp');
    const events: string[] = [];
    const terminalized: Record<string, unknown>[] = [];
    const failedTerminalized: Record<string, unknown>[] = [];
    const failureArtifacts: Record<string, unknown>[] = [];
    const artifactStore = new RecordingInMemoryCapsuleArtifactStore();
    const sourcePolicyDigest = digest({ source_policy: 'orchestrated-restore-memory' });
    const baseMemoryRef = buildInternalArtifactRef({
      kind: 'codex_memory_bundle',
      owner_type: 'codex_session',
      owner_id: codexSessionId,
      artifact_id: 'memory-base',
    });
    const baseMemoryDigest = seedBaseMemoryArtifact({
      store: artifactStore,
      codexSessionId,
      ref: baseMemoryRef,
      content: 'stable digest input\n',
      sourcePolicyDigest,
    });
    await mkdir(workerTempRoot, { recursive: true });

    let sealedEnvelope: SealedEnvelope | undefined;
    let pollIndex = 0;
    let firstTerminalResult: Record<string, unknown> | undefined;
    let secondWorkload: CodexGenerationWorkloadV1 | undefined;
    const firstRuntimeJobId = 'runtime-job-restore-a';
    const secondRuntimeJobId = 'runtime-job-restore-b';
    const actionRunId = 'action-run-restore';
    const firstContext = {
      schema_version: 'codex_session_runtime_context.v1',
      codex_session_id: codexSessionId,
      codex_session_turn_id: 'turn-a',
      lease_id: 'session-lease-a',
      lease_epoch: 1,
      worker_id: 'worker-restore',
      worker_session_digest: digest({ worker_session: 'a' }),
      turn_group_status: 'complete',
      continuation: { kind: 'start_thread' },
    };
    const firstTerminalization = {
      schema_version: 'codex_session_terminalization.v1',
      lease_token: 'session-terminalization-a',
      codex_session_id: codexSessionId,
      codex_session_turn_id: 'turn-a',
      base_memory_bundle_ref: baseMemoryRef,
      base_memory_bundle_digest: baseMemoryDigest,
    };
    const firstSignedContext = generationSignedContext({ actionRunId, phase: 'first', digestSeed: baseMemoryDigest });
    const firstWorkload = generationWorkload({
      runtimeJobId: firstRuntimeJobId,
      actionRunId,
      phase: 'first',
      signedContext: firstSignedContext,
      codexSessionRuntimeContext: firstContext,
      codexSessionTerminalization: firstTerminalization,
    });
    const secondSignedContext = generationSignedContext({ actionRunId, phase: 'second', digestSeed: threadDigest });

    const controlPlaneClient = {
      registerWorker: async (registerInput: Record<string, unknown>) => {
        sealedEnvelope = await sealCodexLaunchTokenEnvelope({
          plaintext_launch_token: 'launch-token-secret',
          runtime_job_id: firstRuntimeJobId,
          launch_lease_id: `lease-${firstRuntimeJobId}`,
          envelope_id: 'envelope-restore',
          worker_id: 'worker-restore',
          worker_public_key_material: String(registerInput.session_public_key_material),
          key_id: String(registerInput.session_public_key_id),
          expires_at: '2026-06-03T00:10:00.000Z',
        });
        return {
          worker: { session_epoch: 1 },
          session_token: 'worker-session-token',
          session_expires_at: '2026-06-03T00:10:00.000Z',
        };
      },
      heartbeatWorker: async () => ({}),
      pollRuntimeJobs: async () => {
        pollIndex += 1;
        if (pollIndex === 1) {
          return { runtime_jobs: [{ runtime_job: runtimeJobFor({ runtimeJobId: firstRuntimeJobId, workload: firstWorkload }), envelope: { id: 'envelope-restore' } }] };
        }
        if (pollIndex === 2 && firstTerminalResult !== undefined) {
          const firstCapsule = firstTerminalResult.output_capsule;
          if (!isRecord(firstCapsule)) {
            throw new Error('codex runtime capsule restore first terminal capsule missing');
          }
          const outputMemoryBundleRef = firstTerminalResult.output_memory_bundle_ref;
          const outputMemoryBundleDigest = firstTerminalResult.output_memory_bundle_digest;
          const outputEnvironmentManifestRef = firstTerminalResult.output_environment_manifest_ref;
          const outputEnvironmentManifestDigest = firstTerminalResult.output_environment_manifest_digest;
          if (
            typeof firstCapsule.id !== 'string' ||
            typeof firstCapsule.digest !== 'string' ||
            typeof firstCapsule.artifact_ref !== 'string' ||
            typeof outputMemoryBundleRef !== 'string' ||
            typeof outputMemoryBundleDigest !== 'string' ||
            typeof outputEnvironmentManifestRef !== 'string' ||
            typeof outputEnvironmentManifestDigest !== 'string'
          ) {
            throw new Error('codex runtime capsule restore first terminal evidence incomplete');
          }
          const secondContext = {
            schema_version: 'codex_session_runtime_context.v1',
            codex_session_id: codexSessionId,
            codex_session_turn_id: 'turn-b',
            lease_id: 'session-lease-b',
            lease_epoch: 2,
            worker_id: 'worker-restore',
            worker_session_digest: digest({ worker_session: 'b' }),
            expected_input_capsule_digest: firstCapsule.digest,
            turn_group_status: 'complete',
            continuation: {
              kind: 'resume_thread',
              codex_thread_id: threadId,
              codex_thread_id_digest: threadDigest,
            },
          };
          const secondTerminalization = {
            schema_version: 'codex_session_terminalization.v1',
            lease_token: 'session-terminalization-b',
            codex_session_id: codexSessionId,
            codex_session_turn_id: 'turn-b',
            expected_input_capsule_digest: firstCapsule.digest,
            input_capsule_id: firstCapsule.id,
            input_capsule_digest: firstCapsule.digest,
            input_capsule_ref: firstCapsule.artifact_ref,
            input_memory_bundle_ref: outputMemoryBundleRef,
            input_memory_bundle_digest: outputMemoryBundleDigest,
            input_environment_manifest_ref: outputEnvironmentManifestRef,
            input_environment_manifest_digest: outputEnvironmentManifestDigest,
          };
          secondWorkload = generationWorkload({
            runtimeJobId: secondRuntimeJobId,
            actionRunId,
            phase: 'second',
            signedContext: secondSignedContext,
            codexSessionRuntimeContext: secondContext,
            codexSessionTerminalization: secondTerminalization,
          });
          return { runtime_jobs: [{ runtime_job: runtimeJobFor({ runtimeJobId: secondRuntimeJobId, workload: secondWorkload }), envelope: { id: 'envelope-restore' } }] };
        }
        return { runtime_jobs: [] };
      },
      acceptRuntimeJob: async () => ({}),
      getRuntimeJobControl: async () => ({ control: { cancel_requested: false, drain_requested: false } }),
      claimLaunchTokenEnvelope: async () => ({ envelope: sealedEnvelope }),
      fetchRuntimeJobWorkload: async (_workerId: string, jobId: string) => {
        if (jobId === firstRuntimeJobId) {
          return { workload: firstWorkload, signed_context: firstSignedContext };
        }
        if (jobId === secondRuntimeJobId) {
          if (secondWorkload === undefined) {
            throw new Error('codex runtime capsule restore second workload missing');
          }
          return { workload: secondWorkload, signed_context: secondSignedContext };
        }
        throw new Error('codex runtime capsule restore workload unavailable');
      },
      materializeRuntimeJob: async (_workerId: string, jobId: string) =>
        materializationFor({ runtimeJobId: jobId, targetId: actionRunId }),
      startRuntimeJob: async (_workerId: string, jobId: string) => {
        events.push(`runtime-job-start:${jobId}`);
        const startedWorkload =
          jobId === firstRuntimeJobId
            ? firstWorkload
            : jobId === secondRuntimeJobId
              ? secondWorkload
              : undefined;
        if (startedWorkload === undefined) {
          throw new Error('codex runtime capsule restore start workload unavailable');
        }
        return { runtime_job: { ...runtimeJobFor({ runtimeJobId: jobId, workload: startedWorkload }), status: 'running' } };
      },
      markCodexSessionRunnerOwner: async () => ({}),
      appendRuntimeJobEvent: async () => ({}),
      uploadRuntimeJobArtifact: async (_workerId: string, jobId: string, upload: Record<string, unknown>) => {
        if (upload.kind === 'startup_failure_evidence') {
          const bytes = upload.bytes instanceof Uint8Array ? Buffer.from(upload.bytes).toString('utf8') : undefined;
          failureArtifacts.push({
            runtime_job_id: jobId,
            metadata_json: upload.metadata_json,
            payload: bytes === undefined ? undefined : JSON.parse(bytes),
          });
        }
        return {
          artifact: {
            kind: upload.kind,
            name: upload.name,
            content_type: upload.content_type,
            digest: upload.digest,
            internal_ref: `artifact://internal/codex_runtime_job_artifact/codex_runtime_job/${jobId}/${String(upload.kind)}`,
          },
        };
      },
      terminalizeRuntimeJob: async (_workerId: string, jobId: string, terminalInput: Record<string, unknown>) => {
        events.push(`terminalize:${jobId}`);
        if (terminalInput.terminal_status === 'succeeded' && isRecord(terminalInput.terminal_result_json)) {
          if (jobId === firstRuntimeJobId) {
            firstTerminalResult = terminalInput.terminal_result_json;
          }
          terminalized.push(terminalInput);
        } else if (terminalInput.terminal_status === 'failed') {
          failedTerminalized.push({ runtime_job_id: jobId, ...terminalInput });
        }
        return {};
      },
      uploadInternalArtifact: artifactStore.uploadInternalArtifact.bind(artifactStore),
      downloadInternalArtifact: artifactStore.downloadInternalArtifact.bind(artifactStore),
    };

    const actualManager = createRemoteWorkerCapsuleManager({
      controlPlaneClient,
      workerId: 'worker-restore',
      codexCliVersion: input.codexCliVersion,
      appServerProtocolDigest: input.appServerProtocolDigest,
      now: () => '2026-06-03T00:00:00.000Z',
    });
    const capsuleManager = {
      materializeBaseMemory: actualManager.materializeBaseMemory,
      restore: async (...args: Parameters<typeof actualManager.restore>) => {
        events.push('restore');
        await actualManager.restore(...args);
      },
      repairLocator: async (...args: Parameters<typeof actualManager.repairLocator>) => {
        events.push('repair');
        await actualManager.repairLocator(...args);
      },
      package: async (...args: Parameters<typeof actualManager.package>) => {
        events.push('package');
        return actualManager.package(...args);
      },
    };
    const launcher = {
      startFromMaterialization: async (materialization: CodexLaunchMaterialization, hookInput?: Record<string, unknown>) => {
        const runtimeCodexHomeHostPath = join(workerTempRoot, `${materialization.lease_id}-runtime-codex-home`);
        const codexHomeHostPath = join(workerTempRoot, `${materialization.lease_id}-capsule-codex-home`);
        const artifactHostPath = join(workerTempRoot, `${materialization.lease_id}-artifacts`);
        await mkdir(runtimeCodexHomeHostPath, { recursive: true });
        await mkdir(codexHomeHostPath, { recursive: true });
        await mkdir(artifactHostPath, { recursive: true });
        await (hookInput?.beforeAppServerStart as (paths: {
          codexHomeHostPath: string;
          codexHomeContainerPath: string;
          artifactHostPath: string;
        }) => Promise<void>)?.({ codexHomeHostPath, codexHomeContainerPath: '/codex-home', artifactHostPath });
        events.push(`app-server-start:${materialization.lease_id}`);
        await (hookInput?.afterAppServerStart as (paths: {
          codexHomeHostPath: string;
          codexHomeContainerPath: string;
          artifactHostPath: string;
        }) => Promise<void>)?.({ codexHomeHostPath, codexHomeContainerPath: '/codex-home', artifactHostPath });
        const isSecondTurn = materialization.lease_id === `lease-${secondRuntimeJobId}`;
        return {
          endpoint: `dogfood:${digest(materialization.lease_id)}`,
          createTransport: () =>
            (input.createTransport ?? ((transportInput) => recordingAppServerTransport({
              events: transportInput.events,
              codexHomeHostPath: transportInput.codexHomeHostPath,
              threadId: transportInput.threadId,
              generated: transportInput.generated,
              mutateCodexHome: transportInput.mutateCodexHome,
            })))({
              events,
              codexHomeHostPath,
              threadId,
              generated: generatedSpecPayload(isSecondTurn ? 'Second restore turn' : 'First restore turn'),
              mutateCodexHome: async () => {
                if (isSecondTurn) {
                  await writeRelativeFile(codexHomeHostPath, 'memories/second-turn.md', 'second capsule digest input\n');
                } else {
                  await rm(join(codexHomeHostPath, 'memories/delete-me.md'));
                  await rename(join(codexHomeHostPath, 'memories/rename-source.md'), join(codexHomeHostPath, 'memories/rename-target.md'));
                }
                await writeRelativeFile(
                  codexHomeHostPath,
                  'sessions/2026/06/03/rollout-orchestrated-restore.jsonl',
                  `${JSON.stringify({ event_kind: 'turn_context', thread_digest: threadDigest })}\n`,
                );
              },
            }),
          containerWorkspacePath: '/workspace' as const,
          capsuleHookInput: {
            codexHomeHostPath,
            codexHomeContainerPath: '/codex-home',
            artifactHostPath,
          },
          publicEvidence: {
            runtime_profile_id: materialization.profile_revision.profile_id,
            runtime_profile_revision_id: materialization.profile_revision.id,
            runtime_profile_digest: materialization.profile_revision.profile_digest,
            runtime_target_kind: 'generation' as const,
            source_access_mode: 'artifact_only' as const,
            environment: 'test' as const,
            launch_lease_id: materialization.lease_id,
            worker_id: 'worker-restore',
            docker_image_digest: materialization.profile_revision.docker_image_digest,
            container_id_digest: digest({ container: materialization.lease_id }),
            app_server_effective_config_digest: materialization.profile_revision.expected_effective_config_digest,
            docker_policy_self_check_digest: digest({ docker_policy: 'restore' }),
            app_server_attempted: true as const,
            selected_execution_mode: 'app_server' as const,
          },
          close: async () => undefined,
        };
      },
    };
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-restore',
      workerIdentity: 'restore-dogfood',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot,
      allowedScopes: [{ project_id: 'project-restore', repo_id: 'repo-restore' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest({ image: 'restore' })],
      networkPolicyDigests: [digest({ network: 'disabled' })],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient,
      launcher,
      capsuleManager,
      generationRuntimeFactory: createCodexGenerationRuntime,
      scavenger: async () => undefined,
      now: () => '2026-06-03T00:00:00.000Z',
      nonceFactory: () => 'nonce-restore',
    });

    await worker.runOnce();
    await worker.runOnce();

    const secondTerminalized = terminalized.at(-1);
    const secondTerminalResult = isRecord(secondTerminalized?.terminal_result_json)
      ? secondTerminalized.terminal_result_json
      : undefined;
    if (secondTerminalResult === undefined) {
      throw new Error(
        `codex runtime capsule restore terminal result missing: ${JSON.stringify({
          terminalization: failedTerminalized.at(-1) ?? null,
          failure_artifact: failureArtifacts.at(-1) ?? null,
          events,
        })}`,
      );
    }
    const firstOutputCapsule = isRecord(firstTerminalResult?.output_capsule) ? firstTerminalResult.output_capsule : undefined;
    const secondOutputCapsule = isRecord(secondTerminalResult.output_capsule) ? secondTerminalResult.output_capsule : undefined;
    if (firstOutputCapsule === undefined || secondOutputCapsule === undefined) {
      throw new Error('codex runtime capsule restore terminal capsule missing');
    }
    if (
      typeof firstOutputCapsule.digest !== 'string' ||
      typeof secondOutputCapsule.digest !== 'string' ||
      typeof firstTerminalResult?.output_memory_bundle_ref !== 'string' ||
      typeof firstTerminalResult?.output_memory_bundle_digest !== 'string' ||
      typeof secondTerminalResult.output_memory_bundle_digest !== 'string' ||
      typeof secondTerminalResult.output_environment_manifest_digest !== 'string'
    ) {
      throw new Error('codex runtime capsule restore terminal capsule fields missing');
    }

    assertEventOrder(events, 'restore', `app-server-start:lease-${secondRuntimeJobId}`);
    assertEventOrder(events, `app-server-start:lease-${secondRuntimeJobId}`, 'repair');
    assertEventOrder(events, 'repair', 'thread/resume');
    assertEventOrder(events, 'package', `terminalize:${secondRuntimeJobId}`);
    if (events.slice(events.indexOf(`runtime-job-start:${secondRuntimeJobId}`)).includes('thread/start')) {
      throw new Error('codex runtime capsule restore resumed turn started a replacement thread');
    }

    const memoryDeltaArtifactRef = secondTerminalResult.memory_delta_artifact_ref;
    const memoryDeltaDigest = secondTerminalResult.memory_delta_digest;
    const memoryDelta =
      typeof memoryDeltaArtifactRef === 'string' && typeof memoryDeltaDigest === 'string'
        ? JSON.parse(Buffer.from(await artifactStore.read(memoryDeltaArtifactRef, memoryDeltaDigest)).toString('utf8'))
        : undefined;
    if (!isRecord(memoryDelta) || !Array.isArray(memoryDelta.operations)) {
      throw new Error('codex runtime capsule restore memory delta missing');
    }
    const counts = operationCounts(memoryDelta.operations as Array<{ op: 'add' | 'modify' | 'delete' | 'rename' }>);
    if (counts.add < 1 || counts.delete !== 0 || counts.rename !== 0) {
      throw new Error('codex runtime capsule restore second turn memory delta coverage missing');
    }
    const firstMemoryDeltaArtifactRef = firstTerminalResult.memory_delta_artifact_ref;
    const firstMemoryDeltaDigest = firstTerminalResult.memory_delta_digest;
    const replayCounts =
      typeof firstMemoryDeltaArtifactRef === 'string' && typeof firstMemoryDeltaDigest === 'string'
        ? await verifyDeleteRenameDeltaReplay({
            artifactStore,
            baseMemoryRef,
            baseMemoryDigest,
            outputMemoryRef: firstTerminalResult.output_memory_bundle_ref,
            outputMemoryDigest: firstTerminalResult.output_memory_bundle_digest,
            deltaRef: firstMemoryDeltaArtifactRef,
            deltaDigest: firstMemoryDeltaDigest,
          })
        : undefined;
    if (replayCounts === undefined) {
      throw new Error('codex runtime capsule restore memory delta replay evidence missing');
    }

    return {
      scenario_kind: input.scenarioKind,
      orchestration_path: 'remote_worker_client',
      discovery_report_digest: digest(input.discoveryReport),
      codex_cli_version_digest: input.discoveryReport.codex_cli_version_digest,
      app_server_protocol_digest: input.appServerProtocolDigest,
      worker_root_count: 2,
      restore_checks: {
        thread_locator_digest_continuity: 'passed',
        memory_output_input_digest_continuity: 'passed',
        memory_delta_replay: 'passed',
        environment_manifest_digest_continuity: 'passed',
        second_capsule_packaged: 'passed',
      },
      orchestration_checks: {
        restore_before_app_server_start: 'passed',
        locator_repaired_before_resume: 'passed',
        resumed_without_thread_start: 'passed',
        packaged_before_terminalize: 'passed',
        terminal_result_capsule_fields: 'passed',
      },
      terminal_result_digest: digest(secondTerminalResult),
      terminal_result_capsule_digest: secondOutputCapsule.digest,
      memory_delta_replay_operation_counts: replayCounts,
      memory_delta_operation_counts: counts,
      memory_input_digest: firstTerminalResult.output_memory_bundle_digest,
      memory_output_digest: firstTerminalResult.output_memory_bundle_digest,
      resumed_memory_input_digest: firstTerminalResult.output_memory_bundle_digest,
      environment_manifest_digest: secondTerminalResult.output_environment_manifest_digest,
      first_capsule_digest: firstOutputCapsule.digest,
      second_capsule_digest: secondOutputCapsule.digest,
      package_sequence_count: 2,
      public_safety: {
        raw_runtime_material: 'excluded',
        report_value_policy: 'digests_status_codes_only',
      },
    };
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
};

const runFakeCrossWorkerRestoreScenario = async (input: {
  discoveryReport: CodexRuntimeCapsuleDiscoveryReport;
}): Promise<PassedRestoreScenarioResult> =>
  runOrchestratedCrossWorkerRestoreScenario({
    discoveryReport: input.discoveryReport,
    scenarioKind: 'fake_cross_worker_restore',
    codexCliVersion: 'fake-codex 1.0.0',
    appServerProtocolDigest: input.discoveryReport.app_server_protocol_digest,
  });

const runRealCrossWorkerRestoreScenario = async (input: {
  discoveryReport: CodexRuntimeCapsuleDiscoveryReport;
  env: EnvLike;
}): Promise<PassedRestoreScenarioResult> => {
  const codexCliVersion = await execCodex(input.env, ['--version']);
  const protocolDigest = await appServerProtocolDigest(input.env);
  return runOrchestratedCrossWorkerRestoreScenario({
    discoveryReport: input.discoveryReport,
    scenarioKind: 'real_cross_worker_restore',
    env: input.env,
    codexCliVersion,
    appServerProtocolDigest: protocolDigest,
    createTransport: ({ codexHomeHostPath, mutateCodexHome }) =>
      instrumentedAppServerTransport({
        mutateCodexHome,
        base: new CodexAppServerStdioTransport({
        codexBin: codexBin(input.env),
        codexHomeRoot: codexHomeHostPath,
        cwd: process.cwd(),
        env: input.env,
      }),
      }),
  });
};

const publicSafeReport = <T extends CodexRuntimeCapsuleRestoreReport>(report: T): T => {
  assertCodexRuntimeCapsulePublicReportSafe(report);
  return report;
};

export const runCodexRuntimeCapsuleRestoreDogfood = async (
  dependencies: CodexRuntimeCapsuleRestoreDogfoodDependencies = {},
): Promise<CodexRuntimeCapsuleRestoreReport> => {
  const env = dependencies.env ?? process.env;
  const mode = dependencies.mode ?? modeFromEnv(env);
  const hasCredentials = await (dependencies.credentialsAvailable ?? (() => defaultCredentialsAvailable(mode, env)))();
  if (!hasCredentials) {
    return publicSafeReport({
      schema_version: reportSchemaVersion,
      status: 'skip',
      reason_code: 'codex_runtime_capsule_restore_credentials_unavailable',
    });
  }

  const discoveryReport =
    dependencies.discoveryReport === undefined
      ? mode === 'fake'
        ? fakeDiscoveryReport()
        : await runCodexRuntimeCapsuleDiscoveryDogfood(env)
      : await dependencies.discoveryReport();
  if (discoveryReport.status !== 'passed') {
    return publicSafeReport({
      schema_version: reportSchemaVersion,
      status: 'blocked',
      blocker_codes: sanitizeBlockerCodes(discoveryReport.blocker_codes),
    });
  }

  const scenarioResult =
    dependencies.executeRestoreScenario === undefined
      ? mode === 'fake'
        ? await runFakeCrossWorkerRestoreScenario({ discoveryReport })
        : await runRealCrossWorkerRestoreScenario({ discoveryReport, env })
      : await dependencies.executeRestoreScenario({ discoveryReport });
  if (scenarioResult === undefined) {
    return publicSafeReport({
      schema_version: reportSchemaVersion,
      status: 'blocked',
      blocker_codes: ['codex_runtime_capsule_restore_real_probe_unavailable'],
    });
  }

  return publicSafeReport({
    schema_version: reportSchemaVersion,
    status: 'passed',
    report_path: codexRuntimeCapsuleRestoreReportPath,
    ...scenarioResult,
  });
};

export const writeCodexRuntimeCapsuleRestoreReport = async (
  report: CodexRuntimeCapsuleRestoreReport,
  path = codexRuntimeCapsuleRestoreReportPath,
): Promise<void> => {
  publicSafeReport(report);
  const absolutePath = resolve(path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
};

export const renderCodexRuntimeCapsuleRestoreSummary = (report: CodexRuntimeCapsuleRestoreReport): string => {
  publicSafeReport(report);
  if (report.status === 'skip') {
    return `SKIP ${report.reason_code}`;
  }
  if (report.status === 'blocked') {
    return `BLOCKED ${report.blocker_codes.join(',')}`;
  }
  return [
    'PASS codex_runtime_capsule_restore_cross_worker_restore',
    `Report: ${report.report_path}`,
    `Discovery report digest: ${report.discovery_report_digest}`,
    `Memory input digest: ${report.memory_input_digest}`,
    `Memory output digest: ${report.memory_output_digest}`,
    `Environment manifest digest: ${report.environment_manifest_digest}`,
    `First capsule digest: ${report.first_capsule_digest}`,
    `Second capsule digest: ${report.second_capsule_digest}`,
    `Restore checks digest: ${digest(report.restore_checks)}`,
  ].join('\n');
};

export const codexRuntimeCapsuleRestoreMain = async (env: EnvLike = process.env): Promise<number> => {
  const report = await runCodexRuntimeCapsuleRestoreDogfood({ env });
  await writeCodexRuntimeCapsuleRestoreReport(report);
  console.log(renderCodexRuntimeCapsuleRestoreSummary(report));
  if (report.status === 'skip') {
    return 0;
  }
  return report.status === 'passed' ? 0 : 1;
};

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await codexRuntimeCapsuleRestoreMain();
}

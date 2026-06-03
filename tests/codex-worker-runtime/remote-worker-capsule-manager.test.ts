import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  codexCanonicalDigest,
  codexMemoryBundleDigest,
  codexRuntimeCapsuleArchiveDigest,
  codexRuntimeCapsuleArchiveSchema,
  parseInternalArtifactRef,
  type InternalArtifactKind,
} from '@forgeloop/domain';
import type { CodexLaunchMaterialization } from '@forgeloop/domain';
import { describe, expect, it } from 'vitest';

import { createRemoteWorkerCapsuleManager } from '../../packages/codex-worker-runtime/src/index';

const digest = (value: unknown): string => codexCanonicalDigest(value);
const codexSessionId = 'session-1';
const turnId = 'turn-1';
const rolloutRelativePath = 'sessions/2026/06/03/rollout-thread-a.jsonl';
const rolloutContent = '{"type":"turn_context","thread":"redacted"}\n';
const codexThreadId = 'thread-1';
const codexThreadIdDigest = digest({ kind: 'codex_app_server_thread_id', thread_id: codexThreadId });

const materialization = (): CodexLaunchMaterialization => ({
  launch_target: {
    target_type: 'automation_action_run',
    target_id: 'action-run-1',
    target_kind: 'generation',
    project_id: 'project-1',
    repo_id: 'repo-1',
  },
  lease_id: 'lease-1',
  expires_at: '2026-06-03T00:10:00.000Z',
  materialized_at: '2026-06-03T00:00:01.000Z',
  resolved_credentials: [
    {
      binding_id: 'github-a',
      binding_version_id: 'github-v1',
      payload: { token: 'secret' },
      payload_digest: digest({ token: 'secret' }),
    },
  ],
  profile_revision: {
    id: 'profile-rev-1',
    profile_id: 'profile-1',
    revision_number: 1,
    status: 'active',
    environment: 'test',
    docker_image: 'ghcr.io/forgeloop/codex',
    docker_image_digest: digest('image'),
    target_kind: 'generation',
    source_access_mode: 'artifact_only',
    codex_config_toml: 'approval_policy = "never"',
    codex_config_digest: digest('config'),
    expected_effective_config_digest: digest('effective'),
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
      artifact_bytes: 10_000,
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
    allowed_scopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
    profile_digest: digest('profile'),
    created_by_actor_id: 'actor-1',
    created_at: '2026-06-03T00:00:00.000Z',
  },
});

class InMemoryInternalArtifactClient {
  readonly artifacts = new Map<string, { bytes: Uint8Array; digest: string; kind: InternalArtifactKind }>();
  readonly uploads: Array<{ ref: string; kind: InternalArtifactKind; bytes: Uint8Array; digest: string }> = [];

  seed(input: { ref: string; kind: InternalArtifactKind; bytes: Uint8Array; digest: string }): void {
    this.artifacts.set(input.ref, { bytes: input.bytes, digest: input.digest, kind: input.kind });
  }

  async downloadInternalArtifact(input: { ref: string; expectedDigest: string }): Promise<Uint8Array> {
    const artifact = this.artifacts.get(input.ref);
    if (artifact === undefined) {
      throw new Error(`missing artifact: ${input.ref}`);
    }
    if (artifact.digest !== input.expectedDigest) {
      throw new Error('artifact digest mismatch');
    }
    return artifact.bytes;
  }

  async uploadInternalArtifact(input: {
    kind: InternalArtifactKind;
    ownerType: 'codex_session';
    ownerId: string;
    bytes: Uint8Array;
    metadataJson?: Record<string, unknown>;
  }): Promise<{ ref: string; digest: string; size_bytes: string }> {
    const artifactId = String(input.metadataJson?.artifact_id ?? `${input.kind}-${this.uploads.length}`);
    const ref = `artifact://internal/${input.kind}/codex_session/${input.ownerId}/${artifactId}`;
    const digestFromBytes = `sha256:${createHash('sha256').update(input.bytes).digest('hex')}`;
    this.artifacts.set(ref, { bytes: input.bytes, digest: digestFromBytes, kind: input.kind });
    this.uploads.push({ ref, kind: input.kind, bytes: input.bytes, digest: digestFromBytes });
    return { ref, digest: digestFromBytes, size_bytes: String(input.bytes.byteLength) };
  }
}

const jsonBytes = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));

const memoryBundle = (content: string) => ({
  schema_version: 'codex_memory_bundle_manifest.v1',
  bundle_id: 'memory-base',
  codex_session_id: codexSessionId,
  source_policy_digest: digest({ policy: 'base' }),
  entries: [{
    relative_path: 'memories/session.md',
    source_kind: 'session_memory',
    content_digest: digest(content),
    size_bytes: String(Buffer.byteLength(content)),
    content,
    operation: 'present',
  }],
});

describe('RemoteWorkerCapsuleManager', () => {
  it('materializes first-turn base memory and packages a verified output capsule archive', async () => {
    const artifactClient = new InMemoryInternalArtifactClient();
    const baseBundle = memoryBundle('base memory\n');
    const baseMemoryRef = `artifact://internal/codex_memory_bundle/codex_session/${codexSessionId}/memory-base`;
    artifactClient.seed({
      ref: baseMemoryRef,
      kind: 'codex_memory_bundle',
      bytes: jsonBytes(baseBundle),
      digest: codexMemoryBundleDigest(baseBundle),
    });
    const manager = createRemoteWorkerCapsuleManager({
      controlPlaneClient: artifactClient,
      workerId: 'worker-1',
      codexCliVersion: 'codex-cli 0.133.0',
      appServerProtocolDigest: digest({ protocol: 'app-server-v1' }),
      now: () => '2026-06-03T00:00:00.000Z',
    });
    const codexHomeRoot = await mkdtemp(join(tmpdir(), 'forgeloop-capsule-manager-'));
    const artifactHostPath = await mkdtemp(join(tmpdir(), 'forgeloop-capsule-artifacts-'));

    await manager.materializeBaseMemory({
      codexHomeHostPath: codexHomeRoot,
      artifactHostPath,
      codexSessionId,
      codexSessionTurnId: turnId,
      baseMemoryBundleRef: baseMemoryRef,
      baseMemoryBundleDigest: codexMemoryBundleDigest(baseBundle),
      materialization: materialization(),
    });
    await expect(readFile(join(codexHomeRoot, 'memories/session.md'), 'utf8')).resolves.toBe('base memory\n');

    await writeFile(join(codexHomeRoot, 'memories/session.md'), 'updated memory\n');
    await mkdir(join(codexHomeRoot, 'sessions/2026/06/03'), { recursive: true });
    await writeFile(join(codexHomeRoot, rolloutRelativePath), rolloutContent);

    const result = await manager.package({
      codexHomeHostPath: codexHomeRoot,
      artifactHostPath,
      codexSessionId,
      codexSessionTurnId: turnId,
      materialization: materialization(),
      status: 'succeeded',
      runtimeEvidence: {
        runtime_profile_id: 'profile-1',
        runtime_profile_revision_id: 'profile-rev-1',
        runtime_profile_digest: digest('runtime'),
        runtime_target_kind: 'generation',
        source_access_mode: 'artifact_only',
        environment: 'test',
        launch_lease_id: 'lease-1',
        worker_id: 'worker-1',
        docker_image_digest: digest('image'),
        container_id_digest: digest('container'),
        app_server_effective_config_digest: digest('effective'),
        docker_policy_self_check_digest: digest('docker-policy'),
        app_server_attempted: true,
        selected_execution_mode: 'app_server',
      },
      generationResult: {
        taskKind: 'spec_draft',
        promptVersion: 'prompt-v1',
        outputSchemaVersion: 'spec_draft.v1',
        generated: { schema_version: 'spec_draft.v1' },
        generationArtifacts: [],
        publicSummary: 'summary',
        codexThread: { codex_thread_id: codexThreadId, codex_thread_id_digest: codexThreadIdDigest },
      },
    });

    expect(parseInternalArtifactRef(result.capsule.artifact_ref)).toMatchObject({ kind: 'codex_runtime_capsule' });
    expect(result.memoryDeltaDigest).toBeDefined();
    const capsuleUpload = artifactClient.uploads.find((upload) => upload.kind === 'codex_runtime_capsule');
    expect(capsuleUpload).toBeDefined();
    const archive = codexRuntimeCapsuleArchiveSchema.parse(JSON.parse(Buffer.from(capsuleUpload!.bytes).toString('utf8')));
    expect(codexRuntimeCapsuleArchiveDigest(archive)).toBe(result.capsule.digest);
    expect(archive.manifest.memory_state.output_bundle_ref).toBe(result.outputMemoryBundleRef);
    expect(archive.manifest.environment_manifest.artifact_ref).toBe(result.outputEnvironmentManifestRef);
  });
});

import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildInternalArtifactRef,
  codexCanonicalDigest,
  codexRuntimeCapsuleManifestDigest,
} from '@forgeloop/domain';
import { describe, expect, it } from 'vitest';

import {
  CodexRuntimeCapsuleMaterializer,
  type CapsuleComponentArtifactReader,
} from '../../packages/codex-worker-runtime/src/index';

const codexSessionId = 'codex-session-1';
const digest = (input: unknown): string => codexCanonicalDigest(input);

const ref = (kind: Parameters<typeof buildInternalArtifactRef>[0]['kind'], artifactId: string): string =>
  buildInternalArtifactRef({ kind, owner_type: 'codex_session', owner_id: codexSessionId, artifact_id: artifactId });

class EmptyArtifactReader implements CapsuleComponentArtifactReader {
  async read(): Promise<Uint8Array> {
    throw new Error('unexpected artifact read');
  }
}

describe('Codex runtime capsule materializer', () => {
  it('writes trusted config/auth and never copies capsule config/auth files', async () => {
    const codexHomeRoot = await mkdtemp(join(tmpdir(), 'forgeloop-codex-materializer-'));
    const capsuleManifest = {
      schema_version: 'codex_runtime_capsule_manifest.v1',
      codex_session_id: codexSessionId,
      created_from_turn_id: 'turn-1',
      sequence: 1,
      codex_thread_id_digest: digest({ thread: 'thread-a' }),
      codex_cli_version: 'codex-cli 1.2.3',
      app_server_protocol_digest: digest({ protocol: 'app-server-v1' }),
      thread_state: { artifact_ref: ref('codex_thread_state_bundle', 'thread-state-a'), digest: digest({ thread: 'state' }) },
      memory_state: {
        base_bundle_ref: ref('codex_memory_bundle', 'memory-base'),
        base_bundle_digest: digest({ memory: 'base' }),
        input_bundle_ref: ref('codex_memory_bundle', 'memory-input'),
        input_bundle_digest: digest({ memory: 'input' }),
        output_bundle_ref: ref('codex_memory_bundle', 'memory-output'),
        output_bundle_digest: digest({ memory: 'output' }),
        delta_ref: ref('codex_memory_delta', 'memory-delta'),
        delta_digest: digest({ memory: 'delta' }),
      },
      environment_manifest: { artifact_ref: ref('codex_environment_manifest', 'environment-a'), digest: digest({ environment: 'manifest' }) },
      included_files: ['sessions/2026/06/03/rollout-a.jsonl', 'auth.json', 'config.toml'],
      excluded_patterns: [],
      forbidden_patterns_checked: ['auth.json', 'config.toml'],
    };
    const materializer = new CodexRuntimeCapsuleMaterializer({ artifactReader: new EmptyArtifactReader() });

    const result = await materializer.materialize({
      codexHomeRoot,
      capsuleManifest,
      runtimeProfileMaterialization: {
        codexConfigToml: 'approval_policy = "never"\n',
      },
      credentialBindingMaterialization: {
        authJson: { OPENAI_API_KEY: 'sk-test' },
      },
    });

    await expect(readFile(join(codexHomeRoot, 'config.toml'), 'utf8')).resolves.toContain('approval_policy');
    await expect(readFile(join(codexHomeRoot, 'auth.json'), 'utf8')).resolves.toContain('"OPENAI_API_KEY"');
    expect(result.capsuleManifestDigest).toBe(codexRuntimeCapsuleManifestDigest(capsuleManifest));
    expect(result.copiedCapsuleFiles).toContain('sessions/2026/06/03/rollout-a.jsonl');
    expect(result.copiedCapsuleFiles).not.toContain('auth.json');
    expect(result.copiedCapsuleFiles).not.toContain('config.toml');
  });
});

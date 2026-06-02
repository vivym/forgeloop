import { lstat, readdir } from 'node:fs/promises';

import {
  assertCodexSessionArtifactRef,
  codexCanonicalDigest,
  codexEnvironmentManifestDigest,
  codexMemoryBundleDigest,
  codexMemoryBundleManifestSchema,
  codexMemoryDeltaDigest,
  codexMemoryDeltaManifestSchema,
  codexRuntimeCapsuleManifestDigest,
  codexRuntimeCapsuleManifestSchema,
} from '@forgeloop/domain';
import type { z } from 'zod';

import {
  restoreCodexThreadStateBundle,
  type ThreadStateBundle,
} from './thread-state.js';
import {
  validateCodexEnvironmentState,
  type CapsuleComponentArtifactReader,
  type CodexEnvironmentManifest,
} from './environment-state.js';

type RestoredRuntimeCapsuleManifest = z.infer<typeof codexRuntimeCapsuleManifestSchema>;

export interface RestoredCodexRuntimeCapsule {
  capsuleManifest: RestoredRuntimeCapsuleManifest;
  capsuleManifestDigest: string;
  threadStateBundle: ThreadStateBundle;
  environmentManifest: CodexEnvironmentManifest;
}

const parseJsonArtifact = async <T>(
  artifactReader: CapsuleComponentArtifactReader,
  ref: string,
  expectedDigest: string,
  label: string,
  parse: (value: unknown) => T,
): Promise<T> => {
  const bytes = await artifactReader.read(ref, expectedDigest);
  const value = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  const parsed = parse(value);
  const actualDigest = digestForLabel(parsed, label);
  if (actualDigest !== expectedDigest) {
    throw new Error(`${label} digest mismatch`);
  }
  return parsed;
};

const digestForLabel = (value: unknown, label: string): string => {
  if (label === 'capsule manifest') {
    return codexRuntimeCapsuleManifestDigest(value);
  }
  if (label === 'memory bundle') {
    return codexMemoryBundleDigest(value);
  }
  if (label === 'memory delta') {
    return codexMemoryDeltaDigest(value);
  }
  if (label === 'environment manifest') {
    return codexEnvironmentManifestDigest(value);
  }
  return codexCanonicalDigest(value);
};

const assertFreshIsolatedRoot = async (codexHomeRoot: string): Promise<void> => {
  const rootStat = await lstat(codexHomeRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error('restore target CODEX_HOME must be a fresh isolated root directory');
  }
  const entries = await readdir(codexHomeRoot);
  if (entries.length > 0) {
    throw new Error('restore target CODEX_HOME must be fresh and empty');
  }
};

const assertRuntimeMatches = (input: {
  capsuleManifest: RestoredRuntimeCapsuleManifest;
  codexSessionId: string;
  currentCodexCliVersion: string;
  currentAppServerProtocolDigest: string;
}): void => {
  if (input.capsuleManifest.codex_session_id !== input.codexSessionId) {
    throw new Error('capsule codex session mismatch');
  }
  if (input.capsuleManifest.codex_cli_version !== input.currentCodexCliVersion) {
    throw new Error('capsule Codex CLI version mismatch');
  }
  if (input.capsuleManifest.app_server_protocol_digest !== input.currentAppServerProtocolDigest) {
    throw new Error('capsule app-server protocol digest mismatch');
  }
};

export const restoreCodexRuntimeCapsule = async (input: {
  codexHomeRoot: string;
  codexSessionId: string;
  expectedCapsuleDigest: string;
  capsuleRef: string;
  artifactReader: CapsuleComponentArtifactReader;
  currentCodexCliVersion: string;
  currentAppServerProtocolDigest: string;
}): Promise<RestoredCodexRuntimeCapsule> => {
  await assertFreshIsolatedRoot(input.codexHomeRoot);
  assertCodexSessionArtifactRef({
    ref: input.capsuleRef,
    expectedKind: 'codex_runtime_capsule',
    codexSessionId: input.codexSessionId,
  });

  const capsuleManifest = await parseJsonArtifact(
    input.artifactReader,
    input.capsuleRef,
    input.expectedCapsuleDigest,
    'capsule manifest',
    (value) => codexRuntimeCapsuleManifestSchema.parse(value) as RestoredRuntimeCapsuleManifest,
  );
  assertRuntimeMatches({
    capsuleManifest,
    codexSessionId: input.codexSessionId,
    currentCodexCliVersion: input.currentCodexCliVersion,
    currentAppServerProtocolDigest: input.currentAppServerProtocolDigest,
  });

  assertCodexSessionArtifactRef({
    ref: capsuleManifest.thread_state.artifact_ref,
    expectedKind: 'codex_thread_state_bundle',
    codexSessionId: input.codexSessionId,
  });
  const threadStateBundle = await parseJsonArtifact(
    input.artifactReader,
    capsuleManifest.thread_state.artifact_ref,
    capsuleManifest.thread_state.digest,
    'thread state bundle',
    (value) => value as ThreadStateBundle,
  );

  for (const [ref, expectedDigest] of [
    [capsuleManifest.memory_state.base_bundle_ref, capsuleManifest.memory_state.base_bundle_digest],
    [capsuleManifest.memory_state.input_bundle_ref, capsuleManifest.memory_state.input_bundle_digest],
    [capsuleManifest.memory_state.output_bundle_ref, capsuleManifest.memory_state.output_bundle_digest],
  ] as const) {
    assertCodexSessionArtifactRef({ ref, expectedKind: 'codex_memory_bundle', codexSessionId: input.codexSessionId });
    await parseJsonArtifact(input.artifactReader, ref, expectedDigest, 'memory bundle', (value) =>
      codexMemoryBundleManifestSchema.parse(value),
    );
  }
  assertCodexSessionArtifactRef({
    ref: capsuleManifest.memory_state.delta_ref,
    expectedKind: 'codex_memory_delta',
    codexSessionId: input.codexSessionId,
  });
  await parseJsonArtifact(input.artifactReader, capsuleManifest.memory_state.delta_ref, capsuleManifest.memory_state.delta_digest, 'memory delta', (value) =>
    codexMemoryDeltaManifestSchema.parse(value),
  );

  assertCodexSessionArtifactRef({
    ref: capsuleManifest.environment_manifest.artifact_ref,
    expectedKind: 'codex_environment_manifest',
    codexSessionId: input.codexSessionId,
  });
  const environmentManifest = await parseJsonArtifact(
    input.artifactReader,
    capsuleManifest.environment_manifest.artifact_ref,
    capsuleManifest.environment_manifest.digest,
    'environment manifest',
    (value) => validateCodexEnvironmentState({ environmentManifest: value }).manifest,
  );

  if (
    environmentManifest.codex_cli_version !== input.currentCodexCliVersion ||
    environmentManifest.app_server_protocol_digest !== input.currentAppServerProtocolDigest
  ) {
    throw new Error('environment manifest runtime protocol or CLI version mismatch');
  }

  await restoreCodexThreadStateBundle({
    codexHomeRoot: input.codexHomeRoot,
    bundle: threadStateBundle,
    locatorRepair: threadStateBundle.locator_repair_manifest,
  });

  return {
    capsuleManifest,
    capsuleManifestDigest: codexRuntimeCapsuleManifestDigest(capsuleManifest),
    threadStateBundle,
    environmentManifest,
  };
};

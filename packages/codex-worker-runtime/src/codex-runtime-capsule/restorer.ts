import { lstat, readdir } from 'node:fs/promises';

import {
  assertCodexSessionArtifactRef,
  codexCanonicalDigest,
  codexEnvironmentManifestDigest,
  codexMemoryBundleDigest,
  codexMemoryBundleManifestSchema,
  codexMemoryDeltaDigest,
  codexMemoryDeltaManifestSchema,
  codexRuntimeCapsuleArchiveDigest,
  codexRuntimeCapsuleArchiveSchema,
  codexRuntimeCapsuleManifestDigest,
  codexRuntimeCapsuleManifestSchema,
} from '@forgeloop/domain';
import type { z } from 'zod';

import {
  restoreCodexThreadStateBundle,
  parseThreadStateBundle,
  type ThreadStateBundle,
  type CodexThreadLocatorRepairExecutor,
} from './thread-state.js';
import {
  materializeCodexMemoryBundleToRoot,
  type CodexMemoryBundleManifest,
  type CodexMemoryDeltaManifest,
} from './memory-state.js';
import {
  validateCodexEnvironmentState,
  materializeCodexEnvironmentState,
  type CapsuleComponentArtifactReader,
  type CodexEnvironmentManifest,
} from './environment-state.js';

type RestoredRuntimeCapsuleManifest = z.infer<typeof codexRuntimeCapsuleManifestSchema>;
type RestoredRuntimeCapsuleArchive = z.infer<typeof codexRuntimeCapsuleArchiveSchema>;

export interface RestoredCodexRuntimeCapsule {
  capsuleManifest: RestoredRuntimeCapsuleManifest;
  capsuleManifestDigest: string;
  threadStateBundle: ThreadStateBundle;
  environmentManifest: CodexEnvironmentManifest;
  outputMemoryBundle: CodexMemoryBundleManifest;
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
  if (label === 'capsule archive') {
    return codexRuntimeCapsuleArchiveDigest(value);
  }
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
    throw new Error('restore target codex home root must be a fresh isolated root directory');
  }
  const entries = await readdir(codexHomeRoot);
  if (entries.length > 0) {
    throw new Error('restore target codex home root must be fresh and empty');
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
  codexThreadId?: string;
  locatorRepairExecutor?: CodexThreadLocatorRepairExecutor;
  deferLocatorRepair?: boolean;
}): Promise<RestoredCodexRuntimeCapsule> => {
  await assertFreshIsolatedRoot(input.codexHomeRoot);
  assertCodexSessionArtifactRef({
    ref: input.capsuleRef,
    expectedKind: 'codex_runtime_capsule',
    codexSessionId: input.codexSessionId,
  });

  const capsuleArchive = await parseJsonArtifact(
    input.artifactReader,
    input.capsuleRef,
    input.expectedCapsuleDigest,
    'capsule archive',
    (value) => codexRuntimeCapsuleArchiveSchema.parse(value) as RestoredRuntimeCapsuleArchive,
  );
  const capsuleManifest = capsuleArchive.manifest;
  if (codexRuntimeCapsuleManifestDigest(capsuleManifest) !== capsuleArchive.manifest_digest) {
    throw new Error('capsule manifest digest mismatch');
  }
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
    parseThreadStateBundle,
  );
  if (threadStateBundle.codex_session_id !== input.codexSessionId) {
    throw new Error('thread state bundle codex session mismatch');
  }
  if (threadStateBundle.locator_repair_manifest.codex_thread_id_digest !== capsuleManifest.codex_thread_id_digest) {
    throw new Error('thread state bundle codex thread digest mismatch');
  }

  const memoryComponentRefs: Array<readonly [string, string]> = [
    [capsuleManifest.memory_state.base_bundle_ref, capsuleManifest.memory_state.base_bundle_digest],
    [capsuleManifest.memory_state.input_bundle_ref, capsuleManifest.memory_state.input_bundle_digest],
    [capsuleManifest.memory_state.output_bundle_ref, capsuleManifest.memory_state.output_bundle_digest],
  ];
  const memoryBundles = await Promise.all(
    memoryComponentRefs.map(async ([ref, expectedDigest]): Promise<CodexMemoryBundleManifest> => {
      assertCodexSessionArtifactRef({ ref, expectedKind: 'codex_memory_bundle', codexSessionId: input.codexSessionId });
      return parseJsonArtifact(input.artifactReader, ref, expectedDigest, 'memory bundle', (value) =>
        codexMemoryBundleManifestSchema.parse(value) as CodexMemoryBundleManifest,
      );
    }),
  );
  for (const memoryBundle of memoryBundles) {
    if (memoryBundle.codex_session_id !== input.codexSessionId) {
      throw new Error('memory bundle codex session mismatch');
    }
  }
  if (capsuleManifest.memory_state.delta_ref !== undefined && capsuleManifest.memory_state.delta_digest !== undefined) {
    assertCodexSessionArtifactRef({
      ref: capsuleManifest.memory_state.delta_ref,
      expectedKind: 'codex_memory_delta',
      codexSessionId: input.codexSessionId,
    });
    const memoryDelta = await parseJsonArtifact(
      input.artifactReader,
      capsuleManifest.memory_state.delta_ref,
      capsuleManifest.memory_state.delta_digest,
      'memory delta',
      (value) => codexMemoryDeltaManifestSchema.parse(value) as CodexMemoryDeltaManifest,
    );
    if (memoryDelta.codex_session_id !== input.codexSessionId) {
      throw new Error('memory delta codex session mismatch');
    }
    if (memoryDelta.input_bundle_digest !== capsuleManifest.memory_state.input_bundle_digest) {
      throw new Error('memory delta input bundle digest mismatch');
    }
    if (memoryDelta.output_bundle_digest !== capsuleManifest.memory_state.output_bundle_digest) {
      throw new Error('memory delta output bundle digest mismatch');
    }
  }

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

  const outputMemoryBundle = memoryBundles[2]!;
  await materializeCodexMemoryBundleToRoot({
    root: input.codexHomeRoot,
    bundle: outputMemoryBundle,
  });
  await materializeCodexEnvironmentState({
    targetCodexHomeRoot: input.codexHomeRoot,
    environmentManifest,
    artifactReader: input.artifactReader,
  });

  await restoreCodexThreadStateBundle({
    codexHomeRoot: input.codexHomeRoot,
    bundle: threadStateBundle,
    locatorRepair: threadStateBundle.locator_repair_manifest,
    ...(input.codexThreadId === undefined ? {} : { codexThreadId: input.codexThreadId }),
    ...(input.locatorRepairExecutor === undefined ? {} : { repairExecutor: input.locatorRepairExecutor }),
    ...(input.deferLocatorRepair === undefined ? {} : { deferLocatorRepair: input.deferLocatorRepair }),
  });

  return {
    capsuleManifest,
    capsuleManifestDigest: codexRuntimeCapsuleManifestDigest(capsuleManifest),
    threadStateBundle,
    environmentManifest,
    outputMemoryBundle,
  };
};

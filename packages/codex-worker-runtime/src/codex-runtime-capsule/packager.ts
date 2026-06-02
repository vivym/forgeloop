import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  assertCodexSessionArtifactRef,
  buildInternalArtifactRef,
  codexCanonicalDigest,
  codexEnvironmentManifestDigest,
  codexMemoryBundleDigest,
  codexMemoryBundleManifestSchema,
  codexMemoryDeltaDigest,
  codexMemoryDeltaManifestSchema,
  codexRuntimeCapsuleManifestDigest,
  codexRuntimeCapsuleManifestSchema,
  DomainError,
  type InternalArtifactKind,
} from '@forgeloop/domain';
import type { z } from 'zod';

import {
  assertSafeCodexHomeRelativePath,
  classifyCodexHomePath,
} from './path-classifier.js';
import {
  packageCodexThreadStateBundle,
  type ThreadStateBundleBuildResult,
} from './thread-state.js';
import { validateCodexEnvironmentState } from './environment-state.js';
import type { CodexThreadLocatorRepairManifest } from './discovery.js';

type RuntimeCapsuleManifest = z.infer<typeof codexRuntimeCapsuleManifestSchema>;
type CodexMemoryBundleManifest = z.infer<typeof codexMemoryBundleManifestSchema>;
type CodexMemoryDeltaManifest = z.infer<typeof codexMemoryDeltaManifestSchema>;

export interface CodexRuntimeCapsuleArtifactWriter {
  write(input: {
    kind: InternalArtifactKind;
    ownerId: string;
    artifactId: string;
    content: Uint8Array;
    digest: string;
    metadata: Record<string, unknown>;
  }): Promise<{ ref: string; digest: string; size_bytes: string }>;
}

export interface CodexRuntimeCapsulePackageInput {
  codexHomeRoot: string;
  codexSessionId: string;
  capsuleId: string;
  createdFromTurnId: string;
  sequence: number;
  codexThreadIdDigest: string;
  codexCliVersion: string;
  appServerProtocolDigest: string;
  locatorRepair: CodexThreadLocatorRepairManifest;
  memoryState: {
    baseBundle: CodexMemoryBundleManifest;
    baseBundleDigest: string;
    inputBundle: CodexMemoryBundleManifest;
    inputBundleDigest: string;
    outputBundle: CodexMemoryBundleManifest;
    outputBundleDigest: string;
    delta: CodexMemoryDeltaManifest;
    deltaDigest: string;
  };
  environmentManifest: unknown;
  environmentManifestDigest: string;
}

export interface CodexRuntimeCapsulePackageResult {
  manifest: RuntimeCapsuleManifest;
  digest: string;
  artifactRef: string;
  artifactSizeBytes: string;
  threadState: ThreadStateBundleBuildResult;
}

const jsonBytes = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));

const unknownPathError = (relativePath: string, reason: string): DomainError =>
  new DomainError('codex_runtime_capsule_unknown_path', 'Codex runtime capsule contains a path that cannot be packaged.', {
    relative_path: relativePath,
    reason,
  });

const listCodexHomeFiles = async (root: string, prefix = ''): Promise<string[]> => {
  const directory = join(root, prefix);
  const names = await readdir(directory);
  const files: string[] = [];
  for (const name of names) {
    const relativePath = prefix.length === 0 ? name : `${prefix}/${name}`;
    assertSafeCodexHomeRelativePath(relativePath);
    const path = join(root, relativePath);
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) {
      throw new Error(`unsafe Codex home path entry: ${relativePath} is a symlink`);
    }
    if (stat.isDirectory()) {
      files.push(...(await listCodexHomeFiles(root, relativePath)));
    } else if (stat.isFile()) {
      files.push(relativePath);
    } else {
      throw unknownPathError(relativePath, 'non_regular_entry');
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
};

const assertNoForbiddenOrUnknownCodexHomeFiles = async (root: string): Promise<void> => {
  for (const relativePath of await listCodexHomeFiles(root)) {
    const classification = classifyCodexHomePath(relativePath).classification;
    if (classification === 'forbidden' || classification === 'forbidden_whole_db' || classification === 'unknown') {
      throw unknownPathError(relativePath, classification);
    }
  }
};

const assertDigest = (actual: string, expected: string, label: string): void => {
  if (actual !== expected) {
    throw new Error(`${label} digest mismatch`);
  }
};

const writeJsonArtifact = async (
  artifactWriter: CodexRuntimeCapsuleArtifactWriter,
  input: {
    kind: InternalArtifactKind;
    ownerId: string;
    artifactId: string;
    manifest: unknown;
    digest: string;
    metadata?: Record<string, unknown>;
  },
): Promise<{ ref: string; digest: string; size_bytes: string }> => {
  const content = jsonBytes(input.manifest);
  const written = await artifactWriter.write({
    kind: input.kind,
    ownerId: input.ownerId,
    artifactId: input.artifactId,
    content,
    digest: input.digest,
    metadata: input.metadata ?? {},
  });
  assertDigest(written.digest, input.digest, `${input.kind} upload`);
  assertCodexSessionArtifactRef({ ref: written.ref, expectedKind: input.kind, codexSessionId: input.ownerId });
  return written;
};

export const packageCodexRuntimeCapsule = async (
  input: CodexRuntimeCapsulePackageInput & { artifactWriter: CodexRuntimeCapsuleArtifactWriter },
): Promise<CodexRuntimeCapsulePackageResult> => {
  await assertNoForbiddenOrUnknownCodexHomeFiles(input.codexHomeRoot);
  if (input.codexThreadIdDigest !== input.locatorRepair.codex_thread_id_digest) {
    throw new Error('codex runtime capsule thread locator digest mismatch');
  }

  const threadState = await packageCodexThreadStateBundle({
    codexHomeRoot: input.codexHomeRoot,
    locatorRepair: input.locatorRepair,
    codexSessionId: input.codexSessionId,
    capsuleId: input.capsuleId,
  });

  const baseMemoryBundle = codexMemoryBundleManifestSchema.parse(input.memoryState.baseBundle);
  const inputMemoryBundle = codexMemoryBundleManifestSchema.parse(input.memoryState.inputBundle);
  const outputMemoryBundle = codexMemoryBundleManifestSchema.parse(input.memoryState.outputBundle);
  const memoryDelta = codexMemoryDeltaManifestSchema.parse(input.memoryState.delta);
  assertDigest(codexMemoryBundleDigest(baseMemoryBundle), input.memoryState.baseBundleDigest, 'base memory bundle');
  assertDigest(codexMemoryBundleDigest(inputMemoryBundle), input.memoryState.inputBundleDigest, 'input memory bundle');
  assertDigest(codexMemoryBundleDigest(outputMemoryBundle), input.memoryState.outputBundleDigest, 'output memory bundle');
  assertDigest(codexMemoryDeltaDigest(memoryDelta), input.memoryState.deltaDigest, 'memory delta');
  const environmentValidation = validateCodexEnvironmentState({ environmentManifest: input.environmentManifest });
  assertDigest(environmentValidation.environmentManifestDigest, input.environmentManifestDigest, 'environment manifest');

  const ownerId = input.codexSessionId;
  const threadWrite = await writeJsonArtifact(input.artifactWriter, {
    kind: 'codex_thread_state_bundle',
    ownerId,
    artifactId: `${input.capsuleId}-thread-state`,
    manifest: threadState.bundle,
    digest: threadState.digest,
  });
  const baseMemoryWrite = await writeJsonArtifact(input.artifactWriter, {
    kind: 'codex_memory_bundle',
    ownerId,
    artifactId: `${input.capsuleId}-memory-base`,
    manifest: baseMemoryBundle,
    digest: input.memoryState.baseBundleDigest,
  });
  const inputMemoryWrite = await writeJsonArtifact(input.artifactWriter, {
    kind: 'codex_memory_bundle',
    ownerId,
    artifactId: `${input.capsuleId}-memory-input`,
    manifest: inputMemoryBundle,
    digest: input.memoryState.inputBundleDigest,
  });
  const outputMemoryWrite = await writeJsonArtifact(input.artifactWriter, {
    kind: 'codex_memory_bundle',
    ownerId,
    artifactId: `${input.capsuleId}-memory-output`,
    manifest: outputMemoryBundle,
    digest: input.memoryState.outputBundleDigest,
  });
  const memoryDeltaWrite = await writeJsonArtifact(input.artifactWriter, {
    kind: 'codex_memory_delta',
    ownerId,
    artifactId: `${input.capsuleId}-memory-delta`,
    manifest: memoryDelta,
    digest: input.memoryState.deltaDigest,
  });
  const environmentWrite = await writeJsonArtifact(input.artifactWriter, {
    kind: 'codex_environment_manifest',
    ownerId,
    artifactId: `${input.capsuleId}-environment-manifest`,
    manifest: environmentValidation.manifest,
    digest: input.environmentManifestDigest,
  });

  const manifest = codexRuntimeCapsuleManifestSchema.parse({
    schema_version: 'codex_runtime_capsule_manifest.v1',
    codex_session_id: input.codexSessionId,
    created_from_turn_id: input.createdFromTurnId,
    sequence: input.sequence,
    codex_thread_id_digest: input.codexThreadIdDigest,
    codex_cli_version: input.codexCliVersion,
    app_server_protocol_digest: input.appServerProtocolDigest,
    thread_state: { artifact_ref: threadWrite.ref, digest: threadWrite.digest },
    memory_state: {
      base_bundle_ref: baseMemoryWrite.ref,
      base_bundle_digest: baseMemoryWrite.digest,
      input_bundle_ref: inputMemoryWrite.ref,
      input_bundle_digest: inputMemoryWrite.digest,
      output_bundle_ref: outputMemoryWrite.ref,
      output_bundle_digest: outputMemoryWrite.digest,
      delta_ref: memoryDeltaWrite.ref,
      delta_digest: memoryDeltaWrite.digest,
    },
    environment_manifest: { artifact_ref: environmentWrite.ref, digest: environmentWrite.digest },
    included_files: [input.locatorRepair.rollout_relative_path],
    excluded_patterns: ['auth.json', 'config.toml', 'state_*.sqlite', 'logs_*.sqlite', 'memories_*.sqlite', 'plugins/**'],
    forbidden_patterns_checked: ['auth.json', 'config.toml', 'state_*.sqlite', 'logs_*.sqlite', 'memories_*.sqlite', 'plugins/**'],
  });
  const capsuleDigest = codexRuntimeCapsuleManifestDigest(manifest);
  const capsuleWrite = await writeJsonArtifact(input.artifactWriter, {
    kind: 'codex_runtime_capsule',
    ownerId,
    artifactId: input.capsuleId,
    manifest,
    digest: capsuleDigest,
    metadata: { schema_version: manifest.schema_version },
  });
  const canonicalCapsuleRef = buildInternalArtifactRef({
    kind: 'codex_runtime_capsule',
    owner_type: 'codex_session',
    owner_id: input.codexSessionId,
    artifact_id: input.capsuleId,
  });
  if (capsuleWrite.ref !== canonicalCapsuleRef) {
    assertCodexSessionArtifactRef({ ref: capsuleWrite.ref, expectedKind: 'codex_runtime_capsule', codexSessionId: input.codexSessionId });
  }

  return {
    manifest,
    digest: capsuleDigest,
    artifactRef: capsuleWrite.ref,
    artifactSizeBytes: capsuleWrite.size_bytes,
    threadState,
  };
};

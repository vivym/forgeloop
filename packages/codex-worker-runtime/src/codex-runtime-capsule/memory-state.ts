import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  codexCanonicalDigest,
  codexMemoryBundleDigest,
  codexMemoryBundleManifestSchema,
  codexMemoryDeltaDigest,
  codexMemoryDeltaManifestSchema,
} from '@forgeloop/domain';
import type { z } from 'zod';

export type CodexMemoryBundleManifest = z.infer<typeof codexMemoryBundleManifestSchema>;
export type CodexMemoryDeltaManifest = z.infer<typeof codexMemoryDeltaManifestSchema>;

type MemoryEntry = CodexMemoryBundleManifest['entries'][number];
export interface CodexMemoryBundleMetadata {
  bundleId: string;
  sourcePolicyDigest: string;
}

type BundleBuildMetadata = CodexMemoryBundleMetadata & {
  codexSessionId: string;
};

export interface CodexMemoryBundleBuildResult {
  manifest: CodexMemoryBundleManifest;
  digest: string;
}

const bytesDigest = (bytes: Uint8Array): string => codexCanonicalDigest(Buffer.from(bytes).toString('utf8'));
const materializedSourcePolicyDigest = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
const defaultBundleMetadata: CodexMemoryBundleMetadata = {
  bundleId: 'materialized',
  sourcePolicyDigest: materializedSourcePolicyDigest,
};

export interface CodexMemoryDeltaContentReader {
  read(input: { deltaDigest: string; relativePath: string; expectedDigest: string }): Promise<Uint8Array>;
}

const validateMemoryRelativePath = (relativePath: string): string => {
  if (relativePath.trim() !== relativePath || relativePath.length === 0) {
    throw new Error('unsafe memory relative path: path must be non-empty and canonical');
  }
  if (relativePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(relativePath)) {
    throw new Error('unsafe memory relative path: absolute paths are forbidden');
  }
  if (relativePath.includes('\\')) {
    throw new Error('unsafe memory relative path: backslashes are forbidden');
  }
  const parts = relativePath.split('/');
  if (parts.some((part) => part.length === 0 || part === '.' || part === '..')) {
    throw new Error('unsafe memory relative path: traversal and empty segments are forbidden');
  }
  return relativePath;
};

const memoryPath = (root: string, relativePath: string): string => join(root, validateMemoryRelativePath(relativePath));

const assertSafeRoot = async (root: string): Promise<void> => {
  const rootStat = await lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error('unsafe memory root: root must be a real directory');
  }
};

const assertExistingDirectoryNoSymlink = async (path: string, relativePath: string): Promise<void> => {
  const pathStat = await lstat(path);
  if (pathStat.isSymbolicLink()) {
    throw new Error(`unsafe memory path entry: ${relativePath} contains a symlink`);
  }
  if (!pathStat.isDirectory()) {
    throw new Error(`unsafe memory path entry: ${relativePath} parent is not a directory`);
  }
};

const ensureSafeParentDirectory = async (root: string, relativePath: string): Promise<void> => {
  const safeRelativePath = validateMemoryRelativePath(relativePath);
  await assertSafeRoot(root);
  const parentParts = safeRelativePath.split('/').slice(0, -1);
  let currentRelativePath = '';
  let currentPath = root;
  for (const part of parentParts) {
    currentRelativePath = currentRelativePath.length === 0 ? part : `${currentRelativePath}/${part}`;
    currentPath = join(currentPath, part);
    try {
      await assertExistingDirectoryNoSymlink(currentPath, currentRelativePath);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        await mkdir(currentPath);
        await assertExistingDirectoryNoSymlink(currentPath, currentRelativePath);
        continue;
      }
      throw error;
    }
  }
};

const assertNoExistingTargetSymlink = async (root: string, relativePath: string): Promise<void> => {
  const safeRelativePath = validateMemoryRelativePath(relativePath);
  try {
    const targetStat = await lstat(memoryPath(root, safeRelativePath));
    if (targetStat.isSymbolicLink()) {
      throw new Error(`unsafe memory path entry: ${safeRelativePath} is a symlink`);
    }
    throw new Error(`unsafe memory path entry: ${safeRelativePath} already exists`);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }
};

const assertRegularFileNoSymlink = async (root: string, relativePath: string): Promise<void> => {
  const safeRelativePath = validateMemoryRelativePath(relativePath);
  await ensureSafeParentDirectory(root, safeRelativePath);
  const fileStat = await lstat(memoryPath(root, safeRelativePath));
  if (fileStat.isSymbolicLink()) {
    throw new Error(`unsafe memory path entry: ${safeRelativePath} is a symlink`);
  }
  if (!fileStat.isFile()) {
    throw new Error(`unsafe memory path entry: ${safeRelativePath} is not a regular file`);
  }
};

const listRegularFiles = async (root: string, prefix = ''): Promise<string[]> => {
  await assertSafeRoot(root);
  const names = await readdir(join(root, prefix));
  const files: string[] = [];
  for (const name of names) {
    const relativePath = prefix.length === 0 ? name : `${prefix}/${name}`;
    validateMemoryRelativePath(relativePath);
    const path = join(root, relativePath);
    const entryStat = await lstat(path);
    if (entryStat.isSymbolicLink()) {
      throw new Error(`unsafe memory path entry: ${relativePath} is a symlink`);
    }
    if (entryStat.isDirectory()) {
      files.push(...(await listRegularFiles(root, relativePath)));
    } else if (entryStat.isFile()) {
      files.push(relativePath);
    } else {
      throw new Error(`unsafe memory path entry: ${relativePath} is not a regular file`);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
};

const buildEntriesFromRoot = async (root: string): Promise<MemoryEntry[]> => {
  const entries: MemoryEntry[] = [];
  for (const relativePath of await listRegularFiles(root)) {
    await assertRegularFileNoSymlink(root, relativePath);
    const bytes = await readFile(memoryPath(root, relativePath));
    entries.push({
      relative_path: relativePath,
      source_kind: 'session_memory',
      content_digest: bytesDigest(bytes),
      size_bytes: String(bytes.byteLength),
      operation: 'present',
    });
  }
  return entries;
};

export const buildCodexMemoryBundleFromRoot = async (input: {
  root: string;
  codexSessionId: string;
  bundleId: string;
  sourcePolicyDigest: string;
}): Promise<CodexMemoryBundleBuildResult> => {
  const manifest = codexMemoryBundleManifestSchema.parse({
    schema_version: 'codex_memory_bundle_manifest.v1',
    bundle_id: input.bundleId,
    codex_session_id: input.codexSessionId,
    source_policy_digest: input.sourcePolicyDigest,
    entries: await buildEntriesFromRoot(input.root),
  });
  const digest = codexMemoryBundleDigest(manifest);
  return {
    manifest,
    digest,
  };
};

const buildComparableBundle = async (root: string, input: BundleBuildMetadata): Promise<CodexMemoryBundleBuildResult> =>
  buildCodexMemoryBundleFromRoot({
    root,
    codexSessionId: input.codexSessionId,
    bundleId: input.bundleId,
    sourcePolicyDigest: input.sourcePolicyDigest,
  });

const entriesByPath = (entries: readonly MemoryEntry[]): Map<string, MemoryEntry> =>
  new Map(entries.map((entry) => [entry.relative_path, entry]));

export const diffCodexMemoryBundles = async (input: {
  beforeRoot: string;
  afterRoot: string;
  inputBundleDigest: string;
  codexSessionId: string;
  turnId: string;
  bundleMetadata?: CodexMemoryBundleMetadata;
}): Promise<CodexMemoryDeltaManifest | undefined> => {
  const inputMetadata = {
    ...(input.bundleMetadata ?? defaultBundleMetadata),
    codexSessionId: input.codexSessionId,
  };
  const before = await buildComparableBundle(input.beforeRoot, inputMetadata);
  if (before.digest !== input.inputBundleDigest) {
    throw new Error('memory diff input bundle digest does not match before root');
  }
  const after = await buildComparableBundle(input.afterRoot, inputMetadata);
  if (after.digest === before.digest) {
    return undefined;
  }

  const beforeEntries = entriesByPath(before.manifest.entries);
  const afterEntries = entriesByPath(after.manifest.entries);
  const deleted = [...beforeEntries.values()].filter((entry) => !afterEntries.has(entry.relative_path));
  const added = [...afterEntries.values()].filter((entry) => !beforeEntries.has(entry.relative_path));
  const operations: CodexMemoryDeltaManifest['operations'] = [];
  const usedAdded = new Set<string>();
  const usedDeleted = new Set<string>();

  for (const beforeEntry of deleted.sort((left, right) => left.relative_path.localeCompare(right.relative_path))) {
    const renamedTo = added
      .filter((afterEntry) => !usedAdded.has(afterEntry.relative_path) && afterEntry.content_digest === beforeEntry.content_digest)
      .sort((left, right) => left.relative_path.localeCompare(right.relative_path))[0];
    if (renamedTo !== undefined) {
      usedDeleted.add(beforeEntry.relative_path);
      usedAdded.add(renamedTo.relative_path);
      operations.push({
        op: 'rename',
        from_relative_path: beforeEntry.relative_path,
        to_relative_path: renamedTo.relative_path,
        before_digest: beforeEntry.content_digest,
        after_digest: renamedTo.content_digest,
      });
    }
  }

  for (const beforeEntry of deleted) {
    if (!usedDeleted.has(beforeEntry.relative_path)) {
      operations.push({ op: 'delete', relative_path: beforeEntry.relative_path, before_digest: beforeEntry.content_digest });
    }
  }
  for (const afterEntry of added) {
    if (!usedAdded.has(afterEntry.relative_path)) {
      operations.push({ op: 'add', relative_path: afterEntry.relative_path, content_digest: afterEntry.content_digest });
    }
  }
  for (const beforeEntry of before.manifest.entries) {
    const afterEntry = afterEntries.get(beforeEntry.relative_path);
    if (afterEntry !== undefined && afterEntry.content_digest !== beforeEntry.content_digest) {
      operations.push({
        op: 'modify',
        relative_path: beforeEntry.relative_path,
        before_digest: beforeEntry.content_digest,
        after_digest: afterEntry.content_digest,
      });
    }
  }

  const sortedOperations = operations.sort((left, right) => {
    const leftPath = 'relative_path' in left ? left.relative_path : left.from_relative_path;
    const rightPath = 'relative_path' in right ? right.relative_path : right.from_relative_path;
    return leftPath.localeCompare(rightPath) || left.op.localeCompare(right.op);
  });

  const delta = codexMemoryDeltaManifestSchema.parse({
    schema_version: 'codex_memory_delta_manifest.v1',
    codex_session_id: input.codexSessionId,
    turn_id: input.turnId,
    input_bundle_digest: before.digest,
    output_bundle_digest: after.digest,
    operations: sortedOperations,
  });
  return delta;
};

const assertFileDigest = async (root: string, relativePath: string, expectedDigest: string): Promise<void> => {
  await assertRegularFileNoSymlink(root, relativePath);
  const bytes = await readFile(memoryPath(root, relativePath));
  if (bytesDigest(bytes) !== expectedDigest) {
    throw new Error(`memory replay digest mismatch for ${relativePath}`);
  }
};

export const replayCodexMemoryDelta = async (input: {
  root: string;
  inputBundleDigest: string;
  delta: CodexMemoryDeltaManifest;
  bundleMetadata?: CodexMemoryBundleMetadata;
  contentReader?: CodexMemoryDeltaContentReader;
}): Promise<string> => {
  const delta = codexMemoryDeltaManifestSchema.parse(input.delta);
  const deltaDigest = codexMemoryDeltaDigest(delta);
  if (delta.input_bundle_digest !== input.inputBundleDigest) {
    throw new Error('memory replay input bundle digest does not match delta input bundle digest');
  }
  const inputMetadata = {
    ...(input.bundleMetadata ?? defaultBundleMetadata),
    codexSessionId: delta.codex_session_id,
  };
  const current = await buildComparableBundle(input.root, inputMetadata);
  if (current.digest !== delta.input_bundle_digest) {
    throw new Error('memory replay input bundle digest does not match materialized root');
  }

  for (const operation of delta.operations) {
    if (operation.op === 'add') {
      const path = memoryPath(input.root, operation.relative_path);
      await ensureSafeParentDirectory(input.root, operation.relative_path);
      await assertNoExistingTargetSymlink(input.root, operation.relative_path);
      const contentBytes = await readDeltaContentBytes(input.contentReader, {
        deltaDigest,
        relativePath: operation.relative_path,
        expectedDigest: operation.content_digest,
      });
      await writeFile(path, contentBytes);
      await assertFileDigest(input.root, operation.relative_path, operation.content_digest);
    } else if (operation.op === 'modify') {
      await assertFileDigest(input.root, operation.relative_path, operation.before_digest);
      await ensureSafeParentDirectory(input.root, operation.relative_path);
      const contentBytes = await readDeltaContentBytes(input.contentReader, {
        deltaDigest,
        relativePath: operation.relative_path,
        expectedDigest: operation.after_digest,
      });
      await writeFile(memoryPath(input.root, operation.relative_path), contentBytes);
      await assertFileDigest(input.root, operation.relative_path, operation.after_digest);
    } else if (operation.op === 'delete') {
      await assertFileDigest(input.root, operation.relative_path, operation.before_digest);
      await rm(memoryPath(input.root, operation.relative_path));
    } else {
      await assertFileDigest(input.root, operation.from_relative_path, operation.before_digest);
      const toPath = memoryPath(input.root, operation.to_relative_path);
      await ensureSafeParentDirectory(input.root, operation.to_relative_path);
      await assertNoExistingTargetSymlink(input.root, operation.to_relative_path);
      await rename(memoryPath(input.root, operation.from_relative_path), toPath);
      await assertFileDigest(input.root, operation.to_relative_path, operation.after_digest);
    }
  }

  const output = await buildComparableBundle(input.root, inputMetadata);
  if (output.digest !== delta.output_bundle_digest) {
    throw new Error('memory replay output bundle digest mismatch');
  }
  if (deltaDigest.length === 0) {
    throw new Error('unreachable memory delta digest');
  }
  return output.digest;
};

const readDeltaContentBytes = async (
  contentReader: CodexMemoryDeltaContentReader | undefined,
  input: { deltaDigest: string; relativePath: string; expectedDigest: string },
): Promise<Uint8Array> => {
  if (contentReader === undefined) {
    throw new Error('memory replay add/modify requires a content reader');
  }
  const bytes = await contentReader.read(input);
  if (bytesDigest(bytes) !== input.expectedDigest) {
    throw new Error(`memory replay content digest mismatch for ${input.relativePath}`);
  }
  return bytes;
};

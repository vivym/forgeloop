import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  assertCodexRuntimeCapsulePublicReportSafe,
  codexCanonicalDigest,
  codexThreadLocatorRepairManifestDigest,
  codexThreadLocatorRepairManifestSchema,
} from '@forgeloop/domain';

import {
  assertSafeCodexHomePathEntry,
  assertSafeCodexHomeRelativePath,
} from './path-classifier.js';
import type { CodexThreadLocatorRepairManifest } from './discovery.js';

export interface ThreadStateBundleEntry {
  relative_path: string;
  content: string;
  digest: string;
  size_bytes: string;
}

export interface ThreadStateBundle {
  schema_version: 'codex_thread_state_bundle.v1';
  bundle_id: string;
  codex_session_id: string;
  locator_repair_manifest: CodexThreadLocatorRepairManifest;
  locator_repair_manifest_digest: string;
  entries: ThreadStateBundleEntry[];
}

export interface ThreadStateBundleBuildResult {
  bundle: ThreadStateBundle;
  digest: string;
}

export const assertCodexThreadStatePublicReportSafe = (value: unknown): void => {
  assertCodexRuntimeCapsulePublicReportSafe(value);
};

const parseLocatorRepair = (locatorRepair: CodexThreadLocatorRepairManifest): CodexThreadLocatorRepairManifest =>
  codexThreadLocatorRepairManifestSchema.parse(locatorRepair) as CodexThreadLocatorRepairManifest;

const assertSupportedRepairStrategy = (locatorRepair: CodexThreadLocatorRepairManifest): void => {
  if (!['app_server_scan', 'minimal_state_index_upsert'].includes(locatorRepair.repair_strategy)) {
    throw new Error(`unsupported locator repair strategy: ${String(locatorRepair.repair_strategy)}`);
  }
};

const assertSafeRolloutFile = async (codexHomeRoot: string, relativePath: string): Promise<void> => {
  assertSafeCodexHomePathEntry({ relativePath, entryKind: 'regular_file' });
  const entryStat = await lstat(join(codexHomeRoot, relativePath));
  if (entryStat.isSymbolicLink()) {
    throw new Error(`unsafe thread state path entry: ${relativePath} is a symlink`);
  }
  if (!entryStat.isFile()) {
    throw new Error(`unsafe thread state path entry: ${relativePath} is not a regular file`);
  }
};

const ensureSafeParent = async (codexHomeRoot: string, relativePath: string): Promise<void> => {
  const safeRelativePath = assertSafeCodexHomeRelativePath(relativePath);
  const parentParts = safeRelativePath.split('/').slice(0, -1);
  let currentRelativePath = '';
  let currentPath = codexHomeRoot;
  for (const part of parentParts) {
    currentRelativePath = currentRelativePath.length === 0 ? part : `${currentRelativePath}/${part}`;
    currentPath = join(currentPath, part);
    try {
      const currentStat = await lstat(currentPath);
      if (currentStat.isSymbolicLink() || !currentStat.isDirectory()) {
        throw new Error(`unsafe thread state path entry: ${currentRelativePath} parent is not a real directory`);
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        await mkdir(currentPath);
        continue;
      }
      throw error;
    }
  }
};

const assertNoExistingSymlink = async (codexHomeRoot: string, relativePath: string): Promise<void> => {
  try {
    const targetStat = await lstat(join(codexHomeRoot, relativePath));
    if (targetStat.isSymbolicLink()) {
      throw new Error(`unsafe thread state path entry: ${relativePath} is a symlink`);
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }
};

export const packageCodexThreadStateBundle = async (input: {
  codexHomeRoot: string;
  locatorRepair: CodexThreadLocatorRepairManifest;
  codexSessionId: string;
  capsuleId: string;
}): Promise<ThreadStateBundleBuildResult> => {
  const locatorRepair = parseLocatorRepair(input.locatorRepair);
  assertSupportedRepairStrategy(locatorRepair);
  await assertSafeRolloutFile(input.codexHomeRoot, locatorRepair.rollout_relative_path);
  const content = await readFile(join(input.codexHomeRoot, locatorRepair.rollout_relative_path), 'utf8');
  const contentDigest = codexCanonicalDigest(content);
  if (contentDigest !== locatorRepair.rollout_digest) {
    throw new Error('thread state rollout digest mismatch');
  }

  const bundle: ThreadStateBundle = {
    schema_version: 'codex_thread_state_bundle.v1',
    bundle_id: input.capsuleId,
    codex_session_id: input.codexSessionId,
    locator_repair_manifest: locatorRepair,
    locator_repair_manifest_digest: codexThreadLocatorRepairManifestDigest(locatorRepair),
    entries: [
      {
        relative_path: locatorRepair.rollout_relative_path,
        content,
        digest: contentDigest,
        size_bytes: String(Buffer.byteLength(content)),
      },
    ],
  };

  return {
    bundle,
    digest: codexCanonicalDigest(bundle),
  };
};

export const restoreCodexThreadStateBundle = async (input: {
  codexHomeRoot: string;
  bundle: ThreadStateBundle;
  locatorRepair: CodexThreadLocatorRepairManifest;
}): Promise<void> => {
  const locatorRepair = parseLocatorRepair(input.locatorRepair);
  assertSupportedRepairStrategy(locatorRepair);
  if (codexThreadLocatorRepairManifestDigest(locatorRepair) !== input.bundle.locator_repair_manifest_digest) {
    throw new Error('thread state locator repair manifest digest mismatch');
  }
  if (codexThreadLocatorRepairManifestDigest(input.bundle.locator_repair_manifest) !== input.bundle.locator_repair_manifest_digest) {
    throw new Error('thread state embedded locator repair manifest digest mismatch');
  }
  const entries = input.bundle.entries.filter((entry) => entry.relative_path === locatorRepair.rollout_relative_path);
  if (entries.length !== 1 || input.bundle.entries.length !== 1) {
    throw new Error('thread state bundle must contain exactly the bound rollout entry');
  }
  const entry = entries[0] as ThreadStateBundleEntry;
  if (codexCanonicalDigest(entry.content) !== entry.digest || entry.digest !== locatorRepair.rollout_digest) {
    throw new Error('thread state rollout digest mismatch');
  }
  assertSafeCodexHomePathEntry({ relativePath: entry.relative_path, entryKind: 'regular_file' });
  await ensureSafeParent(input.codexHomeRoot, entry.relative_path);
  await assertNoExistingSymlink(input.codexHomeRoot, entry.relative_path);
  await writeFile(join(input.codexHomeRoot, entry.relative_path), entry.content);
};

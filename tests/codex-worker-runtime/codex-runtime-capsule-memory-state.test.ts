import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  codexCanonicalDigest,
  codexMemoryBundleDigest,
} from '@forgeloop/domain';
import { describe, expect, it } from 'vitest';

import {
  buildCodexMemoryBundleFromRoot,
  diffCodexMemoryBundles,
  replayCodexMemoryDelta,
  type CodexMemoryDeltaContentReader,
  type CodexMemoryDeltaManifest,
} from '../../packages/codex-worker-runtime/src/index';

const digest = (input: unknown): string => codexCanonicalDigest(input);
const contentDigest = (content: string): string => codexCanonicalDigest(content);
const materializedSourcePolicyDigest = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';

const writeMemoryFile = async (root: string, relativePath: string, content: string): Promise<void> => {
  const path = join(root, relativePath);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content);
};

class MapMemoryContentReader implements CodexMemoryDeltaContentReader {
  constructor(private readonly contents: Map<string, Uint8Array>) {}

  async read(input: { relativePath: string; expectedDigest: string }): Promise<Uint8Array> {
    const bytes = this.contents.get(input.relativePath);
    if (bytes === undefined) {
      throw new Error(`missing content: ${input.relativePath}`);
    }
    return bytes;
  }
}

describe('Codex runtime capsule memory state', () => {
  it('builds a full memory bundle digest from files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'forgeloop-codex-memory-'));
    await writeMemoryFile(root, 'memories/user.md', 'remember user preference\n');
    await writeMemoryFile(root, 'sessions/2026-06-03.md', 'session note\n');

    const result = await buildCodexMemoryBundleFromRoot({
      root,
      codexSessionId: 'codex-session-1',
      bundleId: 'bundle-1',
      sourcePolicyDigest: digest({ policy: 'memory-source' }),
    });

    expect(result.manifest.entries.map((entry) => entry.relative_path)).toEqual([
      'memories/user.md',
      'sessions/2026-06-03.md',
    ]);
    expect(result.manifest.entries[0]).toMatchObject({
      content_digest: contentDigest('remember user preference\n'),
      size_bytes: String(Buffer.byteLength('remember user preference\n')),
      operation: 'present',
    });
    expect(result.digest).toBe(codexMemoryBundleDigest(result.manifest));
  });

  it('diffs and replays a deletion operation', async () => {
    const beforeRoot = await mkdtemp(join(tmpdir(), 'forgeloop-codex-memory-before-'));
    const afterRoot = await mkdtemp(join(tmpdir(), 'forgeloop-codex-memory-after-'));
    await writeMemoryFile(beforeRoot, 'memories/old.md', 'old note\n');

    const before = await buildCodexMemoryBundleFromRoot({
      root: beforeRoot,
      codexSessionId: 'codex-session-1',
      bundleId: 'materialized',
      sourcePolicyDigest: materializedSourcePolicyDigest,
    });

    const delta = await diffCodexMemoryBundles({
      beforeRoot,
      afterRoot,
      inputBundleDigest: before.digest,
      codexSessionId: 'codex-session-1',
      turnId: 'turn-1',
    });

    expect(delta?.operations).toEqual([
      {
        op: 'delete',
        relative_path: 'memories/old.md',
        before_digest: contentDigest('old note\n'),
      },
    ]);
    await expect(
      replayCodexMemoryDelta({ root: beforeRoot, inputBundleDigest: before.digest, delta: delta as CodexMemoryDeltaManifest }),
    ).resolves.toBe(delta?.output_bundle_digest);
    await expect(readFile(join(beforeRoot, 'memories/old.md'), 'utf8')).rejects.toThrow();
  });

  it('diffs and replays a deterministic rename operation', async () => {
    const beforeRoot = await mkdtemp(join(tmpdir(), 'forgeloop-codex-memory-before-'));
    const afterRoot = await mkdtemp(join(tmpdir(), 'forgeloop-codex-memory-after-'));
    await writeMemoryFile(beforeRoot, 'memories/source.md', 'same note\n');
    await writeMemoryFile(afterRoot, 'memories/renamed.md', 'same note\n');

    const before = await buildCodexMemoryBundleFromRoot({
      root: beforeRoot,
      codexSessionId: 'codex-session-1',
      bundleId: 'materialized',
      sourcePolicyDigest: materializedSourcePolicyDigest,
    });

    const delta = await diffCodexMemoryBundles({
      beforeRoot,
      afterRoot,
      inputBundleDigest: before.digest,
      codexSessionId: 'codex-session-1',
      turnId: 'turn-1',
    });

    expect(delta?.operations).toEqual([
      {
        op: 'rename',
        from_relative_path: 'memories/source.md',
        to_relative_path: 'memories/renamed.md',
        before_digest: contentDigest('same note\n'),
        after_digest: contentDigest('same note\n'),
      },
    ]);
    await expect(
      replayCodexMemoryDelta({ root: beforeRoot, inputBundleDigest: before.digest, delta: delta as CodexMemoryDeltaManifest }),
    ).resolves.toBe(delta?.output_bundle_digest);
    await expect(readFile(join(beforeRoot, 'memories/renamed.md'), 'utf8')).resolves.toBe('same note\n');
  });

  it('replays independently constructed add and modify operations with an explicit content reader', async () => {
    const beforeRoot = await mkdtemp(join(tmpdir(), 'forgeloop-codex-memory-before-'));
    const afterRoot = await mkdtemp(join(tmpdir(), 'forgeloop-codex-memory-after-'));
    await writeMemoryFile(beforeRoot, 'memories/existing.md', 'before\n');
    await writeMemoryFile(afterRoot, 'memories/existing.md', 'after\n');
    await writeMemoryFile(afterRoot, 'memories/new.md', 'new\n');
    const before = await buildCodexMemoryBundleFromRoot({
      root: beforeRoot,
      codexSessionId: 'codex-session-1',
      bundleId: 'materialized',
      sourcePolicyDigest: materializedSourcePolicyDigest,
    });

    const after = await buildCodexMemoryBundleFromRoot({
      root: afterRoot,
      codexSessionId: 'codex-session-1',
      bundleId: 'materialized',
      sourcePolicyDigest: materializedSourcePolicyDigest,
    });
    const delta: CodexMemoryDeltaManifest = {
      schema_version: 'codex_memory_delta_manifest.v1',
      codex_session_id: 'codex-session-1',
      turn_id: 'turn-1',
      input_bundle_digest: before.digest,
      output_bundle_digest: after.digest,
      operations: [{
        op: 'modify',
        relative_path: 'memories/existing.md',
        before_digest: contentDigest('before\n'),
        after_digest: contentDigest('after\n'),
      },
      { op: 'add', relative_path: 'memories/new.md', content_digest: contentDigest('new\n') }],
    };

    await expect(
      replayCodexMemoryDelta({
        root: beforeRoot,
        inputBundleDigest: before.digest,
        delta,
        contentReader: new MapMemoryContentReader(new Map([
          ['memories/existing.md', new TextEncoder().encode('after\n')],
          ['memories/new.md', new TextEncoder().encode('new\n')],
        ])),
      }),
    ).resolves.toBe(delta.output_bundle_digest);
    await expect(readFile(join(beforeRoot, 'memories/existing.md'), 'utf8')).resolves.toBe('after\n');
    await expect(readFile(join(beforeRoot, 'memories/new.md'), 'utf8')).resolves.toBe('new\n');
  });

  it('rejects add and modify replay when content reader is missing', async () => {
    const beforeRoot = await mkdtemp(join(tmpdir(), 'forgeloop-codex-memory-before-'));
    const afterRoot = await mkdtemp(join(tmpdir(), 'forgeloop-codex-memory-after-'));
    await writeMemoryFile(beforeRoot, 'memories/existing.md', 'before\n');
    await writeMemoryFile(afterRoot, 'memories/existing.md', 'after\n');
    const before = await buildCodexMemoryBundleFromRoot({
      root: beforeRoot,
      codexSessionId: 'codex-session-1',
      bundleId: 'materialized',
      sourcePolicyDigest: materializedSourcePolicyDigest,
    });
    const after = await buildCodexMemoryBundleFromRoot({
      root: afterRoot,
      codexSessionId: 'codex-session-1',
      bundleId: 'materialized',
      sourcePolicyDigest: materializedSourcePolicyDigest,
    });
    const delta: CodexMemoryDeltaManifest = {
      schema_version: 'codex_memory_delta_manifest.v1',
      codex_session_id: 'codex-session-1',
      turn_id: 'turn-1',
      input_bundle_digest: before.digest,
      output_bundle_digest: after.digest,
      operations: [{ op: 'modify', relative_path: 'memories/existing.md', before_digest: contentDigest('before\n'), after_digest: contentDigest('after\n') }],
    };

    await expect(replayCodexMemoryDelta({ root: beforeRoot, inputBundleDigest: before.digest, delta })).rejects.toThrow(/content reader/i);
  });

  it('rejects add and modify replay when content reader bytes do not match the operation digest', async () => {
    const beforeRoot = await mkdtemp(join(tmpdir(), 'forgeloop-codex-memory-before-'));
    const afterRoot = await mkdtemp(join(tmpdir(), 'forgeloop-codex-memory-after-'));
    await writeMemoryFile(beforeRoot, 'memories/existing.md', 'before\n');
    await writeMemoryFile(afterRoot, 'memories/existing.md', 'after\n');
    const before = await buildCodexMemoryBundleFromRoot({
      root: beforeRoot,
      codexSessionId: 'codex-session-1',
      bundleId: 'materialized',
      sourcePolicyDigest: materializedSourcePolicyDigest,
    });
    const after = await buildCodexMemoryBundleFromRoot({
      root: afterRoot,
      codexSessionId: 'codex-session-1',
      bundleId: 'materialized',
      sourcePolicyDigest: materializedSourcePolicyDigest,
    });
    const delta: CodexMemoryDeltaManifest = {
      schema_version: 'codex_memory_delta_manifest.v1',
      codex_session_id: 'codex-session-1',
      turn_id: 'turn-1',
      input_bundle_digest: before.digest,
      output_bundle_digest: after.digest,
      operations: [{ op: 'modify', relative_path: 'memories/existing.md', before_digest: contentDigest('before\n'), after_digest: contentDigest('after\n') }],
    };

    await expect(
      replayCodexMemoryDelta({
        root: beforeRoot,
        inputBundleDigest: before.digest,
        delta,
        contentReader: new MapMemoryContentReader(new Map([['memories/existing.md', new TextEncoder().encode('wrong\n')]])),
      }),
    ).rejects.toThrow(/content digest/i);
    await expect(readFile(join(beforeRoot, 'memories/existing.md'), 'utf8')).resolves.toBe('before\n');
  });

  it('replays deltas only when the input bundle digest matches', async () => {
    const root = await mkdtemp(join(tmpdir(), 'forgeloop-codex-memory-'));
    await writeMemoryFile(root, 'memories/note.md', 'before\n');
    const before = await buildCodexMemoryBundleFromRoot({
      root,
      codexSessionId: 'codex-session-1',
      bundleId: 'materialized',
      sourcePolicyDigest: materializedSourcePolicyDigest,
    });
    const delta: CodexMemoryDeltaManifest = {
      schema_version: 'codex_memory_delta_manifest.v1',
      codex_session_id: 'codex-session-1',
      turn_id: 'turn-1',
      input_bundle_digest: digest({ other: 'input' }),
      output_bundle_digest: digest({ output: 'unused' }),
      operations: [{ op: 'delete', relative_path: 'memories/note.md', before_digest: contentDigest('before\n') }],
    };

    await expect(replayCodexMemoryDelta({ root, inputBundleDigest: before.digest, delta })).rejects.toThrow(/input bundle digest/i);
    await expect(readFile(join(root, 'memories/note.md'), 'utf8')).resolves.toBe('before\n');
  });

  it('rejects paths outside the memory root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'forgeloop-codex-memory-'));
    await writeMemoryFile(root, 'memories/note.md', 'before\n');
    const before = await buildCodexMemoryBundleFromRoot({
      root,
      codexSessionId: 'codex-session-1',
      bundleId: 'materialized',
      sourcePolicyDigest: materializedSourcePolicyDigest,
    });
    const delta: CodexMemoryDeltaManifest = {
      schema_version: 'codex_memory_delta_manifest.v1',
      codex_session_id: 'codex-session-1',
      turn_id: 'turn-1',
      input_bundle_digest: before.digest,
      output_bundle_digest: digest({ output: 'unused' }),
      operations: [{ op: 'delete', relative_path: '../outside.md', before_digest: contentDigest('before\n') }],
    };

    await expect(replayCodexMemoryDelta({ root, inputBundleDigest: before.digest, delta })).rejects.toThrow(/relative path/i);
  });

  it('returns no delta when memory is unchanged', async () => {
    const beforeRoot = await mkdtemp(join(tmpdir(), 'forgeloop-codex-memory-before-'));
    const afterRoot = await mkdtemp(join(tmpdir(), 'forgeloop-codex-memory-after-'));
    await writeMemoryFile(beforeRoot, 'memories/note.md', 'same\n');
    await writeMemoryFile(afterRoot, 'memories/note.md', 'same\n');
    const before = await buildCodexMemoryBundleFromRoot({
      root: beforeRoot,
      codexSessionId: 'codex-session-1',
      bundleId: 'materialized',
      sourcePolicyDigest: materializedSourcePolicyDigest,
    });
    const after = await buildCodexMemoryBundleFromRoot({
      root: afterRoot,
      codexSessionId: 'codex-session-1',
      bundleId: 'materialized',
      sourcePolicyDigest: materializedSourcePolicyDigest,
    });

    await expect(
      diffCodexMemoryBundles({
        beforeRoot,
        afterRoot,
        inputBundleDigest: before.digest,
        codexSessionId: 'codex-session-1',
        turnId: 'turn-1',
      }),
    ).resolves.toBeUndefined();
    expect(after.digest).toBe(before.digest);
  });
});

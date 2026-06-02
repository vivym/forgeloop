import { describe, expect, it } from 'vitest';

import { assertSafeCodexHomePathEntry, assertSafeCodexHomeRelativePath, classifyCodexHomePath } from '../../packages/codex-worker-runtime/src/index';

describe('Codex runtime capsule path classifier', () => {
  it('classifies known Codex home paths into capsule policy buckets', () => {
    expect(classifyCodexHomePath('sessions/2026/06/02/rollout-abc.jsonl').classification).toBe('thread_state_allowed');
    expect(classifyCodexHomePath('auth.json').classification).toBe('forbidden');
    expect(classifyCodexHomePath('config.toml').classification).toBe('forbidden');
    expect(classifyCodexHomePath('logs_1.sqlite').classification).toBe('forbidden');
    expect(classifyCodexHomePath('state_5.sqlite').classification).toBe('forbidden_whole_db');
    expect(classifyCodexHomePath('plugins/plugin-a/plugin.json').classification).toBe('environment_component');
    expect(classifyCodexHomePath('skills/project/SKILL.md').classification).toBe('environment_component');
    expect(classifyCodexHomePath('unknown.bin').classification).toBe('unknown');
  });

  it('rejects unsafe relative paths before classification is trusted', () => {
    expect(() => assertSafeCodexHomeRelativePath('../auth.json')).toThrow(/unsafe/);
    expect(() => assertSafeCodexHomeRelativePath('/Users/viv/.codex/auth.json')).toThrow(/unsafe/);
    expect(() => assertSafeCodexHomeRelativePath(String.raw`plugins\plugin-a\plugin.json`)).toThrow(/unsafe/);
  });

  it('rejects non-regular filesystem entries before capsule packaging', () => {
    expect(() => assertSafeCodexHomePathEntry({ relativePath: 'sessions/2026/06/02/rollout-abc.jsonl', entryKind: 'symlink' })).toThrow(
      /unsafe/,
    );
    expect(() => assertSafeCodexHomePathEntry({ relativePath: 'sessions/2026/06/02/rollout-abc.jsonl', entryKind: 'socket' })).toThrow(
      /unsafe/,
    );
    expect(() => assertSafeCodexHomePathEntry({ relativePath: 'unknown.bin', entryKind: 'regular_file' })).toThrow(/unsafe/);
    expect(() => assertSafeCodexHomePathEntry({ relativePath: 'auth.json', entryKind: 'regular_file' })).toThrow(/unsafe/);
  });
});

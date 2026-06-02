export type CodexHomePathClassification =
  | 'thread_state_allowed'
  | 'memory_state_allowed'
  | 'environment_component'
  | 'generated_environment'
  | 'forbidden'
  | 'forbidden_whole_db'
  | 'unknown';

export interface CodexHomePathClassificationResult {
  relativePath: string;
  classification: CodexHomePathClassification;
}

export type CodexHomePathEntryKind = 'regular_file' | 'directory' | 'symlink' | 'socket' | 'other';

export interface CodexHomePathEntrySafetyInput {
  relativePath: string;
  entryKind: CodexHomePathEntryKind;
}

const forbiddenExactPaths = new Set(['auth.json', 'config.toml', 'codex-dev.db']);
const forbiddenRawDirectoryPattern = /^(?:plugins|cache|tmp)\/.+/;
const sqliteSuffixPattern = /\.sqlite.*$/;
const forbiddenWholeDbPattern = /^state_[0-9]+\.sqlite.*$/;
const forbiddenDbPattern = /^(?:logs_[0-9]+|goals_[0-9]+|memories_[0-9]+|mcp|history)\.sqlite.*$/;

export const assertSafeCodexHomeRelativePath = (relativePath: string): string => {
  if (relativePath.trim() !== relativePath || relativePath.length === 0) {
    throw new Error('unsafe Codex home relative path: path must be non-empty and canonical');
  }
  if (relativePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(relativePath)) {
    throw new Error('unsafe Codex home relative path: absolute paths are forbidden');
  }
  if (relativePath.includes('\\')) {
    throw new Error('unsafe Codex home relative path: backslashes are forbidden');
  }
  const parts = relativePath.split('/');
  if (parts.some((part) => part.length === 0 || part === '.' || part === '..')) {
    throw new Error('unsafe Codex home relative path: traversal and empty segments are forbidden');
  }
  return relativePath;
};

export const classifyCodexHomePath = (input: string): CodexHomePathClassificationResult => {
  const relativePath = assertSafeCodexHomeRelativePath(input);
  const classification = classifySafeCodexHomePath(relativePath);
  return { relativePath, classification };
};

export const assertSafeCodexHomePathEntry = (input: CodexHomePathEntrySafetyInput): CodexHomePathClassificationResult => {
  const result = classifyCodexHomePath(input.relativePath);
  if (input.entryKind !== 'regular_file') {
    throw new Error('unsafe Codex home path entry: only regular files can be captured');
  }
  if (result.classification === 'unknown' || result.classification === 'forbidden' || result.classification === 'forbidden_whole_db') {
    throw new Error(`unsafe Codex home path entry: ${result.classification} paths cannot be captured`);
  }
  return result;
};

const classifySafeCodexHomePath = (relativePath: string): CodexHomePathClassification => {
  if (forbiddenExactPaths.has(relativePath) || forbiddenRawDirectoryPattern.test(relativePath) || forbiddenDbPattern.test(relativePath)) {
    return 'forbidden';
  }
  if (forbiddenWholeDbPattern.test(relativePath)) {
    return 'forbidden_whole_db';
  }
  if (sqliteSuffixPattern.test(relativePath)) {
    return 'unknown';
  }
  if (/^sessions\/[0-9]{4}\/[0-9]{2}\/[0-9]{2}\/rollout-[A-Za-z0-9._-]+\.jsonl$/.test(relativePath)) {
    return 'thread_state_allowed';
  }
  if (/^(?:memories|memory)\/.+/.test(relativePath)) {
    return 'memory_state_allowed';
  }
  if (/^(?:skills|apps|mcp|connectors)\/.+/.test(relativePath)) {
    return 'environment_component';
  }
  if (/^(?:generated|tool-cache)\/.+/.test(relativePath)) {
    return 'generated_environment';
  }
  return 'unknown';
};

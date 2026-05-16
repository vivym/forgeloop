import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import type { WorkflowPolicyDigestStatus } from './types.js';

export interface LoadWorkflowPolicyDigestInput {
  repoRoot: string;
  allowedRepoRoots: string[];
  policyPath?: string;
  parserVersion: string;
}

const defaultPolicyPath = 'WORKFLOW.md';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

const normalizeContent = (content: string): string => content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

const digestPolicyContent = (input: { parserVersion: string; content: string }): string =>
  sha256(JSON.stringify({ parserVersion: input.parserVersion, content: normalizeContent(input.content) }));

const statusBase = (input: LoadWorkflowPolicyDigestInput, policyPath = input.policyPath ?? defaultPolicyPath) => ({
  parserVersion: input.parserVersion,
  policyPath,
});

const unsafePath = (
  input: LoadWorkflowPolicyDigestInput,
  reasonCode: string,
  policyPath = input.policyPath ?? defaultPolicyPath,
  publicSummary?: string,
): WorkflowPolicyDigestStatus => ({
  status: 'unsafe_path',
  ...statusBase(input, policyPath),
  reasonCode,
  ...(publicSummary === undefined ? {} : { publicSummary }),
});

const parseFailed = (
  input: LoadWorkflowPolicyDigestInput,
  reasonCode: string,
  policyPath: string,
  publicSummary?: string,
): WorkflowPolicyDigestStatus => ({
  status: 'parse_failed',
  ...statusBase(input, policyPath),
  reasonCode,
  ...(publicSummary === undefined ? {} : { publicSummary }),
});

const missing = (input: LoadWorkflowPolicyDigestInput, policyPath: string): WorkflowPolicyDigestStatus => ({
  status: 'missing',
  ...statusBase(input, policyPath),
  reasonCode: 'not_found',
});

const pathInside = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return relative.length === 0 || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const canonicalizeAllowedRoots = async (allowedRepoRoots: string[]): Promise<string[]> =>
  Promise.all(allowedRepoRoots.map((allowedRoot) => realpath(allowedRoot)));

const parseFrontMatter = (content: string): 'ok' | 'parse_failed' => {
  const normalized = normalizeContent(content);
  const lines = normalized.split('\n');
  if (lines[0] !== '---') {
    return 'ok';
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && line === '---');
  if (closingIndex === -1) {
    return 'parse_failed';
  }

  for (const line of lines.slice(1, closingIndex)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      continue;
    }
    if (!/^[A-Za-z_][A-Za-z0-9_-]*:\s*.*$/.test(trimmed)) {
      return 'parse_failed';
    }
  }

  return 'ok';
};

const normalizePolicyPath = (policyPath: string): string => policyPath.split(path.sep).join('/');

const resolvePolicyPath = async (
  input: LoadWorkflowPolicyDigestInput,
): Promise<
  | { ok: true; repoRoot: string; policyPath: string; policyFile: string }
  | { ok: false; status: WorkflowPolicyDigestStatus }
> => {
  const policyPath = input.policyPath ?? defaultPolicyPath;
  if (path.isAbsolute(policyPath)) {
    return { ok: false, status: unsafePath(input, 'absolute_policy_path', policyPath) };
  }

  let allowedRoots: string[];
  let repoRoot: string;
  try {
    allowedRoots = await canonicalizeAllowedRoots(input.allowedRepoRoots);
    repoRoot = await realpath(input.repoRoot);
  } catch {
    return { ok: false, status: unsafePath(input, 'repo_root_unavailable', policyPath) };
  }

  if (allowedRoots.some((allowedRoot) => pathInside(allowedRoot, repoRoot)) !== true) {
    return { ok: false, status: unsafePath(input, 'repo_root_outside_allowed_roots', policyPath) };
  }

  const normalized = path.normalize(policyPath);
  if (normalized === '.' || normalized.length === 0) {
    return { ok: false, status: unsafePath(input, 'policy_path_equals_repo_root', policyPath) };
  }
  if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
    return { ok: false, status: unsafePath(input, 'policy_path_outside_repo', policyPath) };
  }

  const candidate = path.resolve(repoRoot, normalized);
  if (candidate === repoRoot) {
    return { ok: false, status: unsafePath(input, 'policy_path_equals_repo_root', policyPath) };
  }
  if (!pathInside(repoRoot, candidate)) {
    return { ok: false, status: unsafePath(input, 'policy_path_outside_repo', policyPath) };
  }

  try {
    const stat = await lstat(candidate);
    if (!stat.isFile() && !stat.isSymbolicLink()) {
      return { ok: false, status: unsafePath(input, 'policy_path_not_file', policyPath) };
    }
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'ENOENT') {
      return { ok: false, status: missing(input, normalizePolicyPath(normalized)) };
    }
    return { ok: false, status: unsafePath(input, 'policy_path_unavailable', policyPath) };
  }

  let realPolicyFile: string;
  try {
    realPolicyFile = await realpath(candidate);
  } catch {
    return { ok: false, status: unsafePath(input, 'policy_path_unavailable', policyPath) };
  }

  if (!pathInside(repoRoot, realPolicyFile)) {
    return { ok: false, status: unsafePath(input, 'policy_path_symlink_escape', policyPath) };
  }
  if (realPolicyFile === repoRoot) {
    return { ok: false, status: unsafePath(input, 'policy_path_equals_repo_root', policyPath) };
  }

  return {
    ok: true,
    repoRoot,
    policyPath: normalizePolicyPath(normalized),
    policyFile: realPolicyFile,
  };
};

export const loadWorkflowPolicyDigest = async (
  input: LoadWorkflowPolicyDigestInput,
): Promise<WorkflowPolicyDigestStatus> => {
  const resolved = await resolvePolicyPath(input);
  if (!resolved.ok) {
    return resolved.status;
  }

  let content: string;
  try {
    content = await readFile(resolved.policyFile, 'utf8');
  } catch {
    return unsafePath(input, 'policy_path_unavailable', resolved.policyPath);
  }

  if (parseFrontMatter(content) !== 'ok') {
    return parseFailed(input, 'invalid_front_matter', resolved.policyPath);
  }

  return {
    status: 'loaded',
    parserVersion: input.parserVersion,
    policyDigest: digestPolicyContent({ parserVersion: input.parserVersion, content }),
    policyPath: resolved.policyPath,
  };
};

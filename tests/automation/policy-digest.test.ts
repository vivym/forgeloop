import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadWorkflowPolicyDigest } from '../../packages/automation/src/index';
import { loadDaemonWorkflowPolicyDigest } from '../../apps/automation-daemon/src/workflow-policy-loader';

const parserVersion = 'workflow-md-parser:v1';

let tempRoot: string;
let allowedRoot: string;
let repoRoot: string;

const writeWorkflow = async (content: string, relativePath = 'WORKFLOW.md'): Promise<void> => {
  const target = path.join(repoRoot, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
};

const loadPolicy = (overrides: Partial<Parameters<typeof loadWorkflowPolicyDigest>[0]> = {}) =>
  loadWorkflowPolicyDigest({
    repoRoot,
    allowedRepoRoots: [allowedRoot],
    parserVersion,
    ...overrides,
  });

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), 'forgeloop-policy-digest-'));
  allowedRoot = path.join(tempRoot, 'allowed');
  repoRoot = path.join(allowedRoot, 'repo');
  await mkdir(repoRoot, { recursive: true });
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('WORKFLOW.md policy digest', () => {
  it('returns missing when WORKFLOW.md is absent', async () => {
    await expect(loadPolicy()).resolves.toMatchObject({
      status: 'missing',
      parserVersion,
      reasonCode: 'not_found',
      policyPath: 'WORKFLOW.md',
    });
  });

  it('computes a stable digest for equivalent policy content', async () => {
    await writeWorkflow('---\nvisibility: public_safe\n---\n# Runtime\n\nChecks stay manual.\r\n');
    const first = await loadPolicy();
    await writeWorkflow('---\nvisibility: public_safe\n---\n# Runtime\n\nChecks stay manual.\n');
    const second = await loadPolicy();

    expect(first).toMatchObject({
      status: 'loaded',
      parserVersion,
      policyPath: 'WORKFLOW.md',
    });
    expect(first.status === 'loaded' ? first.policyDigest : undefined).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toEqual(first);
  });

  it('returns parse_failed for invalid front matter', async () => {
    await writeWorkflow('---\nvisibility public_safe\n---\n# Runtime\n');

    await expect(loadPolicy()).resolves.toMatchObject({
      status: 'parse_failed',
      parserVersion,
      reasonCode: 'invalid_front_matter',
      policyPath: 'WORKFLOW.md',
    });
  });

  it('rejects a repo root outside configured allowed roots', async () => {
    const outsideRepo = path.join(tempRoot, 'outside-repo');
    await mkdir(outsideRepo, { recursive: true });

    await expect(loadPolicy({ repoRoot: outsideRepo })).resolves.toMatchObject({
      status: 'unsafe_path',
      parserVersion,
      reasonCode: 'repo_root_outside_allowed_roots',
    });
  });

  it('rejects absolute candidate policy paths', async () => {
    await expect(loadPolicy({ policyPath: path.join(repoRoot, 'WORKFLOW.md') })).resolves.toMatchObject({
      status: 'unsafe_path',
      parserVersion,
      reasonCode: 'absolute_policy_path',
    });
  });

  it('rejects outside-repo candidate policy paths', async () => {
    await expect(loadPolicy({ policyPath: '../WORKFLOW.md' })).resolves.toMatchObject({
      status: 'unsafe_path',
      parserVersion,
      reasonCode: 'policy_path_outside_repo',
    });
  });

  it('rejects root-equal candidate policy paths', async () => {
    await expect(loadPolicy({ policyPath: '.' })).resolves.toMatchObject({
      status: 'unsafe_path',
      parserVersion,
      reasonCode: 'policy_path_equals_repo_root',
    });
  });

  it('rejects symlink escapes', async () => {
    const outside = path.join(tempRoot, 'outside');
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(outside, 'WORKFLOW.md'), '# escaped\n');
    await symlink(outside, path.join(repoRoot, 'linked-outside'));

    await expect(loadPolicy({ policyPath: 'linked-outside/WORKFLOW.md' })).resolves.toMatchObject({
      status: 'unsafe_path',
      parserVersion,
      reasonCode: 'policy_path_symlink_escape',
    });
  });

  it('daemon loader always reads WORKFLOW.md under configured allowed roots', async () => {
    await writeWorkflow('# Runtime\n');

    await expect(
      loadDaemonWorkflowPolicyDigest({
        repoRoot,
        allowedRepoRoots: [allowedRoot],
        parserVersion,
      }),
    ).resolves.toMatchObject({
      status: 'loaded',
      policyPath: 'WORKFLOW.md',
    });
  });
});

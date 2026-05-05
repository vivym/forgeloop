import { afterEach, describe, expect, it, vi } from 'vitest';

import { createForgeloopApi, ForgeloopApiError } from '../../apps/web/src/api';

describe('Forgeloop web API client', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends JSON bodies to normalized endpoint URLs', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: 'work-item-1', title: 'Ship workbench' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const api = createForgeloopApi({ baseUrl: 'http://api.local/root/', fetch: fetchMock });

    const result = await api.createWorkItem({
      project_id: 'project-1',
      kind: 'feature',
      title: 'Ship workbench',
      goal: 'Operate P0 from the browser',
      success_criteria: ['Create and run a package'],
      priority: 'P0',
      risk: 'medium',
      owner_actor_id: 'actor-owner',
    });

    expect(result).toMatchObject({ id: 'work-item-1' });
    expect(fetchMock).toHaveBeenCalledWith('http://api.local/root/work-items', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        project_id: 'project-1',
        kind: 'feature',
        title: 'Ship workbench',
        goal: 'Operate P0 from the browser',
        success_criteria: ['Create and run a package'],
        priority: 'P0',
        risk: 'medium',
        owner_actor_id: 'actor-owner',
      }),
    });
  });

  it('encodes query parameters and command request bodies', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }));
    const api = createForgeloopApi({ baseUrl: 'http://api.local', fetch: fetchMock });

    await api.listWorkItems('project with spaces');
    await api.approveSpec('spec-1', { actor_id: 'actor-reviewer' });

    expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://api.local/work-items?project_id=project+with+spaces', {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://api.local/specs/spec-1/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ actor_id: 'actor-reviewer' }),
    });
  });

  it('patches execution package content without sending repo_id', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'package-1' }), { status: 200 }));
    const api = createForgeloopApi({ baseUrl: 'http://api.local', fetch: fetchMock });

    await api.patchExecutionPackage('package-1', {
      objective: 'Tighten package edit controls',
      owner_actor_id: 'actor-owner',
      reviewer_actor_id: 'actor-reviewer',
      qa_owner_actor_id: 'actor-qa',
      required_checks: [
        {
          check_id: 'web-build',
          display_name: 'Web build',
          command: 'pnpm --filter @forgeloop/web build',
          timeout_seconds: 600,
          blocks_review: true,
        },
      ],
      required_artifact_kinds: ['diff', 'check_output'],
      allowed_paths: ['apps/web/**'],
      forbidden_paths: ['apps/control-plane-api/**'],
    });

    expect(fetchMock).toHaveBeenCalledWith('http://api.local/execution-packages/package-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        objective: 'Tighten package edit controls',
        owner_actor_id: 'actor-owner',
        reviewer_actor_id: 'actor-reviewer',
        qa_owner_actor_id: 'actor-qa',
        required_checks: [
          {
            check_id: 'web-build',
            display_name: 'Web build',
            command: 'pnpm --filter @forgeloop/web build',
            timeout_seconds: 600,
            blocks_review: true,
          },
        ],
        required_artifact_kinds: ['diff', 'check_output'],
        allowed_paths: ['apps/web/**'],
        forbidden_paths: ['apps/control-plane-api/**'],
      }),
    });
  });

  it('surfaces backend error messages from non-2xx responses', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ message: 'Spec is not awaiting approval', code: 'INVALID_TRANSITION' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const api = createForgeloopApi({ baseUrl: 'http://api.local', fetch: fetchMock });

    await expect(api.approveSpec('spec-1', {})).rejects.toMatchObject({
      name: 'ForgeloopApiError',
      message: 'Spec is not awaiting approval',
      status: 400,
      details: { code: 'INVALID_TRANSITION' },
    } satisfies Partial<ForgeloopApiError>);
  });
});

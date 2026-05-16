import { describe, expect, it } from 'vitest';

import type { RunSession } from '@forgeloop/domain';

import { serializePublicRunSession } from '../../apps/control-plane-api/src/modules/query/public-run-session-projection';

describe('run session public serialization', () => {
  it('uses shared public artifact serialization for artifacts and check outputs', () => {
    const runSession: RunSession = {
      id: 'run-session-1',
      execution_package_id: 'package-1',
      requested_by_actor_id: 'actor-1',
      status: 'succeeded',
      executor_type: 'mock',
      changed_files: [],
      artifacts: [
        {
          kind: 'diff',
          name: 'Patch',
          content_type: 'text/x-patch',
          storage_uri: 's3://bucket/diff.patch',
          local_ref: 'artifacts/run/diff.patch',
        },
        {
          kind: 'diff',
          name: 'Unsafe',
          content_type: 'text/x-patch',
          storage_uri: 'https://example.test/diff.patch?token=secret',
        },
        {
          kind: 'execution_summary',
          name: '/Users/viv/projs/forgeloop/out.md',
          content_type: 'text/markdown',
          storage_uri: 's3://bucket/summary.md',
        },
      ],
      log_refs: [
        {
          kind: 'logs',
          name: 'Logs',
          content_type: 'text/plain',
          local_ref: 'artifacts/run/logs.txt',
        },
      ],
      check_results: [
        {
          check_id: 'contracts',
          command: 'pnpm vitest run tests/contracts',
          status: 'succeeded',
          exit_code: 0,
          duration_seconds: 1,
          blocks_review: true,
          stdout: {
            kind: 'check_output',
            name: 'stdout',
            content_type: 'text/plain',
            storage_uri: 'file:///Users/viv/stdout.txt',
          },
          stderr: {
            kind: 'check_output',
            name: 'stderr',
            content_type: 'text/plain',
            storage_uri: 'https://example.test/stderr.txt?token=secret',
          },
        },
      ],
      created_at: '2026-05-10T00:00:00.000Z',
      updated_at: '2026-05-10T00:00:01.000Z',
    };

    const serialized = serializePublicRunSession(runSession);

    expect(serialized.artifacts).toEqual([
      {
        kind: 'diff',
        name: 'Patch',
        content_type: 'text/x-patch',
        storage_uri: 's3://bucket/diff.patch',
      },
    ]);
    expect(serialized.log_refs).toEqual([]);
    expect(serialized.check_results[0]).not.toHaveProperty('stdout');
    expect(serialized.check_results[0]).not.toHaveProperty('stderr');
    expect(JSON.stringify(serialized)).not.toContain('token=secret');
    expect(JSON.stringify(serialized)).not.toContain('local_ref');
    expect(JSON.stringify(serialized)).not.toContain('/Users/viv/projs/forgeloop');
  });
});

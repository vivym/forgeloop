import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  collectRunbookScriptReferences,
  missingRunbookScripts,
  requiredCodexRuntimeSuperpowersScripts,
} from '../../scripts/check-runbook-scripts';

const rootUrl = new URL('../..', import.meta.url);
const readJson = (path: string) => JSON.parse(readFileSync(new URL(path, rootUrl), 'utf8'));

describe('runbook script consistency gate', () => {
  it('registers every required Codex runtime Superpowers alias in package.json', () => {
    const scripts = readJson('package.json').scripts as Record<string, string>;

    for (const [name, command] of Object.entries(requiredCodexRuntimeSuperpowersScripts)) {
      expect(scripts[name]).toBe(command);
    }
  });

  it('detects runbook pnpm command references that are missing package aliases', () => {
    const references = collectRunbookScriptReferences({
      files: [
        {
          path: 'docs/runbooks/example.md',
          content: [
            '```bash',
            'pnpm codex:remote-worker',
            'pnpm missing:script -- --flag',
            '```',
          ].join('\n'),
        },
      ],
    });

    expect(references.map((reference) => reference.scriptName)).toEqual(['codex:remote-worker', 'missing:script']);
    expect(missingRunbookScripts(references, { 'codex:remote-worker': 'tsx worker.ts' })).toEqual([
      expect.objectContaining({ scriptName: 'missing:script', file: 'docs/runbooks/example.md' }),
    ]);
  });

  it('keeps active runbooks free of missing pnpm script aliases', () => {
    const packageScripts = readJson('package.json').scripts as Record<string, string>;
    const references = collectRunbookScriptReferences({ rootDir: new URL('../..', import.meta.url).pathname });

    expect(missingRunbookScripts(references, packageScripts)).toEqual([]);
  });

  it('documents the env vars that the remote worker script actually reads', () => {
    const runbook = readFileSync(new URL('docs/runbooks/codex-remote-worker-runtime.md', rootUrl), 'utf8');

    expect(runbook).toContain('FORGELOOP_CODEX_WORKER_ID');
    expect(runbook).toContain('FORGELOOP_AUTOMATION_ACTOR_ID');
    expect(runbook).toContain('FORGELOOP_AUTOMATION_DAEMON_IDENTITY');
    expect(runbook).toContain('FORGELOOP_CODEX_ALLOWED_SCOPE_PROJECT_ID=project-1');
    expect(runbook).toContain('FORGELOOP_CODEX_ALLOWED_SCOPE_REPO_ID=repo-1');
    expect(runbook).not.toContain('FORGELOOP_CODEX_WORKER_SCOPES_JSON');
  });

  it('documents repo scope as optional rather than a required worker setup input', () => {
    const runbook = readFileSync(new URL('docs/runbooks/codex-remote-worker-runtime.md', rootUrl), 'utf8');
    const requiredSetupInputs = runbook.match(/Required setup inputs:\n\n(?<section>(?:- `[^`]+`\n)+)/)?.groups?.section ?? '';

    expect(requiredSetupInputs).toContain('FORGELOOP_CODEX_ALLOWED_SCOPE_PROJECT_ID');
    expect(requiredSetupInputs).not.toContain('FORGELOOP_CODEX_ALLOWED_SCOPE_REPO_ID');
    expect(runbook).toContain('Optional setup inputs:');
    expect(runbook).toContain('FORGELOOP_CODEX_ALLOWED_SCOPE_REPO_ID');
  });
});

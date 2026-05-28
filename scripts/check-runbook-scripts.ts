import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const requiredCodexRuntimeSuperpowersScripts = {
  'codex:runtime:import': 'tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/codex-runtime-import.ts',
  'codex:runtime:bootstrap': 'tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/codex-runtime-dogfood-bootstrap.ts',
  'codex:remote-worker': 'tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/codex-remote-worker-dogfood.ts',
  'dogfood:codex-runtime:superpowers':
    'tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/codex-runtime-superpowers-dogfood.ts',
  'check:codex-runtime-superpowers-no-baggage':
    'tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/check-codex-runtime-superpowers-no-baggage.ts',
  'check:runbook-scripts': 'tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/check-runbook-scripts.ts',
} as const;

export interface RunbookFileInput {
  path: string;
  content: string;
}

export interface RunbookScriptReference {
  file: string;
  line: number;
  scriptName: string;
  raw: string;
}

const pnpmScriptReferencePattern = /(?:^|\s)pnpm\s+(?!--)([A-Za-z0-9][A-Za-z0-9:_-]*)/g;

const readPackageScripts = (rootDir: string): Record<string, string> => {
  const packageJson = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
  return packageJson.scripts ?? {};
};

const readRunbookFiles = (rootDir: string): RunbookFileInput[] => {
  const runbookDir = join(rootDir, 'docs', 'runbooks');
  if (!existsSync(runbookDir)) {
    return [];
  }
  return readdirSync(runbookDir)
    .filter((entry) => entry.endsWith('.md'))
    .sort()
    .map((entry) => {
      const path = join(runbookDir, entry);
      return {
        path: relative(rootDir, path),
        content: readFileSync(path, 'utf8'),
      };
    });
};

export const collectRunbookScriptReferences = (input: {
  rootDir?: string;
  files?: RunbookFileInput[];
}): RunbookScriptReference[] => {
  const rootDir = resolve(input.rootDir ?? process.cwd());
  const files = input.files ?? readRunbookFiles(rootDir);
  const references: RunbookScriptReference[] = [];

  for (const file of files) {
    const lines = file.content.split(/\r?\n/);
    for (const [lineIndex, line] of lines.entries()) {
      pnpmScriptReferencePattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pnpmScriptReferencePattern.exec(line)) !== null) {
        const scriptName = match[1];
        if (scriptName === undefined) {
          continue;
        }
        references.push({
          file: file.path,
          line: lineIndex + 1,
          scriptName,
          raw: line.trim(),
        });
      }
    }
  }

  return references;
};

export const missingRunbookScripts = (
  references: RunbookScriptReference[],
  packageScripts: Record<string, string>,
): RunbookScriptReference[] =>
  references.filter((reference) => packageScripts[reference.scriptName] === undefined);

export const runRunbookScriptConsistencyCheck = (rootDir = process.cwd()): { ok: boolean; missing: RunbookScriptReference[] } => {
  const resolvedRoot = resolve(rootDir);
  const references = collectRunbookScriptReferences({ rootDir: resolvedRoot });
  const missing = missingRunbookScripts(references, readPackageScripts(resolvedRoot));
  return { ok: missing.length === 0, missing };
};

const main = (): number => {
  const result = runRunbookScriptConsistencyCheck();
  if (result.ok) {
    console.log('Runbook pnpm script references are registered.');
    return 0;
  }

  console.error('Runbook pnpm script references are missing package aliases:');
  for (const reference of result.missing) {
    console.error(`- ${reference.file}:${reference.line} ${reference.scriptName}`);
  }
  return 1;
};

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = main();
}

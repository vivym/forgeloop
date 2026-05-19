import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const textFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (path.includes('.react-router') || path.includes('/dist/') || path.includes('/node_modules/')) return [];
    if (statSync(path).isDirectory()) return textFiles(path);
    return /\.(ts|tsx|css|html|md)$/.test(path) ? [path] : [];
  });

const sourceText = () =>
  textFiles('apps/web')
    .concat(textFiles('tests/web').filter((file) => !file.endsWith('no-legacy-web-ui.test.ts')))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');

describe('no legacy Web UI baggage', () => {
  it('does not keep old workbench classes or legacy routes', () => {
    expect(sourceText()).not.toMatch(/workbench-grid|className="panel"|\.panel\b|\/legacy|src\/main\.tsx|Load role queue|Load cockpit|Load replay/);
  });

  it('does not import the old monolithic App', () => {
    expect(sourceText()).not.toMatch(/from ['"].*src\/App['"]|<App\b/);
  });

  it('does not keep old API or state shims', () => {
    expect(sourceText()).not.toMatch(/src\/api|src\/workbenchState|from ['"].*\/api['"]/);
  });

  it('removes old Web entry, API, state, and stylesheet files', () => {
    for (const path of [
      'apps/web/src/App.tsx',
      'apps/web/src/api.ts',
      'apps/web/src/api',
      'apps/web/src/styles.css',
      'apps/web/src/workbenchState.ts',
    ]) {
      expect(existsSync(path), path).toBe(false);
    }
  });
});

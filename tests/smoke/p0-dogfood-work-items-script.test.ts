import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execFile = promisify(execFileCallback);

describe('p0 dogfood work items script', () => {
  it(
    'creates the three P0 dogfood Work Items and writes a completion report',
    async () => {
      const outputDir = await mkdtemp(join(tmpdir(), 'forgeloop-work-item-dogfood-'));
      const reportPath = join(outputDir, 'report.md');

      try {
        await execFile('pnpm', ['dogfood:p0:work-items'], {
          cwd: process.cwd(),
          env: { ...process.env, FORGELOOP_WORK_ITEM_DOGFOOD_REPORT_PATH: reportPath },
          maxBuffer: 1024 * 1024 * 10,
          timeout: 30_000,
        });

        const report = await readFile(reportPath, 'utf8');
        expect(report).toContain('Remote CI gate');
        expect(report).toContain('Durable verification gaps');
        expect(report).toContain('Browser Run Console walkthrough');
        expect(report).toContain('changes_requested -> rerun -> approve');
        expect(report).toContain('object_event');
        expect(report).toContain('status_history');
      } finally {
        await rm(outputDir, { recursive: true, force: true });
      }
    },
    45_000,
  );
});

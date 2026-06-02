import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertCodexAppServerResumeDogfoodReportSafe,
  codexAppServerResumeDogfoodMain,
  codexAppServerResumeDogfoodSkipMessage,
  renderCodexAppServerResumeDogfoodReport,
  runCodexAppServerResumeDogfood,
  writeCodexAppServerResumeDogfoodReport,
  type CodexAppServerResumeDogfoodReport,
} from '../../scripts/codex-app-server-resume-dogfood';

describe('codex app-server resume dogfood script', () => {
  it('skips by default without requiring a real app-server', async () => {
    const report = await runCodexAppServerResumeDogfood({});

    expect(report).toMatchObject({
      status: 'skipped',
      thread_start_count: 0,
      thread_resume_count: 0,
      replacement_thread_start_count: 0,
      blocker_codes: ['codex_app_server_resume_dogfood_disabled'],
    });
  });

  it('prints the documented skip message from the default command path', async () => {
    const messages: string[] = [];
    const originalLog = console.log;
    console.log = (message?: unknown) => {
      messages.push(String(message));
    };
    try {
      await expect(codexAppServerResumeDogfoodMain({})).resolves.toBe(0);
    } finally {
      console.log = originalLog;
    }

    expect(messages).toContain(codexAppServerResumeDogfoodSkipMessage);
  });

  it('fails closed when enabled without an app-server endpoint', async () => {
    const report = await runCodexAppServerResumeDogfood({ FORGELOOP_CODEX_APP_SERVER_RESUME_DOGFOOD: '1' });

    expect(report).toMatchObject({
      status: 'failed',
      blocker_codes: ['codex_app_server_resume_dogfood_endpoint_missing'],
      replacement_thread_start_count: 0,
    });
  });

  it('renders only product-safe report fields', () => {
    const report: CodexAppServerResumeDogfoodReport = {
      status: 'passed',
      codex_session_id: 'codex-session-1',
      codex_thread_id_digest: `sha256:${'a'.repeat(64)}`,
      thread_start_count: 1,
      thread_resume_count: 2,
      replacement_thread_start_count: 0,
      blocker_codes: [],
      report_generated_at: '2026-06-02T00:00:00.000Z',
    };

    expect(renderCodexAppServerResumeDogfoodReport(report)).toContain('"status": "passed"');
    expect(JSON.stringify(report)).not.toContain('thread-raw');
    expect(JSON.stringify(report)).not.toContain('prompt transcript');
    expect(() =>
      assertCodexAppServerResumeDogfoodReportSafe({
        ...report,
        blocker_codes: ['prompt transcript leaked'],
      }),
    ).toThrow(/codex_app_server_resume_dogfood_report_unsafe/);
  });

  it('writes the dogfood report as JSON', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'forgeloop-resume-dogfood-'));
    const reportPath = join(tempDir, 'report.json');
    try {
      const report: CodexAppServerResumeDogfoodReport = {
        status: 'skipped',
        codex_session_id: 'codex-session-1',
        thread_start_count: 0,
        thread_resume_count: 0,
        replacement_thread_start_count: 0,
        blocker_codes: ['codex_app_server_resume_dogfood_disabled'],
        report_generated_at: '2026-06-02T00:00:00.000Z',
      };

      await writeCodexAppServerResumeDogfoodReport(report, reportPath);

      await expect(readFile(reportPath, 'utf8')).resolves.toContain('"status": "skipped"');
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});

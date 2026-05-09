import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { chromium, expect as expectPage, type Browser, type Page } from '@playwright/test';
import request from 'supertest';
import { createServer as createViteServer, type ViteDevServer } from 'vite';
import { afterEach, describe, expect as expectValue, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { P0_REPOSITORY, RUN_WORKER } from '../../apps/control-plane-api/src/p0/p0.service';
import type { InMemoryP0Repository } from '../../packages/db/src';
import { transitionRunSession } from '../../packages/domain/src/index';
import { seedReadyExecutionPackageThroughApi } from '../helpers/p0-runtime-fixtures';

const actorOwner = 'actor-owner';
const viewports = [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
];

describe('run console browser e2e', () => {
  const apps: INestApplication[] = [];
  const viteServers: ViteDevServer[] = [];
  const browsers: Browser[] = [];
  const browserProcesses: ChildProcess[] = [];
  const browserProfileDirs: string[] = [];

  afterEach(async () => {
    const cleanupResults = await Promise.allSettled([
      ...browsers.splice(0).map((browser) => browser.close()),
      ...browserProcesses.splice(0).map((process) => stopProcess(process)),
      ...browserProfileDirs
        .splice(0)
        .map((profileDir) => rm(profileDir, { force: true, maxRetries: 5, recursive: true, retryDelay: 100 })),
      ...viteServers.splice(0).map((server) => server.close()),
      ...apps.splice(0).map((app) => app.close()),
    ]);
    const cleanupErrors = cleanupResults.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, 'Run console e2e cleanup failed');
    }
  });

  it(
    'backfills run events, streams new events, handles commands, and stays usable at desktop and mobile widths',
    async () => {
      const { app, apiUrl, repo, runSessionId } = await startApi();
      apps.push(app);

      const vite = await startWeb(apiUrl);
      viteServers.push(vite);
      const webUrl = requireViteUrl(vite);

      const { browser, process, profileDir } = await launchChromiumOverCdp();
      browsers.push(browser);
      browserProcesses.push(process);
      browserProfileDirs.push(profileDir);
      const page = await browser.newPage({ viewport: viewports[0] });
      let mainFrameNavigationCount = 0;
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) mainFrameNavigationCount += 1;
      });

      const streamOpened = page.waitForResponse(
        (response) => response.url().includes(`/run-sessions/${runSessionId}/events/stream?`) && response.status() === 200,
      );
      await page.goto(webUrl);
      await runSelect(page).selectOption(runSessionId);

      const console = page.getByTestId('run-console');
      await expectVisibleText(console, 'run_queued');

      const backfillCursor = await latestBackfillCursor(app, runSessionId);
      const initialCursor = await latestRenderedCursor(page);
      expectValue(initialCursor).toMatch(/^\d{10}$/);

      const streamResponse = await streamOpened;
      expectValue(streamResponse.url()).toContain(`after=${encodeURIComponent(backfillCursor)}`);
      const navigationCountAfterStreamOpen = mainFrameNavigationCount;
      const reloadSentinel = await installReloadSentinel(page);

      await request(app.getHttpServer())
        .post(`/run-sessions/${runSessionId}/input`)
        .set('X-Forgeloop-Actor-Id', actorOwner)
        .send({ message: 'API-created event after stream open.' })
        .expect(201);

      const liveCursor = await latestApiCursor(app, runSessionId);
      const liveEventRow = page.locator(`[data-event-cursor="${liveCursor}"]`);
      await expectPage(liveEventRow).toBeVisible();
      await expectPage(liveEventRow).toHaveCount(1);
      expectValue(mainFrameNavigationCount).toBe(navigationCountAfterStreamOpen);
      expectValue(await reloadSentinelIsPresent(page, reloadSentinel)).toBe(true);
      expectValue(page.url()).toBe(webUrl);
      await expectPage(runSelect(page)).toHaveValue(runSessionId);

      await page.getByTestId('run-console-input').fill('Browser input from the run console.');
      await page.getByTestId('run-console-send').click();
      await expectVisibleText(console, 'user_input');

      await page.getByTestId('run-console-resume').click();
      await expectVisibleText(console, 'resuming');

      const runSession = await repo.getRunSession(runSessionId);
      await repo.saveRunSession({ ...runSession!, status: 'stalled' });
      await page.getByTestId('run-console-cancel').click();
      await expectVisibleText(console, 'cancel_requested');

      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        await assertRunConsoleLayout(page);
      }
    },
    60_000,
  );

  it(
    'renders evidence chain with current focus before superseded history and hides raw refs',
    async () => {
      const vite = await startWeb('http://api.local');
      viteServers.push(vite);

      const { browser, process, profileDir } = await launchChromiumOverCdp();
      browsers.push(browser);
      browserProcesses.push(process);
      browserProfileDirs.push(profileDir);
      const page = await browser.newPage({ viewport: viewports[0] });
      await routeEvidenceWorkbench(page);

      await page.goto(requireViteUrl(vite));

      const evidence = page.getByTestId('evidence-chain');
      await expectPage(evidence).toBeVisible();
      await expectPage(evidence.getByTestId('evidence-group-current')).toBeVisible();
      await expectPage(evidence.getByText('review-packet-approved', { exact: false }).first()).toBeVisible();
      await expectPage(evidence.getByText('Redacted: logs artifact', { exact: false })).toBeVisible();

      const currentGroup = await requiredBox(evidence.getByTestId('evidence-group-current'), 'current evidence group');
      const historyGroup = await requiredBox(evidence.getByTestId('evidence-group-history'), 'history evidence group');
      expectValue(currentGroup.y).toBeLessThan(historyGroup.y);

      const evidenceText = await evidence.innerText();
      expectValue(evidenceText).not.toContain('raw-codex');
      expectValue(evidenceText).not.toContain('raw_ref');
      expectValue(evidenceText).not.toContain('local_ref');
      expectValue(evidenceText).not.toContain('local://');
      expectValue(evidenceText).not.toContain('secret command output');
    },
    60_000,
  );

  it(
    'keeps the workbench usable when the evidence chain request fails',
    async () => {
      const vite = await startWeb('http://api.local');
      viteServers.push(vite);

      const { browser, process, profileDir } = await launchChromiumOverCdp();
      browsers.push(browser);
      browserProcesses.push(process);
      browserProfileDirs.push(profileDir);
      const page = await browser.newPage({ viewport: viewports[0] });
      await routeEvidenceWorkbench(page, { failEvidenceChain: true });

      await page.goto(requireViteUrl(vite));

      await expectPage(page.getByText('Evidence Chain Workbench', { exact: false }).first()).toBeVisible();
      await expectPage(page.getByText('Completion')).toBeVisible();
      await expectPage(page.getByTestId('evidence-chain').getByText('No evidence chain loaded')).toBeVisible();
    },
    60_000,
  );
});

async function routeEvidenceWorkbench(page: Page, options: { failEvidenceChain?: boolean } = {}): Promise<void> {
  const now = '2026-05-08T00:00:00.000Z';
  const workItem = {
    id: 'work-item-1',
    project_id: 'project-1',
    kind: 'feature',
    title: 'Evidence Chain Workbench',
    goal: 'Render evidence',
    success_criteria: ['Evidence is visible'],
    priority: 'P0',
    risk: 'medium',
    owner_actor_id: actorOwner,
    phase: 'review',
    activity_state: 'awaiting_human',
    gate_state: 'review_approved',
    resolution: 'completed',
    current_spec_id: 'spec-1',
    current_plan_id: 'plan-1',
    created_at: now,
    updated_at: now,
  };
  const cockpit = {
    work_item: workItem,
    current_spec: {
      id: 'spec-1',
      work_item_id: workItem.id,
      entity_type: 'spec',
      status: 'approved',
      editing_state: 'idle',
      gate_state: 'approved',
      resolution: 'approved',
      current_revision_id: 'spec-revision-1',
    },
    current_plan: {
      id: 'plan-1',
      work_item_id: workItem.id,
      entity_type: 'plan',
      status: 'approved',
      editing_state: 'idle',
      gate_state: 'approved',
      resolution: 'approved',
      current_revision_id: 'plan-revision-1',
    },
    packages: [],
    run_sessions: [],
    review_packets: [],
    next_actions: [],
    completion_state: {},
  };
  const evidenceChain = {
    work_item_id: workItem.id,
    generated_at: now,
    focus: { selection: 'current', review_packet_ids: ['review-packet-approved'] },
    projection: { source: 'mixed', version: 1, partial: true, gaps: ['missing_trace_artifact_refs'] },
    summary: {
      total_items: 4,
      run_count: 2,
      review_packet_count: 2,
      decision_count: 1,
      artifact_count: 1,
      risk_flags: ['redacted_evidence', 'superseded_run', 'projection_partial'],
      redacted_count: 1,
    },
    items: [
      {
        id: 'evidence-item:review-packet:review-packet-approved',
        source: 'review_packet',
        subject: { object_type: 'review_packet', object_id: 'review-packet-approved', relationship: 'supports' },
        summary: 'Rerun approved.',
        created_at: now,
        visibility: 'public',
        links: [{ object_type: 'run_session', object_id: 'run-session-approved', relationship: 'generated_by' }],
        risk_flags: [],
        redacted: false,
        details: { decision: 'approved' },
      },
      {
        id: 'evidence-item:redacted-log:run-session-approved:0',
        source: 'artifact',
        subject: { object_type: 'artifact', object_id: 'run-session-approved:logs:0', relationship: 'redacted_from' },
        summary: 'Logs artifact redacted from public evidence.',
        created_at: now,
        visibility: 'public',
        links: [{ object_type: 'review_packet', object_id: 'review-packet-approved', relationship: 'supports' }],
        risk_flags: ['redacted_evidence'],
        redacted: true,
        details: { redaction_reason: 'logs_artifact' },
      },
      {
        id: 'evidence-item:run-session:run-session-approved',
        source: 'object_event',
        subject: { object_type: 'run_session', object_id: 'run-session-approved', relationship: 'generated_by' },
        summary: 'Rerun addressed requested changes and passed review.',
        created_at: now,
        visibility: 'public',
        links: [{ object_type: 'review_packet', object_id: 'review-packet-approved', relationship: 'supports' }],
        risk_flags: [],
        redacted: false,
        details: { run_status: 'succeeded', required_check_ids: ['unit-tests'] },
      },
      {
        id: 'evidence-item:run-session:run-session-changes-requested',
        source: 'object_event',
        subject: { object_type: 'run_session', object_id: 'run-session-changes-requested', relationship: 'generated_by' },
        summary: 'Initial run completed before review changes were requested.',
        created_at: '2026-05-07T23:55:00.000Z',
        visibility: 'public',
        links: [{ object_type: 'review_packet', object_id: 'review-packet-changes-requested', relationship: 'generated_by' }],
        risk_flags: ['superseded_run'],
        redacted: false,
        details: { run_status: 'succeeded' },
      },
    ],
  };

  await page.route('http://api.local/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === '/work-items') return route.fulfill({ json: [workItem] });
    if (path === '/query/work-item-cockpit/work-item-1') return route.fulfill({ json: cockpit });
    if (path === '/query/replay/work_item/work-item-1') return route.fulfill({ json: [] });
    if (path === '/work-items/work-item-1/evidence-chain') {
      return options.failEvidenceChain
        ? route.fulfill({ status: 503, json: { message: 'Evidence Chain unavailable' } })
        : route.fulfill({ json: evidenceChain });
    }
    if (path === '/specs/spec-1/revisions') return route.fulfill({ json: [] });
    if (path === '/plans/plan-1/revisions') return route.fulfill({ json: [] });
    return route.fulfill({ status: 404, json: { message: `Unhandled test route ${path}` } });
  });
}

function runSelect(page: Page) {
  return page.locator('section.run-review label').filter({ hasText: /^Run/ }).locator('select');
}

async function installReloadSentinel(page: Page): Promise<string> {
  const sentinel = `run-console-${Date.now()}-${Math.random()}`;
  await page.evaluate((value) => {
    (window as unknown as Record<string, string>).__forgeloopRunConsoleReloadSentinel = value;
  }, sentinel);
  return sentinel;
}

async function reloadSentinelIsPresent(page: Page, sentinel: string): Promise<boolean> {
  return page.evaluate((value) => {
    return (window as unknown as Record<string, string>).__forgeloopRunConsoleReloadSentinel === value;
  }, sentinel);
}

async function stopProcess(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null || process.signalCode !== null) return;
  process.kill();
  await waitForProcessExit(process);
}

async function waitForProcessExit(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null || process.signalCode !== null) return;
  await new Promise<void>((resolveExit) => {
    const timeout = setTimeout(resolveExit, 1000);
    process.once('exit', () => {
      clearTimeout(timeout);
      resolveExit();
    });
  });
}

async function startApi(): Promise<{
  app: INestApplication;
  apiUrl: string;
  repo: InMemoryP0Repository;
  runSessionId: string;
}> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RUN_WORKER)
    .useValue({ kick: () => undefined, drainOnce: async () => undefined })
    .compile();
  const app = moduleRef.createNestApplication();
  app.enableCors({ origin: true });
  await app.init();

  const executionPackage = await seedReadyExecutionPackageThroughApi(app);
  const runResponse = (
    await request(app.getHttpServer())
      .post(`/execution-packages/${executionPackage.id}/run`)
      .set('X-Forgeloop-Actor-Id', actorOwner)
      .send({ requested_by_actor_id: actorOwner, executor_type: 'mock', workflow_only: true })
      .expect(201)
  ).body as { run_session_id: string };

  const repo = app.get(P0_REPOSITORY) as InMemoryP0Repository;
  const runSession = await repo.getRunSession(runResponse.run_session_id);
  const running = transitionRunSession(runSession, { type: 'worker_started', at: '2026-05-07T00:00:01.000Z' });
  const waiting = transitionRunSession(running, { type: 'waiting_for_input', at: '2026-05-07T00:00:02.000Z' });
  await repo.saveRunSession(waiting);

  await app.listen(0);
  return { app, apiUrl: await app.getUrl(), repo, runSessionId: runResponse.run_session_id };
}

async function startWeb(apiUrl: string): Promise<ViteDevServer> {
  process.env.VITE_FORGELOOP_API_URL = apiUrl;
  const server = await createViteServer({
    configFile: resolve('apps/web/vite.config.ts'),
    root: resolve('apps/web'),
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  });
  await server.listen();
  return server;
}

async function launchChromiumOverCdp(): Promise<{ browser: Browser; process: ChildProcess; profileDir: string }> {
  const port = await freePort();
  const profileDir = await mkdtemp(join(tmpdir(), 'forgeloop-run-console-chromium-'));
  const process = spawn(headlessShellExecutablePath(), [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ]);
  process.stderr.resume();
  process.stdout.resume();

  try {
    const browser = await waitForCdpBrowser(port);
    return { browser, process, profileDir };
  } catch (error) {
    await stopProcess(process);
    await rm(profileDir, { force: true, maxRetries: 5, recursive: true, retryDelay: 100 });
    throw error;
  }
}

function headlessShellExecutablePath(): string {
  const revision = chromium.executablePath().match(/chromium-(\d+)/)?.[1];
  if (revision === undefined) throw new Error(`Unable to resolve Playwright Chromium revision from ${chromium.executablePath()}`);
  const home = process.env.HOME ?? '';
  const candidates = [
    join(home, 'Library/Caches/ms-playwright', `chromium_headless_shell-${revision}`, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell'),
    join(home, 'Library/Caches/ms-playwright', `chromium_headless_shell-${revision}`, 'chrome-headless-shell-mac-x64', 'chrome-headless-shell'),
    join(home, '.cache/ms-playwright', `chromium_headless_shell-${revision}`, 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
    join(home, '.cache/ms-playwright', `chromium_headless_shell-${revision}`, 'chrome-linux', 'headless_shell'),
    chromium.executablePath(),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? chromium.executablePath();
}

async function waitForCdpBrowser(port: number): Promise<Browser> {
  const deadline = Date.now() + 10_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch (error) {
      lastError = error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Chromium CDP endpoint did not open');
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address !== 'object' || address === null) {
        server.close(() => reject(new Error('Unable to allocate a TCP port')));
        return;
      }
      const port = address.port;
      server.close(() => resolvePort(port));
    });
  });
}

function requireViteUrl(server: ViteDevServer): string {
  const url = server.resolvedUrls?.local[0];
  if (url === undefined) throw new Error('Vite did not expose a local URL');
  return url;
}

async function latestApiCursor(app: INestApplication, runSessionId: string): Promise<string> {
  const response = await request(app.getHttpServer())
    .get(`/run-sessions/${runSessionId}/events`)
    .set('X-Forgeloop-Actor-Id', actorOwner)
    .expect(200);
  const cursor = response.body.events.at(-1)?.cursor;
  if (typeof cursor !== 'string') throw new Error('API did not return a latest run event cursor');
  return cursor;
}

async function latestBackfillCursor(app: INestApplication, runSessionId: string): Promise<string> {
  const response = await request(app.getHttpServer())
    .get(`/run-sessions/${runSessionId}/events`)
    .set('X-Forgeloop-Actor-Id', actorOwner)
    .expect(200);
  const cursor = response.body.next_cursor;
  if (typeof cursor !== 'string') throw new Error('API did not return a backfill run event cursor');
  return cursor;
}

async function latestRenderedCursor(page: Page): Promise<string | undefined> {
  return page.getByTestId('run-console-events').evaluate((element) => {
    const rows = [...element.querySelectorAll<HTMLElement>('[data-event-cursor]')];
    return rows.at(-1)?.dataset.eventCursor;
  });
}

async function expectVisibleText(locator: ReturnType<Page['getByTestId']>, text: string): Promise<void> {
  await expectPage(locator.getByText(text, { exact: false }).first()).toBeVisible();
}

async function assertRunConsoleLayout(page: Page): Promise<void> {
  await page.getByTestId('run-console').scrollIntoViewIfNeeded();

  const noHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expectValue(noHorizontalOverflow).toBe(true);

  const events = await requiredBox(page.getByTestId('run-console-events'), 'run console events');
  for (const testId of ['run-console-input', 'run-console-send', 'run-console-cancel', 'run-console-resume']) {
    const control = await requiredBox(page.getByTestId(testId), testId);
    expectValue(overlaps(events, control)).toBe(false);
  }
}

async function requiredBox(locator: ReturnType<Page['getByTestId']>, name: string) {
  const box = await locator.boundingBox();
  if (box === null) throw new Error(`Missing bounding box for ${name}`);
  return box;
}

function overlaps(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

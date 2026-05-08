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

      const initialCursor = await latestRenderedCursor(page);
      expectValue(initialCursor).toMatch(/^\d{10}$/);

      await streamOpened;
      const navigationCountAfterStreamOpen = mainFrameNavigationCount;
      const reloadSentinel = await installReloadSentinel(page);

      await request(app.getHttpServer())
        .post(`/run-sessions/${runSessionId}/input`)
        .set('X-Forgeloop-Actor-Id', actorOwner)
        .send({ message: 'API-created event after stream open.' })
        .expect(201);

      const liveCursor = await latestApiCursor(app, runSessionId);
      await expectPage(page.locator(`[data-event-cursor="${liveCursor}"]`)).toBeVisible();
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
});

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

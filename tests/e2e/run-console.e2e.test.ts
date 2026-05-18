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
import { afterEach, describe, expect as expectValue, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import { DELIVERY_RUN_WORKER } from '../../apps/control-plane-api/src/modules/run-control/run-worker.token';
import type { InMemoryDeliveryRepository } from '../../packages/db/src';
import { transitionRunSession } from '../../packages/domain/src/index';
import { seedReadyExecutionPackageThroughApi } from '../helpers/delivery-runtime-fixtures';

const actorOwner = 'actor-owner';
const viewports = [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
];

describe('run console browser e2e', () => {
  const apps: INestApplication[] = [];
  const webProcesses: ChildProcess[] = [];
  const browsers: Browser[] = [];
  const browserProcesses: ChildProcess[] = [];
  const browserProfileDirs: string[] = [];

  afterEach(async () => {
    const cleanupResults = await Promise.allSettled([
      ...browsers.splice(0).map((browser) => browser.close()),
      ...browserProcesses.splice(0).map((browserProcess) => stopProcess(browserProcess)),
      ...webProcesses.splice(0).map((webProcess) => stopProcess(webProcess)),
      ...browserProfileDirs
        .splice(0)
        .map((profileDir) => rm(profileDir, { force: true, maxRetries: 5, recursive: true, retryDelay: 100 })),
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

      const web = await startWeb(apiUrl);
      webProcesses.push(web.webProcess);
      const runUrl = `${web.url}runs/${runSessionId}`;

      const { browser, browserProcess, profileDir } = await launchChromiumOverCdp();
      browsers.push(browser);
      browserProcesses.push(browserProcess);
      browserProfileDirs.push(profileDir);
      const page = await browser.newPage({ viewport: viewports[0] });
      let mainFrameNavigationCount = 0;
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) mainFrameNavigationCount += 1;
      });

      const streamOpened = page.waitForResponse(
        (response) => response.url().includes(`/run-sessions/${runSessionId}/events/stream?`) && response.status() === 200,
      );
      await page.goto(runUrl);

      const console = page.getByTestId('run-console');
      await expectVisibleText(console, 'Run queued');

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
      expectValue(page.url()).toBe(runUrl);

      await page.getByTestId('run-console-input').fill('Browser input from the run console.');
      await page.getByTestId('run-console-send').click();
      await expectVisibleText(console, 'Operator input');

      await page.getByTestId('run-console-resume').click();
      await expectVisibleText(console, 'Resume requested');

      const runSession = await repo.getRunSession(runSessionId);
      await repo.saveRunSession({ ...runSession!, status: 'stalled' });
      await page.getByTestId('run-console-cancel').click();
      await expectVisibleText(console, 'Cancellation requested');

      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        await assertRunConsoleLayout(page);
      }

      const consoleText = await console.innerText();
      expectValue(consoleText).not.toContain('raw_ref');
      expectValue(consoleText).not.toContain('local_ref');
      expectValue(consoleText).not.toContain('raw-codex');
      expectValue(consoleText).not.toContain('run_queued');
      expectValue(consoleText).not.toContain('user_input');
      expectValue(consoleText).not.toContain('resuming');
      expectValue(consoleText).not.toContain('cancel_requested');
    },
    60_000,
  );
});

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

async function stopProcess(childProcess: ChildProcess): Promise<void> {
  if (childProcess.exitCode !== null || childProcess.signalCode !== null) return;
  childProcess.kill('SIGTERM');
  try {
    await waitForProcessExit(childProcess, 1000);
  } catch {
    childProcess.kill('SIGKILL');
    await waitForProcessExit(childProcess, 2000);
  }
  if (childProcess.exitCode === null && childProcess.signalCode === null) {
    throw new Error(`Process ${childProcess.pid ?? 'unknown'} did not exit after termination`);
  }
}

async function waitForProcessExit(childProcess: ChildProcess, timeoutMs: number): Promise<void> {
  if (childProcess.exitCode !== null || childProcess.signalCode !== null) return;
  await new Promise<void>((resolveExit, rejectExit) => {
    const timeout = setTimeout(() => {
      childProcess.off('exit', onExit);
      rejectExit(new Error(`Process ${childProcess.pid ?? 'unknown'} did not exit within ${timeoutMs}ms`));
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timeout);
      resolveExit();
    };
    childProcess.once('exit', onExit);
  });
}

async function startApi(): Promise<{
  app: INestApplication;
  apiUrl: string;
  repo: InMemoryDeliveryRepository;
  runSessionId: string;
}> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DELIVERY_RUN_WORKER)
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
      .send({ executor_type: 'mock', workflow_only: true })
      .expect(201)
  ).body as { run_session_id: string };

  const repo = app.get(DELIVERY_REPOSITORY) as InMemoryDeliveryRepository;
  const runSession = await repo.getRunSession(runResponse.run_session_id);
  const running = transitionRunSession(runSession, { type: 'worker_started', at: '2026-05-07T00:00:01.000Z' });
  const waiting = transitionRunSession(running, { type: 'waiting_for_input', at: '2026-05-07T00:00:02.000Z' });
  await repo.saveRunSession(waiting);

  await app.listen(0);
  return { app, apiUrl: await app.getUrl(), repo, runSessionId: runResponse.run_session_id };
}

async function startWeb(apiUrl: string): Promise<{ url: string; webProcess: ChildProcess }> {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}/`;
  const output: string[] = [];
  const webProcess = spawn('pnpm', ['--filter', '@forgeloop/web', 'dev', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: resolve('.'),
    env: { ...process.env, VITE_FORGELOOP_API_URL: apiUrl },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  webProcess.stdout?.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  webProcess.stderr?.on('data', (chunk: Buffer) => output.push(chunk.toString()));

  try {
    await waitForWebUrl(url, webProcess, output);
    return { url, webProcess };
  } catch (error) {
    await stopProcess(webProcess);
    throw error;
  }
}

async function launchChromiumOverCdp(): Promise<{ browser: Browser; browserProcess: ChildProcess; profileDir: string }> {
  const port = await freePort();
  const profileDir = await mkdtemp(join(tmpdir(), 'forgeloop-run-console-chromium-'));
  const browserProcess = spawn(headlessShellExecutablePath(), [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ]);
  browserProcess.stderr.resume();
  browserProcess.stdout.resume();

  try {
    const browser = await waitForCdpBrowser(port);
    return { browser, browserProcess, profileDir };
  } catch (error) {
    await stopProcess(browserProcess);
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

async function waitForWebUrl(url: string, webProcess: ChildProcess, output: string[]): Promise<void> {
  const deadline = Date.now() + 30_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (webProcess.exitCode !== null || webProcess.signalCode !== null) {
      throw new Error(`Web dev server exited before ${url} was ready.\n${output.join('')}`);
    }
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
      lastError = new Error(`Web dev server responded ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown error');
  throw new Error(`Web dev server did not become ready at ${url}: ${message}\n${output.join('')}`);
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

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
import type { Task } from '../../packages/domain/src';
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
      const { app, apiUrl, runSessionId, taskId } = await startApi();
      apps.push(app);

      const web = await startWeb(apiUrl);
      webProcesses.push(web.webProcess);
      const runUrl = `${web.url}tasks/${taskId}/runs/${runSessionId}`;

      const { browser, browserProcess, profileDir } = await launchChromiumOverCdp();
      browsers.push(browser);
      browserProcesses.push(browserProcess);
      browserProfileDirs.push(profileDir);
      const page = await browser.newPage({ viewport: viewports[0] });
      let mainFrameNavigationCount = 0;
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) mainFrameNavigationCount += 1;
      });

      await page.goto(runUrl);

      await expectPage(page.getByRole('heading', { name: 'Run Evidence' })).toBeVisible();
      await expectPage(page.getByText('Waiting For Input').first()).toBeVisible();
      await expectPage(page.getByText(`Task ${taskId}`)).toBeVisible();
      expectValue(page.url()).toBe(runUrl);
      expectValue(new URL(page.url()).pathname).not.toBe(`/runs/${runSessionId}`);
      const navigationCountAfterRouteOpen = mainFrameNavigationCount;
      const reloadSentinel = await installReloadSentinel(page);

      await request(app.getHttpServer())
        .post(`/run-sessions/${runSessionId}/input`)
        .set('X-Forgeloop-Actor-Id', actorOwner)
        .send({ message: 'API-created event after stream open.' })
        .expect(201);

      await expectPage(page.getByRole('heading', { name: 'Run Evidence' })).toBeVisible();
      expectValue(mainFrameNavigationCount).toBe(navigationCountAfterRouteOpen);
      expectValue(await reloadSentinelIsPresent(page, reloadSentinel)).toBe(true);
      expectValue(page.url()).toBe(runUrl);

      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        await assertRunEvidenceLayout(page);
      }

      const pageText = await page.locator('main').innerText();
      expectValue(pageText).not.toContain('raw_ref');
      expectValue(pageText).not.toContain('local_ref');
      expectValue(pageText).not.toContain('raw-codex');
      expectValue(pageText).not.toContain(`href="/runs/${runSessionId}"`);
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
  taskId: string;
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
  const taskId = 'task-run-console-e2e';
  await repo.saveTask({
    id: taskId,
    project_id: executionPackage.project_id,
    title: 'Run console evidence task',
    narrative_markdown: '',
    execution_brief: 'Validate task-scoped run evidence route.',
    acceptance_checklist: ['Run evidence route renders'],
    status: 'ready',
    controlling_spec_revision_id: executionPackage.spec_revision_id,
    controlling_plan_revision_id: executionPackage.plan_revision_id,
    stale_state: 'current',
    created_at: '2026-05-07T00:00:00.000Z',
    updated_at: '2026-05-07T00:00:00.000Z',
  } satisfies Task);
  await repo.linkExecutionPackageToTask({ task_id: taskId, execution_package_id: executionPackage.id });

  const runSession = await repo.getRunSession(runResponse.run_session_id);
  const running = transitionRunSession(runSession, { type: 'worker_started', at: '2026-05-07T00:00:01.000Z' });
  const waiting = transitionRunSession(running, { type: 'waiting_for_input', at: '2026-05-07T00:00:02.000Z' });
  await repo.saveRunSession(waiting);

  await app.listen(0);
  return { app, apiUrl: await app.getUrl(), repo, runSessionId: runResponse.run_session_id, taskId };
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

async function assertRunEvidenceLayout(page: Page): Promise<void> {
  await page.getByRole('heading', { name: 'Run Evidence' }).scrollIntoViewIfNeeded();

  const noHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expectValue(noHorizontalOverflow).toBe(true);
  await expectPage(page.getByRole('main')).toBeVisible();
}

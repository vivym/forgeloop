import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createServer as createHttpServer, type Server } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { join } from 'node:path';

import { chromium, expect as expectPage, type Browser } from '@playwright/test';
import type { ProductLaneItem, ProductLaneResponse } from '@forgeloop/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { defaultProductApiResponses, type ProductApiResponseMap } from '../web/fixtures/product-api-mock';
import { executionPackage, projectId, release, reviewPacket, runSession, workItem } from '../web/fixtures/product-data';

const routes = [
  '/workbench',
  '/workbench/requirements',
  '/pipeline',
  '/work-items',
  '/work-items/wi-1',
  '/work-items/wi-1/spec-plan',
  '/specs',
  '/plans',
  '/packages',
  `/packages/${executionPackage.id}`,
  '/runs',
  `/runs/${runSession.id}`,
  '/reviews',
  `/reviews/${reviewPacket.id}`,
  '/releases',
  `/releases/${release.id}`,
];

const viewports = [
  { width: 375, height: 900 },
  { width: 768, height: 900 },
  { width: 1024, height: 900 },
  { width: 1440, height: 1000 },
];

describe('web product routes visual smoke', () => {
  let apiServer: Server | undefined;
  let browser: Browser | undefined;
  let webProcess: ChildProcess | undefined;

  afterEach(async () => {
    await browser?.close();
    if (webProcess !== undefined) await stopProcess(webProcess);
    if (apiServer !== undefined) await stopServer(apiServer);
    apiServer = undefined;
    browser = undefined;
    webProcess = undefined;
  });

  it(
    'renders populated product routes without horizontal overflow',
    async () => {
      const api = await startProductApiMockServer(highDensityProductApiResponses());
      apiServer = api.server;
      const web = await startReactRouterWeb(api.url);
      webProcess = web.process;
      browser = await chromium.launch();
      const page = await browser.newPage();

      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        for (const route of routes) {
          await page.goto(`${web.url}${route}`);
          await expectPage(page.getByRole('main')).toBeVisible();
          await assertPopulatedRoute(page, route);
          const overflow = await page.evaluate(overflowDetails);
          expect(
            overflow.scrollWidth,
            `${route} at ${viewport.width}px overflowed: scrollWidth=${overflow.scrollWidth}, clientWidth=${overflow.clientWidth}; ${overflow.offenders}`,
          ).toBeLessThanOrEqual(overflow.clientWidth);
          await mkdir(join('test-results', 'web-product-routes', 'populated'), { recursive: true });
          await page.screenshot({
            fullPage: true,
            path: join('test-results', 'web-product-routes', 'populated', `${routeName(route)}-${viewport.width}.png`),
          });
        }
      }

      expect(api.unhandledRequests).toEqual([]);
      expect(api.handledRequests).toContain(`GET /query/product-lanes/requirements?project_id=${projectId}`);
    },
    120_000,
  );

  it(
    'renders degraded product routes without horizontal overflow',
    async () => {
      const web = await startReactRouterWeb('http://127.0.0.1:1');
      webProcess = web.process;
      browser = await chromium.launch();
      const page = await browser.newPage();

      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        for (const route of routes) {
          await page.goto(`${web.url}${route}`);
          await expectPage(page.getByRole('main')).toBeVisible();
          const overflow = await page.evaluate(overflowDetails);
          expect(
            overflow.scrollWidth,
            `${route} at ${viewport.width}px degraded overflowed: scrollWidth=${overflow.scrollWidth}, clientWidth=${overflow.clientWidth}; ${overflow.offenders}`,
          ).toBeLessThanOrEqual(overflow.clientWidth);
          await mkdir(join('test-results', 'web-product-routes', 'degraded'), { recursive: true });
          await page.screenshot({
            fullPage: true,
            path: join('test-results', 'web-product-routes', 'degraded', `${routeName(route)}-${viewport.width}.png`),
          });
        }
      }
    },
    120_000,
  );
});

async function startReactRouterWeb(apiUrl: string): Promise<{ process: ChildProcess; url: string }> {
  const port = await freePort();
  const webProcess = spawn(
    'pnpm',
    ['--filter', '@forgeloop/web', 'dev', '--host', '127.0.0.1', '--port', String(port)],
    { env: { ...process.env, VITE_FORGELOOP_API_URL: apiUrl }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  webProcess.stderr?.resume();
  webProcess.stdout?.resume();
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status < 600) return { process: webProcess, url };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  await stopProcess(webProcess);
  throw new Error(`React Router Web dev server did not start at ${url}`);
}

async function startProductApiMockServer(
  overrides: ProductApiResponseMap = {},
): Promise<{ handledRequests: string[]; server: Server; unhandledRequests: string[]; url: string }> {
  const port = await freePort();
  const responses = { ...defaultProductApiResponses, ...overrides };
  const handledRequests: string[] = [];
  const unhandledRequests: string[] = [];
  const server = createHttpServer(async (request, response) => {
    response.setHeader('access-control-allow-origin', '*');
    response.setHeader('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    response.setHeader('access-control-allow-headers', 'content-type');

    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }

    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `127.0.0.1:${port}`}`);
    if (url.pathname.endsWith('/events/stream')) {
      response.writeHead(200, {
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'content-type': 'text/event-stream',
      });
      response.write('\n');
      return;
    }

    const method = (request.method ?? 'GET').toUpperCase();
    const key = `${method} ${url.pathname}${url.search}`;
    const fixture = responses[key];

    if (fixture === undefined) {
      unhandledRequests.push(key);
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ message: `Unhandled product API request: ${key}` }));
      return;
    }
    handledRequests.push(key);

    const body =
      typeof fixture === 'function'
        ? await fixture({ input: new Request(url), init: { method }, key })
        : fixture;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });

  return { handledRequests, server, unhandledRequests, url: `http://127.0.0.1:${port}` };
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 1000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

function stopServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address !== 'object' || address === null) {
        server.close(() => reject(new Error('Unable to allocate a TCP port')));
        return;
      }
      server.close(() => resolvePort(address.port));
    });
  });
}

function routeName(route: string): string {
  return route.replaceAll('/', '_').replace(/^_$/, 'index').replace(/^_/, '');
}

async function assertPopulatedRoute(page: Awaited<ReturnType<Browser['newPage']>>, route: string) {
  if (route === '/workbench') {
    await expectPage(page).toHaveURL(/\/workbench\/requirements$/);
  }
  const expectation = populatedRouteText(route);
  await expectPage(
    page.getByRole('main').getByText(expectation).filter({ visible: true }).first(),
    `${route} did not render populated fixture content`,
  ).toBeVisible();
}

function populatedRouteText(route: string): string | RegExp {
  switch (route) {
    case '/workbench':
    case '/workbench/requirements':
      return 'Improve release cockpit';
    case '/pipeline':
      return 'Release cockpit frontend waits on contract fixture parity.';
    case '/work-items':
      return workItem.title;
    case '/work-items/wi-1':
    case '/work-items/wi-1/spec-plan':
      return 'Improve release cockpit';
    case '/specs':
    case '/plans':
      return workItem.title;
    case '/packages':
    case `/packages/${executionPackage.id}`:
      return executionPackage.objective;
    case '/runs':
      return runSession.summary ?? runSession.id;
    case `/runs/${runSession.id}`:
      return 'Run Console';
    case '/reviews':
    case `/reviews/${reviewPacket.id}`:
      return reviewPacket.summary;
    case '/releases':
    case `/releases/${release.id}`:
      return release.title;
    default:
      throw new Error(`Missing populated route assertion for ${route}`);
  }
}

function highDensityProductApiResponses(): ProductApiResponseMap {
  const pipeline = responseFor<{ stages: Array<Record<string, unknown>>; degraded_sources: string[] }>(
    `GET /query/pipeline?project_id=${projectId}`,
  );
  const requirementsLane = responseFor<ProductLaneResponse>(`GET /query/product-lanes/requirements?project_id=${projectId}`);
  const runs = responseFor<{ items: Array<Record<string, unknown>>; degraded_sources: string[] }>(
    `GET /query/runs?project_id=${projectId}&limit=100`,
  );
  const releases = responseFor<{ releases: Array<Record<string, unknown>> }>(
    `GET /query/releases?project_id=${projectId}`,
  );
  const releasesWithLimit = responseFor<{ releases: Array<Record<string, unknown>> }>(
    `GET /query/releases?project_id=${projectId}&limit=100`,
  );
  const cockpit = responseFor<{
    work_items: Array<Record<string, unknown>>;
    execution_packages: Array<Record<string, unknown>>;
    latest_run_sessions: Array<Record<string, unknown>>;
    current_review_packets: Array<Record<string, unknown>>;
  }>(`GET /query/release-cockpit/${release.id}`);

  return {
    [`GET /query/pipeline?project_id=${projectId}`]: {
      ...pipeline,
      stages: pipeline.stages.map((stage) => {
        const representativeItems = duplicateProductItems(
          ((stage.representative_items as Array<Record<string, unknown>> | undefined)?.[0] ?? pipelineFallbackItem(stage.id)),
          6,
        );
        return {
          ...stage,
          item_count: Math.max(Number(stage.item_count ?? 0), representativeItems.length),
          representative_items: representativeItems,
        };
      }),
    },
    [`GET /query/product-lanes/requirements?project_id=${projectId}`]: {
      ...requirementsLane,
      summary: { ...requirementsLane.summary, total: 6 },
      items: duplicateProductLaneItems(requirementsLane.items[0], 6),
    },
    [`GET /query/runs?project_id=${projectId}&limit=100`]: {
      ...runs,
      items: duplicateProductItems(runs.items[0], 6),
    },
    [`GET /query/releases?project_id=${projectId}`]: {
      releases: duplicateReleases(releases.releases[0], 6),
    },
    [`GET /query/releases?project_id=${projectId}&limit=100`]: {
      releases: duplicateReleases(releasesWithLimit.releases[0], 6),
    },
    [`GET /query/release-cockpit/${release.id}`]: {
      ...cockpit,
      work_items: duplicateDomainObjects(cockpit.work_items[0], 6),
      execution_packages: duplicateDomainObjects(cockpit.execution_packages[0], 6),
      latest_run_sessions: duplicateDomainObjects(cockpit.latest_run_sessions[0], 6),
      current_review_packets: duplicateDomainObjects(cockpit.current_review_packets[0], 6),
    },
  };
}

function responseFor<T>(key: string): T {
  const response = defaultProductApiResponses[key];
  if (response === undefined || typeof response === 'function') {
    throw new Error(`Missing static fixture for ${key}`);
  }
  return response as T;
}

function duplicateProductLaneItems(item: ProductLaneItem | undefined, count: number): ProductLaneItem[] {
  if (item === undefined) return [];
  return Array.from({ length: count }, (_, index) => {
    if (index === 0) return item;

    const id = `${item.id}-density-${index}`;
    const title = `${item.title} ${index + 1}`;
    const object = item.object.type === 'lane_summary' ? { ...item.object, id } : { ...item.object, id };

    return {
      ...item,
      id,
      title,
      object,
      actions: item.actions.map((action, actionIndex) => ({
        ...action,
        id: `${action.id}-density-${index}-${actionIndex}`,
      })),
    };
  });
}

function duplicateProductItems(item: Record<string, unknown>, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const object = item.object as Record<string, unknown>;
    const id = index === 0 ? String(item.id) : `${String(item.id)}-density-${index}`;
    const title = index === 0 ? String(item.title) : `${String(item.title)} ${index + 1}`;
    return {
      ...item,
      id,
      title,
      object: { ...object, id, title },
    };
  });
}

function duplicateReleases(item: Record<string, unknown>, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    ...item,
    id: index === 0 ? item.id : `${String(item.id)}-density-${index}`,
    title: index === 0 ? item.title : `${String(item.title)} ${index + 1}`,
  }));
}

function duplicateDomainObjects(item: Record<string, unknown>, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    ...item,
    id: index === 0 ? item.id : `${String(item.id)}-density-${index}`,
    title: index === 0 ? item.title : item.title === undefined ? undefined : `${String(item.title)} ${index + 1}`,
  }));
}

function pipelineFallbackItem(stageId: unknown): Record<string, unknown> {
  const id = `pipeline-${String(stageId)}-item`;
  return {
    id,
    object: { type: 'execution_package', id, title: `Pipeline ${String(stageId)} item` },
    title: `Pipeline ${String(stageId)} item`,
    counts: {},
    related: [],
    updated_at: '2026-05-18T00:00:00.000Z',
  };
}

function overflowDetails() {
  const clientWidth = document.documentElement.clientWidth;
  const scrollWidth = document.documentElement.scrollWidth;
  const offenders = [...document.querySelectorAll('body *')]
    .map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        className: element.getAttribute('class') ?? '',
        tagName: element.tagName.toLowerCase(),
        text: (element.textContent ?? '').trim().slice(0, 80),
        width: Math.round(rect.width),
        x: Math.round(rect.x),
      };
    })
    .filter((item) => item.width > clientWidth || item.x + item.width > clientWidth)
    .sort((left, right) => right.x + right.width - (left.x + left.width))
    .slice(0, 5)
    .map((item) => `${item.tagName}.${item.className} x=${item.x} w=${item.width} text=${JSON.stringify(item.text)}`)
    .join(' | ');
  return { clientWidth, offenders, scrollWidth };
}

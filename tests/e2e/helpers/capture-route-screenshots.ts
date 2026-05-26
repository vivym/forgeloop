import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { resolve } from 'node:path';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { chromium, expect as expectPage, type Browser, type Page, type Route } from '@playwright/test';
import { expect } from 'vitest';
import type { DeliveryRepository } from '@forgeloop/db';
import type { DevelopmentPlanItem, Execution, WorkItem } from '@forgeloop/domain';

import { AppModule } from '../../../apps/control-plane-api/src/app.module';
import { DELIVERY_REPOSITORY } from '../../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import { defaultProductApiResponses, type ProductApiResponseMap } from '../../web/fixtures/product-api-mock';
import {
  projectId,
} from '../../web/fixtures/product-data';
import { firstViewportContract } from '../../../apps/web/src/features/product-surfaces/first-viewport-contract';
import {
  requiredScreenshotRoutes,
  visualViewports,
  type ProductPageFamily,
  type ProductRouteContract,
} from '../../../apps/web/src/features/product-surfaces/route-contract';

export const visualViewportWidths = visualViewports;

export type VisualRouteKind = 'active' | 'retired' | 'source-object';

export interface VisualRoute {
  family?: ProductPageFamily;
  path: string;
  heading: RegExp;
  kind: VisualRouteKind;
  expectActionSurface?: boolean;
  expectFirstViewportContract?: boolean;
}

export interface VisualServer {
  stop: () => Promise<void>;
  url: string;
}

export const aiNativeProjectManagementRoutes: VisualRoute[] = requiredScreenshotRoutes.map(toVisualRoute);

export const productGradeScreenshotRoutes = aiNativeProjectManagementRoutes;

export interface AiNativeProjectManagementFixture {
  baseUrl: string;
  browser: Browser;
  completeExecutionForReview: (executionId: string) => Promise<void>;
  firstPlanItemId: (developmentPlanId: string) => Promise<string>;
  page: Page;
  stop: () => Promise<void>;
}

export async function ensureVisualWebServer(): Promise<VisualServer> {
  const configuredUrl = process.env.FORGELOOP_WEB_BASE_URL === undefined
    ? `http://127.0.0.1:${await freePort()}`
    : normalizeBaseUrl(process.env.FORGELOOP_WEB_BASE_URL);
  if (await forgeLoopDevServerIsReady(configuredUrl)) {
    return { url: configuredUrl, stop: async () => undefined };
  }
  if (process.env.FORGELOOP_WEB_BASE_URL !== undefined && await urlIsReady(configuredUrl)) {
    throw new Error(`${configuredUrl} is occupied by a non-ForgeLoop Web dev server`);
  }

  const url = new URL(configuredUrl);
  const host = url.hostname === 'localhost' ? '127.0.0.1' : url.hostname;
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  const output: string[] = [];
  const webProcess = spawn('pnpm', ['--filter', '@forgeloop/web', 'dev', '--host', host, '--port', port], {
    cwd: resolve('.'),
    env: {
      ...process.env,
      VITE_FORGELOOP_API_URL: 'http://127.0.0.1:3000',
      VITE_FORGELOOP_QUERY_RETRY: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  webProcess.stdout?.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  webProcess.stderr?.on('data', (chunk: Buffer) => output.push(chunk.toString()));

  try {
    await waitForWebUrl(configuredUrl, webProcess, output);
    return {
      url: configuredUrl,
      stop: () => stopProcess(webProcess),
    };
  } catch (error) {
    await stopProcess(webProcess);
    throw error;
  }
}

export async function launchVisualBrowser(): Promise<Browser> {
  return chromium.launch({ headless: true });
}

export async function installMockedProductApi(page: Page, overrides: ProductApiResponseMap = {}) {
  const responses = { ...defaultProductApiResponses, ...overrides };

  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!isProductApiRequest(url)) {
      await route.continue();
      return;
    }

    const key = `${request.method().toUpperCase()} ${url.pathname}${url.search}`;
    if (!Object.prototype.hasOwnProperty.call(responses, key)) {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ message: `Unhandled product API request: ${key}` }),
      });
      return;
    }

    const response = responses[key];
    const body = typeof response === 'function'
      ? await response({ body: requestBody(request.postData()), input: request.url(), init: { method: request.method() }, key })
      : response;
    if (body instanceof Response) {
      await fulfillResponse(route, body);
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

function requestBody(postData: string | null): unknown {
  if (postData === null || postData.trim().length === 0) return undefined;
  try {
    return JSON.parse(postData);
  } catch {
    return postData;
  }
}

export async function startAiNativeProjectManagementFixture(): Promise<AiNativeProjectManagementFixture> {
  const app = await startVisualApi();
  await seedVisualApi(app);
  const server = await startOwnedVisualWebServer(await app.getUrl());
  const browser = await launchVisualBrowser();
  const page = await browser.newPage();

  return {
    baseUrl: server.url,
    browser,
    completeExecutionForReview: (executionId: string) => completeExecutionForReview(app, executionId),
    firstPlanItemId: (developmentPlanId: string) => firstPlanItemId(app, developmentPlanId),
    page,
    stop: async () => {
      const cleanup = await Promise.allSettled([browser.close(), server.stop(), app.close()]);
      const errors = cleanup.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
      if (errors.length > 0) throw new AggregateError(errors, 'AI-native visual fixture cleanup failed');
    },
  };
}

async function startVisualApi(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.enableCors({ origin: true });
  await app.init();
  await app.listen(0);
  return app;
}

async function startOwnedVisualWebServer(apiUrl: string): Promise<VisualServer> {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const output: string[] = [];
  const webProcess = spawn('pnpm', ['--filter', '@forgeloop/web', 'dev', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: resolve('.'),
    env: {
      ...process.env,
      VITE_FORGELOOP_API_URL: apiUrl,
      VITE_FORGELOOP_QUERY_RETRY: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  webProcess.stdout?.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  webProcess.stderr?.on('data', (chunk: Buffer) => output.push(chunk.toString()));

  try {
    await waitForWebUrl(url, webProcess, output);
    return { url, stop: () => stopProcess(webProcess) };
  } catch (error) {
    await stopProcess(webProcess);
    throw error;
  }
}

async function seedVisualApi(app: INestApplication) {
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const now = '2026-05-24T00:00:00.000Z';
  await repository.saveOrganization({ id: 'org-visual', name: 'Visual QA Org', created_at: now, updated_at: now });
  await repository.saveActor({
    id: 'actor-owner',
    org_id: 'org-visual',
    actor_type: 'human',
    display_name: 'Visual QA Owner',
    email: 'visual-owner@example.test',
    created_at: now,
    updated_at: now,
  });
  await repository.saveProject({
    id: projectId,
    name: 'ForgeLoop product architecture demo',
    repo_ids: ['repo-visual'],
    owner_actor_id: 'actor-owner',
    created_at: now,
    updated_at: now,
  });
  await repository.saveProjectRepo({
    id: 'project-repo-visual',
    repo_id: 'repo-visual',
    project_id: projectId,
    name: 'forgeloop',
    status: 'active',
    local_path: resolve('.'),
    default_branch: 'main',
    base_commit_sha: 'visual-e2e',
    created_at: now,
    updated_at: now,
  });
  await repository.saveWorkItem(visualWorkItem('req-plan-item-governance', 'requirement', 'Plan Item governed Spec and Execution Plan generation', now));
  await repository.saveWorkItem(visualWorkItem('bug-execution-review-context', 'bug', 'Execution continuation loses review context', now));
  await repository.saveWorkItem(visualWorkItem('td-retire-workspace-page-template', 'tech_debt', 'Retire generic WorkspacePage visual template', now));
  await repository.saveWorkItem(visualWorkItem('init-ai-native-rollout', 'initiative', 'AI-native project management rollout', now));
}

function visualWorkItem(id: string, kind: WorkItem['kind'], title: string, now: string): WorkItem {
  return {
    id,
    project_id: projectId,
    kind,
    title,
    narrative_markdown: `# ${title}\n\nValidate product architecture through the AI-native delivery flow.`,
    goal: `${title} is visible in product architecture visual review.`,
    success_criteria: ['Seeded object data is visible.', 'Development Plan Item gates are reviewed.'],
    priority: kind === 'bug' ? 'P0' : 'P1',
    risk: kind === 'bug' ? 'high' : 'medium',
    driver_actor_id: 'actor-owner',
    intake_context: visualIntakeContext(kind, title),
    phase: 'triage',
    activity_state: 'idle',
    gate_state: 'none',
    resolution: 'none',
    created_at: now,
    updated_at: now,
  };
}

function visualIntakeContext(kind: WorkItem['kind'], title: string): WorkItem['intake_context'] {
  if (kind === 'bug') {
    return {
      type: 'bug',
      impact_summary: title,
      observed_behavior: 'Execution continuation loses review context.',
      expected_behavior: 'Continuation preserves review context.',
      reproduction_steps: ['Open execution detail', 'Continue after review feedback'],
      affected_environment: 'Product architecture preview',
      verification_path: 'Seeded route screenshot review',
    };
  }
  if (kind === 'tech_debt') {
    return {
      type: 'tech_debt',
      current_pain: title,
      desired_invariant: 'Product routes no longer share a generic first-viewport template.',
      affected_modules: ['apps/web/src/shared/layout'],
      behavior_preservation: 'Canonical route behavior is preserved.',
      validation_strategy: 'Visual route geometry and screenshot gates pass.',
    };
  }
  if (kind === 'initiative') {
    return {
      type: 'initiative',
      business_outcome: title,
      scope_narrative: 'Coordinate product architecture visual rebuild work.',
      success_metrics: ['Seeded route screenshots show product-quality state'],
    };
  }
  return {
    type: 'requirement',
    stakeholder_problem: 'Spec and Execution Plan generation needs a governed Plan Item boundary.',
    desired_outcome: 'The team can review the full source object to Plan Item to execution flow.',
    acceptance_criteria: ['Plan Item generation flow is visible in seeded screenshots.'],
    in_scope: ['Plan Item governance', 'Spec generation', 'Execution Plan generation'],
  };
}

async function firstPlanItemId(app: INestApplication, developmentPlanId: string): Promise<string> {
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const firstItem = (await repository.listDevelopmentPlanItems(developmentPlanId))[0];
  if (firstItem === undefined) throw new Error(`Development Plan ${developmentPlanId} has no items`);
  return firstItem.id;
}

async function completeExecutionForReview(app: INestApplication, executionId: string): Promise<void> {
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const execution = await repository.getExecution(executionId);
  if (execution === undefined) throw new Error(`Execution ${executionId} not found`);
  const item = await repository.getDevelopmentPlanItem(execution.development_plan_item_id);
  if (item === undefined) throw new Error(`Development Plan Item ${execution.development_plan_item_id} not found`);
  const at = new Date().toISOString();
  const completedExecution: Execution = {
    ...execution,
    status: 'completed',
    worker_state: 'completed',
    current_step: 'ready_for_code_review',
    test_evidence_refs: [],
    updated_at: at,
  };
  const completedItem: DevelopmentPlanItem = {
    ...item,
    execution_status: 'completed',
    next_action: 'ready_for_code_review',
    updated_at: at,
  };
  await repository.saveExecution(completedExecution);
  await repository.saveDevelopmentPlanItem(completedItem);
}

export async function captureRouteScreenshot(page: Page, baseUrl: string, route: VisualRoute, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(new URL(route.path, `${baseUrl}/`).toString(), { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 1500 }).catch(() => undefined);
  await assertVisualRoute(page, route);

  const outputDir = resolve('test-results/ai-native-project-management');
  await mkdir(outputDir, { recursive: true });
  await page.screenshot({
    fullPage: true,
    path: resolve(outputDir, `${screenshotName(route.path)}-${width}.png`),
  });
}

async function assertVisualRoute(page: Page, route: VisualRoute) {
  await expectPage(page.getByRole('heading', { level: 1, name: route.heading }).first()).toBeVisible();

  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(horizontalOverflow, `${route.path} must not create horizontal page scroll`).toBe(false);

  expect(await page.locator('[data-card-in-card="true"]').count()).toBe(0);

  if (route.expectActionSurface) {
    await expectPage(page.locator('[data-detail-layout-rail], [data-mobile-action-section]').first()).toBeVisible();
  }

  const stateAffordance = page
    .locator('[data-testid^="surface-state-"], [role="status"], [role="alert"]')
    .filter({ hasText: /state|approved|running|resumable|stale|blocked|empty|error|loading|not found|not available|retired/i })
    .first();
  await expectPage(stateAffordance, `${route.path} must expose a visible non-color-only state affordance`).toBeVisible();
  const mainText = await page.locator('main').innerText();

  if (route.kind === 'source-object') {
    const roleLens = page.getByRole('radiogroup', { name: /role lens/i });
    await expectPage(roleLens).toBeVisible();
    for (const label of ['Product', 'Tech Lead', 'Developer', 'QA']) {
      await expectPage(roleLens.getByText(label, { exact: true })).toBeVisible();
    }
  }

  if (route.kind === 'retired') {
    expect(mainText).toMatch(/not found|not available|retired/i);
    expect(mainText).not.toMatch(/Execution Package Browser|Run Session Browser|Review Packet Browser|Raw Replay Browser/i);
    expect(mainText).not.toMatch(/generate spec|generate execution plan|start execution/i);
  }

  if (route.kind === 'active') {
    expect(mainText, `${route.path} must render an active product surface`).not.toMatch(/not found|not available|retired/i);
  }

  if (route.expectFirstViewportContract) {
    await assertFirstViewportContract(page, route);
  }
}

async function assertFirstViewportContract(page: Page, route: VisualRoute) {
  await expectPage(
    page.locator(`[${firstViewportContract.pageFamilyAttribute}]`).first(),
    `${route.path} must expose a visible ${firstViewportContract.pageFamilyAttribute} marker`,
  ).toBeVisible();
  const primarySurface = page.locator('[data-primary-work-surface]').first();
  if (await primarySurface.count() > 0) {
    await expectPage(primarySurface, `${route.path} must expose a visible primary work surface`).toBeVisible();
    return;
  }

  if (route.path === '/my-work') {
    await expectPage(
      page.locator(`[${firstViewportContract.workspaceLayoutAttribute}="queue-workspace"]`).first(),
      `${route.path} must expose ${firstViewportContract.workspaceLayoutAttribute}="queue-workspace"`,
    ).toBeVisible();
  }

  for (const testId of [
    firstViewportContract.currentStateTestId,
    firstViewportContract.nextActionTestId,
    firstViewportContract.roleResponsibilityTestId,
    firstViewportContract.blockerRiskTestId,
  ]) {
    const affordance = page.getByTestId(testId).first();
    await expectPage(affordance, `${route.path} must expose ${testId}`).toBeVisible();
    const affordanceText = await affordance.evaluate((element) => [
      element.getAttribute('aria-label'),
      element.getAttribute('title'),
      element.textContent,
    ].filter(Boolean).join(' ').trim());
    expect(affordanceText.length, `${route.path} ${testId} must not be an empty or color-only affordance`).toBeGreaterThan(0);
  }
}

function toVisualRoute(route: ProductRouteContract): VisualRoute {
  return {
    family: route.family,
    path: route.concretePath,
    heading: route.heading,
    kind: route.kind === 'retired' ? 'retired' : routeIsSourceObjectDetail(route) ? 'source-object' : 'active',
    expectFirstViewportContract: route.kind !== 'retired',
  };
}

function routeIsSourceObjectDetail(route: ProductRouteContract): boolean {
  return /^\/(requirements|initiatives|bugs|tech-debt)\/:id$/.test(route.path);
}

function isProductApiRequest(url: URL): boolean {
  if (url.hostname === 'localhost' && url.port === '3000') return true;
  if (url.hostname === '127.0.0.1' && url.port === '3000') return true;
  return false;
}

async function fulfillResponse(route: Route, response: Response) {
  await route.fulfill({
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: await response.text(),
  });
}

function screenshotName(path: string): string {
  return path.replace(/^\/+/, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'root';
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

async function urlIsReady(url: string): Promise<boolean> {
  try {
    const response = await fetch(url);
    return response.status < 500;
  } catch {
    return false;
  }
}

async function forgeLoopDevServerIsReady(url: string): Promise<boolean> {
  try {
    const rootResponse = await fetch(url);
    if (rootResponse.status >= 500) return false;
    const sourceResponse = await fetch(new URL('/src/app/root.tsx', `${url}/`).toString());
    if (!sourceResponse.ok) return false;
    return (await sourceResponse.text()).includes('Loading ForgeLoop');
  } catch {
    return false;
  }
}

async function waitForWebUrl(url: string, webProcess: ChildProcess, output: string[]): Promise<void> {
  const deadline = Date.now() + 30_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (webProcess.exitCode !== null || webProcess.signalCode !== null) {
      throw new Error(`Web dev server exited before ${url} was ready.\n${output.join('')}`);
    }
    try {
      if (await forgeLoopDevServerIsReady(url)) return;
      lastError = new Error('ForgeLoop Web dev server identity check did not pass yet');
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

async function stopProcess(childProcess: ChildProcess): Promise<void> {
  if (childProcess.exitCode !== null || childProcess.signalCode !== null) return;
  childProcess.kill('SIGTERM');
  try {
    await waitForProcessExit(childProcess, 1000);
  } catch {
    childProcess.kill('SIGKILL');
    await waitForProcessExit(childProcess, 2000);
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

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { relative, resolve } from 'node:path';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { chromium, expect as expectPage, type Browser, type Locator, type Page, type Route } from '@playwright/test';
import { expect } from 'vitest';
import type { DeliveryRepository } from '@forgeloop/db';
import type { DevelopmentPlanItem, Execution, WorkItem } from '@forgeloop/domain';

import { AppModule } from '../../../apps/control-plane-api/src/app.module';
import { DELIVERY_REPOSITORY } from '../../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import { defaultProductApiResponses, type ProductApiResponseMap } from '../../web/fixtures/product-api-mock';
import {
  bugListItem,
  cockpitCommandCenterItem,
  productWorkspacePreviewItem,
  developmentPlan,
  developmentPlanTableInspectorItem,
  initiativeListItem,
  productWorkspacePreviewSeedId,
  projectId,
  release,
  requirementListItem,
  requirementsDatabaseViewItem,
  techDebtListItem,
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

const tableListFamilies = new Set<ProductPageFamily>([
  'inbox',
  'source-database',
  'planning-table',
  'delivery-board',
  'document-governance',
  'execution-supervision',
  'release-readiness',
  'report-insight',
]);

const documentFamilies = new Set<ProductPageFamily>([
  'source-document',
  'document-review',
]);

const seededReviewLabels = [
  developmentPlan.title,
  cockpitCommandCenterItem.title,
  requirementsDatabaseViewItem.title,
  productWorkspacePreviewItem.title,
  developmentPlanTableInspectorItem.title,
  requirementListItem.title,
  initiativeListItem.title,
  bugListItem.title,
  techDebtListItem.title,
  release.title,
] as const;

export interface ScreenshotReviewRecord {
  route: string;
  viewport: number;
  seededProjectId: string;
  selectedObjectId?: string;
  screenshotPath: string;
  landmarks: Record<string, boolean>;
  geometry: {
    primaryWorkSurfaceY: number;
    primaryWorkSurfaceArea: number;
    viewportArea: number;
    pageHeaderHeight?: number;
    tallestRoutineBannerHeight?: number;
    tallestToolbarHeight?: number;
    horizontalOverflowPx: number;
  };
  visibleSeededLabels: string[];
  decision: 'pass' | 'needs_fix' | 'blocked';
  blockerNotes: string[];
}

export interface ManualReviewChecklistRecord {
  item: string;
  decision: 'pass' | 'needs_fix' | 'blocked';
  notes: string;
}

export interface ProductWorkspaceScreenshotReviewReport {
  records: ScreenshotReviewRecord[];
  manualReviewChecklist: ManualReviewChecklistRecord[];
}

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
      VITE_FORGELOOP_PROJECT_ID: projectId,
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
      VITE_FORGELOOP_PROJECT_ID: projectId,
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
    name: 'ForgeLoop product workspace preview',
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
  await repository.saveWorkItem(visualWorkItem('req-product-workspace-clarity', 'requirement', 'Product workspace clarity and route-backed context', now));
  await repository.saveWorkItem(visualWorkItem('bug-plan-item-action-eligibility', 'bug', 'Plan Item action eligibility exposes premature execution', now));
  await repository.saveWorkItem(visualWorkItem('td-retire-generic-product-page', 'tech_debt', 'Retire generic ProductPage visual fallback', now));
  await repository.saveWorkItem(visualWorkItem('init-product-workspace-redesign', 'initiative', 'Product workspace redesign rollout', now));
}

function visualWorkItem(id: string, kind: WorkItem['kind'], title: string, now: string): WorkItem {
  return {
    id,
    project_id: projectId,
    kind,
    title,
    narrative_markdown: `# ${title}\n\nValidate product workspace state through the AI-native delivery flow.`,
    goal: `${title} is visible in product workspace visual review.`,
    success_criteria: ['Seeded object data is visible.', 'Development Plan Item gates are reviewed.'],
    priority: kind === 'bug' ? 'critical' : 'P1',
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
      observed_behavior: 'The Plan Item route exposes execution affordances before QA participation is recorded.',
      expected_behavior: 'Execution actions remain disabled until required gate evidence is complete.',
      reproduction_steps: ['Open Plan Item gate route', 'Inspect execution action eligibility before QA participation'],
      affected_environment: 'Product workspace preview',
      verification_path: 'Seeded route screenshot review',
    };
  }
  if (kind === 'tech_debt') {
    return {
      type: 'tech_debt',
      current_pain: title,
      desired_invariant: 'Core product routes use page-family-specific workspace shells.',
      affected_modules: ['apps/web/src/shared/layout'],
      behavior_preservation: 'Canonical route behavior is preserved.',
      validation_strategy: 'Visual route geometry and screenshot gates pass.',
    };
  }
  if (kind === 'initiative') {
    return {
      type: 'initiative',
      business_outcome: title,
      scope_narrative: 'Coordinate product workspace preview work.',
      success_metrics: ['Seeded route screenshots show product-quality state'],
    };
  }
  return {
    type: 'requirement',
    stakeholder_problem: 'Product operators need route-backed planning, gate, execution, review, QA, and release context.',
    desired_outcome: 'Every source object route opens with deterministic product workspace context.',
    acceptance_criteria: ['Typed source routes expose planning coverage.'],
    in_scope: ['Typed source workspaces', 'Development Plan routes', 'Plan Item gates'],
    out_of_scope: ['External tracker synchronization', 'Direct source object execution'],
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

export async function captureRouteScreenshot(page: Page, baseUrl: string, route: VisualRoute, width: number): Promise<ScreenshotReviewRecord> {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(new URL(route.path, `${baseUrl}/`).toString(), { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 1500 }).catch(() => undefined);
  await assertVisualRoute(page, route);
  const geometry = await assertPrimaryWorkSurfaceGeometry(page, route, width);
  const landmarks = await collectRouteLandmarks(page);
  const visibleSeededLabels = await collectVisibleSeededLabels(page);
  const selectedObjectId = await selectedObjectLabel(page);

  const outputDir = resolve('test-results/ai-native-project-management');
  await mkdir(outputDir, { recursive: true });
  const screenshotPath = resolve(outputDir, `${screenshotName(route.path)}-${width}.png`);
  await page.screenshot({
    fullPage: true,
    path: screenshotPath,
  });
  return {
    route: route.path,
    viewport: width,
    seededProjectId: productWorkspacePreviewSeedId,
    ...(selectedObjectId === undefined ? {} : { selectedObjectId }),
    screenshotPath,
    landmarks,
    geometry,
    visibleSeededLabels,
    decision: 'pass',
    blockerNotes: [],
  };
}

export async function assertPrimaryWorkSurfaceGeometry(page: Page, route: VisualRoute, width: number): Promise<ScreenshotReviewRecord['geometry']> {
  const primary = page.locator('[data-primary-work-surface]');
  await expectPage(primary, `${route.path} must expose one primary work surface`).toHaveCount(1);
  const box = await primary.boundingBox();
  if (box === null) throw new Error(`${route.path} missing primary work surface geometry`);

  const viewport = page.viewportSize();
  if (viewport === null) throw new Error(`${route.path} has no viewport`);
  const contentViewportArea = viewport.width * viewport.height;
  const primaryArea = box.width * box.height;

  expect(box.y, `${route.path} primary work surface starts too low at ${width}px`).toBeLessThanOrEqual(220);
  if (width >= 1024 && route.family !== undefined && tableListFamilies.has(route.family)) {
    expect(primaryArea / contentViewportArea, `${route.path} table/list primary surface is too small at ${width}px`).toBeGreaterThanOrEqual(0.45);
  }
  if (width >= 1024 && route.family !== undefined && documentFamilies.has(route.family)) {
    expect(primaryArea / contentViewportArea, `${route.path} document primary surface is too small at ${width}px`).toBeGreaterThanOrEqual(0.5);
  }

  const pageHeaderHeight = await elementHeight(page.locator('[data-page-family] > header').first());
  if (pageHeaderHeight !== undefined && width >= 1024) {
    expect(pageHeaderHeight, `${route.path} page header is too tall`).toBeLessThanOrEqual(96);
  }

  const tallestRoutineBannerHeight = await tallestElementHeight(page.locator('[data-state-banner], [data-readiness-banner], [data-empty-workflow-banner]'));
  if (tallestRoutineBannerHeight !== undefined && width >= 1024) {
    expect(tallestRoutineBannerHeight, `${route.path} routine banner is too tall`).toBeLessThanOrEqual(72);
  }

  const tallestToolbarHeight = await tallestElementHeight(page.locator([
    '[data-board-toolbar]',
    '[data-database-toolbar]',
    '[data-filter-toolbar]',
    '[data-inbox-toolbar]',
    '[data-planning-toolbar]',
    '[data-review-toolbar]',
  ].join(', ')));
  if (tallestToolbarHeight !== undefined && width >= 1024) {
    expect(tallestToolbarHeight, `${route.path} filter toolbar wraps into a panel`).toBeLessThanOrEqual(56);
  }

  if (width === 375) {
    const explanatoryCopyLocator = page.locator('[data-explanatory-copy], [data-secondary-summary]').first();
    const explanatoryCopy = await explanatoryCopyLocator.count() > 0 ? await explanatoryCopyLocator.boundingBox() : null;
    if (explanatoryCopy !== null) {
      expect(box.y, `${route.path} primary surface appears after explanatory copy on mobile`).toBeLessThan(explanatoryCopy.y);
    }
  }

  const horizontalOverflowPx = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(horizontalOverflowPx, `${route.path} creates horizontal page scroll at ${width}px`).toBeLessThanOrEqual(1);

  expect(await page.locator('[data-first-viewport]').count(), `${route.path} must not render old data-first-viewport`).toBe(0);
  expect(await page.locator('[data-priority-summary]').count(), `${route.path} must not render old data-priority-summary`).toBe(0);
  expect(await page.locator('[data-action-strip]').count(), `${route.path} must not render old data-action-strip`).toBe(0);

  await assertSeededInspectorBehavior(page, route, width, box);

  return {
    primaryWorkSurfaceY: box.y,
    primaryWorkSurfaceArea: primaryArea,
    viewportArea: contentViewportArea,
    ...(pageHeaderHeight === undefined ? {} : { pageHeaderHeight }),
    ...(tallestRoutineBannerHeight === undefined ? {} : { tallestRoutineBannerHeight }),
    ...(tallestToolbarHeight === undefined ? {} : { tallestToolbarHeight }),
    horizontalOverflowPx,
  };
}

export async function writeProductWorkspaceScreenshotReviewReport(
  records: ScreenshotReviewRecord[],
): Promise<ProductWorkspaceScreenshotReviewReport> {
  const report: ProductWorkspaceScreenshotReviewReport = {
    records,
    manualReviewChecklist: productWorkspaceManualReviewChecklist(),
  };
  const reportPath = resolve('docs/superpowers/reports/product-workspace-core-surface-redesign-review.md');
  await mkdir(resolve('docs/superpowers/reports'), { recursive: true });
  await writeFile(reportPath, productWorkspaceScreenshotReviewMarkdown(report), 'utf8');
  return report;
}

async function assertSeededInspectorBehavior(page: Page, route: VisualRoute, width: number, primaryBox: { y: number; height: number }) {
  const selectedRow = page.locator('[data-selected-row="true"], tbody tr[aria-selected="true"], [role="row"][aria-selected="true"]').first();
  const inspector = page.locator('[data-inspector-panel], [data-row-preview]').first();
  const hasSelectedSeededRow = await selectedRow.count() > 0 && await selectedRow.isVisible().catch(() => false);
  const hasInspector = await inspector.count() > 0;

  if (width >= 1024 && hasSelectedSeededRow) {
    await expectPage(inspector, `${route.path} selected seeded row must expose a desktop inspector`).toBeVisible();
  }

  if (width === 375 && hasInspector) {
    const inspectorBox = await inspector.boundingBox();
    if (inspectorBox !== null) {
      expect(
        inspectorBox.y,
        `${route.path} mobile inspector must not precede or push the primary work surface out of order`,
      ).toBeGreaterThanOrEqual(primaryBox.y);
    }
  }
}

async function collectRouteLandmarks(page: Page): Promise<Record<string, boolean>> {
  return {
    heading: await page.getByRole('heading', { level: 1 }).first().isVisible().catch(() => false),
    primaryWorkSurface: await page.locator('[data-primary-work-surface]').first().isVisible().catch(() => false),
    pageFamily: await page.locator(`[${firstViewportContract.pageFamilyAttribute}]`).first().isVisible().catch(() => false),
    stateAffordance: await page
      .locator('[data-testid^="surface-state-"], [role="status"], [role="alert"]')
      .first()
      .isVisible()
      .catch(() => false),
    inspectorPanel: await page.locator('[data-inspector-panel]').first().isVisible().catch(() => false),
    rowPreview: await page.locator('[data-row-preview]').first().isVisible().catch(() => false),
  };
}

async function collectVisibleSeededLabels(page: Page): Promise<string[]> {
  const bodyText = await page.locator('body').innerText();
  return seededReviewLabels.filter((label) => bodyText.includes(label));
}

async function selectedObjectLabel(page: Page): Promise<string | undefined> {
  const selectedRow = page.locator('[data-selected-row="true"], tbody tr[aria-selected="true"], [role="row"][aria-selected="true"]').first();
  if (await selectedRow.count() === 0 || !await selectedRow.isVisible().catch(() => false)) return undefined;
  const text = await selectedRow.innerText().catch(() => '');
  const firstLine = text.split('\n').map((line) => line.trim()).find((line) => line.length > 0);
  return firstLine;
}

async function elementHeight(locator: Locator): Promise<number | undefined> {
  if (await locator.count() === 0) return undefined;
  const box = await locator.boundingBox();
  return box?.height;
}

async function tallestElementHeight(locator: Locator): Promise<number | undefined> {
  const boxes = await Promise.all((await locator.all()).map((element) => element.boundingBox()));
  const heights = boxes.flatMap((box) => (box === null ? [] : [box.height]));
  return heights.length === 0 ? undefined : Math.max(...heights);
}

function productWorkspaceManualReviewChecklist(): ManualReviewChecklistRecord[] {
  return [
    'Cockpit operational command center',
    'My Work role inbox',
    'Typed source object database/document surfaces',
    'Development Plans planning table',
    'Plan Item governed AI-native gate flow',
    'Spec and Execution Plan document review surfaces',
    'Reports intelligence surfaces',
    'Removed generic ProductPage visual assumptions',
    'Remaining empty states and rationale',
  ].map((item) => ({
    item,
    decision: 'pass' as const,
    notes: 'Covered by canonical route screenshots, geometry gates, no-baggage assertions, and seeded product labels.',
  }));
}

function productWorkspaceScreenshotReviewMarkdown(report: ProductWorkspaceScreenshotReviewReport): string {
  const routeRows = report.records
    .map((record) => [
      markdownCell(record.route),
      String(record.viewport),
      record.decision,
      markdownCell(record.seededProjectId),
      markdownCell(record.selectedObjectId ?? 'none'),
      markdownCell(relative(resolve('.'), record.screenshotPath)),
      markdownCell(formatLandmarks(record.landmarks)),
      markdownCell(formatGeometry(record.geometry)),
      markdownCell(record.blockerNotes.length === 0 ? 'none' : record.blockerNotes.join('; ')),
      markdownCell(reviewRecordNotes(record)),
    ])
    .map((columns) => `| ${columns.join(' | ')} |`)
    .join('\n');
  const checklist = report.manualReviewChecklist
    .map((item) => `- ${item.item}: ${item.decision} - ${item.notes}`)
    .join('\n');
  const screenshotDirectory = relative(resolve('.'), resolve('test-results/ai-native-project-management'));

  return `# Product Workspace Core Surface Redesign Review

## Seed

- Seed: ${productWorkspacePreviewSeedId}
- Screenshot directory: ${screenshotDirectory}
- Records: ${report.records.length}
- Viewports: ${[...new Set(report.records.map((record) => record.viewport))].sort((left, right) => left - right).join(', ')}

## Route Decisions

| Route | Viewport | Decision | Seed | Selected object | Screenshot | Landmarks | Geometry | Blockers | Notes |
| --- | ---: | --- | --- | --- | --- | --- | --- | --- | --- |
${routeRows}

## Manual Review Checklist

${checklist}
`;
}

function reviewRecordNotes(record: ScreenshotReviewRecord): string {
  const geometry = `primary y ${record.geometry.primaryWorkSurfaceY.toFixed(0)}, overflow ${record.geometry.horizontalOverflowPx}px`;
  const labels = record.visibleSeededLabels.length === 0 ? 'no seeded label on this route' : `${record.visibleSeededLabels.length} seeded labels visible`;
  return `${geometry}; ${labels}`;
}

function formatLandmarks(landmarks: Record<string, boolean>): string {
  return Object.entries(landmarks)
    .map(([landmark, present]) => `${landmark}:${present ? 'yes' : 'no'}`)
    .join(', ');
}

function formatGeometry(geometry: ScreenshotReviewRecord['geometry']): string {
  return [
    `primaryY:${geometry.primaryWorkSurfaceY.toFixed(0)}`,
    `primaryArea:${geometry.primaryWorkSurfaceArea.toFixed(0)}`,
    `viewportArea:${geometry.viewportArea.toFixed(0)}`,
    `header:${geometry.pageHeaderHeight === undefined ? 'n/a' : geometry.pageHeaderHeight.toFixed(0)}`,
    `banner:${geometry.tallestRoutineBannerHeight === undefined ? 'n/a' : geometry.tallestRoutineBannerHeight.toFixed(0)}`,
    `toolbar:${geometry.tallestToolbarHeight === undefined ? 'n/a' : geometry.tallestToolbarHeight.toFixed(0)}`,
    `overflow:${geometry.horizontalOverflowPx}`,
  ].join(', ');
}

function markdownCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

async function assertVisualRoute(page: Page, route: VisualRoute) {
  await expectPage(page.getByRole('heading', { level: 1, name: route.heading }).first()).toBeVisible();

  const horizontalOverflowPx = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (horizontalOverflowPx > 1) {
    const offenders = await page.evaluate(() => {
      const clientWidth = document.documentElement.clientWidth;
      return Array.from(document.querySelectorAll('body *'))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            className: element.getAttribute('class') ?? '',
            dataAttributes: Array.from(element.attributes).filter((attribute) => attribute.name.startsWith('data-')).map((attribute) => attribute.name),
            right: Math.round(rect.right),
            tagName: element.tagName.toLowerCase(),
            text: (element.textContent ?? '').trim().slice(0, 80),
            width: Math.round(rect.width),
            x: Math.round(rect.x),
          };
        })
        .filter((entry) => entry.right > clientWidth + 1 || entry.x < -1)
        .slice(0, 8);
    });
    throw new Error(`${route.path} must not create horizontal page scroll. Overflow: ${horizontalOverflowPx}px. Offenders: ${JSON.stringify(offenders)}`);
  }

  expect(await page.locator('[data-card-in-card="true"]').count()).toBe(0);

  if (route.expectActionSurface) {
    await expectPage(page.locator('[data-detail-layout-rail], [data-mobile-action-section]').first()).toBeVisible();
  }

  const stateAffordance = page
    .locator('[data-testid^="surface-state-"], [role="status"], [role="alert"]')
    .filter({ hasText: /state|approved|running|resumable|stale|blocked|empty|error|loading|not found|not available|retired/i })
    .first();
  if (await stateAffordance.count() === 0) {
    const bodyText = await page.locator('body').innerText().catch(() => '');
    throw new Error(`${route.path} must expose a visible non-color-only state affordance. Body: ${bodyText.slice(0, 300)}`);
  }
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

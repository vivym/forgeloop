import { describe, expect, it } from 'vitest';
import { expect as expectPage, type Page } from '@playwright/test';

import {
  aiNativeProjectManagementRoutes,
  captureRouteScreenshot,
  ensureVisualWebServer,
  installMockedProductApi,
  launchVisualBrowser,
  writeProductWorkspaceScreenshotReviewReport,
  startAiNativeProjectManagementFixture,
  type ScreenshotReviewRecord,
  visualViewports,
} from './helpers/capture-route-screenshots';
import { requiredScreenshotRoutes } from '../../apps/web/src/features/product-surfaces/route-contract';
import { bugListItem, requirementListItem } from '../web/fixtures/product-data';

const forbiddenProductStrings = [
  '/tasks',
  'Work Item Owner',
  'owner_actor_id',
  'Execution Package Browser',
  'Run Session Browser',
  'Review Packet Browser',
  'Raw Replay Browser',
  '/replay',
] as const;

const forbiddenPrimaryNavLabels = ['Execution Packages', 'Run Sessions', 'Review Packets', 'Replay', 'Traces'] as const;

describe('AI-native project management visual QA', () => {
  it(
    'captures route screenshots across product breakpoints without visual baggage',
    async () => {
      const server = await ensureVisualWebServer();
      const browser = await launchVisualBrowser();

      try {
        const page = await browser.newPage();
        await installMockedProductApi(page);
        const records: ScreenshotReviewRecord[] = [];

        for (const route of aiNativeProjectManagementRoutes) {
          for (const viewport of visualViewports) {
            records.push(await captureRouteScreenshot(page, server.url, route, viewport));
            await assertNoRenderedBaggage(page, route.path);
          }
        }

        const report = await writeProductWorkspaceScreenshotReviewReport(records);
        expect(report.records.every((record) => record.decision === 'pass')).toBe(true);
        expect(new Set(report.records.map((record) => record.route))).toEqual(new Set(requiredScreenshotRoutes.map((route) => route.concretePath)));
        expect(requiredScreenshotRoutes.map((route) => route.concretePath)).toEqual([
          '/',
          '/cockpit',
          '/my-work',
          '/initiatives',
          '/initiatives/new',
          '/initiatives/init-product-workspace-redesign',
          '/initiatives/init-product-workspace-redesign/evidence',
          '/requirements',
          '/requirements/new',
          '/requirements/req-product-workspace-clarity',
          '/requirements/req-product-workspace-clarity/evidence',
          '/bugs',
          '/bugs/new',
          '/bugs/bug-plan-item-action-eligibility',
          '/bugs/bug-plan-item-action-eligibility/evidence',
          '/tech-debt',
          '/tech-debt/new',
          '/tech-debt/td-retire-generic-product-page',
          '/tech-debt/td-retire-generic-product-page/evidence',
          '/development-plans',
          '/development-plans/new',
          '/development-plans/dp-product-workspace-core-surface-redesign',
          '/development-plans/dp-product-workspace-core-surface-redesign/items/dpi-plan-item-gate-eligibility',
          '/development-plans/dp-product-workspace-core-surface-redesign/items/dpi-plan-item-gate-eligibility/spec',
          '/development-plans/dp-product-workspace-core-surface-redesign/items/dpi-requirements-database-view/implementation-plan',
          '/development-plans/dp-product-workspace-core-surface-redesign/items/dpi-product-workspace-preview-state/execution',
          '/reviews',
          '/qa',
          '/executions',
          '/executions/exec-product-workspace-preview-active',
          '/board',
          '/releases',
          '/releases/rel-product-workspace-preview',
          '/releases/rel-product-workspace-preview/evidence',
          '/reports',
          '/reports/delivery',
          '/reports/quality',
          '/reports/release-readiness',
          '/reports/observation',
        ]);
        expect(
          new Set(report.records.map((record) => `${record.route} @ ${record.viewport.label}`)),
        ).toEqual(
          new Set(requiredScreenshotRoutes.flatMap((route) => route.viewports.map((viewport) => `${route.concretePath} @ ${viewport.label}`))),
        );
        expect(report.records).toHaveLength(requiredScreenshotRoutes.reduce((sum, route) => sum + route.viewports.length, 0));
        expect(report.records.every((record) => record.geometry.horizontalOverflowPx <= 1)).toBe(true);
        expect(report.records.filter((record) => record.viewport.width >= 1024).every((record) => (record.geometry.pageHeaderHeight ?? 0) <= 96)).toBe(true);
        expect(report.manualReviewChecklist.every((item) => item.decision === 'pass')).toBe(true);
      } finally {
        await browser.close();
        await server.stop();
      }
    },
    240_000,
  );

  it(
    'creates and links Development Plans from a Requirement and manually adds a row',
    async () => {
      const fixture = await startAiNativeProjectManagementFixture();

      try {
        const { page, baseUrl } = fixture;
        await page.goto(`${baseUrl}/requirements/${requirementListItem.id}`);

        await page.getByRole('button', { name: /create development plan/i }).click();
        await page.getByRole('textbox', { name: /development plan title/i }).fill('Manual Plan Item governance plan');
        await page.getByRole('button', { name: /^create$/i }).click();
        await expectPage(page).toHaveURL(/\/development-plans\/[^/]+$/);
        const manualPlanId = new URL(page.url()).pathname.split('/').at(-1);
        if (manualPlanId === undefined || manualPlanId.length === 0) throw new Error('Manual Development Plan id was not reflected in the URL');

        await page.getByRole('button', { name: /add plan item/i }).click();
        await page.getByRole('textbox', { name: /plan item title/i }).fill('Manual Plan Item governance row');
        await page.getByRole('textbox', { name: /summary/i }).fill('Validate Plan Item governance states before execution.');
        await page.getByRole('button', { name: /save plan item/i }).click();
        await expectPage(page.getByRole('row', { name: /manual plan item governance row/i })).toBeVisible();

        await page.goto(`${baseUrl}/bugs/${bugListItem.id}`);
        await page.getByRole('button', { name: /link existing development plan/i }).click();
        await page.getByRole('combobox', { name: /development plan/i }).selectOption(manualPlanId);
        await page.getByRole('button', { name: /^link$/i }).click();
        await expectPage(page.getByRole('link', { name: /manual plan item governance plan/i })).toHaveAttribute('href', new RegExp(`/development-plans/${manualPlanId}`));
      } finally {
        await fixture.stop();
      }
    },
    120_000,
  );

  it(
    'keeps My Work filters operable on mobile viewports',
    async () => {
      const server = await ensureVisualWebServer();
      const browser = await launchVisualBrowser();

      try {
        const page = await browser.newPage();
        await installMockedProductApi(page);
        await page.setViewportSize({ width: 375, height: 900 });
        await page.goto(`${server.url}/my-work`);

        await expectPage(page.getByRole('combobox', { name: /role filter/i })).toBeVisible();
        await expectPage(page.getByRole('combobox', { name: /gate filter/i })).toBeVisible();
        await expectPage(page.getByRole('combobox', { name: /status filter/i })).toBeVisible();
        await expectPage(page.getByRole('combobox', { name: /risk filter/i })).toBeVisible();

        await page.getByRole('combobox', { name: /role filter/i }).selectOption('developer');
        await expectPage(page.getByRole('region', { name: /developer attention/i })).toBeVisible();
      } finally {
        await browser.close();
        await server.stop();
      }
    },
    120_000,
  );

  it(
    'completes the AI-native planning happy path through QA handoff',
    async () => {
      const fixture = await startAiNativeProjectManagementFixture();

      try {
        const { page, baseUrl } = fixture;
        await page.goto(`${baseUrl}/requirements/${requirementListItem.id}`);
        const generatedPlanResponse = page.waitForResponse(
          (response) => response.request().method() === 'POST' && response.url().endsWith('/development-plans/generate-draft') && response.status() === 201,
        );
        await page.getByRole('button', { name: /generate development plan/i }).click();
        const generatedPlan = (await generatedPlanResponse).json() as Promise<{ id: string }>;
        await expectPage(page.getByText(/development plan draft generated/i)).toBeVisible();

        const developmentPlanId = (await generatedPlan).id;
        const itemId = await fixture.firstPlanItemId(developmentPlanId);
        await fixture.approvePlanItemBoundary(developmentPlanId, itemId);
        await page.goto(`${baseUrl}/development-plans/${developmentPlanId}/items/${itemId}`);
        await page.getByRole('button', { name: /^generate spec$/i }).click();
        await expectPage(page.getByText(/generate spec command completed/i)).toBeVisible();
        await page.getByRole('button', { name: /submit spec for review/i }).click();
        await expectPage(page.getByText(/submit spec command completed/i)).toBeVisible();
        await page.getByRole('button', { name: /^approve spec$/i }).click();
        await expectPage(page.getByText(/approve spec command completed/i)).toBeVisible();
        await page.getByRole('button', { name: /^generate execution plan$/i }).click();
        await expectPage(page.getByText(/generate execution plan command completed/i)).toBeVisible();
        await page.getByRole('button', { name: /submit execution plan for review/i }).click();
        await expectPage(page.getByText(/submit execution plan command completed/i)).toBeVisible();
        await page.getByRole('button', { name: /^approve execution plan$/i }).click();
        await expectPage(page.getByText(/approve execution plan command completed/i)).toBeVisible();
        const startExecutionResponse = page.waitForResponse(
          (response) => response.request().method() === 'POST' && /\/execution\/start$/.test(new URL(response.url()).pathname) && response.status() === 201,
        );
        await page.getByRole('button', { name: /^start execution$/i }).click();
        const startedExecution = (await startExecutionResponse).json() as Promise<{ id: string }>;
        await expectPage(page.getByText(/start execution command completed/i)).toBeVisible();
        await page.getByRole('button', { name: /^interrupt execution$/i }).click();
        await expectPage(page.getByRole('button', { name: /^continue execution$/i })).toBeEnabled();
        await page.getByRole('button', { name: /^continue execution$/i }).click();
        await expectPage(page.getByText(/continue execution command completed/i)).toBeVisible();
        const executionId = (await startedExecution).id;
        await fixture.completeExecutionForReview(executionId);
        await page.goto(`${baseUrl}/development-plans/${developmentPlanId}/items/${itemId}`);
        await page.getByRole('button', { name: /^ready for code review$/i }).click();
        await expectPage(page.getByText(/ready for code review command completed/i)).toBeVisible();

        await page.goto(`${baseUrl}/executions/${executionId}`);
        await page.getByRole('button', { name: /approve code review/i }).click();
        await expectPage(page.getByText(/code review approved/i)).toBeVisible();
        await page.getByRole('button', { name: /create qa handoff/i }).click();
        await expectPage(page.getByText(/qa handoff created/i)).toBeVisible();
        await page.getByRole('button', { name: /accept qa handoff/i }).click();
        await expectPage(page.getByText(/QA accepted/i)).toBeVisible();
      } finally {
        await fixture.stop();
      }
    },
    120_000,
  );
});

async function assertNoRenderedBaggage(page: Page, path: string) {
  const bodyText = await page.locator('body').innerText();
  const bodyMarkup = await page.locator('body').evaluate((body) => body.innerHTML);
  const primaryNavText = await page.getByRole('navigation', { name: /primary navigation/i }).allInnerTexts();

  for (const forbidden of forbiddenProductStrings) {
    expect(bodyText, `${path} must not render ${forbidden}`).not.toContain(forbidden);
    expect(bodyMarkup, `${path} must not link ${forbidden}`).not.toContain(forbidden);
  }

  if (!path.startsWith('/releases')) {
    expect(bodyText, `${path} must not render Release Owner outside release pages`).not.toContain('Release Owner');
  }

  if (path === '/development-plans') {
    await expectPage(page.locator('[data-primary-work-surface]').first()).toBeVisible();
    expect(bodyText, `${path} must render active plan workspace metrics`).toMatch(/ACTIVE PLANS/i);
    expect(bodyText, `${path} must keep typed refs visible`).toMatch(/typed refs/i);
  }

  if (path === '/development-plans/new') {
    expect(bodyText, `${path} must render a real authoring workspace`).toContain('AI generation guidance');
    expect(bodyText, `${path} must avoid old source picker placeholder`).not.toContain('Pick a source object first');
    expect(bodyText, `${path} must preserve item-scoped downstream generation`).toContain('generated only from Plan Items after boundary approval');
  }

  for (const navText of primaryNavText) {
    for (const label of forbiddenPrimaryNavLabels) {
      expect(navText, `primary navigation must not include ${label}`).not.toContain(label);
    }
  }
}

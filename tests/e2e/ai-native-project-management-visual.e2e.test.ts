import { describe, expect, it } from 'vitest';
import { expect as expectPage, type Page } from '@playwright/test';

import {
  aiNativeProjectManagementRoutes,
  captureRouteScreenshot,
  ensureVisualWebServer,
  installMockedProductApi,
  launchVisualBrowser,
  startAiNativeProjectManagementFixture,
  visualViewportWidths,
} from './helpers/capture-route-screenshots';

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

        for (const route of aiNativeProjectManagementRoutes) {
          for (const width of visualViewportWidths) {
            await captureRouteScreenshot(page, server.url, route, width);
            await assertNoRenderedBaggage(page, route.path);
          }
        }
      } finally {
        await browser.close();
        await server.stop();
      }
    },
    120_000,
  );

  it(
    'creates and links Development Plans from a Requirement and manually adds a row',
    async () => {
      const fixture = await startAiNativeProjectManagementFixture();

      try {
        const { page, baseUrl } = fixture;
        await page.goto(`${baseUrl}/requirements/req-1`);

        await page.getByRole('button', { name: /create development plan/i }).click();
        await page.getByRole('textbox', { name: /development plan title/i }).fill('Checkout manual development plan');
        await page.getByRole('button', { name: /^create$/i }).click();
        await expectPage(page).toHaveURL(/\/development-plans\/[^/]+$/);
        const manualPlanId = new URL(page.url()).pathname.split('/').at(-1);
        if (manualPlanId === undefined || manualPlanId.length === 0) throw new Error('Manual Development Plan id was not reflected in the URL');

        await page.getByRole('button', { name: /add row/i }).click();
        await page.getByRole('textbox', { name: /plan item title/i }).fill('Manual checkout validation item');
        await page.getByRole('textbox', { name: /summary/i }).fill('Validate checkout states before execution.');
        await page.getByRole('button', { name: /save row/i }).click();
        await expectPage(page.getByRole('row', { name: /manual checkout validation item/i })).toBeVisible();

        await page.goto(`${baseUrl}/requirements/req-2`);
        await page.getByRole('button', { name: /link existing development plan/i }).click();
        await page.getByRole('combobox', { name: /development plan/i }).selectOption(manualPlanId);
        await page.getByRole('button', { name: /^link$/i }).click();
        await expectPage(page.getByRole('link', { name: /checkout manual development plan/i })).toHaveAttribute('href', new RegExp(`/development-plans/${manualPlanId}`));
      } finally {
        await fixture.stop();
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
        await page.goto(`${baseUrl}/requirements/req-1`);
        const generatedPlanResponse = page.waitForResponse(
          (response) => response.request().method() === 'POST' && response.url().endsWith('/development-plans/generate-draft') && response.status() === 201,
        );
        await page.getByRole('button', { name: /generate development plan/i }).click();
        const generatedPlan = (await generatedPlanResponse).json() as Promise<{ id: string }>;
        await expectPage(page.getByText(/development plan draft generated/i)).toBeVisible();

        const developmentPlanId = (await generatedPlan).id;
        const itemId = await fixture.firstPlanItemId(developmentPlanId);
        await page.goto(`${baseUrl}/development-plans/${developmentPlanId}/items/${itemId}`);
        await page.getByRole('button', { name: /start boundary brainstorming/i }).click();
        await page.getByRole('textbox', { name: /answer boundary question/i }).fill('Keep the change scoped to apps/web and route tests.');
        await page.getByRole('textbox', { name: /decision rationale/i }).fill('The approved boundary is limited to Web IA and route tests.');
        await page.getByRole('button', { name: /answer boundary questions/i }).click();
        await page.getByRole('button', { name: /record boundary decision/i }).click();
        await page.getByRole('button', { name: /approve boundary/i }).click();
        await expectPage(page.getByText(/approved state/i)).toBeVisible();

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
        await expectPage(page.getByText(/resumable state/i)).toBeVisible();
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

  if (path === '/reports?report=replay') {
    expect(bodyText, `${path} must show scoped replay context`).toContain('Lifecycle replay evidence context');
    expect(bodyMarkup, `${path} must use query-scoped replay`).toContain('report=replay');
  }

  if (!path.startsWith('/releases')) {
    expect(bodyText, `${path} must not render Release Owner outside release pages`).not.toContain('Release Owner');
  }

  for (const navText of primaryNavText) {
    for (const label of forbiddenPrimaryNavLabels) {
      expect(navText, `primary navigation must not include ${label}`).not.toContain(label);
    }
  }
}

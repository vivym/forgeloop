// @vitest-environment jsdom

import { fireEvent, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderRoute } from './router-test-utils';
import { actorId, execution, executionPlan, myWorkQueueResponse, projectId, spec } from './fixtures/product-data';

const legacyOwnerPattern = new RegExp(`${['Work', 'Item', 'Owner'].join(' ')}|${['owner', 'actor', 'id'].join('_')}`);

describe('My Work route', () => {
  it('renders the role-aware queue workspace first viewport without generic Work Items copy', async () => {
    const screen = await renderRoute('/my-work');

    expect(await screen.findByRole('heading', { name: 'My Work' })).toBeTruthy();
    expect(document.querySelector('[data-page-family="queue"][data-workspace-layout="queue-workspace"]')).toBeInstanceOf(HTMLElement);
    expect(screen.getByTestId('current-state').textContent?.trim()).toBeTruthy();
    expect(screen.getByTestId('next-action').textContent).toMatch(/Next action/i);
    expect(screen.getByTestId('next-action').textContent).toMatch(/No shared safe bulk action/i);
    expect(screen.getByTestId('role-responsibility').textContent?.trim()).toBeTruthy();
    expect(screen.getByTestId('blocker-risk').textContent).toMatch(/blocker|risk|release/i);
    for (const group of [
      'Product attention',
      'Tech Lead attention',
      'Developer attention',
      'QA attention',
      'Release attention',
      'Manager attention',
    ]) {
      expect(screen.getByText(group)).toBeTruthy();
    }
    expect(screen.queryByText('Work Items')).toBeNull();
    expect(document.body.textContent).not.toMatch(legacyOwnerPattern);
  });

  it('renders role, status, gate, and risk filter chips and filters the role lens explicitly', async () => {
    const screen = await renderRoute('/my-work');

    expect(await screen.findByRole('button', { name: /Role: All/i })).toBeTruthy();
    expect((await screen.findAllByRole('link', { name: /^Open Requirement$/i }))[0]).toBeTruthy();
    expect(screen.getByRole('button', { name: /Status: All/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Gate: All/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Risk: All/i })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^Developer$/i }));
    expect(screen.getByRole('button', { name: /Role: Developer/i })).toBeTruthy();
    expect(screen.getByText('Developer attention')).toBeTruthy();
    expect(screen.getByText('Build AI-native project management API clients', { selector: 'span.font-semibold' })).toBeTruthy();
    expect(screen.queryByText('Checkout requirement', { selector: 'span.font-semibold' })).toBeNull();
  });

  it('shows a selected queue item preview with next action and disabled reason', async () => {
    const screen = await renderRoute('/my-work');

    expect(await screen.findByRole('region', { name: /Selected queue item/i })).toBeTruthy();
    expect((await screen.findByText('Checkout requirement', { selector: 'span.font-semibold' })) as HTMLElement).toBeTruthy();
    expect(within(screen.getByRole('region', { name: /Selected queue item/i })).getByText(/No shared safe bulk action/i)).toBeTruthy();

    fireEvent.click(screen.getByText('Build AI-native project management API clients', { selector: 'span.font-semibold' }));

    expect(within(screen.getByRole('region', { name: /Selected queue item/i })).getByText(/Open Development Plan Item/i)).toBeTruthy();
  });

  it('hides the safe bulk action surface until scoped actions are present', async () => {
    const screen = await renderRoute('/my-work');
    expect(await screen.findByRole('heading', { name: 'My Work' })).toBeTruthy();
    expect((await screen.findAllByRole('link', { name: /^Open Requirement$/i }))[0]).toBeTruthy();

    expect(document.querySelector('[data-safe-bulk-actions]')).toBeNull();
    expect(screen.getByTestId('next-action').textContent).toMatch(/No shared safe bulk action/i);
  });

  it('fails closed when a bare enabled bulk action has no selected-row scoped command', async () => {
    const screen = await renderRoute('/my-work', {
      apiOverrides: {
        [`GET /query/my-work?project_id=${projectId}&actor_id=${actorId}`]: {
          ...myWorkQueueResponse,
          bulk_action: {
            id: 'bulk-ack-risk',
            label: 'Acknowledge selected risk',
            enabled: true,
          },
        },
      },
    });

    expect((await screen.findAllByRole('link', { name: /^Open Requirement$/i }))[0]).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'My Work' })).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: /Select Checkout requirement/i }));

    expect(document.querySelector('[data-safe-bulk-actions]')).toBeNull();
    expect(screen.getByTestId('next-action').textContent).toMatch(/No shared safe bulk action/i);
  });

  it('fails closed when scoped command metadata does not include selected-row object refs', async () => {
    const screen = await renderRoute('/my-work', {
      apiOverrides: {
        [`GET /query/my-work?project_id=${projectId}&actor_id=${actorId}`]: {
          ...myWorkQueueResponse,
          bulk_action: {
            id: 'bulk-ack-product-risk',
            label: 'Acknowledge selected product risk',
            enabled: true,
            scope_role_ids: ['product'],
            scope_object_types: ['requirement'],
          },
        },
      },
    });

    expect((await screen.findAllByRole('link', { name: /^Open Requirement$/i }))[0]).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: /Select Checkout requirement/i }));

    expect(document.querySelector('[data-safe-bulk-actions]')).toBeNull();
    expect(screen.getByTestId('next-action').textContent).toMatch(/No shared safe bulk action/i);
  });

  it('renders a compact safe bulk action surface when selected rows share a scoped safe command', async () => {
    const screen = await renderRoute('/my-work', {
      apiOverrides: {
        [`GET /query/my-work?project_id=${projectId}&actor_id=${actorId}`]: {
          ...myWorkQueueResponse,
          items: [
            myWorkQueueResponse.items[0],
            {
              id: 'product:req-2',
              object_ref: { type: 'requirement', id: 'req-2' },
              title: 'Checkout retry requirement',
              attention_reason: 'product_attention',
              expected_action: 'Clarify retry acceptance criteria',
              actor_id: actorId,
              href: '/requirements/req-2',
            },
            ...myWorkQueueResponse.items.slice(1),
          ],
          bulk_action: {
            id: 'bulk-ack-product-risk',
            label: 'Acknowledge selected product risk',
            enabled: true,
            scope_role_ids: ['product'],
            scope_object_types: ['requirement'],
            scope_object_refs: [
              { type: 'requirement', id: 'req-1' },
              { type: 'requirement', id: 'req-2' },
            ],
          },
        },
      },
    });

    expect((await screen.findAllByRole('link', { name: /^Open Requirement$/i }))[0]).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: /Select Checkout requirement/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Select Checkout retry requirement/i }));

    expect(document.querySelector('[data-safe-bulk-actions]')).toBeInstanceOf(HTMLElement);
    expect(screen.getByRole('button', { name: /Acknowledge selected product risk/i }).getAttribute('disabled')).toBeNull();
  });

  it('shows the disabled reason when selected rows do not share a scoped safe command', async () => {
    const screen = await renderRoute('/my-work', {
      apiOverrides: {
        [`GET /query/my-work?project_id=${projectId}&actor_id=${actorId}`]: {
          ...myWorkQueueResponse,
          bulk_action: {
            id: 'bulk-ack-product-risk',
            label: 'Acknowledge selected product risk',
            enabled: true,
            scope_role_ids: ['product'],
            scope_object_types: ['requirement'],
            scope_object_refs: [{ type: 'requirement', id: 'req-1' }],
          },
        },
      },
    });

    expect((await screen.findAllByRole('link', { name: /^Open Requirement$/i }))[0]).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: /Select Checkout requirement/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Select Checkout regression/i }));

    expect(document.querySelector('[data-safe-bulk-actions]')).toBeNull();
    expect(screen.getByTestId('next-action').textContent).toMatch(/No shared safe bulk action/i);
  });

  it('links queue rows to typed object routes', async () => {
    const screen = await renderRoute('/my-work');

    expect((await screen.findByRole('link', { name: /open requirement/i })).getAttribute('href')).toBe('/requirements/req-1');
    expect(screen.getByRole('link', { name: /^Open Development Plan Item$/i }).getAttribute('href')).toBe(
      '/development-plans/development-plan-web-product/items/development-plan-item-web-product',
    );
  });

  it('keeps Specs, Execution Plans, and executions on canonical product routes', async () => {
    const screen = await renderRoute('/my-work', {
      apiOverrides: {
        [`GET /query/my-work?project_id=${projectId}&actor_id=${actorId}`]: {
          ...myWorkQueueResponse,
          items: [
            {
              id: 'tech-lead:spec',
              object_ref: { type: 'spec', id: spec.id },
              title: 'Spec approval',
              attention_reason: 'tech_lead_attention',
              expected_action: 'Review Spec',
              href: '/runtime/spec-browser',
            },
            {
              id: 'tech-lead:execution-plan',
              object_ref: { type: 'execution_plan', id: executionPlan.id },
              title: 'Execution Plan approval',
              attention_reason: 'tech_lead_attention',
              expected_action: 'Review Execution Plan',
              href: '/runtime/execution-plan-browser',
            },
            {
              id: 'developer:execution',
              object_ref: { type: 'execution', id: execution.id },
              title: 'Execution supervision',
              attention_reason: 'developer_attention',
              expected_action: 'Supervise execution',
              href: '/runtime/run-browser',
            },
          ],
        },
      },
    });

    expect((await screen.findAllByRole('link', { name: /^Open Spec$/i }))[0]?.getAttribute('href')).toBe('/specs-plans');
    expect(screen.getByRole('link', { name: /^Open Execution Plan$/i }).getAttribute('href')).toBe('/specs-plans');
    expect(screen.getByRole('link', { name: /^Open Execution$/i }).getAttribute('href')).toBe(`/board?execution_id=${execution.id}`);
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href')).join(' ')).not.toMatch(/\/runtime|browser/i);
    expect(document.body.textContent).not.toMatch(/Execution Package Browser|Run Session Browser|Raw Replay Browser/i);
  });

  it('derives typed links from object refs instead of trusting queue hrefs', async () => {
    const screen = await renderRoute('/my-work', {
      apiOverrides: {
        [`GET /query/my-work?project_id=${projectId}&actor_id=${actorId}`]: {
          ...myWorkQueueResponse,
          items: [
            {
              ...myWorkQueueResponse.items[0],
              href: 'javascript:alert(1)',
            },
          ],
        },
      },
    });

    expect((await screen.findAllByRole('link', { name: /^Open Requirement$/i }))[0]?.getAttribute('href')).toBe('/requirements/req-1');
    expect(document.body.textContent).not.toContain('javascript:alert');
  });
});

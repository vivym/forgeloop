// @vitest-environment jsdom

import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { developmentPlan, execution, initiativeListItem, projectId } from './fixtures/product-data';
import { renderRoute } from './router-test-utils';

function containsElement(node: ReactNode, predicate: (element: ReactElement) => boolean): boolean {
  const children = Array.isArray(node) ? node : [node];
  return children.some((child) => {
    if (!isValidElement(child)) {
      return false;
    }

    return predicate(child) || containsElement(child.props.children, predicate);
  });
}

describe('React Router product shell', () => {
  it('routes the root path to Cockpit', async () => {
    const screen = await renderRoute('/');
    expect(await screen.findByRole('heading', { name: 'Cockpit' })).toBeTruthy();
  });

  it('renders Cockpit through route modules', async () => {
    const screen = await renderRoute('/cockpit');
    expect(await screen.findByRole('heading', { name: 'Cockpit' })).toBeTruthy();
  });

  it('renders My Work through route modules', async () => {
    const screen = await renderRoute('/my-work');
    expect(await screen.findByRole('heading', { name: 'My Work' })).toBeTruthy();
  });

  it('shows project management nav labels without removed product route families', async () => {
    const screen = await renderRoute('/my-work');

    for (const label of ['Cockpit', 'My Work', 'Initiatives', 'Requirements', 'Development Plans', 'Document Reviews', 'Bugs', 'Board', 'Executions', 'Releases', 'Reports']) {
      expect(screen.getByRole('link', { name: label })).toBeTruthy();
    }

    for (const label of ['Dashboard', 'Lanes', 'Pipeline', 'Work Items', 'Tasks', 'Packages', 'Runs', 'Reviews']) {
      expect(screen.queryByRole('link', { name: label })).toBeNull();
    }
  });

  it('renders /dashboard as a retired safe state without old dashboard UI', async () => {
    const screen = await renderRoute('/dashboard');

    expect(await screen.findByRole('heading', { name: /not found|retired|not available/i })).toBeTruthy();
    expect(document.body.textContent).toMatch(/not found|retired|not available/i);
    for (const oldDashboardText of ['Flow health', 'Blocked work', 'Risk concentration', 'Trend reports']) {
      expect(document.body.textContent).not.toContain(oldDashboardText);
    }
  });

  it('opens command search suggestions without retired routes', async () => {
    const user = userEvent.setup();
    const screen = await renderRoute('/my-work');

    const search = screen.getByRole('searchbox', { name: 'Command search' });
    await user.click(search);

    const commandSuggestions = screen.getByRole('navigation', { name: 'Command suggestions' });
    expect(commandSuggestions).toBeTruthy();
    expect(screen.queryByRole('listbox', { name: 'Command suggestions' })).toBeNull();
    expect(screen.queryByRole('option')).toBeNull();
    expect(within(commandSuggestions).getByRole('link', { name: 'Cockpit' })).toBeTruthy();
    expect(within(commandSuggestions).queryByRole('link', { name: 'Dashboard' })).toBeNull();

    await user.type(search, 'release');

    expect(within(commandSuggestions).getByRole('link', { name: 'Releases' })).toBeTruthy();
    expect(within(commandSuggestions).queryByRole('link', { name: 'Dashboard' })).toBeNull();
  });

  it('does not render unsafe Cockpit projection hrefs as links', async () => {
    const screen = await renderRoute('/cockpit', {
      apiOverrides: {
        [`GET /query/dashboard?project_id=${projectId}`]: {
          project_id: projectId,
          sections: [{ id: 'flow-health', label: 'Flow Health', value: 1 }],
          next_actions: [
            { id: 'bad-dashboard', label: 'Unsafe Dashboard Query', href: '/dashboard?x=1' },
            { id: 'bad-tasks', label: 'Unsafe Tasks Query', href: '/tasks?x=1' },
            { id: 'bad-dev-tools', label: 'Unsafe Dev Tools', href: '/dev-tools' },
            { id: 'bad-unknown', label: 'Unsafe Unknown Path', href: '/foo' },
          ],
          report_links: [{ id: 'bad-report', label: 'Unsafe Delivery Report Link', href: '/foo' }],
          degraded_sources: [],
        },
      },
    });

    expect(await screen.findByRole('heading', { name: 'Cockpit' })).toBeTruthy();
    for (const label of [
      'Unsafe Dashboard Query',
      'Unsafe Tasks Query',
      'Unsafe Dev Tools',
      'Unsafe Unknown Path',
      'Unsafe Delivery Report Link',
    ]) {
      expect((await screen.findAllByText(label)).length).toBeGreaterThan(0);
      expect(screen.queryByRole('link', { name: new RegExp(label, 'i') })).toBeNull();
    }
  });

  it('gates Dev Tools navigation behind runtime flags', async () => {
    const screen = await renderRoute('/my-work');
    expect(screen.queryByRole('link', { name: 'Dev Tools' })).toBeNull();

    const flaggedScreen = await renderRoute('/my-work', { devToolsEnabled: true });
    expect(flaggedScreen.getByRole('link', { name: 'Dev Tools' })).toBeTruthy();
  });

  it('shows real topbar context without placeholder workspace copy', async () => {
    const screen = await renderRoute('/my-work');
    const topbarContext = document.body.querySelector('[data-topbar-context]');

    expect(screen.getByText('Context active')).toBeTruthy();
    expect(screen.getByText('Authenticated')).toBeTruthy();
    expect(topbarContext?.getAttribute('data-project-context')).toBe('active');
    expect(topbarContext?.getAttribute('data-actor-context')).toBe('active');
    expect(topbarContext?.hasAttribute('data-project-id')).toBe(false);
    expect(topbarContext?.hasAttribute('data-actor-id')).toBe(false);
    expect(screen.queryByText('Product workspace')).toBeNull();
  });

  it('routes sidebar clicks through React Router without document navigation', async () => {
    const user = userEvent.setup();
    const screen = await renderRoute('/my-work');

    await user.click(screen.getByRole('link', { name: 'Reports' }));

    expect(screen.getByRole('heading', { name: 'Reports' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'My Work' })).toBeNull();
  });

  it('marks the Cockpit nav item active on the index route', async () => {
    const screen = await renderRoute('/');

    expect((await screen.findByRole('link', { name: 'Cockpit' })).getAttribute('aria-current')).toBe('page');
  });

  it('marks typed Discovery routes active independently', async () => {
    const screen = await renderRoute(`/initiatives/${initiativeListItem.id}`);

    expect(screen.getByRole('link', { name: 'Initiatives' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Requirements' }).getAttribute('aria-current')).toBe(null);
  });

  it('marks Document Reviews active for the governance queue route', async () => {
    const screen = await renderRoute('/specs-plans');

    expect(screen.getByRole('link', { name: 'Document Reviews' }).getAttribute('aria-current')).toBe('page');
  });

  it('marks Development Plans active for planning table routes', async () => {
    const screen = await renderRoute(`/development-plans/${developmentPlan.id}`);

    expect(screen.getByRole('link', { name: 'Development Plans' }).getAttribute('aria-current')).toBe('page');
  });

  it('marks Executions active for execution supervision routes', async () => {
    const screen = await renderRoute(`/executions/${execution.id}`);

    expect(screen.getByRole('link', { name: 'Executions' }).getAttribute('aria-current')).toBe('page');
  });

  it('respects the requested route path', async () => {
    const screen = await renderRoute('/not-a-product-route');
    expect(screen.queryByRole('heading', { name: /lanes/i })).toBeNull();
  });

  it('exports root route loading and error boundaries', async () => {
    const rootModule = await import('../../apps/web/src/app/root');
    expect(rootModule.HydrateFallback).toEqual(expect.any(Function));
    expect(rootModule.ErrorBoundary).toEqual(expect.any(Function));
  });

  it('keeps essential document metadata in the route shell', async () => {
    const rootModule = await import('../../apps/web/src/app/root');
    const layout = rootModule.Layout({ children: <main /> });
    expect(containsElement(layout, (element) => element.type === 'meta' && element.props.charSet === 'utf-8')).toBe(true);
    expect(
      containsElement(
        layout,
        (element) =>
          element.type === 'meta' &&
          element.props.name === 'viewport' &&
          element.props.content === 'width=device-width, initial-scale=1',
      ),
    ).toBe(true);
  });

  it('uses Cockpit as the default route through a redirect module', async () => {
    const routeConfigModule = await import('../../apps/web/src/app/routes');
    const layoutRoute = routeConfigModule.default.find((route) => route.file === './routes/_layout.tsx');

    expect(layoutRoute?.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ index: true, file: './routes/_index.tsx' }),
        expect.objectContaining({ path: 'cockpit', file: './routes/cockpit/index.tsx' }),
      ]),
    );
  });

  it('does not include removed route families in canonical route config', async () => {
    const routeConfigModule = await import('../../apps/web/src/app/routes');
    const layoutRoute = routeConfigModule.default.find((route) => route.file === './routes/_layout.tsx');
    const serialized = JSON.stringify(layoutRoute);

    for (const forbidden of ['lanes', 'pipeline', 'work-items', 'tasks', 'packages', 'runs', 'reviews']) {
      expect(serialized).not.toContain(`"path":"${forbidden}`);
      expect(serialized).not.toContain(`/routes/${forbidden}`);
    }
    expect(serialized).not.toContain(`"path":"specs"`);
    expect(serialized).not.toContain(`"path":"plans"`);
  });
});

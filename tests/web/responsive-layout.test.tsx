// @vitest-environment jsdom

import { cleanup, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderRoute } from './router-test-utils';
import { legacyRenderedClassTokens } from './helpers/no-legacy-class-scan';
import { developmentPlan, developmentPlanItem, requirementListItem } from './fixtures/product-data';
import { render, screen } from '@testing-library/react';
import { InspectorRail, WorkspaceSplitPane } from '../../apps/web/src/shared/layout';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('responsive layout contract', () => {
  it('keeps workspace split pane single-column by default and responsive when requested', () => {
    const { rerender } = render(
      <WorkspaceSplitPane primary={<section>Primary</section>} secondary={<InspectorRail>Inspector</InspectorRail>} />,
    );

    expect(document.querySelector('[data-workspace-split-pane]')?.className).not.toContain('lg:grid-cols');
    expect(screen.getByRole('complementary').textContent).toBe('Inspector');

    rerender(
      <WorkspaceSplitPane
        minPrimary="wide"
        primary={<section>Primary</section>}
        secondary={<InspectorRail>Inspector</InspectorRail>}
        secondaryWidth="wide"
      />,
    );

    const splitPane = document.querySelector('[data-workspace-split-pane]');
    const splitContent = document.querySelector('[data-workspace-split-content]');
    expect(splitPane?.className).not.toContain('lg:grid-cols');
    expect(splitContent?.className).toContain('lg:grid-cols');
    expect(splitContent?.className).toContain('minmax(28rem,1fr)');
    expect(splitContent?.className).toContain('24rem');
  });

  it('renders the shell with stable responsive landmarks', async () => {
    const screen = await renderRoute('/my-work');

    expect(screen.getAllByRole('banner').length).toBeGreaterThan(0);
    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeTruthy();
    expect(screen.getAllByRole('main').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Open navigation' })).toBeTruthy();
    expect(legacyRenderedClassTokens(document.body)).toEqual([]);
  });

  it('renders planning input workspace without old responsive class tokens', async () => {
    const screen = await renderRoute(`/requirements/${requirementListItem.id}`);

    expect(await screen.findByRole('heading', { name: 'Requirement' })).toBeTruthy();
    expect(document.querySelector('[data-page-family="document-workspace"]')).toBeTruthy();
    expect(document.querySelector('[data-document-surface][data-primary-work-surface]')).toBeTruthy();
    expect(screen.getAllByRole('main').length).toBeGreaterThan(0);
    expect(legacyRenderedClassTokens(document.body)).toEqual([]);
  });

  it('renders item-scoped routes with stable visible status text at desktop and mobile widths', async () => {
    for (const width of [375, 768, 1024, 1440]) {
      vi.stubGlobal('innerWidth', width);
      vi.stubGlobal('matchMedia', createMatchMedia(width));

      const screen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`);
      expect(await screen.findByRole('heading', { name: developmentPlanItem.title })).toBeTruthy();
      await waitFor(() => expect(document.body.textContent).toMatch(/approved|running|pending|status/i));
      expect(document.querySelector('[data-card-in-card="true"]')).toBeNull();
      expect(legacyRenderedClassTokens(document.body)).toEqual([]);
      cleanup();
      vi.unstubAllGlobals();
    }
  });

  it('keeps 768px tablet layouts in mobile drawer mode until navigation opens', async () => {
    vi.stubGlobal('innerWidth', 768);
    vi.stubGlobal('matchMedia', createMatchMedia(768));

    const screen = await renderRoute('/reports');

    expect(screen.getByRole('button', { name: 'Open navigation' })).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: 'Cockpit' })).toBeNull();
    });
  });

  it('keeps Development Plan detail table usable across mobile cards and tablet summary columns', async () => {
    vi.stubGlobal('innerWidth', 375);
    vi.stubGlobal('matchMedia', createMatchMedia(375));

    const mobileScreen = await renderRoute(`/development-plans/${developmentPlan.id}`);

    expect(await mobileScreen.findByRole('heading', { name: developmentPlan.title })).toBeTruthy();
    await waitFor(() => {
      expect(document.querySelector('[data-responsive-card-list]')?.textContent).toMatch(developmentPlanItem.title);
    });
    expect(document.querySelector('[data-responsive-card-list]')?.textContent).toMatch(/Current gate|Gate progress/i);
    expect(document.querySelector('[data-responsive-card-list]')?.textContent).toMatch(/Open Plan Item/i);
    expect(document.querySelector('[data-table-scroll-container]')?.className).toMatch(/overflow-x-auto/);
    cleanup();
    vi.unstubAllGlobals();

    vi.stubGlobal('innerWidth', 1024);
    vi.stubGlobal('matchMedia', createMatchMedia(1024));
    const tabletScreen = await renderRoute(`/development-plans/${developmentPlan.id}`);

    expect(await tabletScreen.findByRole('columnheader', { name: 'Current gate' })).toBeTruthy();
    expect(tabletScreen.getByRole('columnheader', { name: 'Gate progress' })).toBeTruthy();
    expect(tabletScreen.queryByRole('columnheader', { name: 'Implementation Plan Doc' })).toBeNull();
  });
});

function createMatchMedia(width: number) {
  return (query: string): MediaQueryList => {
    const maxWidth = Number(query.match(/max-width:\s*(\d+)px/)?.[1] ?? Number.POSITIVE_INFINITY);
    const minWidth = Number(query.match(/min-width:\s*(\d+)px/)?.[1] ?? 0);
    return {
      matches: width >= minWidth && width <= maxWidth,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
  };
}

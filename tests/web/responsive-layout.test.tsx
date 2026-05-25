// @vitest-environment jsdom

import { cleanup, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderRoute } from './router-test-utils';
import { legacyRenderedClassTokens } from './helpers/no-legacy-class-scan';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('responsive layout contract', () => {
  it('renders the shell with stable responsive landmarks', async () => {
    const screen = await renderRoute('/my-work');

    expect(screen.getByRole('banner')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeTruthy();
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open navigation' })).toBeTruthy();
    expect(legacyRenderedClassTokens(document.body)).toEqual([]);
  });

  it('renders source object workspace without old responsive class tokens', async () => {
    const screen = await renderRoute('/requirements/req-1');

    expect(await screen.findByRole('heading', { name: 'Requirement' })).toBeTruthy();
    expect(await screen.findByRole('complementary', { name: /next action/i })).toBeTruthy();
    expect(document.querySelector('[data-detail-layout-rail]')).toBeTruthy();
    expect(screen.getByRole('main')).toBeTruthy();
    expect(legacyRenderedClassTokens(document.body)).toEqual([]);
  });

  it('renders item-scoped routes with stable visible status text at desktop and mobile widths', async () => {
    for (const width of [375, 768, 1024, 1440]) {
      vi.stubGlobal('innerWidth', width);
      vi.stubGlobal('matchMedia', createMatchMedia(width));

      const screen = await renderRoute('/development-plans/development-plan-web-product/items/development-plan-item-web-product');
      expect(await screen.findByRole('heading', { name: /Development Plan Item/i })).toBeTruthy();
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

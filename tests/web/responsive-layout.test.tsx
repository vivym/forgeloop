// @vitest-environment jsdom

import { readFileSync } from 'node:fs';

import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderRoute } from './router-test-utils';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('responsive layout contract', () => {
  it('renders the shell with stable responsive landmarks', async () => {
    const screen = await renderRoute('/workbench');

    expect(screen.getByRole('banner')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeTruthy();
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open navigation' })).toBeTruthy();
  });

  it('renders dense tables with a card fallback contract', async () => {
    const screen = await renderRoute('/runs');

    expect(await screen.findByRole('table', { name: 'Runs' })).toBeTruthy();
    expect(document.querySelector('[data-responsive-card-list]')).not.toBeNull();
  });

  it('keeps 768px tablet layouts in table mode instead of mobile card mode', async () => {
    vi.stubGlobal('innerWidth', 768);
    vi.stubGlobal('matchMedia', createMatchMedia(768));

    const screen = await renderRoute('/runs');

    expect(await screen.findByRole('table', { name: 'Runs' })).toBeTruthy();
    await waitFor(() => {
      expect(document.querySelector('.fl-responsive-card-list__item')).toBeNull();
    });
  });

  it('defines tablet inline action rails and mobile navigation sheet styles', () => {
    const css = readFileSync('apps/web/src/shared/design-system/theme/css-variables.css', 'utf8');
    const tabletStart = css.indexOf('@media (max-width: 1199px)');
    const mobileStart = css.indexOf('@media (max-width: 767px)');
    const tabletBlock = css.slice(tabletStart, mobileStart);
    const mobileBlock = css.slice(mobileStart);

    expect(tabletBlock).toContain('.fl-detail-layout__body');
    expect(tabletBlock).toContain('grid-template-columns: 1fr');
    expect(tabletBlock).toContain('.fl-action-rail');
    expect(tabletBlock).toContain('border-top');
    expect(mobileBlock).toContain('.fl-app-shell__sidebar.is-open');
    expect(mobileBlock).toContain('position: fixed');
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

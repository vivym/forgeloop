// @vitest-environment jsdom

import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderRoute } from './router-test-utils';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('responsive layout contract', () => {
  it('renders the shell with stable responsive landmarks', async () => {
    const screen = await renderRoute('/lanes');

    expect(screen.getByRole('banner')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeTruthy();
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open navigation' })).toBeTruthy();
    expect(document.body.innerHTML).not.toContain('fl-app-shell');
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
      const responsiveCards = screen.getByRole('list', { name: 'Runs cards' });
      expect(responsiveCards.querySelectorAll('[role="listitem"]').length).toBe(0);
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

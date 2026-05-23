// @vitest-environment jsdom

import { waitFor } from '@testing-library/react';
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

  it('renders target evidence scaffolds without old responsive class tokens', async () => {
    const screen = await renderRoute('/tasks/task-web-product/runs/run-web-product');

    expect(await screen.findByRole('heading', { name: 'Task Run' })).toBeTruthy();
    expect(screen.getByRole('main')).toBeTruthy();
    expect(legacyRenderedClassTokens(document.body)).toEqual([]);
  });

  it('keeps 768px tablet layouts in mobile drawer mode until navigation opens', async () => {
    vi.stubGlobal('innerWidth', 768);
    vi.stubGlobal('matchMedia', createMatchMedia(768));

    const screen = await renderRoute('/reports');

    expect(screen.getByRole('button', { name: 'Open navigation' })).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: 'Dashboard' })).toBeNull();
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

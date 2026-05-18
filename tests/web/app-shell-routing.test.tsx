// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { renderRoute } from './router-test-utils';

describe('React Router product shell', () => {
  it('renders Workbench through route modules, not the legacy App', async () => {
    const screen = await renderRoute('/workbench');
    expect(screen.getByRole('heading', { name: /workbench/i })).toBeTruthy();
    expect(screen.queryByText('Load role queue')).toBeNull();
  });

  it('exports root route loading and error boundaries', async () => {
    const rootModule = await import('../../apps/web/src/app/root');
    expect(rootModule.HydrateFallback).toEqual(expect.any(Function));
    expect(rootModule.ErrorBoundary).toEqual(expect.any(Function));
  });
});

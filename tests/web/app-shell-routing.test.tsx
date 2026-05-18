// @vitest-environment jsdom

import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
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
  it('renders Workbench through route modules, not the legacy App', async () => {
    const screen = await renderRoute('/workbench');
    expect(screen.getByRole('heading', { name: /workbench/i })).toBeTruthy();
    expect(screen.queryByText('Load role queue')).toBeNull();
  });

  it('respects the requested route path', async () => {
    const screen = await renderRoute('/not-a-product-route');
    expect(screen.queryByRole('heading', { name: /workbench/i })).toBeNull();
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

  it('keeps the canonical route config wired to the Workbench route module', async () => {
    const routeConfigModule = await import('../../apps/web/src/app/routes');
    const routeConfig = routeConfigModule.default;
    const layoutRoute = routeConfig.find((route) => route.file === './routes/_layout.tsx');

    expect(layoutRoute?.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ index: true, file: './routes/workbench/index.tsx' }),
        expect.objectContaining({ path: 'workbench', file: './routes/workbench/index.tsx' }),
      ]),
    );
  });
});

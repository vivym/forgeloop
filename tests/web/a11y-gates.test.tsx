// @vitest-environment jsdom

import { readFileSync } from 'node:fs';

import axe from 'axe-core';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { developmentPlan, developmentPlanItem, execution } from './fixtures/product-data';
import { renderRoute } from './router-test-utils';

describe('web accessibility gates', () => {
  it.each([
    '/my-work',
    `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`,
    `/executions/${execution.id}`,
    '/releases/release-web-product',
  ])(
    'renders a skip link to the primary main landmark on %s',
    async (route) => {
      const screen = await renderRoute(route);

      const skipLink = screen.getByRole('link', { name: 'Skip to main content' });
      expect(skipLink.getAttribute('href')).toBe('#main-content');
      expect(screen.getByRole('main').getAttribute('id')).toBe('main-content');
    },
  );

  it.each(['/my-work', '/cockpit', '/dashboard', '/specs-plans', '/executions', '/reports'])(
    'has no automated axe violations on %s',
    async (route) => {
      await renderRoute(route);

      const result = await axe.run(document.body);

      expect(result.violations).toEqual([]);
    },
  );

  it('supports keyboard traversal through the project-management navigation', async () => {
    const screen = await renderRoute('/releases/release-web-product');
    const user = userEvent.setup();

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Skip to main content' }));

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Cockpit' }));

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'My Work' }));
  });

  it('keeps closed mobile navigation out of the keyboard order until opened', async () => {
    vi.stubGlobal('innerWidth', 375);
    vi.stubGlobal('matchMedia', createMatchMedia(375));

    const screen = await renderRoute('/my-work');
    const user = userEvent.setup();

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Skip to main content' }));

    await user.tab();
    const trigger = screen.getByRole('button', { name: 'Open navigation' });
    expect(document.activeElement).toBe(trigger);
    expect(screen.queryByRole('link', { name: 'Cockpit' })).toBeNull();

    await user.keyboard('{Enter}');

    expect(screen.getByRole('button', { name: 'Close navigation' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Cockpit' })).toBeTruthy();
  });

  it('keeps mobile navigation drawers keyboard-accessible and closable', async () => {
    vi.stubGlobal('innerWidth', 375);
    vi.stubGlobal('matchMedia', createMatchMedia(375));

    const screen = await renderRoute('/releases');
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: 'Open navigation' });

    await user.click(trigger);

    expect(screen.getByRole('button', { name: 'Close navigation' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Releases' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Close navigation' }));

    expect(screen.getByRole('button', { name: 'Open navigation' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Releases' })).toBeNull();
  });

  it('allows execution detail pages to receive programmatic main focus', async () => {
    const screen = await renderRoute(`/executions/${execution.id}`);
    const main = screen.getByRole('main');

    expect(await screen.findByRole('heading', { name: 'Execution' })).toBeTruthy();
    main.focus();
    expect(document.activeElement).toBe(main);
  });

  it('announces removed product routes through the product-safe not-found state', async () => {
    const screen = await renderRoute('/work-items/new');

    expect(screen.getByRole('heading', { name: 'Not Found' })).toBeTruthy();
    expect(screen.getByRole('status', { name: 'The requested product route was not found.' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /create work item/i })).toBeNull();
  });

  it('keeps design tokens above minimum contrast for product UI states', () => {
    const css = readFileSync('apps/web/src/shared/styles/theme.css', 'utf8');
    const tokens = cssTokenMap(css);
    const legacyTokenPrefix = ['--', 'fl'].join('');

    expect(tokens['--color-background']).toBe('#f3f6fa');
    expect(tokens['--color-surface']).toBe('#ffffff');
    expect(tokens['--color-primary']).toBe('#2563eb');
    expect(tokens['--z-index-sticky']).toBe('10');
    expect(tokens['--z-index-overlay']).toBe('40');
    expect(tokens['--z-index-drawer']).toBe('50');
    expect(tokens['--z-index-modal']).toBe('60');
    expect(tokens['--z-index-toast']).toBe('70');
    expect(tokens['--transition-duration-fast']).toBe('120ms');
    expect(tokens['--transition-duration-base']).toBe('180ms');
    expect(tokens['--transition-duration-slow']).toBe('260ms');
    expect(tokens['--ease-standard']).toBe('cubic-bezier(0.2, 0, 0, 1)');
    expect(tokens['--ease-out']).toBe('cubic-bezier(0, 0, 0.2, 1)');
    expect(Object.keys(tokens).some((key) => key.startsWith(legacyTokenPrefix))).toBe(false);
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(contrast(tokens['--color-text-primary'], tokens['--color-background'])).toBeGreaterThanOrEqual(7);
    expect(contrast(tokens['--color-text-secondary'], tokens['--color-surface'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#ffffff', tokens['--color-primary'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tokens['--color-danger'], tokens['--color-danger-soft'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tokens['--color-warning'], tokens['--color-warning-soft'])).toBeGreaterThanOrEqual(4.5);
  });
});

function cssTokenMap(css: string) {
  return Object.fromEntries(
    [...css.matchAll(/(--(?:color|shadow|radius|font|text|spacing|z|transition-duration|ease)-[\w-]+):\s*([^;]+);/g)].map((match) => [
      match[1],
      match[2].trim(),
    ]),
  );
}

function contrast(foreground: string, background: string) {
  const light = luminance(foreground);
  const dark = luminance(background);
  const [lighter, darker] = light > dark ? [light, dark] : [dark, light];
  return (lighter + 0.05) / (darker + 0.05);
}

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

function luminance(color: string) {
  const rgb = color
    .replace('#', '')
    .match(/.{2}/g)
    ?.map((part) => Number.parseInt(part, 16) / 255)
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));

  if (rgb === undefined || rgb.length !== 3) {
    throw new Error(`Invalid hex color ${color}`);
  }

  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

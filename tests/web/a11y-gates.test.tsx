// @vitest-environment jsdom

import { readFileSync } from 'node:fs';

import axe from 'axe-core';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderRoute } from './router-test-utils';

describe('web accessibility gates', () => {
  it.each(['/lanes', '/runs/run-web-product', '/releases/release-web-product'])(
    'renders a skip link to the primary main landmark on %s',
    async (route) => {
      const screen = await renderRoute(route);

      const skipLink = screen.getByRole('link', { name: 'Skip to main content' });
      expect(skipLink.getAttribute('href')).toBe('#main-content');
      expect(screen.getByRole('main').getAttribute('id')).toBe('main-content');
    },
  );

  it.each(['/lanes', '/pipeline', '/runs/run-web-product', '/releases/release-web-product'])(
    'has no automated axe violations on %s',
    async (route) => {
      await renderRoute(route);

      const result = await axe.run(document.body);

      expect(result.violations).toEqual([]);
    },
  );

  it('supports keyboard traversal through navigation and product actions', async () => {
    const screen = await renderRoute('/releases/release-web-product');
    const user = userEvent.setup();

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Skip to main content' }));

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Lanes' }));

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Pipeline' }));
  });

  it('keeps drawers keyboard-accessible and returns focus to the trigger', async () => {
    const screen = await renderRoute('/releases');
    const user = userEvent.setup();
    const trigger = await screen.findByRole('button', { name: 'Create release' });

    await user.click(trigger);

    expect(screen.getByRole('dialog', { name: 'Create release' })).toBeTruthy();
    expect(screen.getByText('Create a governed release for this project.')).toBeTruthy();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Create release' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('allows tabs and action rail controls to receive keyboard focus', async () => {
    const screen = await renderRoute('/packages/package-web-product');
    const overviewTab = await screen.findByRole('tab', { name: 'Overview' });
    const forceRerunReason = screen.getByLabelText('Force rerun reason');

    overviewTab.focus();
    expect(document.activeElement).toBe(overviewTab);

    forceRerunReason.focus();
    expect(document.activeElement).toBe(forceRerunReason);
  });

  it('announces form validation with text alerts', async () => {
    const screen = await renderRoute('/work-items/new');
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Create Work Item' }));

    const alerts = await screen.findAllByRole('alert');
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts.map((alert) => alert.textContent).join(' ')).toMatch(/\w/);
  });

  it('keeps design tokens above minimum contrast for product UI states', () => {
    const css = readFileSync('apps/web/src/shared/design-system/theme/css-variables.css', 'utf8');
    const tokens = cssTokenMap(css);

    expect(tokens['--color-background']).toBe('#f6f8fb');
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
    expect(Object.keys(tokens).some((key) => key.includes('-fl-'))).toBe(false);
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

// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { renderRoute } from './router-test-utils';
import { legacyRenderedClassTokens } from './helpers/no-legacy-class-scan';

describe('Release Owner surface', () => {
  it('renders the release list route as a product inventory', async () => {
    const screen = await renderRoute('/releases');

    expect(await screen.findByRole('heading', { name: 'Releases' })).toBeTruthy();
    expect(screen.getByText('Release inventory')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Linked Work Items|\/work-items|\/packages/);
    expect(screen.queryByRole('link', { name: 'Dev Tools' })).toBeNull();
    expect(legacyRenderedClassTokens(document.body)).toEqual([]);
  });

  it('renders the release cockpit route as a governed product surface', async () => {
    const screen = await renderRoute('/releases/release-web-product');

    expect(await screen.findByRole('heading', { name: 'Release Readiness' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Typed scope' })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Linked Work Items|\/work-items|\/packages/);
    expect(screen.queryByRole('link', { name: 'Dev Tools' })).toBeNull();
    expect(legacyRenderedClassTokens(document.body)).toEqual([]);
  });
});

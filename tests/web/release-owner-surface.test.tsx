// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { renderRoute } from './router-test-utils';
import { release } from './fixtures/product-data';
import { legacyRenderedClassTokens } from './helpers/no-legacy-class-scan';

describe('Release Owner surface', () => {
  it('renders the release list route as a product inventory', async () => {
    const screen = await renderRoute('/releases');

    expect(await screen.findByRole('heading', { name: 'Releases' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create release' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Dev Tools' })).toBeNull();
    expect(legacyRenderedClassTokens(document.body)).toEqual([]);
  });

  it('renders the release cockpit route as a governed product surface', async () => {
    const screen = await renderRoute(`/releases/${release.id}`);

    expect(await screen.findByText('Scope summary')).toBeTruthy();
    expect(screen.getByText('Linked Work Items')).toBeTruthy();
    expect(screen.getByText('Linked Execution Packages')).toBeTruthy();
    expect(screen.getByText('Timeline / Replay')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Dev Tools' })).toBeNull();
    expect(legacyRenderedClassTokens(document.body)).toEqual([]);
  });
});

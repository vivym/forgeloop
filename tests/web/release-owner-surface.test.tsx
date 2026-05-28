// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { renderRoute } from './router-test-utils';
import { legacyRenderedClassTokens } from './helpers/no-legacy-class-scan';
import { release } from './fixtures/product-data';

describe('Release Owner surface', () => {
  it('renders the release list route as a product inventory', async () => {
    const screen = await renderRoute('/releases');

    expect(await screen.findByRole('heading', { name: 'Releases' })).toBeTruthy();
    expect(document.querySelector('[data-page-family="release-readiness"]')).toBeInstanceOf(HTMLElement);
    expect(document.querySelector('[data-readiness-blockers][data-primary-work-surface]')).toBeInstanceOf(HTMLElement);
    expect(screen.getByText('Release inventory')).toBeTruthy();
    expect(screen.getByText(/Scope/i)).toBeTruthy();
    expect(screen.getByText(/Readiness/i)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Linked Work Items|\/work-items|\/packages/);
    expect(document.body.textContent).not.toMatch(/actor-release-owner/);
    expect(screen.queryByRole('link', { name: 'Dev Tools' })).toBeNull();
    expect(legacyRenderedClassTokens(document.body)).toEqual([]);
  });

  it('renders the release cockpit route as a governed product surface', async () => {
    const screen = await renderRoute(`/releases/${release.id}`);

    expect(await screen.findByRole('heading', { name: 'Release Readiness' })).toBeTruthy();
    expect(document.querySelector('[data-page-family="release-readiness"]')).toBeInstanceOf(HTMLElement);
    expect(document.querySelector('[data-readiness-blockers][data-primary-work-surface]')).toBeInstanceOf(HTMLElement);
    expect(await screen.findByRole('heading', { name: 'Typed scope' })).toBeTruthy();
    expect(document.body.textContent).toMatch(/Scope|Readiness|High-risk changes|Approvals|Launch disabled|Rollback/i);
    expect(document.body.textContent).not.toMatch(/Linked Work Items|\/work-items|\/packages/);
    expect(document.body.textContent).not.toMatch(/actor-release-owner/);
    expect(screen.queryByRole('link', { name: 'Dev Tools' })).toBeNull();
    expect(legacyRenderedClassTokens(document.body)).toEqual([]);
  });

  it('renders release evidence readiness as a dedicated evidence workspace', async () => {
    const screen = await renderRoute(`/releases/${release.id}/evidence`);

    expect(await screen.findByRole('heading', { name: 'Release Evidence' })).toBeTruthy();
    expect(document.querySelector('[data-page-family="release-evidence"]')).toBeInstanceOf(HTMLElement);
    expect(document.querySelector('[data-release-evidence-summary][data-primary-work-surface]')).toBeInstanceOf(HTMLElement);
    expect(document.body.textContent).toMatch(/Evidence readiness|relevance|QA acceptance is required before release/i);
    expect(screen.getAllByRole('link', { name: 'Open execution evidence' }).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/Linked Work Items|\/work-items|\/packages|actor-release-owner/);
  });
});

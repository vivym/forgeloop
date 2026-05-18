// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { renderRoute } from './router-test-utils';
import { release } from './fixtures/product-data';

const forbiddenRawControls = [
  'release_id',
  'Load cockpit',
  'Load replay',
  'Link WorkItem',
  'Unlink WorkItem',
  'Link ExecutionPackage',
  'Unlink ExecutionPackage',
  'raw JSON',
  'raw replay',
  'Replay payload',
  'mutation',
  'wiring',
];

describe('Release Owner surface', () => {
  it('renders the release list route without old raw release owner controls', async () => {
    const screen = await renderRoute('/releases');

    expect(await screen.findByRole('heading', { name: 'Releases' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create release' })).toBeTruthy();
    for (const label of forbiddenRawControls) {
      expect(screen.queryByText(label)).toBeNull();
      expect(screen.queryByLabelText(label)).toBeNull();
    }
  });

  it('renders the release cockpit route without old raw replay and direct id loading controls', async () => {
    const screen = await renderRoute(`/releases/${release.id}`);

    expect(await screen.findByText('Scope summary')).toBeTruthy();
    expect(screen.getByText('Linked Work Items')).toBeTruthy();
    expect(screen.getByText('Linked Execution Packages')).toBeTruthy();
    expect(screen.getByText('Timeline / Replay')).toBeTruthy();
    for (const label of forbiddenRawControls) {
      expect(screen.queryByText(label)).toBeNull();
      expect(screen.queryByLabelText(label)).toBeNull();
    }
  });
});

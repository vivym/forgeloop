// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { renderRoute } from './router-test-utils';

describe('Pipeline product route', () => {
  it('renders Integration and Test / Acceptance stage readiness detail', async () => {
    const screen = await renderRoute('/pipeline');

    expect(await screen.findByRole('heading', { name: 'Integration Validation' })).toBeTruthy();
    expect(screen.getAllByText(/SLA hint:/).length).toBeGreaterThan(0);
    expect(screen.getByText('Readiness status')).toBeTruthy();
    expect(screen.getByText('Dependency blockers')).toBeTruthy();
    expect(screen.getByText('Contract/mock readiness')).toBeTruthy();
    expect(screen.getByText('Environment requirements')).toBeTruthy();
    expect(screen.getByText('Waiting packages')).toBeTruthy();

    expect(screen.getByRole('heading', { name: 'Test Acceptance' })).toBeTruthy();
    expect(screen.getByText('QA owner queues')).toBeTruthy();
    expect(screen.getByText('Test strategy gaps')).toBeTruthy();
    expect(screen.getByText('Acceptance criteria state')).toBeTruthy();
    expect(screen.getByText('Quality gates')).toBeTruthy();
    expect(screen.getByText('Regression coverage gaps')).toBeTruthy();
    expect(screen.getByText('Release-blocking issues')).toBeTruthy();
  });
});

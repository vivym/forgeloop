// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import type { PipelineResponse, ProductListItem } from '../../apps/web/src/shared/api/types';
import { usePipelineQuery } from '../../apps/web/src/shared/api/hooks';
import { deletedProductLaneRoot } from './deleted-route-guards';
import { renderRoute } from './router-test-utils';

vi.mock('../../apps/web/src/shared/api/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../apps/web/src/shared/api/hooks')>();
  return {
    ...actual,
    usePipelineQuery: vi.fn(actual.usePipelineQuery),
  };
});

const mockedUsePipelineQuery = vi.mocked(usePipelineQuery);

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

  it('routes unknown representative objects to Lanes without emitting legacy product lane links', async () => {
    mockedUsePipelineQuery.mockReturnValueOnce({
      data: pipelineWithUnknownRepresentative(),
      isError: false,
      status: 'success',
    } as ReturnType<typeof usePipelineQuery>);

    const screen = await renderRoute('/pipeline');

    expect(await screen.findByRole('heading', { name: 'Pipeline' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'External delivery object' }).getAttribute('href')).toBe('/lanes');
    expect(document.body.innerHTML).not.toContain(deletedProductLaneRoot);
  });
});

function pipelineWithUnknownRepresentative(): PipelineResponse {
  return {
    degraded_sources: [],
    stages: [
      {
        id: 'intake',
        label: 'Intake',
        item_count: 1,
        blocked_count: 0,
        high_risk_count: 0,
        stale_count: 0,
        representative_items: [
          {
            id: 'external-delivery-object',
            object: {
              type: 'external_delivery_object',
              id: 'external-delivery-object',
              title: 'External delivery object',
            },
            title: 'External delivery object',
            related: [],
            counts: {},
            updated_at: '2026-05-18T00:00:00.000Z',
          } as unknown as ProductListItem,
        ],
        degraded: false,
      },
    ],
  };
}

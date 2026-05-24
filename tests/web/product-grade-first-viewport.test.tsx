// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, it } from 'vitest';

import { firstViewportContract } from '../../apps/web/src/features/product-surfaces/first-viewport-contract';
import { expectFirstViewportContract } from './helpers/first-viewport-contract';

function FixturePage() {
  return (
    <main {...{ [firstViewportContract.pageFamilyAttribute]: 'cockpit' }}>
      <h1>Cockpit</h1>
      <section data-testid={firstViewportContract.currentStateTestId} aria-label="Current state">
        Three gate reviews need owner attention.
      </section>
      <section data-testid={firstViewportContract.nextActionTestId} aria-label="Next action">
        Review the oldest blocked Development Plan Item.
      </section>
      <section data-testid={firstViewportContract.roleResponsibilityTestId} aria-label="Role responsibility">
        Product owner is responsible for the next decision.
      </section>
      <section data-testid={firstViewportContract.blockerRiskTestId} aria-label="Blocker or risk">
        Two execution plans are stale.
      </section>
    </main>
  );
}

describe('product-grade first viewport contract', () => {
  it('accepts a page with visible action-first affordances and page-family marker', () => {
    render(<FixturePage />);

    expectFirstViewportContract(screen, { pageFamily: 'cockpit', heading: /Cockpit/ });
  });
});

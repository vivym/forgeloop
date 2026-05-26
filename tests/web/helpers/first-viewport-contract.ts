import { isInaccessible } from '@testing-library/dom';
import { screen as defaultScreen } from '@testing-library/react';
import { expect } from 'vitest';

import { firstViewportContract } from '../../../apps/web/src/features/product-surfaces/first-viewport-contract';
import type { ProductPageFamily } from '../../../apps/web/src/features/product-surfaces/route-contract';

type ScreenQueries = Pick<typeof defaultScreen, 'getByRole' | 'queryByTestId'>;

export interface FirstViewportContractOptions {
  heading?: RegExp | string;
  pageFamily: ProductPageFamily | string;
}

export function expectFirstViewportContract(
  screen: ScreenQueries,
  options: FirstViewportContractOptions,
) {
  const heading = options.heading === undefined
    ? screen.getByRole('heading', { level: 1 })
    : screen.getByRole('heading', { level: 1, name: options.heading });
  expectVisibleAffordance(heading, 'first viewport must expose a visible h1 with text');

  const markers = document.querySelectorAll(`[${firstViewportContract.pageFamilyAttribute}]`);
  expect(markers).toHaveLength(1);
  const marker = markers[0];
  expect(marker).toBeInstanceOf(HTMLElement);
  expect((marker as HTMLElement).getAttribute(firstViewportContract.pageFamilyAttribute)).toBe(options.pageFamily);
  expectVisibleElement(marker as HTMLElement, 'first viewport must expose a visible page-family marker');

  const primaryWorkSurfaces = document.querySelectorAll(`[${firstViewportContract.primaryWorkSurfaceAttribute}]`);
  expect(primaryWorkSurfaces).toHaveLength(1);
  expectVisibleAffordance(
    primaryWorkSurfaces[0] as HTMLElement,
    'first viewport must expose exactly one visible primary work surface with content',
  );

  for (const attribute of firstViewportContract.forbiddenAttributes) {
    expect(document.querySelector(`[${attribute}]`)).toBeNull();
  }

  for (const testId of firstViewportContract.forbiddenTestIds) {
    expect(screen.queryByTestId(testId)).toBeNull();
  }

  for (const statusAffordance of document.querySelectorAll('[role="status"], [role="alert"], [data-disabled-reason], [aria-disabled="true"]')) {
    expectVisibleAffordance(statusAffordance as HTMLElement, 'state, disabled, blocker, and status affordances must not be empty wrappers');
  }
}

function expectVisibleAffordance(element: HTMLElement, message: string) {
  expectVisibleElement(element, message);
  expect(accessibleOrTextContent(element).length, message).toBeGreaterThan(0);
}

function expectVisibleElement(element: HTMLElement, message: string) {
  expect(element, message).toBeInstanceOf(HTMLElement);
  expect(element.hasAttribute('hidden'), message).toBe(false);
  expect(element.getAttribute('aria-hidden'), message).not.toBe('true');
  expect(isInaccessible(element), message).toBe(false);
}

function accessibleOrTextContent(element: HTMLElement): string {
  return [
    element.getAttribute('aria-label'),
    element.getAttribute('title'),
    element.textContent,
  ]
    .filter((value): value is string => value !== null)
    .join(' ')
    .trim();
}

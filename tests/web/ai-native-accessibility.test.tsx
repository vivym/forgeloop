// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { fireEvent, within } from '@testing-library/react';

import { renderRoute } from './router-test-utils';

describe('AI-native accessibility interactions', () => {
  it('supports keyboard operation for role lens and action rail commands', async () => {
    const user = userEvent.setup();
    const screen = await renderRoute('/requirements/req-1');
    const roleLens = await screen.findByRole('radiogroup', { name: /role lens/i });

    roleLens.focus();
    await user.keyboard('{ArrowRight}');
    expect(within(roleLens).getByRole('radio', { name: /tech lead/i }).getAttribute('aria-checked')).toBe('true');

    const createPlanButton = screen.getByRole('button', { name: /create development plan/i });
    createPlanButton.focus();
    fireEvent.keyDown(createPlanButton, { key: 'Enter' });
    expect(await screen.findByRole('dialog', { name: /create development plan/i })).toBeTruthy();
  });
});

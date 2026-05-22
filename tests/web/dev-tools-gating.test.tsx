// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { isDevToolsEnabled } from '../../apps/web/src/features/dev-tools/dev-tools-gate';
import { renderRoute } from './router-test-utils';
import { legacyRenderedClassTokens } from './helpers/no-legacy-class-scan';

describe('Dev Tools gate', () => {
  it('is disabled in production unless explicitly enabled', () => {
    expect(isDevToolsEnabled({ dev: false, flag: undefined })).toBe(false);
    expect(isDevToolsEnabled({ dev: false, flag: 'true' })).toBe(true);
  });

  it('renders raw/debug tools only when Dev Tools are enabled', async () => {
    const screen = await renderRoute('/dev-tools', { devToolsEnabled: true });
    expect(screen.getByRole('heading', { name: 'Dev Tools' })).toBeTruthy();
    expect(screen.getByLabelText('Object ID')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Load raw replay' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send API smoke request' })).toBeTruthy();
    expect(legacyRenderedClassTokens(document.body)).toEqual([]);
  });

  it('does not show Dev Tools navigation or raw controls when disabled', async () => {
    const screen = await renderRoute('/lanes');

    expect(screen.queryByRole('link', { name: 'Dev Tools' })).toBeNull();
    expect(screen.queryByLabelText('Object ID')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Load raw replay' })).toBeNull();
  });

  it('shows Dev Tools navigation and raw controls when enabled by override', async () => {
    const screen = await renderRoute('/dev-tools', { devToolsEnabled: true });

    expect(screen.getByRole('link', { name: 'Dev Tools' })).toBeTruthy();
    expect(screen.getByLabelText('Object ID')).toBeTruthy();
  });
});

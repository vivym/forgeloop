// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { isDevToolsEnabled } from '../../apps/web/src/features/dev-tools/dev-tools-gate';
import { renderRoute } from './router-test-utils';

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
  });
});

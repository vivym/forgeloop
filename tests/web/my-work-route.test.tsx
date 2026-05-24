// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { renderRoute } from './router-test-utils';
import { actorId, myWorkQueueResponse, projectId } from './fixtures/product-data';

const legacyOwnerPattern = new RegExp(`${['Work', 'Item', 'Owner'].join(' ')}|${['owner', 'actor', 'id'].join('_')}`);

describe('My Work route', () => {
  it('groups role-aware attention items without generic Work Items copy', async () => {
    const screen = await renderRoute('/my-work');

    expect(await screen.findByRole('heading', { name: 'My Work' })).toBeTruthy();
    for (const group of [
      'Product attention',
      'Tech Lead attention',
      'Developer attention',
      'QA attention',
      'Release attention',
      'Manager attention',
    ]) {
      expect(screen.getByText(group)).toBeTruthy();
    }
    expect(screen.queryByText('Work Items')).toBeNull();
    expect(document.body.textContent).not.toMatch(legacyOwnerPattern);
  });

  it('links queue rows to typed object routes', async () => {
    const screen = await renderRoute('/my-work');

    expect((await screen.findByRole('link', { name: /open requirement/i })).getAttribute('href')).toBe('/requirements/req-1');
    expect(screen.getByRole('link', { name: /open development plan item/i }).getAttribute('href')).toBe(
      '/development-plans/development-plan-web-product/items/development-plan-item-web-product',
    );
  });

  it('derives typed links from object refs instead of trusting queue hrefs', async () => {
    const screen = await renderRoute('/my-work', {
      apiOverrides: {
        [`GET /query/my-work?project_id=${projectId}&actor_id=${actorId}`]: {
          ...myWorkQueueResponse,
          items: [
            {
              ...myWorkQueueResponse.items[0],
              href: 'javascript:alert(1)',
            },
          ],
        },
      },
    });

    expect((await screen.findByRole('link', { name: /open requirement/i })).getAttribute('href')).toBe('/requirements/req-1');
    expect(document.body.textContent).not.toContain('javascript:alert');
  });
});

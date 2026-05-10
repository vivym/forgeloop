import { describe, expect, it } from 'vitest';

import { assertResettableDatabaseUrl } from '../../packages/db/src/index';

describe('database reset guard', () => {
  it.each([
    'postgres://localhost:5432/forgeloop_test',
    'postgres://127.0.0.1:5432/tmp_forgeloop',
    'postgres://user:pass@[::1]:5432/forgeloop_dev',
  ])('accepts local disposable URL %s', (databaseUrl) => {
    expect(() => assertResettableDatabaseUrl(databaseUrl, {})).not.toThrow();
  });

  it.each([
    'postgres://db.example.com:5432/forgeloop_test',
    'postgres://prod-db.internal:5432/forgeloop_dev',
    'postgres://localhost:5432/forgeloop',
  ])('rejects production-looking or non-disposable URL %s without confirmation', (databaseUrl) => {
    expect(() => assertResettableDatabaseUrl(databaseUrl, {})).toThrow(/refusing to reset/i);
  });

  it('accepts unrecognized but local URLs only with explicit confirmation', () => {
    const databaseUrl = 'postgres://localhost:5432/forgeloop';

    expect(() => assertResettableDatabaseUrl(databaseUrl, {})).toThrow(/FORGELOOP_CONFIRM_DB_RESET=1/);
    expect(() => assertResettableDatabaseUrl(databaseUrl, { FORGELOOP_CONFIRM_DB_RESET: '1' })).not.toThrow();
  });

  it('never permits reset when URL parsing fails', () => {
    expect(() => assertResettableDatabaseUrl('not a database url', { FORGELOOP_CONFIRM_DB_RESET: '1' })).toThrow(
      /could not parse/i,
    );
  });
});

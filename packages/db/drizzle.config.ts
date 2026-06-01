import { defineConfig } from 'drizzle-kit';

const url = process.env.FORGELOOP_DATABASE_URL ?? process.env.DATABASE_URL;

if (url === undefined) {
  throw new Error('FORGELOOP_DATABASE_URL or DATABASE_URL is required for drizzle-kit');
}

export default defineConfig({
  schema: './packages/db/src/schema/index.ts',
  out: './packages/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url,
  },
});

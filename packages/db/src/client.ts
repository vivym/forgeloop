import { drizzle } from 'drizzle-orm/node-postgres';
import type { PoolConfig } from 'pg';
import { Pool } from 'pg';

import { DrizzleP0Repository, type ForgeloopDrizzleDatabase } from './repositories/drizzle-p0-repository';
import * as schema from './schema';

export type ForgeloopDb = ForgeloopDrizzleDatabase;

export interface DbClient {
  db: ForgeloopDb;
  pool: Pool;
}

export const createDbClient = (config: PoolConfig = {}): DbClient => {
  const pool = new Pool(config);
  const db = drizzle(pool, { schema });

  return { db, pool };
};

export const createDrizzleP0Repository = (db: ForgeloopDb) => new DrizzleP0Repository(db);

import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { config } from './config';
import { logger } from './logger';

// Neon, Render Postgres, and most managed providers require TLS. We detect
// `sslmode=require` in the connection string (the standard signal) and turn
// SSL on. rejectUnauthorized is false because providers use shared CAs that
// node-postgres does not bundle.
const requiresSsl = /sslmode=require/i.test(config.DATABASE_URL);

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  ssl: requiresSsl ? { rejectUnauthorized: false } : undefined,
});

pool.on('error', (err) => {
  logger.error({ err }, 'unexpected pg pool error');
});

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params as never);
}

// Runs the callback inside a transaction. The client is auto-released and the
// transaction rolled back if the callback throws.
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function closeDb(): Promise<void> {
  await pool.end();
}

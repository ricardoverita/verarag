import { Injectable } from '@nestjs/common';
import { DatabaseError, Pool, type QueryResult, type QueryResultRow } from 'pg';

/** Anything that can run a query: the pool, or a client inside a transaction. */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
}

@Injectable()
export class Database implements Queryable {
  constructor(private readonly pool: Pool) {}

  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>> {
    return this.pool.query<R>(text, values);
  }

  /**
   * Runs `work` inside a transaction on a single connection. Any error rolls
   * everything back, so a use case never leaves half of its writes behind.
   */
  async transaction<T>(work: (tx: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

export function isUniqueViolation(error: unknown, constraint: string): boolean {
  return (
    error instanceof DatabaseError && error.code === '23505' && error.constraint === constraint
  );
}

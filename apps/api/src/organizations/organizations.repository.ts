import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import type { Queryable } from '../database/database.js';
import { slugCandidates, slugify } from './slug.js';

export interface OrganizationRecord {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
}

interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  created_at: Date;
}

const SLUG_ATTEMPTS = 20;

@Injectable()
export class OrganizationsRepository {
  /**
   * Inserts the organization with the first free slug: vera-labs,
   * vera-labs-2, … `ON CONFLICT DO NOTHING` leaves the surrounding
   * transaction usable when a slug is taken, and the unique constraint still
   * settles races between concurrent registrations.
   */
  async insert(db: Queryable, name: string): Promise<OrganizationRecord> {
    const base = slugify(name);
    const candidates = [
      ...slugCandidates(base, SLUG_ATTEMPTS),
      `${base}-${randomUUID().slice(0, 8)}`,
    ];
    for (const slug of candidates) {
      const { rows } = await db.query<OrganizationRow>(
        `INSERT INTO organizations (name, slug) VALUES ($1, $2)
         ON CONFLICT (slug) DO NOTHING
         RETURNING id, name, slug, created_at`,
        [name, slug],
      );
      if (rows[0]) {
        return toRecord(rows[0]);
      }
    }
    throw new Error(`no free slug for organization "${base}"`);
  }

  /**
   * Reads an organization by id. Only call it after the caller's membership
   * has been checked (OrganizationAccessGuard does that for HTTP routes).
   */
  async get(db: Queryable, organizationId: string): Promise<OrganizationRecord> {
    const { rows } = await db.query<OrganizationRow>(
      'SELECT id, name, slug, created_at FROM organizations WHERE id = $1',
      [organizationId],
    );
    return toRecord(rows[0]!);
  }

  async rename(db: Queryable, organizationId: string, name: string): Promise<OrganizationRecord> {
    const { rows } = await db.query<OrganizationRow>(
      'UPDATE organizations SET name = $2 WHERE id = $1 RETURNING id, name, slug, created_at',
      [organizationId, name],
    );
    return toRecord(rows[0]!);
  }

  async count(db: Queryable): Promise<number> {
    const { rows } = await db.query<{ count: string }>('SELECT count(*) FROM organizations');
    return Number(rows[0]?.count ?? 0);
  }
}

export function toRecord(row: OrganizationRow): OrganizationRecord {
  return { id: row.id, name: row.name, slug: row.slug, createdAt: row.created_at };
}

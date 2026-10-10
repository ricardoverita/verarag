import type { CollectionsResponse, CollectionView } from '@verarag/contracts';
import { z } from 'zod';

import { actorView } from '../common/actor.dto.js';
import { normalizeCollectionName } from './collection-name.js';
import type { CollectionRecord } from './collections.repository.js';

const nameSchema = z.string().transform(normalizeCollectionName).pipe(z.string().min(1).max(100));

/** An empty description is the same as none. */
const descriptionSchema = z
  .string()
  .trim()
  .max(1000)
  .nullable()
  .transform((value) => (value === '' ? null : value));

export const createCollectionRequest = z.object({
  name: nameSchema,
  description: descriptionSchema.optional().transform((value) => value ?? null),
});
export type CreateCollectionRequest = z.infer<typeof createCollectionRequest>;

export const updateCollectionRequest = z
  .object({ name: nameSchema.optional(), description: descriptionSchema.optional() })
  .refine((body) => body.name !== undefined || body.description !== undefined, {
    message: 'Change the name, the description or both.',
  });
export type UpdateCollectionRequest = z.infer<typeof updateCollectionRequest>;

export const collectionIdParam = z.uuid();

export const collectionView = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  createdBy: actorView,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}) satisfies z.ZodType<CollectionView>;

export const collectionsResponse = z.object({
  collections: z.array(collectionView),
}) satisfies z.ZodType<CollectionsResponse>;

export function toCollectionView(collection: CollectionRecord): CollectionView {
  return {
    id: collection.id,
    name: collection.name,
    description: collection.description,
    createdBy: collection.createdBy,
    createdAt: collection.createdAt.toISOString(),
    updatedAt: collection.updatedAt.toISOString(),
  };
}

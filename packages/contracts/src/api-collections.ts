/**
 * HTTP payloads for collections, which group the documents of an
 * organization. Dates are ISO 8601 strings.
 */

/** Who created something: a member of the organization or one of its API keys. */
export type ActorView =
  { type: 'user'; id: string; displayName: string } | { type: 'apiKey'; id: string; name: string };

export interface CollectionView {
  id: string;
  name: string;
  description: string | null;
  /** Documents in the collection that are not deleted, whatever their status. */
  documentCount: number;
  createdBy: ActorView;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCollectionRequest {
  name: string;
  description?: string | null;
}

/** At least one field. A null description removes it. */
export interface UpdateCollectionRequest {
  name?: string;
  description?: string | null;
}

export interface CollectionsResponse {
  collections: CollectionView[];
}

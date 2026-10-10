import type { ActorView } from '@verarag/contracts';
import { z } from 'zod';

export const actorView = z.discriminatedUnion('type', [
  z.object({ type: z.literal('user'), id: z.uuid(), displayName: z.string() }),
  z.object({ type: z.literal('apiKey'), id: z.uuid(), name: z.string() }),
]) satisfies z.ZodType<ActorView>;

import { connection } from 'next/server';

/** Liveness probe for Docker. It does not check the API. */
export async function GET(): Promise<Response> {
  await connection();
  return Response.json({ status: 'ok' });
}

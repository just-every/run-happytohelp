import { HTTPException } from 'hono/http-exception';

export function requireValue(value: unknown, message: string, status = 422): asserts value {
  if (!value) throw new HTTPException(status as 400, { message });
}

export function text(value: unknown, limit = 8000): string {
  requireValue(typeof value === 'string' && value.trim() && value.length <= limit, 'Invalid text');
  return value as string;
}

export async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function objectBody(request: {json(): Promise<any>}): Promise<Record<string, any>> {
  const body = await request.json().catch(() => { throw new HTTPException(400, {message: 'Invalid JSON body'}); });
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new HTTPException(400, {message: 'Provide a JSON object'});
  }
  return body;
}

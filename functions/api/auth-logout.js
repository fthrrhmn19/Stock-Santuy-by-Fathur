import { json } from './_shared/http.js';
import { sessionCookie } from './_shared/auth.js';

export async function onRequest(context) {
  const req = context.request;
  const env = context.env;
  globalThis.process = { env: { ...(globalThis.process ? globalThis.process.env : {}), ...env } };
  return json(200, { ok: true }, { 'Set-Cookie': sessionCookie(0, req) });
};

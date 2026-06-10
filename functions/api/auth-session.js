import { json } from './_shared/http.js';
import { authRequired, readSessionCookie, sessionToken } from './_shared/auth.js';

export async function onRequest(context) {
  const req = context.request;
  const env = context.env;
  globalThis.process = { env: { ...(globalThis.process ? globalThis.process.env : {}), ...env } };
  if (!authRequired()) return json(200, { authRequired: false, authenticated: true });

  return json(200, {
    authRequired: true,
    authenticated: readSessionCookie(req) === sessionToken()
  });
};

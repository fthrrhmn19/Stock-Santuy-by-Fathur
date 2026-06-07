import { json } from './_shared/http.mjs';
import { authRequired, readSessionCookie, sessionToken } from './_shared/auth.mjs';

export default async req => {
  if (!authRequired()) return json(200, { authRequired: false, authenticated: true });

  return json(200, {
    authRequired: true,
    authenticated: readSessionCookie(req) === sessionToken()
  });
};

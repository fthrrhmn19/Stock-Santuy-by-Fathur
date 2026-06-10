import { json } from './_shared/http.js';
import { authRequired, sessionCookie, verifyAccessPassword } from './_shared/auth.js';

export async function onRequest(context) {
  const req = context.request;
  const env = context.env;
  globalThis.process = { env: { ...(globalThis.process ? globalThis.process.env : {}), ...env } };
  try {
    if (!authRequired()) return json(200, { ok: true, authRequired: false });

    const { password } = await req.json();
    if (!verifyAccessPassword(password)) return json(401, { message: 'Password salah.' });

    return json(200, { ok: true }, { 'Set-Cookie': sessionCookie(28800, req) });
  } catch {
    return json(400, { message: 'Permintaan login tidak valid.' });
  }
};

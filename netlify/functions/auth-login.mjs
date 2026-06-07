import { json } from './_shared/http.mjs';
import { authRequired, sessionCookie, verifyAccessPassword } from './_shared/auth.mjs';

export default async req => {
  try {
    if (!authRequired()) return json(200, { ok: true, authRequired: false });

    const { password } = await req.json();
    if (!verifyAccessPassword(password)) return json(401, { message: 'Password salah.' });

    return json(200, { ok: true }, { 'Set-Cookie': sessionCookie(28800, req) });
  } catch {
    return json(400, { message: 'Permintaan login tidak valid.' });
  }
};

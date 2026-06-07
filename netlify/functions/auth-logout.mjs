import { json } from './_shared/http.mjs';
import { sessionCookie } from './_shared/auth.mjs';

export default async req => json(200, { ok: true }, { 'Set-Cookie': sessionCookie(0, req) });

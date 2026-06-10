import { json } from './_shared/http.js';
import { sessionCookie } from './_shared/auth.js';

export default async req => json(200, { ok: true }, { 'Set-Cookie': sessionCookie(0, req) });

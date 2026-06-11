import crypto from 'node:crypto';

const COOKIE_NAME = 'stock_santuy_session';
const LEGACY_PASSWORD = process.env.ACCESS_PASSWORD;
const PASSWORD_HASH = process.env.LOGIN_PASSWORD_HASH || process.env.ACCESS_PASSWORD_HASH || "pbkdf2_sha256$100000$c6a7680a26611699e88c0830bc05231e$9c004638ba1310d52885aece3d401c7a4c6ccf8db9c65f7e596742abf9dc4050";
const SESSION_SECRET = process.env.SESSION_SECRET || 'stock_santuy_super_secret_session_key_2026';

const safeEqual = (a, b) => {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

const safeEqualHex = (a, b) => {
  if (!/^[a-f0-9]+$/i.test(String(a)) || !/^[a-f0-9]+$/i.test(String(b))) return false;
  return safeEqual(a.toLowerCase(), b.toLowerCase());
};

const verifyPbkdf2 = (password, configured) => {
  const [, iterations, salt, expected] = String(configured).split('$');
  const rounds = Number(iterations);
  if (!Number.isInteger(rounds) || rounds < 100000 || !salt || !expected) return false;
  const actual = crypto.pbkdf2Sync(String(password || ''), salt, rounds, 32, 'sha256').toString('hex');
  return safeEqualHex(actual, expected);
};

const verifyPasswordHash = (password, configured) => {
  const value = String(configured || '').trim();
  if (!value) return false;
  if (value.startsWith('pbkdf2_sha256$')) return verifyPbkdf2(password, value);
  if (value.startsWith('sha256$')) {
    const actual = crypto.createHash('sha256').update(String(password || '')).digest('hex');
    return safeEqualHex(actual, value.slice('sha256$'.length));
  }
  if (/^[a-f0-9]{64}$/i.test(value)) {
    const actual = crypto.createHash('sha256').update(String(password || '')).digest('hex');
    return safeEqualHex(actual, value);
  }
  return false;
};

export const authRequired = () => Boolean(PASSWORD_HASH || LEGACY_PASSWORD);

export const verifyAccessPassword = password => {
  if (PASSWORD_HASH) return verifyPasswordHash(password, PASSWORD_HASH);
  if (LEGACY_PASSWORD) return safeEqual(password, LEGACY_PASSWORD);
  return true;
};

export const sessionToken = () =>
  crypto.createHmac('sha256', SESSION_SECRET).update('authenticated').digest('hex');

const isSecureRequest = req => {
  const forwardedProto = req?.headers?.get?.('x-forwarded-proto');
  return forwardedProto === 'https' || String(req?.url || '').startsWith('https://');
};

export const sessionCookie = (maxAge, req) => {
  const secure = isSecureRequest(req) ? '; Secure' : '';
  return `${COOKIE_NAME}=${maxAge > 0 ? sessionToken() : ''}; Path=/; HttpOnly${secure}; SameSite=Strict; Max-Age=${maxAge}`;
};

export const readSessionCookie = req => {
  const cookie = req.headers.get('cookie') || '';
  const found = cookie
    .split(';')
    .map(part => part.trim())
    .find(part => part.startsWith(`${COOKIE_NAME}=`));
  return found ? found.slice(COOKIE_NAME.length + 1) : '';
};

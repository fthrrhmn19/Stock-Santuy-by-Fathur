import { onRequest as alertCheck } from './alert-check.js';

export async function onRequest(context) {
  const req = context.request;
  const env = context.env;
  globalThis.process = { env: { ...(globalThis.process ? globalThis.process.env : {}), ...env } };
  const url = new URL(req.url);
  url.pathname = '/api/alert-check';
  url.searchParams.set('session', 'morning');
  return alertCheck({ request: new Request(url, { method: req.method, headers: req.headers }), env: context.env });
};

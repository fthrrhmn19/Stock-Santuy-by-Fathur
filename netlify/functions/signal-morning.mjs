import alertCheck from './alert-check.mjs';

export default async req => {
  const url = new URL(req.url);
  url.pathname = '/api/alert-check';
  url.searchParams.set('session', 'morning');
  return alertCheck(new Request(url, { method: req.method, headers: req.headers }));
};

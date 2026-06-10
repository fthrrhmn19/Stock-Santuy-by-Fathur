export const json = (statusCode, body, headers = {}) =>
  new Response(JSON.stringify(body), {
    status: statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers
    }
  });

export const cleanSymbol = s =>
  String(s || '').trim().toUpperCase().replace(/[^A-Z0-9.:-]/g, '').slice(0, 12);

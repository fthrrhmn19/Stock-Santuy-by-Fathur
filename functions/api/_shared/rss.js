const decode = value => String(value || '')
  .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#039;/g, "'")
  .replace(/&#39;/g, "'");

const stripHtml = value => decode(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (item, name) => {
  const match = item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return match ? stripHtml(match[1]) : '';
};

export async function fetchRss(url, source) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);

  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 StockSantuy/1.0', Accept: 'application/rss+xml, application/xml, text/xml' }
    });
    if (!res.ok) throw new Error(`${source} RSS error ${res.status}`);
    const xml = await res.text();
    const items = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].slice(0, 12);
    return items.map(match => ({
      source,
      title: tag(match[1], 'title'),
      link: tag(match[1], 'link'),
      publishedAt: tag(match[1], 'pubDate') || tag(match[1], 'published'),
      summary: tag(match[1], 'description')
    })).filter(item => item.title && item.link);
  } finally {
    clearTimeout(timer);
  }
}

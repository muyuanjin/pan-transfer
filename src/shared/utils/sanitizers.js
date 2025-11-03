export function sanitizeLink(href) {
  if (!href) {
    return '';
  }
  let link = href.trim();
  link = link.replace(/^http:\/\//i, 'https://');
  link = link.replace('https://pan.baidu.com/share/init?surl=', 'https://pan.baidu.com/s/1');
  return link;
}

export function decodeHtmlEntities(input) {
  if (!input || typeof input !== 'string') {
    return '';
  }
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, '\'')
    .replace(/&#x27;/gi, '\'')
    .replace(/&#x2F;/gi, '/')
    .replace(/&#(\d+);/g, (_m, code) => {
      const num = parseInt(code, 10);
      return Number.isFinite(num) ? String.fromCharCode(num) : '';
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => {
      const num = parseInt(hex, 16);
      return Number.isFinite(num) ? String.fromCharCode(num) : '';
    });
}

export function stripHtmlTags(input) {
  return decodeHtmlEntities((input || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export function extractCleanTitle(rawTitle) {
  if (!rawTitle) return '未命名资源';

  let title = rawTitle.trim();

  title = title.replace(/\s*提取码\s+\S+\s*$/gi, '');
  title = title.replace(/[:：]\s*(第[0-9一二三四五六七八九十百]+季|[Ss]eason\s*\d+|S\d+)\s*$/gi, '');
  title = title.replace(/\s+(第[0-9一二三四五六七八九十百]+季|[Ss]eason\s*\d+|S\d+)\s*$/gi, '');
  title = title.replace(/[:：]\s*$/, '');
  title = title.replace(/\s+/g, ' ').trim();

  return title || '未命名资源';
}

export function sanitizePosterInfo(input) {
  if (!input || typeof input !== 'object') {
    return null;
  }
  if (typeof input.src !== 'string' || !input.src) {
    return null;
  }
  return {
    src: input.src,
    alt: typeof input.alt === 'string' ? input.alt : ''
  };
}

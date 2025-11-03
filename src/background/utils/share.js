export function buildSurl(linkUrl) {
  try {
    const url = new URL(linkUrl);
    if (url.pathname.startsWith('/s/')) {
      let segment = url.pathname.replace('/s/', '');
      if (segment.startsWith('1')) {
        segment = segment.substring(1);
      }
      return segment;
    }
    if (url.pathname.startsWith('/share/init')) {
      const surl = url.searchParams.get('surl');
      if (surl) {
        return surl;
      }
    }
  } catch (error) {
    console.warn('无法解析 surl', linkUrl, error);
  }
  return '';
}

export function extractPassCodeFromText(text) {
  if (!text) {
    return '';
  }
  const match = text.match(/提取码[：:]*\s*([0-9a-zA-Z]+)/);
  return match ? match[1] : '';
}

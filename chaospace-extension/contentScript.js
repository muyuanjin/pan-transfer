(() => {
  function locateResourceRows() {
    const selector = 'table tbody tr[id^="link-"]';
    const rows = Array.from(document.querySelectorAll(selector));
    if (rows.length) {
      return rows;
    }
    return Array.from(document.querySelectorAll('table tbody tr'));
  }

  function extractLinkInfo(row) {
    const anchor = row.querySelector('a[href*="/links/"]');
    if (!anchor) {
      return null;
    }

    const idMatch = anchor.href.match(/\/links\/(\d+)\.html/);
    if (!idMatch) {
      return null;
    }

    const cells = Array.from(row.children);
    const qualityCell = row.querySelector('.quality');

    const section = row.closest('#download, #torrent, #magnet, .links_table, body');
    let category = 'unknown';
    if (section) {
      if (section.id) {
        category = section.id;
      } else if (section.classList.contains('links_table')) {
        category = 'links_table';
      }
    }

    const normalizedTitle = anchor.textContent.replace(/\s+/g, ' ').trim();
    const quality = qualityCell ? qualityCell.textContent.trim() : (cells[1] ? cells[1].textContent.trim() : '');
    const subtitle = cells[2] ? cells[2].textContent.trim() : '';
    const date = cells[4] ? cells[4].textContent.trim() : '';
    const authorCell = row.querySelector('td a[href*="/author/"]');

    return {
      id: idMatch[1],
      href: anchor.href,
      title: normalizedTitle,
      quality,
      subtitle,
      date,
      author: authorCell ? authorCell.textContent.trim() : '',
      category
    };
  }

  function collectLinks() {
    const rows = locateResourceRows();
    const items = rows
      .map(extractLinkInfo)
      .filter(Boolean);

    return {
      items,
      url: window.location.href,
      origin: window.location.origin,
      title: document.title
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'chaospace:collect-links') {
      sendResponse(collectLinks());
    }
    return false;
  });
})();

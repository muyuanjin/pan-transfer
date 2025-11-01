(() => {
  const STORAGE_KEY = 'chaospace-transfer-settings';
  const POSITION_KEY = 'chaospace-panel-position';
  let floatingPanel = null;
  let currentToast = null;
  let isMinimized = false;

  // 智能提取剧集标题
  function extractCleanTitle(rawTitle) {
    if (!rawTitle) return '未命名资源';

    let title = rawTitle.trim();

    // 移除 " 提取码 xxxx" 这种后缀
    title = title.replace(/\s*提取码\s+\S+\s*$/gi, '');

    // 移除末尾的 :：及其后面的内容（如 ":第1季"、"：第一季"）
    title = title.replace(/[:：]\s*(第[0-9一二三四五六七八九十百]+季|[Ss]eason\s*\d+|S\d+)\s*$/gi, '');

    // 移除末尾的 " 第X季"、" SXX" 等
    title = title.replace(/\s+(第[0-9一二三四五六七八九十百]+季|[Ss]eason\s*\d+|S\d+)\s*$/gi, '');

    // 移除末尾的单独冒号
    title = title.replace(/[:：]\s*$/, '');

    // 移除多余空格
    title = title.replace(/\s+/g, ' ').trim();

    return title || '未命名资源';
  }

  // 从页面标题提取剧集名称
  function getPageCleanTitle() {
    const pageTitle = document.title;

    // 移除网站名称后缀（如 " - CHAOSPACE", " – CHAOSPACE"）
    let title = pageTitle.replace(/\s*[–\-_|]\s*CHAOSPACE.*$/i, '');

    return extractCleanTitle(title);
  }

  // 只查找百度网盘链接（在 #download 区域）
  function locateBaiduPanRows() {
    const downloadSection = document.getElementById('download');
    if (!downloadSection) {
      return [];
    }

    const selector = 'table tbody tr[id^="link-"]';
    const rows = Array.from(downloadSection.querySelectorAll(selector));

    return rows;
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

    const qualityCell = row.querySelector('.quality');
    const cells = Array.from(row.children);

    const rawTitle = anchor.textContent.replace(/\s+/g, ' ').trim();
    const cleanTitle = extractCleanTitle(rawTitle);
    const quality = qualityCell ? qualityCell.textContent.trim() : (cells[1] ? cells[1].textContent.trim() : '');
    const subtitle = cells[2] ? cells[2].textContent.trim() : '';

    return {
      id: idMatch[1],
      href: anchor.href,
      title: cleanTitle,
      rawTitle: rawTitle,
      quality,
      subtitle
    };
  }

  function collectLinks() {
    try {
      const rows = locateBaiduPanRows();
      const items = rows
        .map(extractLinkInfo)
        .filter(Boolean);

      return {
        items,
        url: window.location.href,
        origin: window.location.origin,
        title: getPageCleanTitle()
      };
    } catch (error) {
      console.error('[Chaospace] Failed to collect links:', error);
      return {
        items: [],
        url: window.location.href || '',
        origin: window.location.origin || '',
        title: ''
      };
    }
  }

  function showToast(type, title, message, stats = null) {
    try {
      if (currentToast && currentToast.parentNode) {
        currentToast.remove();
        currentToast = null;
      }

      if (!document.body) {
        return;
      }

      const toast = document.createElement('div');
      toast.className = `chaospace-toast ${type}`;

      const titleEl = document.createElement('div');
      titleEl.className = 'chaospace-toast-title';
      titleEl.textContent = title;
      toast.appendChild(titleEl);

      if (message) {
        const messageEl = document.createElement('div');
        messageEl.className = 'chaospace-toast-message';
        messageEl.textContent = message;
        toast.appendChild(messageEl);
      }

      if (stats) {
        const statsEl = document.createElement('div');
        statsEl.className = 'chaospace-toast-stats';

        if (stats.success > 0) {
          const successStat = document.createElement('div');
          successStat.className = 'chaospace-toast-stat success';
          successStat.textContent = `✓ 成功: ${stats.success}`;
          statsEl.appendChild(successStat);
        }

        if (stats.failed > 0) {
          const failedStat = document.createElement('div');
          failedStat.className = 'chaospace-toast-stat failed';
          failedStat.textContent = `✗ 失败: ${stats.failed}`;
          statsEl.appendChild(failedStat);
        }

        if (stats.skipped > 0) {
          const skippedStat = document.createElement('div');
          skippedStat.className = 'chaospace-toast-stat skipped';
          skippedStat.textContent = `○ 跳过: ${stats.skipped}`;
          statsEl.appendChild(skippedStat);
        }

        toast.appendChild(statsEl);
      }

      document.body.appendChild(toast);
      currentToast = toast;

      setTimeout(() => {
        if (currentToast === toast && toast.parentNode) {
          toast.remove();
          currentToast = null;
        }
      }, 5000);
    } catch (error) {
      console.error('[Chaospace] Failed to show toast:', error);
    }
  }

  function getTargetPath(baseDir, useTitleSubdir, pageTitle) {
    let targetDirectory = baseDir || '/';

    if (useTitleSubdir && pageTitle) {
      const cleanTitle = extractCleanTitle(pageTitle);
      targetDirectory = baseDir === '/' ? `/${cleanTitle}` : `${baseDir}/${cleanTitle}`;
    }

    return targetDirectory;
  }

  function updatePathPreview(baseDirInput, useTitleCheckbox, previewEl, pageTitle) {
    const baseDir = baseDirInput.value.trim() || '/';
    const useTitleSubdir = useTitleCheckbox.checked;
    const targetPath = getTargetPath(baseDir, useTitleSubdir, pageTitle);
    previewEl.textContent = `转存路径: ${targetPath}`;
  }

  function showTransferResult(results, targetDirectory) {
    if (!floatingPanel) return;

    const body = floatingPanel.querySelector('.chaospace-float-body');

    // 移除旧的结果
    const oldResult = body.querySelector('.chaospace-float-result');
    if (oldResult) {
      oldResult.remove();
    }

    const stats = {
      success: results.filter(r => r.status === 'success').length,
      failed: results.filter(r => r.status === 'failed').length,
      skipped: results.filter(r => r.status === 'skipped').length
    };

    const resultType = stats.failed === 0 ? 'success' : (stats.success > 0 ? 'warning' : 'error');
    const resultTitle = stats.failed === 0 ? '转存完成' : (stats.success > 0 ? '部分转存成功' : '转存失败');

    const resultHTML = `
      <div class="chaospace-float-result ${resultType}">
        <div class="chaospace-float-result-title">${resultTitle}</div>
        <div>目标路径: ${targetDirectory}</div>
        <div class="chaospace-float-result-stats">
          ${stats.success > 0 ? `<span class="chaospace-float-result-stat">成功: ${stats.success}</span>` : ''}
          ${stats.failed > 0 ? `<span class="chaospace-float-result-stat">失败: ${stats.failed}</span>` : ''}
          ${stats.skipped > 0 ? `<span class="chaospace-float-result-stat">跳过: ${stats.skipped}</span>` : ''}
        </div>
        <div class="chaospace-float-result-list">
          ${results.map(r => `
            <div class="chaospace-float-result-item ${r.status}">
              <span>${r.title}</span>
              <span>${r.status === 'success' ? '✓' : r.status === 'skipped' ? '○' : '✗'}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    body.insertAdjacentHTML('beforeend', resultHTML);
  }

  async function handleTransfer() {
    if (!floatingPanel) return;

    const transferBtn = floatingPanel.querySelector('.chaospace-float-btn');
    const baseDirInput = floatingPanel.querySelector('#float-base-dir');
    const useTitleCheckbox = floatingPanel.querySelector('#float-use-title-subdir');

    try {
      const data = collectLinks();

      if (!data.items || data.items.length === 0) {
        showToast('warning', '没有找到资源', '当前页面没有可转存的百度网盘链接');
        return;
      }

      transferBtn.disabled = true;
      transferBtn.classList.add('loading');
      transferBtn.innerHTML = '<span>转存中...</span>';

      const baseDir = baseDirInput.value.trim() || '/';
      const useTitleSubdir = useTitleCheckbox.checked;
      const targetDirectory = getTargetPath(baseDir, useTitleSubdir, data.title);

      // 保存设置
      await chrome.storage.local.set({
        [STORAGE_KEY]: {
          baseDir: baseDir,
          useTitleSubdir: useTitleSubdir
        }
      });

      const payload = {
        origin: data.origin,
        items: data.items.map(item => ({
          id: item.id,
          title: item.title,
          targetPath: targetDirectory
        })),
        targetDirectory
      };

      const response = await chrome.runtime.sendMessage({
        type: 'chaospace:transfer',
        payload
      });

      if (response && response.results) {
        // 显示结果
        showTransferResult(response.results, targetDirectory);

        const stats = {
          success: response.results.filter(r => r.status === 'success').length,
          failed: response.results.filter(r => r.status === 'failed').length,
          skipped: response.results.filter(r => r.status === 'skipped').length
        };

        if (stats.failed === 0) {
          showToast('success', '转存完成', `已成功转存到: ${targetDirectory}`, stats);
        } else if (stats.success > 0) {
          showToast('warning', '部分转存成功', `已转存到: ${targetDirectory}`, stats);
        } else {
          showToast('error', '转存失败', '所有资源转存失败,请检查设置和网络', stats);
        }
      } else {
        showToast('error', '转存失败', '未收到响应,请重试');
      }
    } catch (error) {
      console.error('[Chaospace] Transfer error:', error);
      showToast('error', '转存失败', error.message || '发生未知错误');
    } finally {
      if (transferBtn) {
        transferBtn.disabled = false;
        transferBtn.classList.remove('loading');
        transferBtn.innerHTML = '<span>开始转存</span>';
      }
    }
  }

  async function createFloatingPanel() {
    if (floatingPanel) {
      return;
    }

    try {
      const data = collectLinks();
      if (!data.items || data.items.length === 0) {
        // 没有资源就不显示窗口
        return;
      }

      // 加载设置
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      const settings = stored[STORAGE_KEY] || {};
      const baseDir = settings.baseDir || '/';
      const useTitleSubdir = settings.useTitleSubdir !== false;

      const panel = document.createElement('div');
      panel.className = 'chaospace-float-panel';

      const targetPath = getTargetPath(baseDir, useTitleSubdir, data.title);

      panel.innerHTML = `
        <div class="chaospace-float-header">
          <h2 class="chaospace-float-title">CHAOSPACE 转存助手</h2>
          <div class="chaospace-float-controls">
            <button class="chaospace-float-minimize" title="折叠">−</button>
          </div>
        </div>
        <div class="chaospace-float-body">
          <div class="chaospace-float-settings">
            <div class="chaospace-float-field">
              <label>百度网盘目录</label>
              <input id="float-base-dir" type="text" value="${baseDir}" placeholder="/视频/番剧" />
            </div>
            <label class="chaospace-float-checkbox">
              <input id="float-use-title-subdir" type="checkbox" ${useTitleSubdir ? 'checked' : ''} />
              <span>使用剧集标题创建子目录</span>
            </label>
            <div class="chaospace-float-preview">转存路径: ${targetPath}</div>
          </div>
          <div class="chaospace-float-items">
            <div class="chaospace-float-items-header">找到 ${data.items.length} 个百度网盘资源</div>
            <div class="chaospace-float-items-list">
              ${data.items.map(item => `
                <div class="chaospace-float-item">
                  <div class="chaospace-float-item-title">${item.title}</div>
                  <div class="chaospace-float-item-meta">
                    ${item.quality ? `<span>画质: ${item.quality}</span>` : ''}
                    ${item.subtitle ? `<span>字幕: ${item.subtitle}</span>` : ''}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
        <div class="chaospace-float-actions">
          <button class="chaospace-float-btn">
            <span>开始转存</span>
          </button>
        </div>
      `;

      document.body.appendChild(panel);
      floatingPanel = panel;

      // 加载并设置保存的位置
      const savedPosition = await chrome.storage.local.get(POSITION_KEY);
      if (savedPosition[POSITION_KEY]) {
        const pos = savedPosition[POSITION_KEY];
        panel.style.left = pos.left + 'px';
        panel.style.top = pos.top + 'px';
        panel.style.right = 'auto';
        panel.style.transform = 'none';
      }

      // 绑定事件
      const minimizeBtn = panel.querySelector('.chaospace-float-minimize');
      minimizeBtn.addEventListener('click', () => {
        isMinimized = !isMinimized;
        if (isMinimized) {
          panel.classList.add('minimized');
          minimizeBtn.textContent = '+';
          minimizeBtn.title = '展开';
        } else {
          panel.classList.remove('minimized');
          minimizeBtn.textContent = '−';
          minimizeBtn.title = '折叠';
        }
      });

      const transferBtn = panel.querySelector('.chaospace-float-btn');
      transferBtn.addEventListener('click', handleTransfer);

      const baseDirInput = panel.querySelector('#float-base-dir');
      const useTitleCheckbox = panel.querySelector('#float-use-title-subdir');
      const previewEl = panel.querySelector('.chaospace-float-preview');

      baseDirInput.addEventListener('input', () => {
        updatePathPreview(baseDirInput, useTitleCheckbox, previewEl, data.title);
      });

      useTitleCheckbox.addEventListener('change', () => {
        updatePathPreview(baseDirInput, useTitleCheckbox, previewEl, data.title);
      });

      // 实现拖动功能
      const header = panel.querySelector('.chaospace-float-header');
      let isDragging = false;
      let currentX = 0;
      let currentY = 0;
      let initialX = 0;
      let initialY = 0;

      header.addEventListener('mousedown', (e) => {
        // 如果点击的是折叠按钮,不触发拖动
        if (e.target.closest('.chaospace-float-minimize')) {
          return;
        }

        isDragging = true;

        const rect = panel.getBoundingClientRect();
        initialX = e.clientX - rect.left;
        initialY = e.clientY - rect.top;

        panel.style.transition = 'none';
        header.style.cursor = 'grabbing';
      });

      document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;

        e.preventDefault();

        currentX = e.clientX - initialX;
        currentY = e.clientY - initialY;

        // 限制在视口内
        const maxX = window.innerWidth - panel.offsetWidth;
        const maxY = window.innerHeight - panel.offsetHeight;

        currentX = Math.max(0, Math.min(currentX, maxX));
        currentY = Math.max(0, Math.min(currentY, maxY));

        panel.style.left = currentX + 'px';
        panel.style.top = currentY + 'px';
        panel.style.right = 'auto';
        panel.style.transform = 'none';
      });

      document.addEventListener('mouseup', () => {
        if (isDragging) {
          isDragging = false;
          panel.style.transition = '';
          header.style.cursor = 'move';

          // 保存位置
          const rect = panel.getBoundingClientRect();
          chrome.storage.local.set({
            [POSITION_KEY]: {
              left: rect.left,
              top: rect.top
            }
          });
        }
      });

      console.log('[Chaospace] Floating panel created');
    } catch (error) {
      console.error('[Chaospace] Failed to create floating panel:', error);
      showToast('error', '创建面板失败', error.message);
    }
  }

  function toggleFloatingPanel() {
    if (floatingPanel) {
      floatingPanel.remove();
      floatingPanel = null;
    } else {
      createFloatingPanel();
    }
  }

  function injectStyles() {
    if (document.getElementById('chaospace-float-styles')) {
      return;
    }

    try {
      const link = document.createElement('link');
      link.id = 'chaospace-float-styles';
      link.rel = 'stylesheet';
      link.href = chrome.runtime.getURL('floatingButton.css');

      if (document.head) {
        document.head.appendChild(link);
      }
    } catch (error) {
      console.error('[Chaospace] Failed to inject styles:', error);
    }
  }

  function isSeasonPage() {
    return /\/seasons\/\d+\.html/.test(window.location.pathname);
  }

  function init() {
    if (!isSeasonPage()) {
      return;
    }

    try {
      injectStyles();

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
          setTimeout(createFloatingPanel, 800);
        });
      } else {
        setTimeout(createFloatingPanel, 800);
      }

      // 监听 DOM 变化,如果窗口被移除且有资源则重新创建
      let observerTimeout = null;
      const observer = new MutationObserver(() => {
        if (observerTimeout) {
          clearTimeout(observerTimeout);
        }

        observerTimeout = setTimeout(() => {
          try {
            if (!floatingPanel) {
              const data = collectLinks();
              if (data.items && data.items.length > 0) {
                createFloatingPanel();
              }
            }
          } catch (error) {
            console.error('[Chaospace] Observer error:', error);
          }
        }, 1000);
      });

      const targetNode = document.body;
      if (targetNode) {
        observer.observe(targetNode, {
          childList: true,
          subtree: true
        });
      }
    } catch (error) {
      console.error('[Chaospace] Init error:', error);
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'chaospace:collect-links') {
      try {
        sendResponse(collectLinks());
      } catch (error) {
        console.error('[Chaospace] Message handler error:', error);
        sendResponse({ items: [], url: '', origin: '', title: '' });
      }
    }
    return false;
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

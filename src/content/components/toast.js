let currentToast = null;

export function showToast(type, title, message, stats = null) {
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
        successStat.textContent = `✅ 成功 · ${stats.success}`;
        statsEl.appendChild(successStat);
      }

      if (stats.failed > 0) {
        const failedStat = document.createElement('div');
        failedStat.className = 'chaospace-toast-stat failed';
        failedStat.textContent = `❌ 失败 · ${stats.failed}`;
        statsEl.appendChild(failedStat);
      }

      if (stats.skipped > 0) {
        const skippedStat = document.createElement('div');
        skippedStat.className = 'chaospace-toast-stat skipped';
        skippedStat.textContent = `🌀 跳过 · ${stats.skipped}`;
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
    console.error('[Chaospace Transfer] Failed to show toast', error);
  }
}

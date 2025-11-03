import {
  ERROR_MESSAGES,
  LOGIN_REDIRECT_COOLDOWN,
  LOGIN_REQUIRED_ERRNOS
} from './constants.js';

let lastLoginRedirectAt = 0;

export function createLoginRequiredError() {
  const error = new Error('检测到百度网盘未登录或会话已过期，请先登录后重试');
  error.code = 'PAN_LOGIN_REQUIRED';
  return error;
}

export function redirectToBaiduLogin(reason = '') {
  const now = Date.now();
  if (lastLoginRedirectAt && now - lastLoginRedirectAt < LOGIN_REDIRECT_COOLDOWN) {
    console.log('[Chaospace Transfer] Skip login redirect due to cooldown', {
      reason,
      lastLoginRedirectAt
    });
    return;
  }
  lastLoginRedirectAt = now;
  const loginUrl = 'https://pan.baidu.com/';
  if (!chrome.tabs || typeof chrome.tabs.create !== 'function') {
    console.warn('[Chaospace Transfer] chrome.tabs API unavailable, cannot open login page');
    return;
  }
  const openLoginTab = () => {
    chrome.tabs.create({ url: loginUrl }, () => {
      if (chrome.runtime.lastError) {
        console.warn('[Chaospace Transfer] Failed to open login tab', chrome.runtime.lastError.message);
      }
    });
  };
  try {
    if (typeof chrome.tabs.query !== 'function') {
      openLoginTab();
      return;
    }
    chrome.tabs.query({ url: 'https://pan.baidu.com/*' }, tabs => {
      if (chrome.runtime.lastError) {
        console.warn('[Chaospace Transfer] tabs.query failed', chrome.runtime.lastError.message);
        openLoginTab();
        return;
      }
      const targetTab = Array.isArray(tabs) && tabs.length ? tabs[0] : null;
      if (!targetTab || typeof chrome.tabs.update !== 'function') {
        openLoginTab();
        return;
      }
      chrome.tabs.update(targetTab.id, { url: loginUrl, active: true }, () => {
        if (chrome.runtime.lastError) {
          console.warn('[Chaospace Transfer] tabs.update failed', chrome.runtime.lastError.message);
          openLoginTab();
        }
      });
    });
  } catch (error) {
    console.warn('[Chaospace Transfer] redirectToBaiduLogin threw error', error);
    openLoginTab();
  }
}

export function maybeHandleLoginRequired(errno, context = '') {
  const numericErrno = Number(errno);
  if (!Number.isFinite(numericErrno) || !LOGIN_REQUIRED_ERRNOS.has(numericErrno)) {
    return false;
  }
  redirectToBaiduLogin(context);
  return true;
}

export function mapErrorMessage(errno, fallback) {
  const numeric = Number(errno);
  if (Number.isFinite(numeric) && ERROR_MESSAGES[numeric]) {
    return ERROR_MESSAGES[numeric];
  }
  return fallback || `发生未知错误：${errno}`;
}

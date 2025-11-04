export const STORAGE_KEY = 'chaospace-transfer-settings';
export const POSITION_KEY = 'chaospace-panel-position';
export const SIZE_KEY = 'chaospace-panel-size';
export const DEFAULT_PRESETS: string[] = ['/视频/番剧', '/视频/影视', '/视频/电影'];
export const MAX_LOG_ENTRIES = 80;
export const HISTORY_KEY = 'chaospace-transfer-history';
export const CACHE_KEY = 'chaospace-transfer-cache';
export const HISTORY_DISPLAY_LIMIT = 6;
export const HISTORY_BATCH_RATE_LIMIT_MS = 3500;
export const HISTORY_FILTERS = ['all', 'series', 'ongoing', 'completed', 'movie'] as const;
export type HistoryFilter = typeof HISTORY_FILTERS[number];
export const TV_SHOW_INITIAL_SEASON_BATCH = 2;
export const ALL_SEASON_TAB_ID = '__all__';
export const NO_SEASON_TAB_ID = '__no-season__';
export const EDGE_HIDE_DELAY = 640;
export const EDGE_HIDE_MIN_PEEK = 44;
export const EDGE_HIDE_MAX_PEEK = 128;
export const EDGE_HIDE_DEFAULT_PEEK = 64;
export const INITIAL_PANEL_DELAY_MS = 60;
export const PANEL_CREATION_RETRY_DELAY_MS = 100;
export const PANEL_CREATION_MAX_ATTEMPTS = 6;
export const PAN_DISK_BASE_URL = 'https://pan.baidu.com/disk/main#/index?category=all&path=';
export const SETTINGS_EXPORT_VERSION = 1;
export const DATA_EXPORT_VERSION = 1;
export const MIN_HISTORY_RATE_LIMIT_MS = 500;
export const MAX_HISTORY_RATE_LIMIT_MS = 60000;

export const CLASSIFICATION_PATH_MAP: Record<string, string> = {
  anime: '/视频/番剧',
  tvshow: '/视频/影视',
  movie: '/视频/电影'
};

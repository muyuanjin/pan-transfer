export const ERROR_MESSAGES: Record<number, string> = {
  [-1]: '链接失效：未获取到 shareid',
  [-2]: '链接失效：未获取到 user_id',
  [-3]: '链接失效：未获取到 fs_id',
  [-4]: '转存失败：无效登录',
  [-6]: '转存失败：请使用无痕模式获取 Cookie',
  [-7]: '转存失败：文件名含非法字符',
  [-8]: '转存失败：已存在同名文件或文件夹',
  [-9]: '链接错误：提取码错误或验证过期',
  [-10]: '转存失败：容量不足',
  [-62]: '链接错误次数过多，请稍后再试',
  [12]: '转存失败：文件数超过限制',
  [20]: '转存失败：容量不足',
  [105]: '转存失败：链接格式不正确',
  [2]: '提取码验证失败或需要验证码',
  [404]: '转存失败：秒传无效',
  [9019]: '转存失败：Access Token 无效',
  [20010]: '转存失败：应用授权失败',
  [31039]: '转存失败：文件名冲突',
  [31190]: '转存失败：秒传未生效',
  [666]: '已跳过：文件已存在',
}

export const TOKEN_TTL = 10 * 60 * 1000
export const MAX_TRANSFER_ATTEMPTS = 3
export const TRANSFER_RETRYABLE_ERRNOS = new Set<number>([4])
export const DIRECTORY_LIST_PAGE_SIZE = 200
export const LOGIN_REQUIRED_ERRNOS = new Set<number>([-4, -6, 9019, 20010])
export const LOGIN_REDIRECT_COOLDOWN = 60 * 1000

export const STORAGE_KEYS = {
  settings: 'chaospace-transfer-settings',
  cache: 'chaospace-transfer-cache',
  history: 'chaospace-transfer-history',
} as const
export const CACHE_VERSION = 1
export const HISTORY_VERSION = 1
export const MAX_DIRECTORY_CACHE_ENTRIES = 100000
export const MAX_SHARE_CACHE_ENTRIES = 400000
export const MAX_HISTORY_RECORDS = 200000

export const PAN_BASE_HEADERS: Record<string, string> = {
  Accept: 'application/json, text/javascript, */*; q=0.01',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'X-Requested-With': 'XMLHttpRequest',
}

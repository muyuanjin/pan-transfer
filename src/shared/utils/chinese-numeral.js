/**
 * 中文数字转换工具
 */

const CHINESE_NUMERAL_DIGITS = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9
};

const CHINESE_NUMERAL_UNITS = {
  十: { value: 10, section: false },
  百: { value: 100, section: false },
  千: { value: 1000, section: false },
  万: { value: 10000, section: true },
  亿: { value: 100000000, section: true }
};

/**
 * 解析中文数字为阿拉伯数字
 * @param {string} input - 中文数字字符串 (如 "一", "十二", "二十三")
 * @returns {number} - 转换后的数字,解析失败返回 NaN
 *
 * @example
 * parseChineseNumeral('一') // 1
 * parseChineseNumeral('十') // 10
 * parseChineseNumeral('二十三') // 23
 * parseChineseNumeral('四') // 4
 */
export function parseChineseNumeral(input) {
  const text = (input || '').trim();
  if (!text) {
    return NaN;
  }

  let total = 0;
  let section = 0;
  let number = 0;
  let hasValue = false;

  for (const char of text) {
    if (Object.prototype.hasOwnProperty.call(CHINESE_NUMERAL_DIGITS, char)) {
      number = CHINESE_NUMERAL_DIGITS[char];
      hasValue = true;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(CHINESE_NUMERAL_UNITS, char)) {
      const unit = CHINESE_NUMERAL_UNITS[char];
      // 处理 "十" 开头的情况,如 "十一" = 11
      if (!hasValue && number === 0 && unit.value === 10) {
        number = 1;
      }
      if (unit.section) {
        section = (section + number) * unit.value;
        total += section;
        section = 0;
      } else {
        section += (number || 1) * unit.value;
      }
      number = 0;
      hasValue = true;
      continue;
    }
    // 支持混合阿拉伯数字
    if (/\d/.test(char)) {
      number = parseInt(char, 10);
      hasValue = true;
      continue;
    }
  }

  const result = total + section + number;
  return hasValue && result > 0 ? result : NaN;
}

/**
 * 解析季度序数值 (支持中文数字、阿拉伯数字)
 * @param {string} raw - 序数字符串 (如 "一", "1", "四", "4", "十二")
 * @returns {number} - 转换后的数字,解析失败返回 NaN
 *
 * @example
 * resolveSeasonOrdinalValue('一') // 1
 * resolveSeasonOrdinalValue('1') // 1
 * resolveSeasonOrdinalValue('四') // 4
 * resolveSeasonOrdinalValue('4') // 4
 */
export function resolveSeasonOrdinalValue(raw) {
  const token = (raw || '').trim();
  if (!token) {
    return NaN;
  }

  // 优先提取阿拉伯数字
  const digitMatch = token.match(/\d+/);
  if (digitMatch && digitMatch[0]) {
    const value = parseInt(digitMatch[0], 10);
    return Number.isFinite(value) && value > 0 ? value : NaN;
  }

  // 提取中文字符并解析
  const chineseOnly = token.replace(/[^\u4e00-\u9fa5〇两]+/g, '');
  if (chineseOnly) {
    return parseChineseNumeral(chineseOnly);
  }

  return NaN;
}

/**
 * 标准化季度标签,将中文数字转换为阿拉伯数字
 * @param {string} label - 季度标签 (如 "第四季", "第1季")
 * @returns {string} - 标准化后的标签 (如 "第4季", "第1季")
 *
 * @example
 * normalizeSeasonLabel('第四季') // '第4季'
 * normalizeSeasonLabel('第一季') // '第1季'
 * normalizeSeasonLabel('第1季') // '第1季'
 */
export function normalizeSeasonLabel(label) {
  const text = (label || '').trim();
  if (!text) {
    return text;
  }

  // 匹配 "第X季" 格式
  const seasonPattern = /第([\d一二三四五六七八九十百零两]+)季/g;
  const normalized = text.replace(seasonPattern, (match, ordinal) => {
    const value = resolveSeasonOrdinalValue(ordinal);
    if (Number.isFinite(value) && value > 0) {
      return `第${value}季`;
    }
    return match;
  });

  return normalized.trim();
}

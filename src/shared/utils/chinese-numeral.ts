/**
 * 中文数字转换工具
 */

const CHINESE_NUMERAL_DIGITS: Record<string, number> = {
  '零': 0,
  '〇': 0,
  '一': 1,
  '二': 2,
  '两': 2,
  '三': 3,
  '四': 4,
  '五': 5,
  '六': 6,
  '七': 7,
  '八': 8,
  '九': 9
};

const CHINESE_NUMERAL_UNITS: Record<string, { value: number; section: boolean }> = {
  '十': { value: 10, section: false },
  '百': { value: 100, section: false },
  '千': { value: 1000, section: false },
  '万': { value: 10000, section: true },
  '亿': { value: 100000000, section: true }
};

/**
 * 解析中文数字为阿拉伯数字
 */
export function parseChineseNumeral(input: string | null | undefined): number {
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
      const digit = CHINESE_NUMERAL_DIGITS[char as keyof typeof CHINESE_NUMERAL_DIGITS]!;
      number = digit;
      hasValue = true;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(CHINESE_NUMERAL_UNITS, char)) {
      const unit = CHINESE_NUMERAL_UNITS[char as keyof typeof CHINESE_NUMERAL_UNITS]!;
      if (!unit) {
        continue;
      }
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
 */
export function resolveSeasonOrdinalValue(raw: string | null | undefined): number {
  const token = (raw || '').trim();
  if (!token) {
    return NaN;
  }

  const digitMatch = token.match(/\d+/);
  if (digitMatch && digitMatch[0]) {
    const value = parseInt(digitMatch[0], 10);
    return Number.isFinite(value) && value > 0 ? value : NaN;
  }

  const chineseOnly = token.replace(/[^\u4e00-\u9fa5〇两]+/g, '');
  if (chineseOnly) {
    return parseChineseNumeral(chineseOnly);
  }

  return NaN;
}

/**
 * 标准化季度标签,将中文数字转换为阿拉伯数字
 */
export function normalizeSeasonLabel(label: string | null | undefined): string {
  const text = (label || '').trim();
  if (!text) {
    return text;
  }

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

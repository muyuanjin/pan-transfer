export function extractCleanTitle(rawTitle: string | null | undefined): string {
  if (!rawTitle) return '未命名资源'

  let title = rawTitle.trim()

  // 移除 " 提取码 xxxx" 这种后缀
  title = title.replace(/\s*提取码\s+\S+\s*$/gi, '')

  // 移除末尾的 :：及其后面的内容（如 ":第1季"、"：第一季"）
  title = title.replace(/[:：]\s*(第[0-9一二三四五六七八九十百]+季|[Ss]eason\s*\d+|S\d+)\s*$/gi, '')

  // 移除末尾的 " 第X季"、" SXX" 等
  title = title.replace(/\s+(第[0-9一二三四五六七八九十百]+季|[Ss]eason\s*\d+|S\d+)\s*$/gi, '')

  // 移除末尾的单独冒号
  title = title.replace(/[:：]\s*$/, '')

  // 移除多余空格
  title = title.replace(/\s+/g, ' ').trim()

  return title || '未命名资源'
}

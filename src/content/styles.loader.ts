/**
 * 动态加载 CSS 文件，可注入到 Document 或 ShadowRoot。
 * 会复用已存在的样式链接，避免重复插入。
 */
export async function loadCss(
  url: string,
  target: Document | ShadowRoot = document,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const container = target instanceof Document ? target.head : target
    const ownerDocument = target instanceof Document ? target : (target.ownerDocument ?? document)
    const mountPoint = container ?? ownerDocument.head ?? ownerDocument.body
    if (!mountPoint) {
      reject(new Error('Failed to resolve stylesheet mount point'))
      return
    }

    const exists = Array.from(
      mountPoint.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
    ).some((link) => link.href === url)
    if (exists) {
      resolve()
      return
    }

    const link = ownerDocument.createElement('link')
    link.rel = 'stylesheet'
    link.href = url
    link.onload = () => resolve()
    link.onerror = () => reject(new Error(`Failed to load CSS: ${url}`))

    mountPoint.appendChild(link)
  })
}

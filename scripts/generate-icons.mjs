import { createCanvas } from '@napi-rs/canvas'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const sizes = [128, 48, 32, 16]
const outputDir = path.resolve('src/public')

/* 绘制圆角白色背景 */
const drawRoundedBackground = (ctx, size) => {
  const radius = size * 0.22
  ctx.beginPath()
  ctx.moveTo(radius, 0)
  ctx.lineTo(size - radius, 0)
  ctx.quadraticCurveTo(size, 0, size, radius)
  ctx.lineTo(size, size - radius)
  ctx.quadraticCurveTo(size, size, size - radius, size)
  ctx.lineTo(radius, size)
  ctx.quadraticCurveTo(0, size, 0, size - radius)
  ctx.lineTo(0, radius)
  ctx.quadraticCurveTo(0, 0, radius, 0)
  ctx.closePath()

  ctx.fillStyle = '#ffffff'
  ctx.fill()
}

/* 绘制上下两个矩形块 */
const drawBlocks = (ctx, params, color) => {
  const { topX, topY, bottomY, width, height } = params
  ctx.fillStyle = color
  ctx.fillRect(topX, topY, width, height)
  ctx.fillRect(topX, bottomY, width, height)
}

/**
 * 绘制沙漏剪裁路径
 */
const buildHourglassPath = (ctx, params) => {
  const { topX, topY, bottomY, width, height } = params
  const startY = topY + height
  const endY = bottomY
  const midY = (startY + endY) / 2
  const left = topX
  const right = topX + width
  const centerX = (left + right) / 2

  ctx.beginPath()
  ctx.moveTo(left, startY)
  ctx.lineTo(right, startY)
  ctx.quadraticCurveTo(centerX, midY, right, endY)
  ctx.lineTo(left, endY)
  ctx.quadraticCurveTo(centerX, midY, left, startY)
  ctx.closePath()

  return { startY, endY, midY, left, right, centerX }
}

/**
 * 绘制弧形彩虹线条
 */
const drawArcedRainbowConnector = (ctx, params, mode) => {
  const { size } = params
  const { startY, endY, left, right, centerX } = buildHourglassPath(ctx, params)
  ctx.save()
  ctx.clip()

  // 固定线条数量为3条（与48px尺寸保持一致）
  const arcsCount = 3

  const horizontalPad = Math.max(1, Math.round(size * 0.02))
  const leftX = left + horizontalPad
  const rightX = right - horizontalPad
  const usableWidth = Math.max(1, rightX - leftX)

  // 线条粗细仍然按比例缩放，保证视觉协调
  const baseLineWidth = Math.max(0.6, size * 0.012)
  // 降低弧度，更平缓
  const amplitude = Math.max(size * 0.008, (endY - startY) * 0.04)

  const rainbowStops = [
    { offset: 0, color: '#F86CF8' },
    { offset: 0.18, color: '#A259FF' },
    { offset: 0.38, color: '#00C2FF' },
    { offset: 0.58, color: '#56AB2F' },
    { offset: 0.78, color: '#F9D423' },
    { offset: 1, color: '#FF4E50' },
  ]

  for (let i = 0; i < arcsCount; i++) {
    const t = (i + 0.5) / arcsCount
    const y = startY + t * (endY - startY)
    const controlYOffset = amplitude * (0.6 + 0.4 * Math.sin(t * Math.PI))
    const phaseShift = (i / Math.max(1, arcsCount - 1) - 0.5) * usableWidth * 0.02
    const controlX = centerX + phaseShift
    const controlY = y - controlYOffset

    const phase = (i / Math.max(1, arcsCount - 1) - 0.5) * 0.12
    let grad
    if (mode === 'bifrost') {
      grad = ctx.createLinearGradient(
        leftX - usableWidth * phase,
        0,
        rightX + usableWidth * phase,
        0,
      )
      for (const s of rainbowStops) {
        let pos = Math.min(1, Math.max(0, s.offset + phase))
        grad.addColorStop(pos, s.color)
      }
    } else {
      grad = mode
    }

    // 光晕层
    ctx.beginPath()
    ctx.moveTo(leftX, y)
    ctx.quadraticCurveTo(controlX, controlY, rightX, y)
    ctx.lineWidth = baseLineWidth * 2.6
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = grad
    ctx.globalAlpha = mode === 'bifrost' ? 0.18 : 0.35
    ctx.shadowBlur = Math.max(1, baseLineWidth * 1.6)
    ctx.shadowColor = 'rgba(255,255,255,0.12)'
    ctx.stroke()

    // 主体细线
    ctx.beginPath()
    ctx.moveTo(leftX, y)
    ctx.quadraticCurveTo(controlX, controlY, rightX, y)
    ctx.lineWidth = baseLineWidth
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = grad
    ctx.globalAlpha = 1.0
    ctx.shadowBlur = 0
    ctx.stroke()
  }

  ctx.restore()
}

/* 绘制图标核心内容 */
const drawIconContent = (ctx, size, blockColor, middleMode) => {
  const blockWidth = size * 0.6
  const blockHeight = size * 0.12
  const topX = (size - blockWidth) / 2
  const topY = size * 0.2
  const bottomY = size - blockHeight - size * 0.2

  const params = {
    topX,
    topY,
    bottomY,
    width: blockWidth,
    height: blockHeight,
    size,
  }

  drawBlocks(ctx, params, blockColor)
  drawArcedRainbowConnector(ctx, params, middleMode)
}

/* 光泽高光 */
const drawGlossySheen = (ctx, size) => {
  ctx.save()
  ctx.globalAlpha = 0.06
  ctx.fillStyle = 'white'
  const cx = size * 0.45
  const cy = size * 0.24
  const rx = size * 0.46
  const ry = size * 0.18
  ctx.beginPath()
  ctx.ellipse(cx, cy, rx, ry, -0.35, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/* 生成单个图标文件 */
const generateIcon = async (size) => {
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')

  ctx.clearRect(0, 0, size, size)
  drawRoundedBackground(ctx, size)

  const offset = size * 0.03
  const ghostColors = {
    cyan: 'rgba(0, 255, 255, 0.55)',
    magenta: 'rgba(255, 0, 255, 0.55)',
  }

  // 左上青色重影
  ctx.save()
  ctx.translate(-offset, -offset)
  drawIconContent(ctx, size, ghostColors.cyan, ghostColors.cyan)
  ctx.restore()

  // 右下品红重影
  ctx.save()
  ctx.translate(offset, offset)
  drawIconContent(ctx, size, ghostColors.magenta, ghostColors.magenta)
  ctx.restore()

  // 主体
  drawIconContent(ctx, size, '#000000', 'bifrost')

  // 光泽高光
  drawGlossySheen(ctx, size)

  const buffer = canvas.toBuffer('image/png')
  await mkdir(outputDir, { recursive: true })
  const outPath = path.join(outputDir, `icon-${size}.png`)
  await writeFile(outPath, buffer)
  return outPath
}

/* 主函数 */
const main = async () => {
  const results = []
  for (const size of sizes) {
    results.push(await generateIcon(size))
  }
  console.log(`Generated icons: ${results.map((p) => path.basename(p)).join(', ')}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

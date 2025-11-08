import { createCanvas } from '@napi-rs/canvas';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const sizes = [128, 48];
const outputDir = path.resolve('src/public');

const drawRoundedBackground = (ctx, size) => {
  const radius = size * 0.22;
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.lineTo(size - radius, 0);
  ctx.quadraticCurveTo(size, 0, size, radius);
  ctx.lineTo(size, size - radius);
  ctx.quadraticCurveTo(size, size, size - radius, size);
  ctx.lineTo(radius, size);
  ctx.quadraticCurveTo(0, size, 0, size - radius);
  ctx.lineTo(0, radius);
  ctx.quadraticCurveTo(0, 0, radius, 0);

  ctx.fillStyle = '#ffffff';
  ctx.fill();
};

const drawBlock = (ctx, x, y, width, height) => {
  ctx.fillStyle = '#000000';
  ctx.fillRect(x, y, width, height);
};

const drawArrowHead = (ctx, x, y, size, direction) => {
  const sign = direction === 'up' ? -1 : 1;
  ctx.beginPath();
  ctx.moveTo(x, y + sign * size);
  ctx.lineTo(x - size * 0.7, y - sign * size * 0.2);
  ctx.lineTo(x + size * 0.7, y - sign * size * 0.2);
  ctx.closePath();
  ctx.fillStyle = '#000000';
  ctx.fill();
};

const drawMinimalSymbol = (ctx, size) => {
  const blockWidth = size * 0.52;
  const blockHeight = size * 0.13;
  const topX = (size - blockWidth) / 2;
  const bottomX = topX;
  const topY = size * 0.22;
  const bottomY = size - blockHeight - size * 0.22;

  drawBlock(ctx, topX, topY, blockWidth, blockHeight);
  drawBlock(ctx, bottomX, bottomY, blockWidth, blockHeight);

  const lineStart = topY + blockHeight + size * 0.06;
  const lineEnd = bottomY - size * 0.06;
  const lineX = size / 2;
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = size * 0.08;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(lineX, lineStart);
  ctx.lineTo(lineX, lineEnd);
  ctx.stroke();

  drawArrowHead(ctx, lineX, lineStart, size * 0.08, 'up');
  drawArrowHead(ctx, lineX, lineEnd, size * 0.08, 'down');

  ctx.fillStyle = '#000000';
  const connectorWidth = size * 0.18;
  const connectorHeight = size * 0.04;
  ctx.fillRect((size - connectorWidth) / 2, size * 0.48, connectorWidth, connectorHeight);
};

const generateIcon = async (size) => {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, size, size);
  drawRoundedBackground(ctx, size);
  drawMinimalSymbol(ctx, size);

  const buffer = canvas.toBuffer('image/png');
  await mkdir(outputDir, { recursive: true });
  const outPath = path.join(outputDir, `icon-${size}.png`);
  await writeFile(outPath, buffer);
  return outPath;
};

const main = async () => {
  const results = [];
  for (const size of sizes) {
    results.push(await generateIcon(size));
  }
  console.log(`Generated icons: ${results.map((p) => path.basename(p)).join(', ')}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

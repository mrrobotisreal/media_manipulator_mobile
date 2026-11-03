#!/usr/bin/env node
// Renders every launcher / splash / notification / store graphic from the aperture vector data (scripts/aperture.mjs).
//   node scripts/gen-icons.mjs              write the PNGs into assets/
//   node scripts/gen-icons.mjs --check      fail when a committed PNG differs from a fresh render (gate)
//   --dir <path>                            assets directory to write to / check (default: ./assets; used by the test)
import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { apertureGroup, CORAL, INK, svgDocument, WHITE } from './aperture.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FONT = path.join(
  root,
  'node_modules/@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf',
);

/** file (relative to the assets dir), width, height, alpha expected */
export const ASSETS = [
  { file: 'icon.png', width: 1024, height: 1024, alpha: false },
  { file: 'adaptive-foreground.png', width: 432, height: 432, alpha: true },
  { file: 'monochrome.png', width: 432, height: 432, alpha: true },
  { file: 'splash-icon.png', width: 1024, height: 1024, alpha: true },
  { file: 'notification-icon.png', width: 96, height: 96, alpha: true },
  { file: 'store/feature-graphic.png', width: 1024, height: 500, alpha: false },
  { file: 'store/play-icon-512.png', width: 512, height: 512, alpha: true },
];

const png = (svg) => sharp(Buffer.from(svg)).png({ compressionLevel: 9 });
const mark = (size, diameter, color, background) =>
  svgDocument({
    width: size,
    height: size,
    background,
    body: apertureGroup({ cx: size / 2, cy: size / 2, diameter, color }),
  });

async function featureGraphic() {
  const W = 1024;
  const H = 500;
  // Wordmark colours follow components/darkroom/wordmark.tsx: lead in foreground, last word muted.
  const text = sharp({
    text: {
      text: '<span foreground="#ECEFF4">Media</span> <span foreground="#8B95A5">Manipulator</span>',
      font: 'Inter 600',
      fontfile: FONT,
      rgba: true,
      dpi: 300,
    },
  }).png();
  const textBuf = await sharp(await text.toBuffer())
    .resize({ height: 84 })
    .png()
    .toBuffer();
  const tm = await sharp(textBuf).metadata();
  const markD = 150;
  const gap = 36;
  const total = markD + gap + tm.width;
  const left = Math.round((W - total) / 2);
  const base = await png(
    svgDocument({
      width: W,
      height: H,
      background: INK,
      body: apertureGroup({ cx: left + markD / 2, cy: H / 2, diameter: markD, color: CORAL }),
    }),
  ).toBuffer();
  return sharp(base)
    .composite([{ input: textBuf, left: left + markD + gap, top: Math.round((H - tm.height) / 2) }])
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** Fresh render of every asset: Map<file, Buffer>. */
export async function renderAll() {
  const out = new Map();
  // Opaque square, mark ~62 % (also the iOS icon): flatten removes the alpha channel.
  out.set(
    'icon.png',
    await png(mark(1024, 1024 * 0.62, CORAL, INK))
      .removeAlpha()
      .toBuffer(),
  );
  // Android adaptive foreground: 432 canvas, 66 % safe zone = 288; the mark's outer diameter stays inside it.
  out.set('adaptive-foreground.png', await png(mark(432, 264, CORAL)).toBuffer());
  out.set('monochrome.png', await png(mark(432, 264, WHITE)).toBuffer());
  out.set('splash-icon.png', await png(mark(1024, 1024 * 0.8, CORAL)).toBuffer());
  out.set('notification-icon.png', await png(mark(96, 88, WHITE)).toBuffer());
  out.set('store/feature-graphic.png', await featureGraphic());
  // Play listing icon: 32-bit PNG; Play applies its own mask, so full-bleed background.
  out.set(
    'store/play-icon-512.png',
    await png(mark(512, 512 * 0.62, CORAL, INK))
      .ensureAlpha()
      .toBuffer(),
  );
  return out;
}

async function pixelHash(buf) {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  return crypto
    .createHash('sha256')
    .update(`${info.width}x${info.height}x${info.channels}:`)
    .update(data)
    .digest('hex');
}

/** Returns a list of problems (empty = assets match a fresh render and meet the size/alpha spec). */
export async function checkAssets(dir) {
  const problems = [];
  const fresh = await renderAll();
  for (const spec of ASSETS) {
    const p = path.join(dir, spec.file);
    if (!fs.existsSync(p)) {
      problems.push(`${spec.file}: missing`);
      continue;
    }
    const committed = fs.readFileSync(p);
    const meta = await sharp(committed).metadata();
    if (meta.width !== spec.width || meta.height !== spec.height) {
      problems.push(
        `${spec.file}: ${meta.width}x${meta.height}, expected ${spec.width}x${spec.height}`,
      );
    }
    if (meta.format !== 'png') problems.push(`${spec.file}: not a PNG`);
    if (Boolean(meta.hasAlpha) !== spec.alpha) {
      problems.push(
        `${spec.file}: alpha channel ${meta.hasAlpha ? 'present' : 'absent'}, expected ${spec.alpha ? 'present' : 'absent'}`,
      );
    }
    if ((await pixelHash(committed)) !== (await pixelHash(fresh.get(spec.file)))) {
      problems.push(`${spec.file}: differs from a fresh render (run node scripts/gen-icons.mjs)`);
    }
  }
  return problems;
}

async function main() {
  const args = process.argv.slice(2);
  const di = args.indexOf('--dir');
  const dir = di >= 0 ? path.resolve(args[di + 1]) : path.join(root, 'assets');
  if (args.includes('--check')) {
    const problems = await checkAssets(dir);
    if (problems.length) {
      console.error(`gen-icons --check failed:\n  ${problems.join('\n  ')}`);
      process.exit(1);
    }
    console.log(`gen-icons --check: ${ASSETS.length} assets match`);
    return;
  }
  for (const [file, buf] of await renderAll()) {
    const p = path.join(dir, file);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, buf);
    const m = await sharp(buf).metadata();
    console.log(
      `${file.padEnd(30)} ${m.width}x${m.height} alpha=${m.hasAlpha} ${buf.length} bytes`,
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();

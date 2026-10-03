#!/usr/bin/env node
// ── App icons ───────────────────────────────────────────
//
// Draws every icon file from the sidebar's mark (VitalIcon in
// src/components/shell/Sidebar.tsx): a pulse line on a rounded indigo square, in
// the Default theme's colours. Run it again after changing the mark:
//
//   node scripts/make-icons.mjs
//
// It writes
//   src/app/icon.svg          the favicon; switches to the dark theme's colours
//                             when the browser is in dark mode
//   src/app/favicon.ico       16, 32 and 48 px, for browsers without SVG favicons
//   src/app/apple-icon.png    180 px, full bleed: iOS rounds the corners itself
//   public/icons/icon-*.png   the web app manifest's icons (src/app/manifest.ts);
//                             "maskable" is full bleed for Android's own shapes
//
// sharp comes with Next.js, so this needs no install of its own.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// The mark, on the sidebar's 26-unit grid.
const PULSE = 'M5 13.5h3.6l2.2-5.2 3.4 9.4 2.2-4.2H21';
const RADIUS = 7.5;
const LIGHT = { square: '#4453C8', pulse: '#FFFFFF' };
const DARK = { square: '#9DAAFF', pulse: '#0C0D11' };

/** The mark on its rounded square, as the sidebar draws it. Thin lines blur at
 *  favicon sizes, so the smallest sizes draw the pulse a little heavier. */
function roundedSvg({ size, stroke = 1.8, colours = LIGHT, darkColours = null }) {
  const style = darkColours
    ? `<style>.sq{fill:${colours.square}}.pl{stroke:${colours.pulse}}` +
      `@media (prefers-color-scheme: dark){.sq{fill:${darkColours.square}}.pl{stroke:${darkColours.pulse}}}</style>`
    : '';
  const sq = darkColours ? 'class="sq"' : `fill="${colours.square}"`;
  const pl = darkColours ? 'class="pl"' : `stroke="${colours.pulse}"`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 26 26">${style}` +
    `<rect width="26" height="26" rx="${RADIUS}" ${sq}/>` +
    `<path d="${PULSE}" fill="none" ${pl} stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/></svg>\n`
  );
}

/** The mark full bleed, for platforms that cut their own shape (iOS, maskable).
 *  The pulse spans the middle 62% of the width, inside a maskable icon's safe zone. */
function fullBleedSvg(size) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 26 26">` +
    `<rect width="26" height="26" fill="${LIGHT.square}"/>` +
    `<path d="${PULSE}" fill="none" stroke="${LIGHT.pulse}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  );
}

/** Rasterises at a high density and scales down, for clean edges at every size.
 *  Full-bleed icons are saved opaque: iOS fills a transparent pixel with black. */
async function png(svg, size, { opaque = false } = {}) {
  let img = sharp(Buffer.from(svg), { density: 1200 }).resize(size, size);
  if (opaque) img = img.removeAlpha();
  return img.png().toBuffer();
}

/** An .ico of PNG images (every browser that reads .ico reads PNG entries). */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, data } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...images.map(i => i.data)]);
}

function write(rel, data) {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  console.log(`wrote ${rel}`);
}

write('src/app/icon.svg', roundedSvg({ size: 32, colours: LIGHT, darkColours: DARK }));
write(
  'src/app/favicon.ico',
  ico([
    { size: 16, data: await png(roundedSvg({ size: 16, stroke: 2.6 }), 16) },
    { size: 32, data: await png(roundedSvg({ size: 32, stroke: 2.2 }), 32) },
    { size: 48, data: await png(roundedSvg({ size: 48, stroke: 2 }), 48) },
  ]),
);
write('src/app/apple-icon.png', await png(fullBleedSvg(180), 180, { opaque: true }));
write('public/icons/icon-192.png', await png(roundedSvg({ size: 192 }), 192));
write('public/icons/icon-512.png', await png(roundedSvg({ size: 512 }), 512));
write('public/icons/maskable-512.png', await png(fullBleedSvg(512), 512, { opaque: true }));

#!/usr/bin/env node
/**
 * Regenerate raster icon assets from the brand-mark SVG.
 *
 *   node scripts/generate-icons.mjs
 *
 * Outputs:
 *   public/quick-icon-192.png   (PWA manifest)
 *   public/quick-icon-512.png   (PWA manifest)
 *   app/favicon.ico             (32+48 multi-res ICO wrapping PNGs)
 *
 * The SVG used here is path-based (not text) so it renders identically
 * under librsvg regardless of installed fonts.
 *
 * Colors: brand lime #A6DA0F on dark ink #21211B.
 */

import sharp from "sharp";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Path-based Z so we don't depend on system fonts at render time.
// Designed in a 512×512 viewBox. Geometry: a chunky stencil Z with
// a hairline-balanced diagonal that visually matches the SVG favicon.
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" ry="96" fill="#21211B"/>
  <path
    fill="#A6DA0F"
    d="M 144 144
       H 368
       V 208
       L 244 384
       H 368
       V 432
       H 144
       V 368
       L 268 192
       H 144
       Z"
  />
</svg>`;

async function pngBuffer(size) {
  return sharp(Buffer.from(SVG))
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * Build a minimal ICO file that wraps PNG payloads. Modern browsers
 * (and Windows since Vista) accept PNG-in-ICO containers, so we don't
 * need to round-trip through BMP.
 *
 * ICO layout: 6-byte header + N×16-byte directory + N×payload.
 */
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type=1 (ICO)
  header.writeUInt16LE(entries.length, 4);

  const dirSize = 16 * entries.length;
  let offset = 6 + dirSize;

  const dirParts = [];
  for (const { size, png } of entries) {
    const dir = Buffer.alloc(16);
    dir.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 means 256)
    dir.writeUInt8(size >= 256 ? 0 : size, 1); // height
    dir.writeUInt8(0, 2); // color count
    dir.writeUInt8(0, 3); // reserved
    dir.writeUInt16LE(1, 4); // planes
    dir.writeUInt16LE(32, 6); // bits per pixel
    dir.writeUInt32LE(png.length, 8); // size
    dir.writeUInt32LE(offset, 12); // offset
    dirParts.push(dir);
    offset += png.length;
  }

  return Buffer.concat([header, ...dirParts, ...entries.map((e) => e.png)]);
}

async function main() {
  const png192 = await pngBuffer(192);
  const png512 = await pngBuffer(512);
  const png32 = await pngBuffer(32);
  const png48 = await pngBuffer(48);

  await writeFile(join(root, "public/quick-icon-192.png"), png192);
  await writeFile(join(root, "public/quick-icon-512.png"), png512);

  const ico = buildIco([
    { size: 32, png: png32 },
    { size: 48, png: png48 },
  ]);
  await writeFile(join(root, "app/favicon.ico"), ico);

  console.log("Wrote:");
  console.log("  public/quick-icon-192.png  ", png192.length, "bytes");
  console.log("  public/quick-icon-512.png  ", png512.length, "bytes");
  console.log("  app/favicon.ico            ", ico.length, "bytes");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// The Zero "Z" mark, in Figtree ExtraBold, rendered in Chromium with the app's
// own font file so every icon matches. Two styles:
//   tile  (default) — a lime tile with a dark Z, the Get Zero button colours.
//         Every icon: favicons, app/home-screen icons. At 16px it reads in light
//         and dark tab strips alike; the disc shrank to a dark dot.
//   disc  — the dark green disc with a lime ring that the site header and app
//         sidebar draw in CSS. Only where the mark sits beside the wordmark (og.png).
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function markHtml(root, size, { bleed = false, style = "tile" } = {}) {
  const font = readFileSync(join(root, "public/fonts/Figtree-ExtraBold.otf")).toString("base64");
  return `<!doctype html><html><head><style>
  @font-face{font-family:Mark;src:url(data:font/otf;base64,${font});font-weight:800}
  html,body{margin:0;width:${size}px;height:${size}px;background:${bleed ? (style === "disc" ? "#0c180a" : "#b6f23a") : "transparent"}}
  .m{width:${size}px;height:${size}px;display:grid;place-items:center;box-sizing:border-box;
    padding-top:${Math.round(size * 0.02)}px;${style === "disc" ? disc(size, bleed) : tile(size, bleed)}}
</style></head><body><div class="m">Z</div></body></html>`;
}

function tile(size, bleed) {
  // Bleed icons get rounded by the OS, so the Z stays inside its safe zone.
  return `border-radius:${bleed ? 0 : "24%"};background:linear-gradient(180deg,#c4f75a,#a6e22a);
    color:#0c180a;font:800 ${Math.round(size * (bleed ? 0.56 : 0.62))}px/1 Mark;`;
}

function disc(size, bleed) {
  return `border-radius:${bleed ? 0 : "50%"};background:radial-gradient(circle at 30% 25%,#1f3a16,#0c180a);
    box-shadow:inset 0 0 0 ${Math.max(1, Math.round(size / 30))}px rgba(182,242,58,.45);
    color:#b6f23a;font:800 ${Math.round(size * 0.5)}px/1 Mark;`;
}

// Render the mark to a PNG buffer. `bleed` fills the square (for OS-rounded
// touch and app icons); otherwise the shape sits on a transparent background.
export async function renderMark(browser, root, size, opts = {}) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(markHtml(root, size, opts));
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot({ omitBackground: !opts.bleed });
  await page.close();
  return png;
}

// Pack PNG images into a .ico (PNG-compressed entries, supported everywhere
// that matters).
export function pngsToIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  entries.forEach(({ size, png }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt8(0, o + 2);
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

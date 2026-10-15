#!/usr/bin/env node
// Regenerate every icon from the Z mark (scripts/lib/z-mark.mjs):
//   app/favicon.ico (32 + 48), app/icon.png, app/apple-icon.png,
//   public/quick-icon-{192,512}.png (the /quick PWA),
//   site/favicon-{32,192}.png and site/apple-touch-icon.png (the launch site)
//   npm run icons
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { renderMark, pngsToIco } from "./lib/z-mark.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const browser = await chromium.launch();
const out = (file, buf) => {
  writeFileSync(join(ROOT, file), buf);
  console.log(`  ${file}`);
};

out("app/favicon.ico", pngsToIco([
  { size: 32, png: await renderMark(browser, ROOT, 32) },
  { size: 48, png: await renderMark(browser, ROOT, 48) },
]));
out("app/icon.png", await renderMark(browser, ROOT, 192));
out("app/apple-icon.png", await renderMark(browser, ROOT, 180, { bleed: true }));
out("public/quick-icon-192.png", await renderMark(browser, ROOT, 192, { bleed: true }));
out("public/quick-icon-512.png", await renderMark(browser, ROOT, 512, { bleed: true }));
out("site/favicon-32.png", await renderMark(browser, ROOT, 32));
out("site/favicon-192.png", await renderMark(browser, ROOT, 192));
out("site/apple-touch-icon.png", await renderMark(browser, ROOT, 180, { bleed: true }));

await browser.close();

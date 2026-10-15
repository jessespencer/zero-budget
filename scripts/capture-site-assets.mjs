#!/usr/bin/env node
// Regenerate the launch site's images from a running Zero instance:
//   - product screenshots in dark and light (site/assets/*.webp, 2x, WebP)
//   - the social preview (site/og.png), its Z drawn as the header's disc
//   - the README footer (docs/images/wordmark{,-light}.webp): the site
//     footer's "zero" wordmark (the README's top image is og.png)
// (The site's favicons come from `npm run icons`, with the app's.)
//
// Point it at an app serving the seed:dev demo data, never real data:
//   npm run seed:dev && npm run dev                 # app on :3000
//   npm run site:assets                             # or SITE_APP_URL=http://localhost:3103 npm run site:assets
//
// Uses Playwright's Chromium (already a dev dependency) for capture, cropping,
// and WebP encoding, so it needs no image tools installed.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { renderMark } from "./lib/z-mark.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SITE = join(ROOT, "site");
const ASSETS = join(SITE, "assets");
const APP = (process.env.SITE_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const QUALITY = 0.86;

const SCREENS = [
  { name: "budget", path: "/budget" },
  { name: "transfer-plan", path: "/transfer-plan", crop: { name: "transfer-plan-crop", x: 540, y: 0, w: 2240, h: 1680 } },
  { name: "transactions", path: "/transactions" },
  { name: "insights", path: "/insights" },
  { name: "quick", path: "/quick", viewport: { width: 390, height: 844 } },
];
// Hide dev-only chrome: the dev-mode banner and the Next.js dev indicator.
const HIDE_DEV = `[aria-label="Development mode"]{display:none!important} :root{--zero-banner-h:0px!important} nextjs-portal{display:none!important}`;

const browser = await chromium.launch();

// Encode a PNG buffer (optionally cropped) to WebP inside Chromium.
const encoder = await browser.newPage();
async function toWebp(png, crop) {
  const src = `data:image/png;base64,${png.toString("base64")}`;
  const dataUrl = await encoder.evaluate(
    async ([src, crop, q]) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement("canvas");
      const { x = 0, y = 0, w = img.naturalWidth, h = img.naturalHeight } = crop ?? {};
      c.width = w;
      c.height = h;
      c.getContext("2d").drawImage(img, x, y, w, h, 0, 0, w, h);
      return c.toDataURL("image/webp", q);
    },
    [src, crop ?? null, QUALITY]
  );
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

for (const theme of ["dark", "light"]) {
  const suffix = theme === "light" ? "-light" : "";
  for (const s of SCREENS) {
    const ctx = await browser.newContext({
      viewport: s.viewport ?? { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      colorScheme: theme,
    });
    await ctx.addInitScript((t) => {
      try { localStorage.setItem("theme", t); } catch {}
    }, theme);
    const page = await ctx.newPage();
    await page.goto(`${APP}${s.path}`);
    await page.waitForLoadState("networkidle");
    await page.addStyleTag({ content: HIDE_DEV });
    await page.waitForTimeout(900);
    const png = await page.screenshot();
    writeFileSync(join(ASSETS, `${s.name}${suffix}.webp`), await toWebp(png));
    if (s.crop) writeFileSync(join(ASSETS, `${s.crop.name}${suffix}.webp`), await toWebp(png, s.crop));
    await ctx.close();
    console.log(`  ${s.name}${suffix}.webp`);
  }
}

// The og image's mark sits beside the wordmark, so it's the header's disc.
const markDataUrl = `data:image/png;base64,${(await renderMark(browser, ROOT, 192, { style: "disc" })).toString("base64")}`;

// Social preview, 1200x630: headline beside the budget screen.
const shot = readFileSync(join(ASSETS, "budget.webp")).toString("base64");
const og = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await og.setContent(`<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@600;800&display=swap" rel="stylesheet">
<style>
  html,body{margin:0;width:1200px;height:630px;overflow:hidden;background:#060908;font-family:Figtree,sans-serif;color:#eef3ec}
  .beams{position:absolute;inset:-30% -20% 0 10%;filter:blur(16px);opacity:.9}
  .beam{position:absolute;top:-10%;height:130%;border-radius:999px;transform:rotate(38deg);
    background:linear-gradient(180deg,transparent,rgba(214,255,120,.9) 30%,rgba(160,230,60,.7) 50%,rgba(40,120,50,.35) 72%,transparent)}
  .veil{position:absolute;inset:0;background:linear-gradient(90deg,#060908 34%,rgba(6,9,8,.55) 62%,rgba(6,9,8,.2))}
  .copy{position:absolute;left:72px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;width:560px}
  .brand{display:flex;align-items:center;gap:14px;font-weight:800;font-size:30px}
  .brand img{width:52px;height:52px}
  h1{margin:34px 0 0;font-size:86px;line-height:.95;font-weight:800;letter-spacing:-.045em;
    background:linear-gradient(180deg,#fff 30%,#b9c4b6);-webkit-background-clip:text;color:transparent}
  p{margin:26px 0 0;font-size:25px;line-height:1.4;color:#9aa499;font-weight:600}
  .win{position:absolute;left:640px;top:96px;width:900px;border-radius:18px;overflow:hidden;
    box-shadow:0 0 0 1px rgba(255,255,255,.12),0 40px 100px -20px #000,0 0 80px -20px rgba(182,242,58,.35)}
  .win img{display:block;width:100%}
</style></head><body>
<div class="beams"><span class="beam" style="left:40%;width:120px"></span><span class="beam" style="left:50%;width:40px;opacity:.7"></span><span class="beam" style="left:58%;width:90px;opacity:.6"></span><span class="beam" style="left:68%;width:28px;opacity:.5"></span></div>
<div class="win"><img src="data:image/webp;base64,${shot}"></div>
<div class="veil"></div>
<div class="copy">
  <div class="brand"><img src="${markDataUrl}">Zero</div>
  <h1>Budget down<br>to zero.</h1>
  <p>Personal budgeting that lives on your computer, not in someone's cloud.</p>
</div>
</body></html>`);
await og.waitForLoadState("networkidle");
await og.waitForTimeout(500);
await og.screenshot({ path: join(SITE, "og.png") });

const DOCS_IMAGES = join(ROOT, "docs", "images");
mkdirSync(DOCS_IMAGES, { recursive: true });
const siteUrl = (f) => pathToFileURL(join(SITE, f)).href;

// README footer: the site footer's chunky "zero" wordmark, as the site draws
// it (its colours, glow and bottom crop) — no aurora.
// docs/images/wordmark{,-light}.webp.
const wordmarkHtml = (theme) => `<!doctype html><html${theme === "light" ? ' data-theme="light"' : ""}><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${siteUrl("styles.css")}">
<style>
  *,*::before,*::after{animation:none!important;transition:none!important}
  html,body{margin:0;width:1600px;height:420px;overflow:hidden;background:var(--bg)}
  .stage{width:1600px;height:420px;overflow:hidden;display:grid;place-items:end center}
  /* The footer's .wordmark at a fixed size. Right padding: the tight tracking
     pushes the "o" past its own box, and background-clip:text only paints
     inside it. */
  .stage .wordmark{margin:0;font-size:540px;padding:0 0.09em 0 0.02em}
</style></head><body><div class="stage"><div class="wordmark">zero</div></div></body></html>`;
for (const theme of ["dark", "light"]) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 420 }, deviceScaleFactor: 2, colorScheme: theme });
  const tmp = join(tmpdir(), `zero-readme-wordmark-${theme}.html`);
  writeFileSync(tmp, wordmarkHtml(theme));
  await page.goto(pathToFileURL(tmp).href);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
  writeFileSync(join(DOCS_IMAGES, `wordmark${theme === "light" ? "-light" : ""}.webp`), await toWebp(await page.screenshot()));
  rmSync(tmp);
  await page.close();
}

await browser.close();
console.log("Site assets updated from", APP);

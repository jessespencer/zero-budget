// Zero launch site — progressive enhancement only; the page works without JS.

// The public repository. Every GitHub, Security and Contributing link on every
// page points at it; while it's empty those links are marked "available at
// launch" instead of going nowhere.
const REPO_URL = "https://github.com/jessespencer/zero-budget";

document.querySelectorAll("[data-github], [data-repo-file]").forEach((a) => {
  if (REPO_URL) {
    const file = a.dataset.repoFile;
    a.href = file ? `${REPO_URL}/blob/main/${file}` : REPO_URL;
    a.target = "_blank";
    a.rel = "noopener";
  } else {
    a.classList.add("is-pending");
    a.setAttribute("aria-disabled", "true");
    a.title = "Available at launch";
    a.addEventListener("click", (e) => e.preventDefault());
  }
});

// Theme: "system" (the default) follows the OS setting live. Light or Dark
// overrides it for this tab only (sessionStorage), so every new visit starts
// from the system again. The <head> script applies it before first paint.
// Every screenshot swaps to the matching app theme (each <img> has an
// .only-dark / .only-light twin).
const root = document.documentElement;
const themeColor = document.querySelector('meta[name="theme-color"]');
const choices = document.querySelectorAll("[data-theme-choice]");
const systemLight = window.matchMedia("(prefers-color-scheme: light)");
const KEY = "zero-site-theme";

function choice() {
  try {
    const v = sessionStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch { return "system"; }
}
function render() {
  const c = choice();
  const theme = c === "system" ? (systemLight.matches ? "light" : "dark") : c;
  if (theme === "light") root.dataset.theme = "light";
  else delete root.dataset.theme;
  themeColor?.setAttribute("content", theme === "light" ? "#eef2ee" : "#060908");
  choices.forEach((b) => b.setAttribute("aria-checked", String(b.dataset.themeChoice === c)));
}
choices.forEach((b) =>
  b.addEventListener("click", () => {
    try {
      if (b.dataset.themeChoice === "system") sessionStorage.removeItem(KEY);
      else sessionStorage.setItem(KEY, b.dataset.themeChoice);
    } catch {}
    render();
  })
);
systemLight.addEventListener("change", render);
render();

// Mobile menu.
const menuBtn = document.querySelector("[data-menu-toggle]");
const menu = document.querySelector("[data-menu]");
function setMenu(open) {
  if (!menu || !menuBtn) return;
  menu.hidden = !open;
  menuBtn.setAttribute("aria-expanded", String(open));
  menuBtn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
}
menuBtn?.addEventListener("click", () => setMenu(menu.hidden));
menu?.addEventListener("click", (e) => { if (e.target.closest("a")) setMenu(false); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") setMenu(false); });
document.addEventListener("click", (e) => {
  if (menu && !menu.hidden && !menu.contains(e.target) && !menuBtn.contains(e.target)) setMenu(false);
});

// Product tour: tabs swap the screenshot in the window and the caption below.
const CAPTIONS = {
  demo:
    "<b>A month in Zero.</b> Know where every dollar goes, and what to move.",
  budget:
    "<b>Every dollar assigned.</b> Ready to assign lands on $0.",
  "transfer-plan":
    "<b>A checklist, not a guess.</b> The exact transfers to make.",
  transactions:
    "<b>A fast ledger.</b> Search, split, bulk-edit or import a CSV.",
  insights:
    "<b>The long view.</b> Net worth and where the money went.",
};

const demo = document.querySelector("[data-demo]");
const demoVideo = document.querySelector("[data-demo-video]");
const tabs = document.querySelectorAll("[data-tab]");
const shots = document.querySelectorAll("[data-shot]");
const caption = document.querySelector("[data-caption]");
const url = document.querySelector("[data-url]");

function select(name) {
  tabs.forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === name)));
  shots.forEach((s) => s.classList.toggle("is-active", s.dataset.shot === name));
  if (caption) caption.innerHTML = CAPTIONS[name];
  if (url) url.textContent = name === "demo" ? "Tour" : document.querySelector(`[data-tab="${name}"]`)?.textContent.trim() ?? "";
  if (name !== "demo") demoVideo?.pause();
}
tabs.forEach((t) => t.addEventListener("click", () => select(t.dataset.tab)));

// Copy the install commands without the prompts and the success line.
const copyBtn = document.querySelector("[data-copy]");
const source = document.querySelector("[data-copy-source]");
copyBtn?.addEventListener("click", async () => {
  const text = source.innerText
    .split("\n")
    .filter((line) => line.startsWith("$"))
    .map((line) => line.replace(/^\$\s*/, ""))
    .join("\n");
  try {
    await navigator.clipboard.writeText(text);
    copyBtn.textContent = "Copied";
  } catch {
    copyBtn.textContent = "Select and copy";
  }
  setTimeout(() => (copyBtn.textContent = "Copy"), 1800);
});

// Fade sections in as they scroll into view.
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add("is-in");
        io.unobserve(e.target);
      }
    }
  },
  { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
);
document.querySelectorAll(".reveal").forEach((el) => io.observe(el));

// Product demo (the first tour tab): show the player once a recording exists
// at assets/demo.mp4; until then the placeholder stays.
demoVideo?.addEventListener("loadedmetadata", () => demo?.classList.add("has-video"));

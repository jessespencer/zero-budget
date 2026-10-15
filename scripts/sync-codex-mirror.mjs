// Regenerate the Codex mirror of the agent config from the Claude originals.
//
// .claude/ is the source of truth; never edit the mirror by hand.
//   .claude/skills/        -> .agents/skills/     verbatim, except in Markdown:
//                                                  .claude/skills/ -> .agents/skills/
//                                                  CLAUDE.md       -> AGENTS.md
//
//   node scripts/sync-codex-mirror.mjs          rewrite the mirror to match
//   node scripts/sync-codex-mirror.mjs --check  exit 1 and print the diff if it has drifted

import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const MIRRORS = [
  { src: ".claude/skills", dst: ".agents/skills", render: renderSkills },
];

const toAgentsMd = (s) => s.replaceAll("CLAUDE.md", "AGENTS.md");

function renderSkills(src, out) {
  fs.cpSync(src, out, { recursive: true });
  for (const rel of fs.readdirSync(out, { recursive: true })) {
    const file = path.join(out, rel);
    if (!rel.endsWith(".md") || !fs.statSync(file).isFile()) continue;
    const text = fs.readFileSync(file, "utf8");
    fs.writeFileSync(file, toAgentsMd(text.replaceAll(".claude/skills/", ".agents/skills/")));
  }
}

const check = process.argv[2] === "--check";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-mirror-"));
let drifted = false;

try {
  for (const { src, dst, render } of MIRRORS) {
    const out = path.join(tmp, dst);
    render(path.join(root, src), out);

    if (check) {
      const diff = spawnSync("diff", ["-r", out, path.join(root, dst)], { encoding: "utf8" });
      if (diff.status !== 0) {
        drifted = true;
        process.stderr.write(diff.stdout.replaceAll(out, `${src} (rendered)`).replaceAll(path.join(root, dst), dst));
      }
      continue;
    }

    fs.rmSync(path.join(root, dst), { recursive: true, force: true });
    fs.mkdirSync(path.dirname(path.join(root, dst)), { recursive: true });
    fs.cpSync(out, path.join(root, dst), { recursive: true });
    console.log(`synced ${dst}/ from ${src}/`);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (drifted) {
  console.error("\nThe Codex mirror has drifted from .claude/ — run: npm run codex:sync");
  process.exit(1);
}

// Regenerates the README images from the demo app: node test/make-readme-images.mjs
import { createReadStream, existsSync, mkdirSync, renameSync, rmSync, mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const demo = path.join(root, "examples", "demo");
const img = path.join(root, "docs");
mkdirSync(img, { recursive: true });
const server = createServer((req, res) => {
  const p = new URL(req.url, "http://x").pathname;
  const file = path.join(demo, p === "/" ? "index.html" : p);
  if (!file.startsWith(demo) || !existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": "text/html" });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
const out = mkdtempSync(path.join(os.tmpdir(), "agent-eyes-img-"));
const env = { ...process.env, DEMO_PASSWORD: "demo-password", TMPDIR: out };
const run = (...args) => new Promise((resolve) => {
  import("node:child_process").then(({ spawn }) => {
    const c = spawn(process.execPath, [path.join(root, "bin", "agent-eyes.mjs"), base, ...args,
      "--config", path.join(demo, "agent-eyes.config.json"), "-o", out], { env, stdio: "inherit" });
    c.on("close", resolve);
  });
});
try {
  await run("glitch=/", "--widths", "1280", "--action", "click:#glitch", "--frames", "8", "--measure", "#a");
  renameSync(path.join(out, "glitch-1280-frames.png"), path.join(img, "frames-glitch.png"));
  await run("snap=/", "--widths", "1280", "--action", "click:#open-snap", "--frames", "8", "--measure", "#snap");
  renameSync(path.join(out, "snap-1280-frames.png"), path.join(img, "frames-snap.png"));
  await run("card=/", "--widths", "680x400", "--element", ".row");
  const before = path.join(out, "before"); mkdirSync(before);
  renameSync(path.join(out, "card-680.png"), path.join(before, "card-680.png"));
  await run("card=/", "--widths", "680x400", "--element", ".row", "--action", "click:#smooth", "--compare", before);
  renameSync(path.join(out, "card-680-compare.png"), path.join(img, "compare.png"));
  await hero();
} finally {
  server.close();
  rmSync(out, { recursive: true, force: true });
}

// The README's first image: the command, what the agent reads back, and the frame strip it can open.
async function hero() {
  const { chromium } = await import("playwright");
  const { readFileSync } = await import("node:fs");
  const strip = readFileSync(path.join(img, "frames-glitch.png")).toString("base64");
  const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const lines = [
    ["cmd", "$ agent-eyes http://localhost:3000 --plan checks.json"],
    ["", ""],
    ["path", "home-1440.png         (1440x900, ~1.6k tokens)"],
    ["path", "home-390.png          (390x844, ~430 tokens)"],
    ["path", "panel-1440-frames.png (984x564, ~740 tokens)"],
    ["", ""],
    ["warn", "home@1440: layout shifted after load: div.cards (+36px down)"],
    ["head", "panel@1440 motion: 18 distinct frames over 507 ms"],
    ["warn", "  ! width shrank from 280 to 200 px mid-motion and came back"],
    ["warn", "  ! flicker: opacity dropped to 0.30 mid-motion and came back"],
    ["warn", "  ! the browser froze for 134 ms while animating"],
    ["prob", "PROBLEMS: home@390: horizontal scroll"],
  ];
  const html = `<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; background: #1d1916; font: 15px/1.6 ui-monospace, "SF Mono", Menlo, Consolas, monospace; color: #e9e1d6; }
    .wrap { display: grid; grid-template-columns: 1fr 470px; gap: 28px; padding: 32px 36px; align-items: center; width: 1280px; box-sizing: border-box; }
    .term { background: #26201c; border: 1px solid #3a322b; border-radius: 12px; padding: 18px 22px; white-space: pre; overflow: hidden; }
    .dots { margin-bottom: 12px; } .dots i { display: inline-block; width: 11px; height: 11px; border-radius: 50%; margin-right: 6px; background: #4a4038; }
    .cmd { color: #f2c48d; } .path { color: #9c8f80; } .head { color: #e9e1d6; } .warn { color: #ff9f6b; } .prob { color: #ff7a6b; }
    figure { margin: 0; } figure img { width: 100%; border-radius: 10px; border: 1px solid #3a322b; display: block; }
    figcaption { color: #9c8f80; font-size: 13px; margin-top: 10px; text-align: center; }
  </style><div class="wrap"><div class="term"><div class="dots"><i></i><i></i><i></i></div>${
    lines.map(([c, t]) => `<div class="${c}">${esc(t) || "&nbsp;"}</div>`).join("")}</div>
    <figure><img src="data:image/png;base64,${strip}"><figcaption>panel-1440-frames.png: the motion, frame by frame</figcaption></figure></div>`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 600 }, deviceScaleFactor: 1 });
  await page.setContent(html);
  await page.locator(".wrap").screenshot({ path: path.join(img, "hero.png") });
  await browser.close();
}

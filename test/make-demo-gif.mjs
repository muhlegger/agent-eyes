// Regenerates docs/demo.gif: an agent changes a panel, looks at it with agent-eyes, reads the finding,
// fixes it and looks again. The tool lines and both frame strips are real output from the demo page
// (examples/demo: #open-snap/#snap is the broken panel, #open-ok/#ok the sliding one), shortened, with the
// measured selector shown as "#panel" in both; the chat lines around them are staged.
//   npm install --no-save gifenc pngjs && node test/make-demo-gif.mjs
import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import gifenc from "gifenc";
import { PNG } from "pngjs";

const { GIFEncoder, quantize, applyPalette } = gifenc;
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const demo = path.join(root, "examples", "demo");
const W = 1000, H = 476;

// 1. Two real runs on the demo page.
const server = createServer((req, res) => {
  const p = new URL(req.url, "http://x").pathname;
  const file = path.join(demo, p === "/" ? "index.html" : p);
  if (!file.startsWith(demo) || !existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": "text/html" });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
const tmp = mkdtempSync(path.join(os.tmpdir(), "agent-eyes-gif-"));
const run = (name, button, panel) => new Promise((resolve) => {
  const out = path.join(tmp, name);
  const c = spawn(process.execPath, [path.join(root, "bin", "agent-eyes.mjs"), base, "-o", out,
    "--config", path.join(demo, "agent-eyes.config.json"), "--plan",
    JSON.stringify([{ name: "panel", route: "/", actions: [`click:${button}`], frames: 8, measure: panel, widths: ["1280"] }])],
  { env: { ...process.env, DEMO_PASSWORD: "demo-password", TMPDIR: tmp } });
  let text = "";
  c.stdout.on("data", (d) => (text += d));
  c.stderr.on("data", (d) => (text += d));
  c.on("close", () => resolve({ text, strip: readFileSync(path.join(out, "panel-1280-frames.png")) }));
});
const broken = await run("broken", "#open-snap", "#snap");
const fixed = await run("fixed", "#open-ok", "#ok");
server.close();
const line = (r, re) => { const m = r.text.split("\n").find((l) => re.test(l)); if (!m) throw new Error(`expected ${re} in:\n${r.text}`); return m; };
const size = (r) => line(r, /panel-1280-frames\.png/).match(/\(.*\)/)[0];
const jump = line(broken, /jumped from/).match(/width jumped from \d+ to \d+ px in a single frame/)[0];
line(fixed, /no shrink, snap, flicker/); // the fixed panel must come back clean, or the story is not true

// 2. The storyboard: [class, text, typed?].
const L = {
  ask: ["user", "> make the side panel slide open"],
  edit: ["agent", "● Edit panel.css   + transition: width .25s"],
  cmd1: ["cmd", "$ agent-eyes --plan check.json", true],
  p1: ["path", `panel-1280-frames.png  ${size(broken)}`],
  h1: ["head", line(broken, /motion:/).trim()],
  w1: ["warn", `  ! ${jump}`],
  w2: ["warn", "    while other things animated: if it should slide,"],
  w3: ["warn", "    its transition is not running"],
  fix: ["agent", "● It never runs: a later rule replaces it. Fixing."],
  cmd2: ["cmd", "$ agent-eyes --plan check.json", true],
  p2: ["path", `panel-1280-frames.png  ${size(fixed)}`],
  h2: ["head", line(fixed, /motion:/).trim()],
  g1: ["good", '  "#panel": no shrink, snap, flicker or detour'],
  done: ["agent", "● The panel slides open now."],
};
const order = Object.keys(L);
const steps = []; // { shown: {key: chars}, strip, ms }
const shown = {};
const push = (ms, strip) => steps.push({ shown: { ...shown }, strip, ms });
let strip = 0;
const show = (key, ms) => { shown[key] = Infinity; push(ms, strip); };
const type = (key, chunk, ms) => {
  const n = L[key][1].length;
  for (let i = 2; i < n; i += chunk) { shown[key] = i; push(ms, strip); }
  shown[key] = Infinity; push(500, strip);
};
show("ask", 1100); show("edit", 1100);
type("cmd1", 2, 55);
show("p1", 140); show("h1", 300);
strip = 1; shown.w1 = shown.w2 = Infinity; show("w3", 3800);
show("fix", 1700);
type("cmd2", 3, 45);
show("p2", 140); show("h2", 300);
strip = 2; show("g1", 3000);
show("done", 3200);

// 3. Render every step in the browser, encode as a GIF (unchanged pixels become transparent: small file).
const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const html = `<!doctype html><meta charset="utf-8"><style>
  body { margin: 0; width: ${W}px; height: ${H}px; background: #1d1916; color: #e9e1d6; overflow: hidden;
    font: 14px/1.62 ui-monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace; }
  .wrap { display: grid; grid-template-columns: 1fr 372px; gap: 22px; padding: 26px 28px; height: 100%; box-sizing: border-box; align-items: start; }
  .term { background: #26201c; border: 1px solid #3a322b; border-radius: 12px; padding: 16px 20px; white-space: pre; height: 100%; box-sizing: border-box; overflow: hidden; }
  .dots { margin-bottom: 10px; } .dots i { display: inline-block; width: 11px; height: 11px; border-radius: 50%; margin-right: 6px; background: #4a4038; }
  .l { min-height: 1.62em; } .hide { visibility: hidden; }
  .user { color: #f2c48d; margin-bottom: 6px; } .agent { color: #e9e1d6; margin: 6px 0; }
  .cmd { color: #f2c48d; } .path { color: #9c8f80; } .head { color: #e9e1d6; } .warn { color: #ff9f6b; } .good { color: #a6d08f; }
  .side { display: flex; flex-direction: column; gap: 10px; }
  .cap { color: #9c8f80; font-size: 12.5px; }
  .box { border: 1px solid #3a322b; border-radius: 10px; aspect-ratio: 864 / 564; background: #26201c; overflow: hidden; display: grid; place-items: center; color: #5d5148; font-size: 12.5px; }
  .box img { width: 100%; height: 100%; object-fit: contain; display: none; }
  .verdict { font-size: 13px; min-height: 3.3em; white-space: normal; line-height: 1.5; }
</style><div class="wrap">
  <div class="term"><div class="dots"><i></i><i></i><i></i></div>${
    order.map((k) => `<div class="l ${L[k][0]} hide" data-k="${k}">${esc(L[k][1])}</div>`).join("")}</div>
  <div class="side">
    <div class="cap">the motion, frame by frame (one image)</div>
    <div class="box"><span id="empty">no capture yet</span>
      <img id="s1" src="data:image/png;base64,${broken.strip.toString("base64")}">
      <img id="s2" src="data:image/png;base64,${fixed.strip.toString("base64")}"></div>
    <div class="verdict" id="verdict"></div>
  </div></div>
<script>
  const text = ${JSON.stringify(Object.fromEntries(order.map((k) => [k, L[k][1]])))};
  const verdict = ["", '<span style="color:#ff9f6b">second frame: already at full width.</span> The CSS says it slides; watching it shows it does not.',
    '<span style="color:#a6d08f">now it grows:</span> narrow, half, full. Checked before saying "done".'];
  window.render = (s) => {
    for (const el of document.querySelectorAll("[data-k]")) {
      const n = s.shown[el.dataset.k];
      el.classList.toggle("hide", n === undefined);
      if (n !== undefined) el.textContent = n === null ? text[el.dataset.k] : text[el.dataset.k].slice(0, n) + "\\u2588";
    }
    document.getElementById("empty").style.display = s.strip ? "none" : "";
    document.getElementById("s1").style.display = s.strip === 1 ? "block" : "none";
    document.getElementById("s2").style.display = s.strip === 2 ? "block" : "none";
    document.getElementById("verdict").innerHTML = verdict[s.strip];
  };
</script>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.setContent(html);
const shots = [];
for (const s of steps) {
  // Infinity does not survive JSON: null means "the whole line".
  await page.evaluate((st) => window.render(st), { ...s, shown: Object.fromEntries(Object.entries(s.shown).map(([k, v]) => [k, v === Infinity ? null : v])) });
  shots.push(PNG.sync.read(await page.screenshot({ type: "png" })).data);
}
await browser.close();
rmSync(tmp, { recursive: true, force: true });

// One palette for the whole film (from the frames where each strip is on screen), 255 colors + transparent.
const keyFrames = [steps.findIndex((s) => s.strip === 1), steps.findIndex((s) => s.strip === 2), steps.length - 1];
const sample = Buffer.concat(keyFrames.map((i) => shots[i]));
if (process.env.KEYFRAMES) keyFrames.forEach((i, n) => { // to look at the result without playing the GIF
  const png = new PNG({ width: W, height: H }); png.data = shots[i];
  writeFileSync(path.join(process.env.KEYFRAMES, `key-${n + 1}.png`), PNG.sync.write(png));
});
const palette = quantize(sample, 255);
const TRANSPARENT = palette.length;
const gif = GIFEncoder();
let prev = null;
shots.forEach((rgba, i) => {
  const index = applyPalette(rgba, palette);
  if (prev) for (let p = 0, q = 0; p < index.length; p++, q += 4) {
    if (rgba[q] === prev[q] && rgba[q + 1] === prev[q + 1] && rgba[q + 2] === prev[q + 2]) index[p] = TRANSPARENT;
  }
  gif.writeFrame(index, W, H, { palette: i === 0 ? [...palette, [0, 0, 0]] : undefined, delay: steps[i].ms,
    transparent: i > 0, transparentIndex: TRANSPARENT, dispose: 1, repeat: 0 });
  prev = rgba;
});
gif.finish();
const out = path.join(root, "docs", "demo.gif");
writeFileSync(out, gif.bytes());
console.log(`${out}: ${steps.length} frames, ${(steps.reduce((s, x) => s + x.ms, 0) / 1000).toFixed(1)} s, ${(gif.bytes().length / 1024).toFixed(0)} kB`);

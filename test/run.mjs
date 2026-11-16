// End-to-end check on the demo app: login, actions, compare, and motion (a glitch must be flagged,
// a smooth animation must not). Run with: npm test
import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const demo = path.join(root, "examples", "demo");
const server = createServer((req, res) => {
  const p = new URL(req.url, "http://x").pathname;
  const file = path.join(demo, p === "/" ? "index.html" : p);
  if (!file.startsWith(demo) || !existsSync(file)) { res.writeHead(404).end("not found"); return; }
  res.writeHead(200, { "content-type": file.endsWith(".html") ? "text/html" : "application/json" });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
const out = mkdtempSync(path.join(os.tmpdir(), "agent-eyes-test-"));
const env = { ...process.env, DEMO_PASSWORD: "demo-password", TMPDIR: out }; // fresh session: the login runs
let failures = 0;

async function check(name, args, { want = [], not = [] }) {
  // "-o out" goes first so a test can point -o elsewhere (the last one wins)
  const child = spawn(process.execPath, [path.join(root, "bin", "agent-eyes.mjs"), base, "-o", out,
    "--config", path.join(demo, "agent-eyes.config.json"), ...args], { env });
  let text = "";
  child.stdout.on("data", (d) => (text += d));
  child.stderr.on("data", (d) => (text += d));
  await new Promise((r) => child.on("close", r));
  const has = (w) => (w instanceof RegExp ? w.test(text) : text.includes(w));
  const ok = want.every(has) && !not.some(has);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) { failures++; console.log(text.trim().split("\n").map((l) => `     ${l}`).join("\n")); }
}

try {
  await check("logs in and takes screenshots at two widths", ["home=/", "--action", "hover:#glitch"],
    { want: ["home-1280.png", "home-390.png", "actions ok"] }); // #glitch exists only after the login
  await check('types into an attribute selector (the "=" inside [] is not the separator)',
    ["search=/", "--widths", "1280", "--action", 'type:input[data-field="search"]=hello', "--element", "label"],
    { want: ["search-1280.png", "actions ok"] });
  await check("reports an action that does not find its target",
    ["missing=/", "--widths", "1280", "--action", "click:text=Nope"], { want: ['action "click:text=Nope" failed'] });
  const before = path.join(out, "before");
  await check("takes a baseline into another folder", ["home=/", "--widths", "1280", "-o", before],
    { want: [path.join(before, "home-1280.png")] });
  await check("says identical when nothing changed (no image to read)", ["home=/", "--widths", "1280", "--compare", before],
    { want: ["identical to"], not: ["home-1280-compare.png"] });
  await check("boxes what changed", ["home=/", "--widths", "1280", "--action", "click:#smooth", "--compare", before],
    { want: ["home-1280-compare.png", "region(s), marked in red"] });
  await check("prints what each image costs to read", ["home=/", "--widths", "1280", "--element", "h1"],
    { want: [/home-1280\.png {2}\(\d+x\d+, ~\d+ tokens\)/] });
  await check("flags content that moved after load", ["shift=/shift.html", "--widths", "1280"],
    { want: ["layout shifted after load", 'div#buy "Buy button that moves"'] });
  await check("does not flag a page that does not move", ["home=/", "--widths", "1280"],
    { not: ["layout shifted"] });
  await check("flags a glitchy animation",
    ["glitch=/", "--widths", "1280", "--action", "click:#glitch", "--frames", "8", "--measure", "#a"],
    { want: ["glitch-1280-frames.png", "width shrank from 280", "flicker", "the browser froze"] });
  await check("keeps a smooth animation clean",
    ["smooth=/", "--widths", "1280", "--action", "click:#smooth", "--frames", "6", "--measure", "#b"],
    { want: ["smooth-1280-frames.png", "no shrink, snap, flicker"], not: ["shrank", "flicker:", "froze"] });
  await check("flags a size that snaps in one frame while other things animate (a transition that does not apply)",
    ["snap=/", "--widths", "1280", "--action", "click:#open-snap", "--frames", "6", "--measure", "#snap"],
    { want: [/width jumped from \d+ to 240 px in a single frame/] });
  await check("does not flag the same panel when its width really slides",
    ["slide=/", "--widths", "1280", "--action", "click:#open-ok", "--frames", "6", "--measure", "#ok"],
    { want: ["no shrink, snap, flicker"], not: ["jumped"] });
  await check("says so when the action moved nothing (instead of calling it clean)",
    ["still=/", "--widths", "1280", "--action", "hover:h1", "--frames", "6", "--measure", "h1"],
    { want: ["nothing moved after the action"], not: ["no shrink, snap"] });
  await check("runs a plan: several checks, each with its own actions and widths, in one call",
    ["--plan", JSON.stringify([
      { route: "/", widths: ["390"] },
      { name: "anim", route: "/", actions: ["click:#glitch"], frames: 6, measure: "#a", widths: ["1280"] },
      { route: "/", actions: ["click:#smooth"], widths: ["1280"] },
    ])],
    { want: ["home-390.png", "anim-1280-frames.png", "width shrank from 280", "home-2-1280.png"], not: ["home-1280.png "] });
  await check("a failing check is reported and the others still run",
    ["--widths", "1280", "--plan", JSON.stringify([
      { name: "missing", route: "/", element: "#does-not-exist" },
      { name: "fine", route: "/" },
    ])],
    { want: ['missing@1280: this check failed (element "#does-not-exist" is not on the page', "fine-1280.png"] });

  await check("does not hang on a page that never stops polling, and says what it logged and failed to load",
    ["busy=/busy.html", "--widths", "1280"],
    { want: ["busy-1280.png", "keeps talking to the server", "console error: could not load the user's settings", "requests that failed: 404 /missing.js"] });
  await check("keeps a quiet page free of those notes", ["theme=/theme.html", "--widths", "1280", "-o", before],
    { want: ["no console errors"], not: ["keeps talking", "requests that failed"] });
  await check("shows the page in the dark theme when asked",
    ["theme=/theme.html", "--widths", "1280", "--color-scheme", "dark", "--compare", before], { want: ["theme-1280-compare.png"] });
  await check("and in the light theme otherwise", ["theme=/theme.html", "--widths", "1280", "--compare", before],
    { want: ["identical to"] });

  // The MCP server (agent-eyes mcp): the same runner behind three tools, spoken as JSON-RPC over stdio.
  const child = spawn(process.execPath, [path.join(root, "bin", "agent-eyes.mjs"), "mcp"], { env, cwd: demo });
  const waiting = new Map();
  let buf = "", ids = 0, stray = "";
  child.stdout.on("data", (d) => {
    buf += d;
    for (let i; (i = buf.indexOf("\n")) >= 0; buf = buf.slice(i + 1)) {
      try { const m = JSON.parse(buf.slice(0, i)); waiting.get(m.id)?.(m); } catch { stray += buf.slice(0, i); }
    }
  });
  const rpc = (method, params) => new Promise((ok) => {
    const id = ++ids;
    waiting.set(id, ok);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
  const expect = (name, ok, detail) => {
    console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
    if (!ok) { failures++; console.log(`     ${JSON.stringify(detail).slice(0, 600)}`); }
  };
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  const list = await rpc("tools/list", {});
  expect("mcp: initializes and lists its tools",
    init.result?.protocolVersion === "2025-06-18" && init.result.capabilities.tools &&
    ["check_ui", "view_image", "compare_images"].every((n) => list.result?.tools.some((x) => x.name === n && x.inputSchema)), [init, list]);
  const run = await rpc("tools/call", { name: "check_ui", arguments: { baseUrl: base, out, checks: [
    { name: "mcp", route: "/", actions: ["click:#glitch"], frames: 6, measure: "#a", widths: ["1280"] },
    { route: "/shift.html", widths: ["390"] },
  ] } });
  const said = run.result?.content?.[0]?.text ?? "";
  expect("mcp: check_ui runs several checks and answers in text (logged in from the project's config)",
    !run.result?.isError && ["mcp-1280-frames.png", "width shrank from 280", "layout shifted after load"].every((w) => said.includes(w)), run);
  const img = await rpc("tools/call", { name: "view_image", arguments: { path: path.join(out, "mcp-1280-frames.png") } });
  expect("mcp: view_image hands back the image the agent asked for",
    img.result?.content?.[0]?.type === "image" && img.result.content[0].data.startsWith("iVBOR"), img.result?.content?.[0]?.type);
  const bad = await rpc("tools/call", { name: "check_ui", arguments: { projectDir: out, checks: [{ route: "/" }] } });
  expect("mcp: a run that cannot start is a readable tool result, not a protocol error",
    bad.result?.isError && bad.result.content[0].text.includes("no base URL"), bad);
  const unknown = await rpc("resources/list", {});
  expect("mcp: an unsupported method gets a proper error and nothing else is written to stdout",
    unknown.error?.code === -32601 && !stray, [unknown, stray]);
  child.stdin.end();
  await new Promise((r) => child.on("close", r));
} finally {
  server.close();
  rmSync(out, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);

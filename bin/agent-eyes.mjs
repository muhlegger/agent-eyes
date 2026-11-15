#!/usr/bin/env node
import path from "node:path";
import { chromium } from "playwright";
import { capture } from "../src/capture.mjs";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { diffImages, sideBySide } from "../src/combine.mjs";
import { loadConfig } from "../src/config.mjs";
import { describe } from "../src/tokens.mjs";

const HELP = `agent-eyes: screenshots and motion checks of a web app, in one command.

Usage
  agent-eyes [base-url] <route> [<route>...] [options]
  agent-eyes [base-url] --plan '<json>' [options]   several checks, each with its own actions, in one call
  agent-eyes combine <before.png> <after.png> <out.png> [label A] [label B]
  agent-eyes skill         print the instructions file for AI agents (SKILL.md)
  agent-eyes install       download the browser once (Chromium; add --with-deps on a fresh Linux)

  base-url   e.g. http://localhost:3000 (or "baseUrl" in agent-eyes.config.json)
  route      "/settings" or "name=/settings?tab=2"; "{id}" is replaced by --var id=...

Options
  -o, --out <dir>          where images go (default ./agent-eyes-out)
  --widths <list>          e.g. 1536,375 or 1440x900,390x844 (default 1440,390)
  --full                   the whole page, scrolling, not only the first screen
  --element <selector>     crop the screenshot to one element (smaller image, cheaper to read)
  --action <type:target>   before the screenshot, in order (repeat the option):
                             click:<sel>  hover:<sel>  scroll:<px|sel>  wait:<ms>
                             type:<sel>=<text>  press:<Key>
                           <sel> is a Playwright selector: "text=Save", "button:has-text('Month')", "[data-day]"
  --each-step              also a screenshot after each action, to see the sequence
  --compare <dir>          compare each screenshot with the one of the same name in <dir>, pixel by pixel:
                           "identical" (nothing to look at) or a side-by-side image with the changed
                           regions boxed in red, plus their position and size as text
  --frames [N]             record the MOTION of the last action at real speed (~60 fps) into one image of
                           N frames (default 10), and flag shrink-and-return, snaps, flicker, disappearing,
                           detours and browser freezes. Use with --measure or --element.
  --measure <selector>     the element --frames measures and crops to (default: --element)
  --plan <json|file>       a list of checks run in one call (one browser, one login), each with its own
                           route and options; the options above become the defaults. Example:
                           [{"route":"/orders","widths":["390"]},
                            {"name":"panel","route":"/orders/{id}","actions":["click:text=Details"],
                             "frames":true,"measure":"#details","widths":["1280"]}]
                           keys: name route actions element measure frames full eachStep widths
  --wait <ms>              wait after loading (default 1200)
  --var name=value         fills {name} in routes (repeatable)
  --config <file>          project config (default ./agent-eyes.config.json): login, viewports, locale...
  --storage-state <file>   start from a saved Playwright session (cookies) instead of the login form
  --locale <tag>           e.g. pt-BR      --timezone <zone>   e.g. America/Sao_Paulo
  --wait-for-server <s>    wait up to <s> seconds for the base URL to answer
  --json                   print a JSON summary instead of text
  --strict                 exit 1 when a problem or a motion glitch is found

Actions are real: clicking "save" saves. Point it at a dev or test database.
Output: one image per line with its size and what it costs an agent to read (~tokens, Claude's formula),
then notes (comparisons, content that moved after load), motion notes, and problems (page errors, 5xx,
horizontal scroll, big layout shifts, actions that did not find their target).`;

const argv = process.argv.slice(2);
if (!argv.length || argv.includes("-h") || argv.includes("--help")) { console.log(HELP); process.exit(0); }

if (argv[0] === "install") {
  // Downloads the Chromium build that matches the bundled Playwright (once per machine).
  // playwright does not export its CLI path; its package.json is exported and names it under "bin"
  const pkg = createRequire(import.meta.url).resolve("playwright/package.json");
  const cli = new URL(JSON.parse(readFileSync(pkg, "utf8")).bin.playwright, `file://${pkg}`).pathname;
  const r = spawnSync(process.execPath, [cli, "install", "chromium", ...argv.slice(1)], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}

if (argv[0] === "skill") {
  process.stdout.write(readFileSync(new URL("../skill/SKILL.md", import.meta.url), "utf8"));
  process.exit(0);
}

if (argv[0] === "combine") {
  const [, a, b, out, la, lb] = argv;
  if (!a || !b || !out) { console.error("usage: agent-eyes combine <before.png> <after.png> <out.png> [label A] [label B]"); process.exit(2); }
  const browser = await chromium.launch();
  try {
    const d = await diffImages(browser, a, b);
    if (!d.changedRatio && !d.sizeChanged) console.log("identical (no image written)");
    else {
      console.log(describe(await sideBySide(browser, a, b, out, la, lb, d.regions)));
      console.log(`changed ${(d.changedRatio * 100).toFixed(1)}% of pixels in ${d.totalRegions} region(s), marked in red: ` +
        d.regions.map((r) => `${r.width}x${r.height} at ${r.x},${r.y}`).join("; "));
    }
  } finally { await browser.close(); }
  process.exit(0);
}

const o = { routes: [], actions: [], vars: {}, wait: 1200, full: false, eachStep: false, frames: 0 };
let configFile, widths, json = false, strict = false, base, plan;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const next = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
  switch (a) {
    case "-o": case "--out": o.out = next(); break;
    case "--widths": widths = next().split(","); break;
    case "--full": o.full = true; break;
    case "--element": o.element = next(); break;
    case "--action": o.actions.push(next()); break;
    case "--each-step": o.eachStep = true; break;
    case "--compare": o.compare = next(); break;
    case "--frames": o.frames = /^\d+$/.test(argv[i + 1] ?? "") ? Number(argv[++i]) : 10; break;
    case "--measure": o.measure = next(); break;
    case "--plan": plan = next(); break;
    case "--wait": o.wait = Number(next()); break;
    case "--var": { const [k, ...v] = next().split("="); o.vars[k] = v.join("="); break; }
    case "--config": configFile = next(); break;
    case "--storage-state": o.storageState = next(); break;
    case "--locale": o.locale = next(); break;
    case "--timezone": o.timezone = next(); break;
    case "--wait-for-server": o.waitForServer = Number(next()); break;
    case "--json": json = true; break;
    case "--strict": strict = true; break;
    default:
      if (a.startsWith("-")) { console.error(`unknown option ${a} (see --help)`); process.exit(2); }
      if (/^https?:\/\//.test(a) && !base && !o.routes.length) base = a; else o.routes.push(a);
  }
}

try {
  o.config = loadConfig(configFile);
  o.base = base ?? o.config.baseUrl ?? process.env.BASE_URL;
  if (!o.base) throw new Error("no base URL: pass it first (http://localhost:3000), set BASE_URL or \"baseUrl\" in the config");
  if (!o.routes.length && !plan) o.routes.push("/");
  o.out = path.resolve(o.out ?? o.config.out ?? "agent-eyes-out");
  o.widths = widths ?? o.config.widths ?? ["1440", "390"];
  o.locale ??= o.config.locale;
  o.timezone ??= o.config.timezone;
  o.vars = { ...(o.config.vars ?? {}), ...o.vars };
  const defaults = { actions: o.actions, element: o.element, measure: o.measure, frames: o.frames, full: o.full, eachStep: o.eachStep };
  o.shots = o.routes.map((route) => ({ ...defaults, route }));
  if (plan) {
    const list = JSON.parse(plan.trim().startsWith("[") ? plan : readFileSync(plan, "utf8"));
    if (!Array.isArray(list)) throw new Error("--plan takes a JSON list of checks");
    for (const c of list) {
      if (!c.route) throw new Error(`a --plan check has no "route": ${JSON.stringify(c)}`);
      const w = typeof c.widths === "string" ? c.widths.split(",") : c.widths?.map(String);
      o.shots.push({ ...defaults, ...c, actions: c.actions ?? [], eachStep: c.eachStep ?? c.each_step ?? false,
        route: c.name ? `${c.name}=${c.route}` : c.route, widths: w });
    }
  }
  const r = await capture(o);
  if (json) console.log(JSON.stringify(r, null, 2));
  else {
    for (const f of r.files) console.log(describe(f));
    if (r.notes.length) console.log(r.notes.join("\n"));
    if (r.motion.length) console.log(r.motion.join("\n"));
    console.log(r.problems.length ? `PROBLEMS:\n${r.problems.join("\n")}` : "no page errors, no server errors, no horizontal scroll, actions ok");
  }
  process.exit(strict && (r.problems.length || r.glitch) ? 1 : 0);
} catch (e) {
  const msg = /Executable doesn't exist/.test(e.message)
    ? "the browser is not installed yet: run `agent-eyes install` once (add `--with-deps` on a fresh Linux)"
    : e.message;
  console.error(`agent-eyes: ${msg}`);
  process.exit(2);
}

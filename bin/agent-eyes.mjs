#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { compareFiles } from "../src/combine.mjs";
import { friendly, report, runChecks } from "../src/run.mjs";

const HELP = `agent-eyes: screenshots and motion checks of a web app, in one command.

Usage
  agent-eyes [base-url] <route> [<route>...] [options]
  agent-eyes [base-url] --plan '<json>' [options]   several checks, each with its own actions, in one call
  agent-eyes combine <before.png> <after.png> <out.png> [label A] [label B]
  agent-eyes skill         print the instructions file for AI agents (SKILL.md)
  agent-eyes mcp           run as an MCP server over stdio (Cursor, Windsurf, Claude Desktop, ...)
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
  process.stdout.write(readFileSync(new URL("../skills/agent-eyes/SKILL.md", import.meta.url), "utf8"));
  process.exit(0);
}

if (argv[0] === "mcp") {
  await (await import("../src/mcp.mjs")).serve();
  process.exit(0);
}

if (argv[0] === "combine") {
  const [, a, b, out, la, lb] = argv;
  if (!a || !b || !out) { console.error("usage: agent-eyes combine <before.png> <after.png> <out.png> [label A] [label B]"); process.exit(2); }
  try { console.log(await compareFiles(a, b, out, la, lb)); }
  catch (e) { console.error(`agent-eyes: ${friendly(e)}`); process.exit(2); }
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
  const { routes, vars, out, wait, compare, storageState, locale, timezone, waitForServer, ...defaults } = o;
  const checks = plan && JSON.parse(plan.trim().startsWith("[") ? plan : readFileSync(plan, "utf8"));
  const r = await runChecks({ base, routes, checks, defaults, widths, out, configFile, vars, compare, wait,
    storageState, locale, timezone, waitForServer });
  if (json) console.log(JSON.stringify(r, null, 2));
  else console.log(report(r));
  process.exit(strict && (r.problems.length || r.glitch) ? 1 : 0);
} catch (e) {
  console.error(`agent-eyes: ${friendly(e)}`);
  process.exit(2);
}

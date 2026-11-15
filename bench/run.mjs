// Same UI-checking tasks, done by Claude Code headless (claude -p) with and without agent-eyes.
//   node bench/run.mjs [runs per arm=3] [model=claude-opus-5-5] [effort=high] [label] [tasks=app,toy]
//   results go to bench/results/<date>[-<label>]
//
// Tasks
//   app  bench/task-app.md on bench/app (a small app with a login that works only once its script arrives,
//        late data, client-side navigation, ids to find, and four planted defects the prompt does not name)
//   toy  bench/task.md on examples/demo (one static page; the prompt names what to look at)
// Arms
//   without     Playwright 1.61.1 + Chromium in the folder, nothing else
//   advice      the same, plus bench/advice.md: the checklist the agent-eyes skill implies, as plain text
//   with-first  agent-eyes installed from a packed tarball, its skill in .claude/skills, no config
//   with-repeat the same, with agent-eyes.config.json already written (how a project uses it day to day)
//
// Every run gets a fresh folder and TMPDIR (no saved login, no leftover scripts) and only project settings
// (--setting-sources project: no user hooks, plugins or memories). Apps are served from temp copies, so the
// source an agent can curl does not lead back to this repository. Arms alternate within each round.
import { spawn, spawnSync } from "node:child_process";
import { cpSync, createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [runs = "3", model = "claude-opus-5-5", effort = "high", label = "", only = "app,toy"] = process.argv.slice(2);
const outDir = path.join(root, "bench", "results", new Date().toISOString().slice(0, 10) + (label ? `-${label}` : ""));
mkdirSync(outDir, { recursive: true });
const work = path.join(os.tmpdir(), `ae-bench-${Date.now()}`);
mkdirSync(work, { recursive: true });
const sh = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")}: ${r.stderr || r.stdout}`);
  return r.stdout.trim();
};

// Playwright for the arms without agent-eyes (symlinked in, so its setup time is not measured).
const pw = path.join(work, "pw");
sh("npm", ["install", "--prefix", pw, "playwright@1.61.1", "--ignore-scripts", "--no-audit", "--no-fund"]);
// agent-eyes the way a user gets it: a package installed into its own prefix, its bin on PATH.
const tarball = path.join(work, sh("npm", ["pack", root, "--pack-destination", work, "--silent"]).split("\n").pop());
const ae = path.join(work, "ae");
sh("npm", ["install", "--prefix", ae, tarball, "--no-audit", "--no-fund"]);
const aeBin = path.join(ae, "node_modules", ".bin");
const aePath = `${aeBin}:${process.env.PATH}`;
sh("agent-eyes", ["--help"], { env: { ...process.env, PATH: aePath } });
const skill = sh("agent-eyes", ["skill"], { env: { ...process.env, PATH: aePath } });

// The toy page: a static copy of examples/demo, without its config.
const toyDir = path.join(work, "site-toy");
cpSync(path.join(root, "examples", "demo"), toyDir, { recursive: true, filter: (f) => !f.endsWith(".json") });
const toyServer = createServer((req, res) => {
  const p = new URL(req.url, "http://x").pathname;
  const file = path.join(toyDir, p === "/" ? "index.html" : p);
  if (!file.startsWith(toyDir) || !existsSync(file)) { res.writeHead(404).end("not found"); return; }
  res.writeHead(200, { "content-type": "text/html" });
  createReadStream(file).pipe(res);
});
await new Promise((r) => toyServer.listen(0, r));
const toyBase = `http://localhost:${toyServer.address().port}`;

// The app: a copy of bench/app, run as its own process.
const appDir = path.join(work, "site-app");
cpSync(path.join(root, "bench", "app"), appDir, { recursive: true });
const appProc = spawn("node", [path.join(appDir, "server.mjs"), "0"]);
const appBase = await new Promise((resolve) => appProc.stdout.once("data", (d) => resolve(String(d).trim())));

const tasks = {
  app: { base: appBase, text: readFileSync(path.join(root, "bench", "task-app.md"), "utf8"), arms: ["without", "advice", "with-first", "with-repeat"],
    login: { path: "/login", fields: { "input[type=email]": "dev@example.com", "input[type=password]": "dev" }, submit: "button[type=submit]" } },
  toy: { base: toyBase, text: readFileSync(path.join(root, "bench", "task.md"), "utf8"), arms: ["without", "with-first"],
    login: { path: "/login.html", fields: { "input[type=email]": "dev@example.com", "input[type=password]": "dev" }, submit: "button[type=submit]" } },
};
const advice = readFileSync(path.join(root, "bench", "advice.md"), "utf8");

function prepare(task, arm, i) {
  const t = tasks[task];
  const dir = path.join(work, `${task}-${arm}-${i}`), tmp = path.join(dir, ".tmp");
  mkdirSync(tmp, { recursive: true });
  let note;
  if (arm === "without" || arm === "advice") {
    spawnSync("ln", ["-s", path.join(pw, "node_modules"), path.join(dir, "node_modules")]);
    writeFileSync(path.join(dir, "package.json"), '{ "type": "module" }\n');
    note = "\nPlaywright 1.61.1 and its Chromium are installed in this folder (node_modules).";
    if (arm === "advice") note += "\n" + advice;
  } else {
    mkdirSync(path.join(dir, ".claude", "skills", "agent-eyes"), { recursive: true });
    writeFileSync(path.join(dir, ".claude", "skills", "agent-eyes", "SKILL.md"), skill + "\n");
    note = "\nagent-eyes is installed (run `agent-eyes --help`); see the agent-eyes skill.";
    if (arm === "with-repeat") {
      writeFileSync(path.join(dir, "agent-eyes.config.json"), JSON.stringify({ baseUrl: t.base, widths: ["1280", "390"], login: t.login }, null, 2) + "\n");
      note += " It is already configured for this app, login included (agent-eyes.config.json).";
    }
  }
  return { dir, tmp, prompt: t.text.replaceAll("{BASE}", t.base) + note };
}

function run(task, arm, i) {
  const { dir, tmp, prompt } = prepare(task, arm, i);
  const env = { ...process.env, TMPDIR: tmp, PATH: arm.startsWith("with") ? aePath : process.env.PATH };
  const args = ["-p", prompt, "--model", model, "--effort", effort, "--output-format", "json",
    "--setting-sources", "project", "--permission-mode", "bypassPermissions"];
  return new Promise((resolve) => {
    const t0 = Date.now();
    const c = spawn("claude", args, { cwd: dir, env });
    let out = "", err = "";
    c.stdout.on("data", (d) => (out += d));
    c.stderr.on("data", (d) => (err += d));
    const kill = setTimeout(() => c.kill("SIGTERM"), 30 * 60 * 1000);
    c.on("close", (code) => {
      clearTimeout(kill);
      let r = {};
      try { r = JSON.parse(out); } catch { r = { parse_error: out.slice(0, 500), stderr: err.slice(0, 500) }; }
      Object.assign(r, { task, arm, run: i, model, effort, wall_ms: Date.now() - t0, exit: code, cwd: dir });
      writeFileSync(path.join(outDir, `${task}-${arm}-${i}.json`), JSON.stringify(r, null, 2));
      console.log(`${task} ${arm} #${i}: ${(r.wall_ms / 60000).toFixed(1)} min, $${(r.total_cost_usd ?? 0).toFixed(2)}, ${r.num_turns ?? "?"} turns`);
      resolve(r);
    });
  });
}

try {
  for (let i = 1; i <= Number(runs); i++) {
    for (const task of only.split(",")) {
      const arms = tasks[task].arms, k = (i - 1) % arms.length;
      for (const arm of [...arms.slice(k), ...arms.slice(0, k)]) await run(task, arm, i);
    }
  }
} finally {
  toyServer.close();
  appProc.kill();
}
console.log(`results in ${outDir}`);

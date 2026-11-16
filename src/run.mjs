// One entry for the command line and the MCP server: turn "what to check" into a capture run, and its
// result into the lines an agent reads.
import path from "node:path";
import { capture } from "./capture.mjs";
import { loadConfig } from "./config.mjs";
import { describe } from "./tokens.mjs";

/**
 * input: { base, routes, checks, defaults, widths, out, configFile, vars, compare, wait, locale, timezone,
 *          storageState, waitForServer, cwd }
 * routes are plain routes that all take `defaults`; checks are plan entries with their own options.
 * Relative paths (config, out, compare) resolve against cwd (default: the current folder).
 */
export async function runChecks(input) {
  const dir = path.resolve(input.cwd ?? ".");
  const config = loadConfig(input.configFile, dir);
  const base = input.base ?? config.baseUrl ?? process.env.BASE_URL;
  if (!base) throw new Error('no base URL: pass it (http://localhost:3000), set BASE_URL or "baseUrl" in agent-eyes.config.json');
  const d = input.defaults ?? {};
  const defaults = { actions: d.actions ?? [], element: d.element, measure: d.measure, frames: d.frames ?? 0, full: !!d.full, eachStep: !!d.eachStep };
  const shots = (input.routes ?? []).map((route) => ({ ...defaults, route }));
  if (input.checks !== undefined && !Array.isArray(input.checks)) throw new Error("a plan is a JSON list of checks");
  for (const c of input.checks ?? []) {
    if (!c?.route) throw new Error(`a check has no "route": ${JSON.stringify(c)}`);
    const w = typeof c.widths === "string" ? c.widths.split(",") : c.widths?.map(String);
    shots.push({ ...defaults, ...c, actions: c.actions ?? [], eachStep: c.eachStep ?? c.each_step ?? false,
      route: c.name ? `${c.name}=${c.route}` : c.route, widths: w });
  }
  if (!shots.length) shots.push({ ...defaults, route: "/" });
  return capture({
    base, config, shots,
    out: path.resolve(dir, input.out ?? config.out ?? "agent-eyes-out"),
    widths: (input.widths ?? config.widths ?? ["1440", "390"]).map(String),
    locale: input.locale ?? config.locale,
    timezone: input.timezone ?? config.timezone,
    vars: { ...(config.vars ?? {}), ...(input.vars ?? {}) },
    wait: input.wait ?? 1200,
    compare: input.compare && path.resolve(dir, input.compare),
    storageState: input.storageState && path.resolve(dir, input.storageState),
    waitForServer: input.waitForServer,
  });
}

/** The report an agent reads: images with their cost, then notes, motion and problems. */
export function report(r) {
  return [
    ...r.files.map(describe),
    ...r.notes,
    ...r.motion,
    r.problems.length ? `PROBLEMS:\n${r.problems.join("\n")}` : "no page errors, no server errors, no horizontal scroll, actions ok",
  ].join("\n");
}

// How to run this package without a global install.
export const NPX = "npx -y @muhlegger/agent-eyes";

/** Errors a user can act on, said plainly. */
export function friendly(e) {
  return /Executable doesn't exist/.test(e.message)
    ? `the browser is not installed yet: run \`agent-eyes install\` once (without a global install: \`${NPX} install\`; add \`--with-deps\` on a fresh Linux)`
    : e.message;
}

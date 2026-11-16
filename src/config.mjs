// Optional project config: agent-eyes.config.json in the current folder, or --config <file>.
// Values written as "$NAME" or "${NAME}" come from the environment, so passwords stay out of the file.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const PRESETS = {
  2560: "2560x1440", 1920: "1920x1080", 1536: "1536x864", 1440: "1440x900", 1366: "1366x768",
  1280: "1280x800", 1024: "1024x768", 768: "768x1024", 430: "430x932", 390: "390x844", 375: "375x812",
};

const expand = (v) => (typeof v === "string"
  ? v.replace(/\$\{(\w+)\}|\$(\w+)/g, (_, a, b) => process.env[a ?? b] ?? "")
  : Array.isArray(v) ? v.map(expand)
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, expand(x)]))
  : v);

export function loadConfig(file, dir = ".") {
  const own = path.resolve(dir, "agent-eyes.config.json");
  const f = file ? path.resolve(dir, file) : existsSync(own) ? own : null;
  if (!f) return {};
  if (!existsSync(f)) throw new Error(`config not found: ${f}`);
  try {
    return { ...expand(JSON.parse(readFileSync(f, "utf8"))), __file: path.resolve(f) };
  } catch (e) {
    throw new Error(`config ${f}: ${e.message}`);
  }
}

/** "1536" → preset (or the project's own size for it); "1536x730" → exact. Label = the width. */
export function viewportFor(spec, own = {}) {
  const s = String(spec);
  const size = own[s] ?? PRESETS[s] ?? s;
  const m = /^(\d+)x(\d+)$/.exec(size);
  if (!m) throw new Error(`unknown width "${s}": use one of ${Object.keys(PRESETS).join(",")} or WIDTHxHEIGHT`);
  return { label: s.split("x")[0], width: Number(m[1]), height: Number(m[2]) };
}

// Grades the answers of a bench run against the answer key, blind: tool names are removed from each answer
// and the answers are graded one at a time, in shuffled order, by a separate claude -p call.
//   node bench/grade.mjs bench/results/<date> [model=claude-opus-5-5]   -> <dir>/grades.json
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [dir, model = "claude-opus-5-5"] = process.argv.slice(2);

const keys = {
  app: {
    text: readFileSync(path.join(root, "bench", "answer-key.md"), "utf8"),
    found: ["D1", "D2", "D3", "D4"], clean: ["C1", "C2"],
  },
  toy: {
    text: `Answer key (toy page).
- T1. "Glitchy animation": Card A shrinks (280 -> ~200 px wide) and/or dims (opacity ~0.3) mid-animation, then comes back. Either symptom counts.
- T2. During the glitchy animation the page freezes for ~120 ms (stutter, jank, long frame, long task count).
- T3. On /shift.html the "Buy" card/button is pushed down ~176 px by a late banner after load (any value 150-200 px counts; "moves down after load" without a number counts too).
Must be reported clean (calling it broken is a false alarm):
- C1. "Smooth animation" (Card B).`,
    found: ["T1", "T2", "T3"], clean: ["C1"],
  },
};

const scrub = (s) => s.replace(/agent[- ]?eyes/gi, "[tool]").replace(/playwright/gi, "[tool]").replace(/\bskill\b/gi, "[tool]");
const files = readdirSync(dir).filter((f) => /^(app|toy)-.*\.json$/.test(f));
const order = files.map((f) => [Math.random(), f]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
const cwd = mkdtempSync(path.join(os.tmpdir(), "ae-grade-"));
const grades = {};

for (const f of order) {
  const r = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
  const key = keys[r.task];
  const prompt = `You are grading one report written by someone who checked a web app's UI. Use only the answer key.

${key.text}

For each defect id (${key.found.join(", ")}), decide whether the report identifies that defect (the symptom is
described; exact numbers do not matter). For each clean id (${key.clean.join(", ")}), decide whether the report
calls it broken (a false alarm); saying it is fine, or not mentioning it, is not a false alarm.
Then list any other problems the report claims, in a few words each.

Reply with JSON only, no prose:
{"found": {${key.found.map((k) => `"${k}": true|false`).join(", ")}}, "false_alarm": {${key.clean.map((k) => `"${k}": true|false`).join(", ")}}, "other_claims": ["..."]}

The report:
"""
${scrub(r.result ?? "(no answer)")}
"""`;
  const out = spawnSync("claude", ["-p", prompt, "--model", model, "--effort", "low", "--output-format", "json", "--setting-sources", "project"], { cwd, encoding: "utf8" });
  let g;
  try { g = JSON.parse(JSON.parse(out.stdout).result.replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { g = { error: (out.stdout || out.stderr).slice(0, 300) }; }
  grades[f] = g;
  console.log(f, JSON.stringify(g));
}
writeFileSync(path.join(dir, "grades.json"), JSON.stringify(grades, null, 2) + "\n");

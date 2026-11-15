// Summarizes a bench run: node bench/summarize.mjs bench/results/<date> [--md]
// Reads each result (claude -p --output-format json), its transcript (what the agent did) and grades.json.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { imageTokens, pngSize } from "../src/tokens.mjs";

const dir = process.argv[2];
const md = process.argv.includes("--md");
const grades = existsSync(path.join(dir, "grades.json")) ? JSON.parse(readFileSync(path.join(dir, "grades.json"), "utf8")) : {};
const rows = [];

for (const f of readdirSync(dir).filter((x) => /^(app|toy)-.*\.json$/.test(x)).sort()) {
  const r = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
  const u = r.usage ?? {};
  // Claude Code keeps the transcript in ~/.claude/projects/<cwd with / and . as ->/<session>.jsonl
  const tr = path.join(os.homedir(), ".claude", "projects", (r.cwd ?? "").replace(/[/.]/g, "-"), `${r.session_id}.jsonl`);
  let scripts = 0, images = 0, imgTokens = 0, toolErrors = 0, t0 = null, firstImage = null;
  if (existsSync(tr)) {
    for (const line of readFileSync(tr, "utf8").split("\n")) {
      if (!line) continue;
      let d; try { d = JSON.parse(line); } catch { continue; }
      const ts = d.timestamp ? Date.parse(d.timestamp) : null;
      if (ts && t0 === null) t0 = ts;
      // Only the conversation itself: the transcript also keeps a copy of each API request ("api-request-blob").
      if (d.type !== "assistant" && d.type !== "user") continue;
      const c = d.message?.content;
      if (!Array.isArray(c)) continue;
      for (const b of c) {
        if (b.type === "tool_use") {
          const i = b.input ?? {};
          if (b.name === "Write" && /\.(m?[jt]s|py)$/.test(i.file_path ?? "")) scripts++;
          if (b.name === "Bash" && /(cat|tee)\s*>+\s*\S+\.(m?[jt]s|py)\b/.test(i.command ?? "")) scripts++;
          if (b.name === "Bash" && /node\s+-e\b|python3?\s+-c\b/.test(i.command ?? "")) scripts++;
          if (b.name === "Read" && /\.png$/i.test(i.file_path ?? "")) {
            images++;
            if (firstImage === null && ts) firstImage = ts;
            const size = existsSync(i.file_path) ? pngSize(i.file_path) : null;
            if (size) imgTokens += imageTokens(size);
          }
        }
        if (b.type === "tool_result" && b.is_error) toolErrors++;
      }
    }
  }
  const g = grades[f] ?? {};
  rows.push({
    task: r.task, arm: r.arm, run: r.run, min: r.wall_ms / 60000, cost: r.total_cost_usd ?? NaN, turns: r.num_turns ?? NaN,
    out: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0,
    scripts, images, imgTokens, toolErrors, firstImageMin: firstImage && t0 ? (firstImage - t0) / 60000 : NaN,
    found: g.found ? Object.values(g.found).filter(Boolean).length : NaN, of: g.found ? Object.keys(g.found).length : NaN,
    falseAlarms: g.false_alarm ? Object.values(g.false_alarm).filter(Boolean).length : NaN,
    other: g.other_claims ?? [], answer: (r.result ?? r.parse_error ?? "").trim(),
  });
}

const med = (a) => { const s = a.filter((x) => !Number.isNaN(x)).sort((x, y) => x - y); if (!s.length) return NaN; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const rng = (a, f) => { const s = a.filter((x) => !Number.isNaN(x)); return s.length ? `${f(Math.min(...s))}–${f(Math.max(...s))}` : "?"; };
const n1 = (x) => (Number.isNaN(x) ? "?" : x.toFixed(1)), usd = (x) => (Number.isNaN(x) ? "?" : `$${x.toFixed(2)}`), k = (x) => (Number.isNaN(x) ? "?" : `${(x / 1000).toFixed(1)}k`);

for (const task of ["app", "toy"]) {
  const arms = [...new Set(rows.filter((r) => r.task === task).map((r) => r.arm))];
  if (!arms.length) continue;
  if (md) {
    console.log(`\n### ${task}\n\n| | ${arms.join(" | ")} |\n|---|${arms.map(() => "---").join("|")}|`);
    const col = (fn) => arms.map((a) => fn(rows.filter((r) => r.task === task && r.arm === a))).join(" | ");
    console.log(`| Time (median, range) | ${col((g) => `${n1(med(g.map((r) => r.min)))} min (${rng(g.map((r) => r.min), n1)})`)} |`);
    console.log(`| Time to first screenshot | ${col((g) => `${n1(med(g.map((r) => r.firstImageMin)))} min`)} |`);
    console.log(`| Cost (median) | ${col((g) => usd(med(g.map((r) => r.cost))))} |`);
    console.log(`| Output tokens | ${col((g) => k(med(g.map((r) => r.out))))} |`);
    console.log(`| Context re-read (cache) | ${col((g) => k(med(g.map((r) => r.cacheRead))))} |`);
    console.log(`| Turns | ${col((g) => String(med(g.map((r) => r.turns))))} |`);
    console.log(`| Scripts written | ${col((g) => String(med(g.map((r) => r.scripts))))} |`);
    console.log(`| Images read (tokens) | ${col((g) => `${med(g.map((r) => r.images))} (${k(med(g.map((r) => r.imgTokens)))})`)} |`);
    console.log(`| Defects found | ${col((g) => g.map((r) => `${r.found}/${r.of}`).join(", "))} |`);
    console.log(`| False alarms | ${col((g) => g.map((r) => r.falseAlarms).join(", "))} |`);
  } else {
    for (const arm of arms) {
      const g = rows.filter((r) => r.task === task && r.arm === arm);
      console.log(`\n== ${task} / ${arm} (${g.length} runs)`);
      for (const r of g) console.log(`  #${r.run}: ${n1(r.min)} min | first image ${n1(r.firstImageMin)} min | ${usd(r.cost)} | turns ${r.turns} | out ${r.out} | cache ${r.cacheRead} | scripts ${r.scripts} | images ${r.images} (${r.imgTokens} tok) | errors ${r.toolErrors} | found ${r.found}/${r.of} | false alarms ${r.falseAlarms}`);
    }
  }
}
if (!md) {
  console.log("\n== other claims (check by hand)");
  for (const r of rows) if (r.other.length) console.log(`  ${r.task}/${r.arm} #${r.run}: ${r.other.join(" | ")}`);
  console.log("\n== answers");
  for (const r of rows) console.log(`\n--- ${r.task} / ${r.arm} #${r.run}\n${r.answer}`);
}

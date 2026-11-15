# Benchmark: the same task with and without agent-eyes

Two comparisons, both with Claude Code 2.1.325 and Opus 5.5 at high effort, headless (`claude -p`), three
runs per arm, a fresh folder per run (no saved login, no user settings, hooks or memories). Each answer key
was written before the first run, and each report was graded blind (tool names removed, order shuffled) by
a separate model call, then checked by hand.

## 1. A real project

**Setup.** A production Next.js app with a few hundred components, on an isolated copy with no git remote
and its own database, reset before every run. The prompt (in Portuguese) said what had changed in the auction
calendar (the day panel that opens on clicking a day, the top bar, the board) and asked for a check at 1536
and 375 px, including clicking a day, hovering and the period arrows, reporting each problem and what was
fine. It named the parts and interactions, never a defect.

Three planted defects:

- **K1, the snapping column.** The cause of a bug that really reached the product owner: the width
  transition of the day panel's column was written on an element whose own `transition` rule replaced it,
  so the column snapped open in one frame while its content faded in. The code reads as animated.
- **K2, cut-off controls on a phone.** The scope buttons lose their wrapping at 375 px and run past the
  right edge.
- **K3, content that jumps after load.** A line appears ~1 s after load, with no reserved space, and pushes
  the calendar down ~35 px.

Two interactions had to be reported clean: hovering a day, and the period arrows.

**Arms.** "Without" had the project's instructions as they were before agent-eyes, including a helper that
runs a Playwright script the agent writes. "With" had the instructions that offer agent-eyes v0.1.1, plus
one line about running the whole check as one `--plan` and reading the text first.

| | Without agent-eyes | With agent-eyes (v0.1.1) |
|---|---|---|
| Defects found (per run) | 2/3, 1/3, 1/3 (4 of 9) | **2/3, 2/3, 2/3 (6 of 9)** |
| K1 snapping column | 0 of 3 | 0 of 3 |
| K2 cut-off controls | 3 of 3 | 3 of 3 |
| K3 jump after load | 1 of 3 | **3 of 3** |
| False alarms (on the 2 items that had to be clean) | 0 | 0 |
| Total time (median, range) | 5.0 min (3.6–5.6) | **3.9 min** (3.0–4.8) |
| Cost (median) | $0.97 | **$0.75** |
| Throwaway scripts written | 3 | 0 |
| Images read (their tokens) | 11 (14.6k) | 18 (17.2k) |

What it shows:

- **K3 is where the tool changed the outcome.** agent-eyes reports content that moves after load as a
  text line, so every run saw it; without it, the agent had to notice a 35 px move between screenshots.
- **K1 escaped everyone.** v0.1.1 recorded the motion but only flagged shrink-and-return, flicker and
  freezes in text, not a size that jumps in one frame. v0.2 adds that check. It was verified on this
  defect (flagged: "width jumped from 0 to 252 px in a single frame") and on the fixed version of the
  same screen (reported clean); the benchmark was not re-run with v0.2.
- Three runs per side is a small sample: the direction is consistent, the sizes are not precise.

The real project's code and raw answers are not published (they belong to a client); only the aggregate
numbers above are.

## 2. A small demo app

**Setup.** [bench/app](../bench/app): a small property listing with a login that only works once its
script arrives, data that loads late, client-side navigation, ids to find, and four planted defects the
prompt ([task-app.md](../bench/task-app.md)) does not name: a table that scrolls sideways on phones, a
panel animation that shrinks and dims mid-way, a ~100 ms freeze when that panel opens, and content pushed
down by a late banner. [Answer key](../bench/answer-key.md).

**Arms.** Playwright alone; Playwright plus [a checklist](../bench/advice.md) with the same advice the
agent-eyes skill implies, as plain text; agent-eyes on first use (no config); agent-eyes configured.

| | Playwright alone | Playwright + checklist text | agent-eyes, first use | agent-eyes, configured |
|---|---|---|---|---|
| Defects found | 4/4 in every run | 4/4 in every run | 4/4 in every run | 4/4 in every run |
| False alarms (on the 2 items that had to be clean) | 0 | 0 | 0 | 0 |
| Total time (median, range) | 1.9 min (1.5–2.0) | 1.6 min (1.6–1.8) | **1.5 min** (1.4–3.9) | 1.7 min (1.6–1.9) |
| Cost (median) | $0.37 | $0.29 | **$0.25** | $0.36 |
| Turns | 11 | 9 | 11 | 19 |
| Throwaway scripts written | 4 | 1 | **0** | **0** |
| Images read (their tokens) | 2 (2.0k) | 2 (2.0k) | 4 (2.7k) | 12 (13.6k) |
| Context re-read over the run | 239k | 177k | **176k** | 242k |

What it shows, honestly:

- **A ceiling.** The app is ~200 lines whose code the agent can read; every arm found every defect, quoting
  the values straight from the CSS and JS. On accuracy, this test cannot tell the arms apart. That is why
  the real-project comparison above exists.
- **Turns are the cost.** Each step re-reads the whole conversation. An earlier version (one call per
  question) made agents take 22–24 steps and cost ~5% more than Playwright alone; with one `--plan` per
  check, first use took 11 steps and cost a third less.
- **Configured, it was faster but not cheaper:** with the config's two default widths applied to every
  check, agents opened most of the images. The skill now says to give each check only the widths it needs
  (not re-measured).
- **A plain checklist is a strong baseline** ($0.29, 1.6 min): on a small app, much of the gain is knowing
  what to check.
- The 3.9 min first-use run hit a bug since fixed: one failing check took the whole plan down.

## Reproduce

```bash
node bench/run.mjs 3 claude-opus-5-5 high <label> app     # ~25 min, a few dollars
node bench/grade.mjs bench/results/<date>-<label>
node bench/summarize.mjs bench/results/<date>-<label> --md
```

Raw results of the small-app run: [bench/results/v0.1.1-small-app](../bench/results/v0.1.1-small-app).

## In agent transcripts

In the real project, over three weeks, agents wrote ~210 capture scripts (~200 re-implementing the login).
Across 166 of those, it took 1.2 min (median) and 3.3 min (mean) from starting the script to reading the
image; in 44 the script ran more than once before the agent saw anything, and in 33 it was rewritten (the
login, a selector, a server still compiling). That is the agent's whole process up to the first image.

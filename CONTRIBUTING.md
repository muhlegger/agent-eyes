# Contributing

Thanks for looking. agent-eyes is small on purpose: one runner (`src/`), a command line (`bin/`), an MCP
server (`src/mcp.mjs`) and a skill (`skills/agent-eyes/SKILL.md`). Its only dependency is Playwright.

## Run it

```bash
npm install
npx playwright install chromium
npm test        # end to end against examples/demo: the command line and the MCP server
```

The tests drive a real browser, so a very busy machine can make the motion tests report a browser freeze.
Run them again before assuming a regression.

## What makes a good change

- **A finding comes back as text.** The point of the tool is that an agent reads a line instead of opening
  an image. A new detection should print one line that says what happened and, when it is known, the usual
  cause.
- **No false alarms.** Every detection has a test for the defect and a test for the clean case next to it
  (see `test/run.mjs` and the pairs in `examples/demo/index.html`: `#snap` and `#ok`, `#a` and `#b`).
  Add both.
- **Measured claims.** If a change is meant to make agents faster or cheaper, say how you measured it.
  `docs/benchmark.md` describes the with/without method used so far, including the result where the tool
  did not win.
- **Small.** No image library, no MCP SDK, no build step. If a change needs a dependency, open an issue
  first.

## Reporting a bug

The most useful report has the command you ran, the output, and what the screen really did. If a motion
finding looks wrong, attach the `*-frames.png` it wrote.

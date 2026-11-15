# Answer key for bench/task-app.md (Lotline)

Written before the first run, and kept outside the repository until the runs finished, so the agents
being measured could not find it.

Planted defects (a report finds one if it describes the symptom; the exact number does not matter):

- D1. Detail page at 390 px scrolls sideways: the Overview table ("Asking price / Price per m² / ...")
  is wider than the phone (about 200 px of horizontal scroll).
- D2. "Show details" panel animation is broken mid-way: the panel shrinks horizontally (to ~82% width)
  and/or dims (opacity drops to ~0.45) and comes back. Either symptom counts.
- D3. Opening "Show details" freezes the page for roughly 80–150 ms (main-thread work right after the
  click). Any report of a freeze, jank, stutter, lag or long task on opening the panel counts.
- D4. Content jumps down after load on /app (and the detail page): a notice banner arrives ~1 s late and
  pushes the page down (~68 px at 1280, ~111 px at 390).

Must be reported clean (calling them broken is a false alarm):

- C1. The Overview/Costs tab switch (a plain 180 ms fade).
- C2. Hovering a listing card (lifts 2 px with a shadow).

Anything else reported as a problem is listed by the grader for a manual check; it is a false alarm
only if it is not true of the app.

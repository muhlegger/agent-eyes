---
name: agent-eyes
description: See a web app's UI after changing it - screenshots logged in at chosen widths, hover/click/scroll states, element crops, pixel comparison with the previous version (changed regions boxed and listed), the motion of an animation as a frame strip with glitch detection (shrink, snap, flicker, freeze), and content that jumps after load. Use after any visual change, before telling the user it is done, instead of writing a throwaway Playwright script.
---

# agent-eyes

One shell command; images come back as file paths you can read, with their size and token cost, followed by
text findings (layout shift, horizontal scroll, page errors, motion glitches).

If `agent-eyes` is not on the PATH, run it as `npx -y @muhlegger/agent-eyes` with the same arguments
(the first time, `npx -y @muhlegger/agent-eyes install` downloads the browser).

## Work cheaply: one plan, text first, few images

Every extra call and every image you open stays in your context and is re-read on every later step, so:

1. **Check everything in one call.** Write the whole check as a `--plan` (below): every screen, width and
   interaction you want to verify. Don't run one call per question.
2. **Read the text first.** Overflow, content that jumps, page errors, failed actions and motion glitches
   are reported as text; you don't need an image to know about them.
3. **Give each check only the widths it needs.** A config's default widths apply to every check; a motion
   or hover check usually needs one width, not all of them.
4. **Open only the images the text can't answer** (does the layout look right, is anything cut off or
   misaligned), usually one per screen per width. Prefer crops (`"element"`) when you care about one area.
   Open a motion frame strip only when a `!` line needs a look, or to judge the motion yourself.

## A whole check in one call

```bash
agent-eyes http://localhost:3000 --plan '[
  {"route": "/orders", "widths": ["1280", "390"]},
  {"name": "order", "route": "/orders/{id}", "widths": ["1280", "390"]},
  {"name": "panel", "route": "/orders/{id}", "actions": ["click:text=Details"], "frames": true, "measure": "#details", "widths": ["1280"]},
  {"name": "tabs", "route": "/orders/{id}", "actions": ["click:text=Costs"], "frames": true, "measure": "[role=tabpanel]", "widths": ["1280"]},
  {"name": "hover", "route": "/orders", "actions": ["hover:.order-card"], "element": ".order-card", "widths": ["1280"]}
]' --var id=42
```

Keys per check: `name route actions element measure frames full eachStep widths`. One browser and one
login serve them all. Ids: `{id}` + `--var id=...`; if you don't know one, start from a list page and
`click:` into an item (`"route": "/orders", "actions": ["click:.order-card >> nth=0"]`).

## Look at a screen

```bash
agent-eyes http://localhost:3000 /settings --widths 1440,390
```

- Name the files: `billing=/settings?tab=billing`.
- Logged-in apps: put the login form in `agent-eyes.config.json` once (see below); the session is reused.
- Crop to what you changed: `--element ".invoice-table"`. A full desktop screen costs ~1.5k tokens to read;
  a crop often costs under 100.

## A state that needs interaction

```bash
agent-eyes http://localhost:3000 /calendar --action "click:text=Month" --action "hover:[data-day='15']" --each-step
```

Actions run in order: `click:<sel>`, `hover:<sel>`, `scroll:<px|sel>`, `wait:<ms>`, `type:<sel>=<text>`,
`press:<Key>`. Selectors are Playwright's (`text=Save`, `button:has-text("Save")`, CSS).
Actions are real: clicking Save saves. Use a dev or test database.

## Did my change do what I meant, and nothing else?

```bash
agent-eyes http://localhost:3000 /settings -o /tmp/before      # before editing
# ...edit the code...
agent-eyes http://localhost:3000 /settings --compare /tmp/before
```

"identical" means nothing to look at. Otherwise you get one side-by-side image with each changed region
boxed in red, and the regions as text (size and position). A change outside the area you meant to touch
is a regression to check.

## Animations and transitions

`"frames": true` in a plan check (or `--frames` on the command line) records the motion of the check's last
action at real speed into one image of ~10 frames, cropped to `measure`, and reports if it shrank and came
back, snapped (a size that jumps in one frame while other things animate: its transition is written but not
running), flickered, disappeared, left its path, or the browser froze (above ~50 ms is felt). Measure the
element that should move (the panel, the column), not its content. It cannot judge
whether the motion feels good; that stays with the human.

## Read the output

- Lines ending in `(WxH, ~N tokens)`: the images. Open only the ones you need.
- `layout shifted after load`: something moved on its own after the page loaded (late banner, image
  without size). Usually worth fixing.
- `!` lines under `motion`: a glitch in the recorded motion.
- `PROBLEMS:` page errors, server 5xx, horizontal scroll, poor layout shift, actions that missed their target.

## Config (agent-eyes.config.json, optional)

```json
{
  "baseUrl": "http://localhost:3000",
  "widths": ["1440", "390"],
  "locale": "en-US",
  "login": {
    "path": "/login",
    "fields": { "input[type=email]": "dev@example.com", "input[type=password]": "${APP_PASSWORD}" },
    "submit": "button[type=submit]"
  }
}
```

`${NAME}` reads the environment, so secrets stay out of the file. `agent-eyes --help` lists everything.

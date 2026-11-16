// --frames: records the motion caused by one action, at real speed, and flags what usually is a bug.
//
// How: Chromium's screencast sends a frame on every repaint (~60 fps while something animates) and
// stops sending when nothing changes, so the end of the motion finds itself. In parallel, a tiny
// sampler inside the page records, on every animation frame, the measured element's box, opacity
// and existence, plus how many animations are running.
//
// Why not slow animations down to get more frames: apps often chain steps on timers
// (setTimeout(remove, 80)). Slowing CSS animations would leave those timers at normal speed, the two
// would drift apart, and the capture would show glitches that do not exist.
import { runAction } from "./actions.mjs";
import { frameSheet } from "./combine.mjs";

const RUNNING = () => document.getAnimations().filter((a) => a.playState === "running"
  && a.effect?.getComputedTiming().iterations !== Infinity).length;

export async function recordMotion({ browser, context, page, action, measure, count = 10, out }) {
  let target = measure;
  // The sampler runs in the page, which only understands CSS. A Playwright-only selector ("text=…", ">>")
  // gets resolved now and tagged, so it must exist before the action.
  if (target && !(await page.evaluate((s) => { try { document.querySelector(s); return true; } catch { return false; } }, target))) {
    const ok = await page.locator(target).first()
      .evaluate((el) => el.setAttribute("data-agent-eyes-measure", ""), null, { timeout: 5000 }).then(() => true, () => false);
    if (!ok) return { lines: [`motion: "${measure}" is not CSS and does not exist before the action; use a CSS selector for elements the action creates`], glitch: false };
    target = "[data-agent-eyes-measure]";
  }

  await page.evaluate(({ sel, running }) => {
    const countRunning = new Function(`return (${running})()`);
    const r = (window.__agentEyes = { t0: 0, s: [], done: false, el: null, gen: 0 });
    const step = () => {
      if (r.done) return;
      const t = performance.now() - r.t0;
      const el = sel ? document.querySelector(sel) : null;
      const n = countRunning();
      // gen counts replacements: a tab whose content is swapped for a new node that fades in is not a flicker.
      if (el && r.el && el !== r.el) r.gen++;
      if (el) r.el = el;
      if (el) {
        const b = el.getBoundingClientRect(), cs = getComputedStyle(el);
        r.s.push([t, b.x, b.y, b.width, b.height, Number(cs.opacity), cs.visibility !== "hidden" && b.width > 0 ? 1 : 0, n, r.gen]);
      } else r.s.push([t, null, null, null, null, null, 0, n, r.gen]);
      requestAnimationFrame(step);
    };
    r.start = () => { r.t0 = performance.now(); requestAnimationFrame(step); };
  }, { sel: target, running: RUNNING.toString() });

  const cdp = await context.newCDPSession(page);
  const frames = [];
  cdp.on("Page.screencastFrame", (f) => {
    frames.push({ t: f.metadata.timestamp, data: f.data });
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 85, everyNthFrame: 1 });
  await page.waitForTimeout(150);
  frames.length = 0;
  await page.evaluate(() => window.__agentEyes.start());
  const t0 = Date.now() / 1000;
  await runAction(page, action, { settle: 0 });
  // Done: 300 ms without a new frame and no animation running, or 4 s at most.
  for (let i = 0; i < 80; i++) {
    await page.waitForTimeout(50);
    const last = frames.length ? frames[frames.length - 1].t : t0;
    const running = await page.evaluate(`(${RUNNING.toString()})()`);
    if (Date.now() / 1000 - last > 0.3 && running === 0) break;
  }
  await cdp.send("Page.stopScreencast").catch(() => {});
  await cdp.detach().catch(() => {});
  const samples = await page.evaluate(() => { window.__agentEyes.done = true; return window.__agentEyes.s; });

  // Frames: drop consecutive duplicates, keep up to `count` evenly spaced, always first and last.
  const unique = frames.filter((f, i) => i === 0 || f.data !== frames[i - 1].data);
  const n = Math.min(count, unique.length);
  const picked = n <= 1 ? unique
    : [...new Set(Array.from({ length: n }, (_, i) => Math.round((i * (unique.length - 1)) / (n - 1))))].map((i) => unique[i]);

  // Crop: the area the element occupied at any moment, plus a margin; without an element, the viewport.
  const vp = page.viewportSize();
  let crop = { x: 0, y: 0, width: vp.width, height: vp.height };
  const present = samples.filter((s) => s[6]);
  if (target && present.length) {
    const x0 = Math.min(...present.map((s) => s[1])), y0 = Math.min(...present.map((s) => s[2]));
    const x1 = Math.max(...present.map((s) => s[1] + s[3])), y1 = Math.max(...present.map((s) => s[2] + s[4]));
    const x = Math.max(0, Math.floor(x0 - 16)), y = Math.max(0, Math.floor(y0 - 16));
    crop = { x, y, width: Math.min(vp.width, Math.ceil(x1 + 16)) - x, height: Math.min(vp.height, Math.ceil(y1 + 16)) - y };
  }
  let sheet = null;
  if (picked.length) {
    sheet = await frameSheet(browser, picked.map((f) => ({ data: f.data, label: `+${Math.max(0, Math.round((f.t - t0) * 1000))} ms` })), vp, crop, out);
  }

  // Summary: a few lines, only what usually is a bug.
  const lines = [];
  let glitch = false;
  const warn = (s) => { glitch = true; lines.push(`  ! ${s}`); };
  const span = frames.length ? Math.round((frames[frames.length - 1].t - t0) * 1000) : 0;
  // Jank from the page's own frame rhythm while animating, not from the screenshot intervals
  // (those include the cost of capturing).
  const animating = samples.filter((s) => s[7] > 0);
  const worst = animating.slice(1).reduce((m, s, i) => Math.max(m, s[0] - animating[i][0]), 0);
  lines.push(`motion: ${unique.length} distinct frames over ${span} ms`);
  if (!unique.length) {
    lines.push("  nothing moved after the action (no new frame): if a motion was expected, check that the action changed something");
    return { sheet, lines, glitch };
  }
  if (worst > 50) warn(`the browser froze for ${Math.round(worst)} ms while animating (noticeable above ~50 ms)`);
  if (target) {
    const label = measure;
    const flags = samples.map((s) => s[6]);
    if (!flags.some(Boolean)) lines.push(`  "${label}" did not exist in any frame`);
    else {
      const a = flags.indexOf(1), b = flags.lastIndexOf(1);
      const holes = flags.slice(a, b + 1).filter((v) => !v).length;
      if (holes) warn(`the element disappeared and came back (${holes} frames without it)`);
      // If the action swapped the element for a new one (new tab content), judge the one that settles.
      const gen = present[present.length - 1][8];
      const cur = present.filter((s) => s[8] === gen);
      if (gen > 0) lines.push(`  "${label}" was replaced by a new element during the motion; checked the new one`);
      const first = cur[0], last = cur[cur.length - 1];
      for (const [k, name] of [[3, "width"], [4, "height"]]) {
        const lo = cur.reduce((m, s) => (s[k] < m[k] ? s : m)), hi = cur.reduce((m, s) => (s[k] > m[k] ? s : m));
        const base = Math.min(first[k], last[k]), top = Math.max(first[k], last[k]);
        if (base - lo[k] > Math.max(2, base * 0.03)) warn(`${name} shrank from ${Math.round(base)} to ${Math.round(lo[k])} px mid-motion and came back (see the frames)`);
        if (hi[k] - top > Math.max(2, top * 0.03)) lines.push(`  ${name} overshot to ${Math.round(hi[k])} px, ends at ${Math.round(last[k])} (fine if it is a spring)`);
      }
      // A snap: the size changed by a lot in a single frame. When other things animated around it, it was
      // probably meant to slide too, and its transition is not running (the classic cause: a later
      // `transition:` rule on the same element replaces the property list). Reading the CSS shows the
      // transition; only watching shows it does not apply.
      const alive = samples.filter((s) => s[1] !== null && s[8] === gen);
      const anyAnimation = samples.some((s) => s[7] > 0);
      for (const [k, name] of [[3, "width"], [4, "height"]]) {
        if (alive.length < 2) break;
        const total = Math.abs(alive[alive.length - 1][k] - alive[0][k]);
        let step = 0, at = 1;
        for (let i = 1; i < alive.length; i++) {
          const d = Math.abs(alive[i][k] - alive[i - 1][k]);
          if (d > step) { step = d; at = i; }
        }
        if (step < Math.max(24, 0.2 * Math.max(alive[at][k], alive[at - 1][k])) || step < 0.8 * total) continue;
        const from = Math.round(alive[at - 1][k]), to = Math.round(alive[at][k]);
        // Across a browser freeze the frames in between were never drawn: a slide looks like a jump.
        const gap = alive[at][0] - alive[at - 1][0];
        if (gap > 50) { lines.push(`  ${name} went from ${from} to ${to} px across a ${Math.round(gap)} ms browser freeze: can't tell a snap from skipped frames (run again when the machine is less busy)`); continue; }
        if (anyAnimation) warn(`${name} jumped from ${from} to ${to} px in a single frame while other things animated: if it should slide, its transition is not running (often a later "transition:" rule on the same element replaces the property list)`);
        else lines.push(`  ${name} changed from ${from} to ${to} px instantly (nothing animated)`);
      }
      // A dip between two brighter moments, so a fade-in that dims again before settling also counts.
      const op = cur.map((s) => s[5]);
      const before = op.map((_, i) => Math.max(...op.slice(0, i + 1))), after = op.map((_, i) => Math.max(...op.slice(i)));
      let dip = 0, at = 0;
      op.forEach((v, i) => { const d = Math.min(before[i], after[i]) - v; if (d > dip) { dip = d; at = i; } });
      if (dip > 0.05) warn(`flicker: opacity dropped to ${op[at].toFixed(2)} mid-motion and came back to ${Math.min(before[at], after[at]).toFixed(2)}`);
      for (const [k, name] of [[1, "horizontal"], [2, "vertical"]]) {
        const lo = Math.min(first[k], last[k]) - 3, hi = Math.max(first[k], last[k]) + 3;
        const off = cur.find((s) => s[k] < lo || s[k] > hi);
        if (off) lines.push(`  ${name} position left the start-to-end path (${Math.round(off[k])} px; start ${Math.round(first[k])}, end ${Math.round(last[k])})`);
      }
      if (!lines.slice(1).some((l) => !l.includes("was replaced"))) lines.push(`  "${label}": no shrink, snap, flicker, disappearance or detour`);
    }
  }
  return { sheet, lines, glitch };
}

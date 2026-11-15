// The capture run: open each shot's route at each of its widths, logged in, run its actions, take the
// screenshots, check the page, and optionally compare with a previous run or record the motion of the last
// action. A shot is { route, actions, element, measure, frames, full, eachStep, widths }; the command line
// makes one shot per route with the same options, a plan (--plan) gives each shot its own.
import { existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { parseAction, runAction } from "./actions.mjs";
import { diffImages, sideBySide } from "./combine.mjs";
import { recordMotion } from "./motion.mjs";
import { viewportFor } from "./config.mjs";

const NAV = { waitUntil: "networkidle", timeout: 240000 };

function nameOf(route, vars) {
  const m = route.match(/^([\w.-]+)=(\/.*)$/);
  let [name, url] = m ? [m[1], m[2]] : [null, route];
  for (const [k, v] of Object.entries(vars)) url = url.replaceAll(`{${k}}`, v);
  const missing = url.match(/\{(\w+)\}/);
  if (missing) throw new Error(`route "${route}" uses {${missing[1]}}: pass --var ${missing[1]}=<value>`);
  name ??= (route.replace(/^\//, "").replace(/\{(\w+)\}/g, "$1").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "") || "home").slice(0, 60);
  return [name, url];
}

async function waitForServer(base, seconds) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    try { await fetch(base, { redirect: "manual", signal: AbortSignal.timeout(5000) }); return; } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${base} did not answer in ${seconds} s`);
}

export async function capture(o) {
  const base = o.base.replace(/\/$/, "");
  if (o.waitForServer) await waitForServer(base, o.waitForServer);
  mkdirSync(o.out, { recursive: true });
  const used = new Map();
  const shots = o.shots.map((s) => {
    const actions = (s.actions ?? []).map(parseAction);
    if (s.frames && !actions.length) throw new Error(`${s.route}: frames record the last action: say which (e.g. click:[data-day])`);
    let [name, url] = nameOf(s.route, o.vars);
    const n = (used.get(name) ?? 0) + 1;
    used.set(name, n);
    if (n > 1) name = `${name}-${n}`; // two checks of the same page keep separate files
    return { ...s, actions, name, url };
  });
  const widths = [...new Set(shots.flatMap((s) => s.widths ?? o.widths))];
  const login = o.config.login;
  const u = new URL(base);
  const session = o.storageState ?? path.join(os.tmpdir(), "agent-eyes", `session-${u.hostname}-${u.port || (u.protocol === "https:" ? 443 : 80)}.json`);
  mkdirSync(path.dirname(session), { recursive: true });
  const onLogin = (p) => login && new URL(p.url()).pathname.startsWith(login.path ?? "/login");

  async function logIn(context, out) {
    const p = await context.newPage();
    try {
      // networkidle: forms of client-rendered apps only work once hydrated; a click before that does nothing.
      await p.goto(base + (login.path ?? "/login"), NAV);
      if (onLogin(p)) {
        for (const [sel, value] of Object.entries(login.fields ?? {})) await p.fill(sel, String(value));
        await p.click(login.submit ?? 'button[type="submit"]');
        try {
          await p.waitForURL((x) => !x.pathname.startsWith(login.path ?? "/login"), { timeout: login.timeoutMs ?? 90000 });
        } catch {
          await p.screenshot({ path: path.join(out, "login-failed.png") });
          throw new Error(`login did not complete (screenshot: ${path.join(out, "login-failed.png")})`);
        }
      }
      await context.storageState({ path: session });
    } finally {
      await p.close();
    }
  }

  const browser = await chromium.launch({ args: [`--lang=${o.locale ?? "en-US"}`, "--font-render-hinting=none"] });
  const files = [], notes = [], problems = [], motion = [];
  let glitch = false;
  try {
    for (const spec of widths) {
      const vp = viewportFor(spec, o.config.viewports);
      const ctxOpts = { viewport: { width: vp.width, height: vp.height }, ...(o.locale && { locale: o.locale }), ...(o.timezone && { timezoneId: o.timezone }) };
      const context = await browser.newContext(existsSync(session) ? { ...ctxOpts, storageState: session } : ctxOpts);
      await context.addInitScript(() => {
        const list = (window.__agentEyesShifts = []);
        const what = (n) => {
          if (!n || n.nodeType !== 1) return "an element";
          const cls = typeof n.className === "string" && n.className.trim() ? `.${n.className.trim().split(/\s+/).slice(0, 2).join(".")}` : "";
          const text = (n.textContent || "").trim().replace(/\s+/g, " ").slice(0, 30);
          return `${n.tagName.toLowerCase()}${n.id ? `#${n.id}` : cls}${text ? ` "${text}"` : ""}`;
        };
        try {
          new PerformanceObserver((l) => {
            for (const e of l.getEntries()) {
              if (e.hadRecentInput) continue;
              list.push({ value: e.value, moved: (e.sources || []).map((s) => ({ what: what(s.node),
                dx: Math.round(s.currentRect.x - s.previousRect.x), dy: Math.round(s.currentRect.y - s.previousRect.y) })) });
            }
          }).observe({ type: "layout-shift", buffered: true });
        } catch {}
      });
      const page = await context.newPage();
      const errors = [], failed = [];
      page.on("pageerror", (e) => errors.push(String(e.message).split("\n")[0].slice(0, 160)));
      page.on("response", (r) => { if (r.status() >= 500 && r.url().startsWith(base)) failed.push(`${r.status()} ${r.url().slice(base.length) || "/"}`); });
      for (const s of shots.filter((x) => (x.widths ?? o.widths).includes(spec))) {
        try {
        const { actions, name, url } = s;
        errors.length = 0; failed.length = 0;
        await page.goto(base + url, NAV);
        if (onLogin(page)) { await logIn(context, o.out); await page.goto(base + url, NAV); }
        await page.mouse.move(0, 0); // the pointer stays where the previous check left it; a stale hover hides one
        await page.waitForTimeout(o.wait);
        const where = `${name}@${vp.label}`;
        // Content that moved on its own after loading (not caused by input): the button that drops when an
        // image arrives, the table that pushes the footer. Read before the actions so they don't mix in.
        const shifts = await page.evaluate(() => window.__agentEyesShifts ?? []);
        if (shifts.length) {
          // The score weighs area, so a small button that jumps 170 px scores low; for an agent, "something
          // moved" is the news. Note any move of 8 px or more; a problem from Google's "poor" line (0.1) up.
          const score = shifts.reduce((s, x) => s + x.value, 0);
          const big = shifts.flatMap((x) => x.moved).filter((m) => Math.abs(m.dx) >= 8 || Math.abs(m.dy) >= 8);
          if (big.length || score >= 0.1) {
            const moved = [...new Map(big.map((m) => [m.what, m])).values()].slice(0, 3)
              .map((m) => `${m.what} (${m.dy > 0 ? "+" : ""}${m.dy}px down, ${m.dx > 0 ? "+" : ""}${m.dx}px right)`).join("; ");
            const msg = `${where}: layout shifted after load, score ${score.toFixed(3)}${score >= 0.1 ? " (Google rates above 0.1 as poor)" : ""}${moved ? `: ${moved}` : ""}`;
            (score >= 0.1 ? problems : notes).push(msg);
          }
        }
        const shot = async (suffix = "") => {
          const file = path.join(o.out, `${name}-${vp.label}${suffix}.png`);
          if (s.element) {
            const el = page.locator(s.element).first();
            await el.waitFor({ timeout: 5000 }).catch(() => {});
            if (!(await el.count())) throw new Error(`element "${s.element}" is not on the page (waited 5 s)`);
            await el.screenshot({ path: file, timeout: 15000 });
          }
          else await page.screenshot({ path: file, fullPage: !!s.full });
          files.push(file);
          return file;
        };
        for (const [k, a] of actions.entries()) {
          try {
            if (s.frames && k === actions.length - 1) {
              const r = await recordMotion({ browser, context, page, action: a, measure: s.measure ?? s.element, count: s.frames === true ? 10 : s.frames, out: path.join(o.out, `${name}-${vp.label}-frames.png`) });
              if (r.sheet) files.push(r.sheet);
              motion.push(...r.lines.map((l, i) => (i === 0 ? `${where} ${l}` : l)));
              glitch ||= r.glitch;
            } else await runAction(page, a);
          } catch (e) {
            problems.push(`${where}: action "${a.spec}" failed (${String(e.message).split("\n")[0].slice(0, 140)}); screenshot taken where it stopped`);
            break;
          }
          if (s.eachStep && k < actions.length - 1) await shot(`-step${k + 1}`);
        }
        const final = await shot();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (overflow > 0) problems.push(`${where}: horizontal scroll of ${overflow}px`);
        if (errors.length) problems.push(`${where}: page error: ${errors.join(" | ")}`);
        if (failed.length) problems.push(`${where}: server errors: ${[...new Set(failed)].slice(0, 5).join(", ")}`);
        if (o.compare) {
          const before = path.join(o.compare, path.basename(final));
          if (!existsSync(before)) problems.push(`${where}: nothing to compare at ${before}`);
          else {
            const d = await diffImages(browser, before, final);
            if (!d.changedRatio && !d.sizeChanged) notes.push(`${where}: identical to ${before} (no need to look)`);
            else {
              const out = await sideBySide(browser, before, final, final.replace(/\.png$/, "-compare.png"), "before", "after", d.regions);
              files.push(out);
              const size = d.sizeChanged ? `; size ${d.before.join("x")} -> ${d.after.join("x")}` : "";
              const where2 = d.regions.map((r) => `${r.width}x${r.height} at ${r.x},${r.y}`).join("; ");
              notes.push(`${where}: changed ${(d.changedRatio * 100).toFixed(1)}% of pixels in ${d.totalRegions} region(s), marked in red: ${where2}${size}`);
            }
          }
        }
        } catch (e) {
          // One check failing (a crop whose element is missing, a page that does not load) is reported, and the
          // other checks still run; only a failed login stops everything, since every check would fail.
          if (/^login did not complete/.test(e.message)) throw e;
          problems.push(`${s.name}@${vp.label}: this check failed (${String(e.message).split("\n")[0].slice(0, 160)}); the other checks ran`);
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  return { files, notes, problems, motion, glitch };
}

// Actions run before a screenshot: click, hover, scroll, wait, type, press.
// Targets are Playwright selectors: "text=Save", "button:has-text('Month')", "[data-day]", "#id".

export const ACTION_TYPES = ["click", "hover", "scroll", "wait", "type", "press"];

/** Splits "type:<selector>=<text>" at the first "=" that is outside [...] and quotes,
 *  so attribute selectors like input[name="email"] keep working. */
export function splitTyping(target) {
  let depth = 0, quote = null;
  for (let i = 0; i < target.length; i++) {
    const ch = target[i];
    if (quote) { if (ch === quote && target[i - 1] !== "\\") quote = null; continue; }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "[" || ch === "(") depth++;
    else if (ch === "]" || ch === ")") depth--;
    else if (ch === "=" && depth === 0) return [target.slice(0, i), target.slice(i + 1)];
  }
  throw new Error(`type action needs "<selector>=<text>", got "${target}"`);
}

export function parseAction(spec) {
  const i = spec.indexOf(":");
  const type = i < 0 ? spec : spec.slice(0, i);
  const target = i < 0 ? "" : spec.slice(i + 1);
  if (!ACTION_TYPES.includes(type)) throw new Error(`unknown action "${type}" (use ${ACTION_TYPES.join(", ")})`);
  return { type, target, spec };
}

/** Runs one action. `settle` waits after it so short UI transitions finish (most stay under ~400 ms). */
export async function runAction(page, { type, target }, { settle = 500, timeout = 15000 } = {}) {
  const first = (sel) => page.locator(sel).first();
  switch (type) {
    case "click": await first(target).click({ timeout }); break;
    case "hover": await first(target).hover({ timeout }); break;
    case "scroll":
      if (/^-?\d+$/.test(target)) await page.mouse.wheel(0, Number(target));
      else await first(target).scrollIntoViewIfNeeded({ timeout });
      break;
    case "wait": await page.waitForTimeout(Number(target)); return;
    case "type": { const [sel, text] = splitTyping(target); await first(sel).fill(text, { timeout }); break; }
    case "press": await page.keyboard.press(target); break;
  }
  if (settle) await page.waitForTimeout(settle);
}

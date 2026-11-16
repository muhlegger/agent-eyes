// Image composition with the browser itself (no image library needed):
// a tiny HTML page lays the pictures out, and a screenshot of it is the result.
import { readFileSync } from "node:fs";

const BG = "#26221f", FG = "#f3ede4", LINE = "#6b6058";

async function render(browser, html, out, selector = "#sheet") {
  const page = await browser.newPage({ viewport: { width: 400, height: 300 }, deviceScaleFactor: 1 });
  try {
    await page.setContent(html);
    await page.waitForLoadState("load");
    await page.locator(selector).screenshot({ path: out });
  } finally {
    await page.close();
  }
  return out;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const uri = (f) => `data:image/png;base64,${readFileSync(f).toString("base64")}`;

/** Two images side by side with labels. Each side is capped at 1200 px so two desktop shots stay readable.
 *  `boxes` (in the after image's pixels) are drawn in red over the after side. */
export function sideBySide(browser, before, after, out, labelA = "before", labelB = "after", boxes = []) {
  return render(browser, `<!doctype html><body style="margin:0;background:${BG};font:600 15px system-ui;color:${FG}">
    <div id="sheet" style="display:flex;gap:16px;padding:16px;align-items:flex-start;width:max-content">
    ${[[labelA, before, []], [labelB, after, boxes]].map(([l, f, bx]) => `<figure style="margin:0">
      <figcaption style="margin:0 0 8px">${esc(l)}</figcaption>
      <div style="position:relative;line-height:0">
        <img src="${uri(f)}" style="display:block;max-width:1200px;outline:1px solid ${LINE}"
          onload="for (const b of this.parentNode.querySelectorAll('[data-b]')) { const s = this.width / this.naturalWidth;
            const [x, y, w, h] = b.dataset.b.split(',').map(Number);
            Object.assign(b.style, { left: x * s - 3 + 'px', top: y * s - 3 + 'px', width: w * s + 6 + 'px', height: h * s + 6 + 'px' }); }">
        ${bx.map((b) => `<div data-b="${b.x},${b.y},${b.width},${b.height}" style="position:absolute;border:3px solid #e5322d;border-radius:4px;box-shadow:0 0 0 1px #fff"></div>`).join("")}
      </div></figure>`).join("")}
    </div></body>`, out);
}

/** Pixel comparison in the browser (canvas), no image library. Changed pixels are grouped on a 16 px grid
 *  into regions (connected cells), so "what changed" comes back as a few boxes, not a pixel map. */
export async function diffImages(browser, before, after) {
  const page = await browser.newPage();
  try {
    return await page.evaluate(async ([a, b]) => {
      const load = (src) => new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = src; });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const w = Math.max(ia.width, ib.width), h = Math.max(ia.height, ib.height);
      const px = (img) => { const c = new OffscreenCanvas(w, h); const g = c.getContext("2d"); g.drawImage(img, 0, 0); return g.getImageData(0, 0, w, h).data; };
      const da = px(ia), db = px(ib);
      const C = 16, gw = Math.ceil(w / C), gh = Math.ceil(h / C), cells = new Uint8Array(gw * gh);
      let changed = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        // 32 of 765 summed channel difference: ignores antialiasing noise, catches real changes
        if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 32) {
          changed++; cells[Math.floor(y / C) * gw + Math.floor(x / C)] = 1;
        }
      }
      const seen = new Uint8Array(gw * gh), regions = [];
      for (let s = 0; s < cells.length; s++) {
        if (!cells[s] || seen[s]) continue;
        let x0 = gw, y0 = gh, x1 = 0, y1 = 0; const stack = [s]; seen[s] = 1;
        while (stack.length) {
          const k = stack.pop(), cx = k % gw, cy = (k - cx) / gw;
          x0 = Math.min(x0, cx); y0 = Math.min(y0, cy); x1 = Math.max(x1, cx); y1 = Math.max(y1, cy);
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx, ny = cy + dy, n = ny * gw + nx;
            if (nx >= 0 && ny >= 0 && nx < gw && ny < gh && cells[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
          }
        }
        regions.push({ x: x0 * C, y: y0 * C, width: Math.min(w, (x1 + 1) * C) - x0 * C, height: Math.min(h, (y1 + 1) * C) - y0 * C });
      }
      regions.sort((p, q) => q.width * q.height - p.width * p.height);
      return { changedRatio: changed / (w * h), sizeChanged: ia.width !== ib.width || ia.height !== ib.height,
        before: [ia.width, ia.height], after: [ib.width, ib.height], regions: regions.slice(0, 5), totalRegions: regions.length };
    }, [uri(before), uri(after)]);
  } finally {
    await page.close();
  }
}

/** Two image files compared on their own: the text an agent reads ("identical", or what changed and where). */
export async function compareFiles(a, b, out, labelA, labelB) {
  const { chromium } = await import("playwright");
  const { describe } = await import("./tokens.mjs");
  const browser = await chromium.launch();
  try {
    const d = await diffImages(browser, a, b);
    if (!d.changedRatio && !d.sizeChanged) return "identical (no image written)";
    return [
      describe(await sideBySide(browser, a, b, out, labelA, labelB, d.regions)),
      `changed ${(d.changedRatio * 100).toFixed(1)}% of pixels in ${d.totalRegions} region(s), marked in red: ` +
        d.regions.map((r) => `${r.width}x${r.height} at ${r.x},${r.y}`).join("; "),
    ].join("\n");
  } finally {
    await browser.close();
  }
}

/** A grid of frames (base64 JPEG of the full viewport), each cropped to `crop` and captioned. */
export function frameSheet(browser, frames, viewport, crop, out, maxWidth = 1600) {
  const { x, y, width, height } = crop;
  const cols = Math.min(frames.length, Math.max(1, Math.round(Math.sqrt(frames.length * (height / width) * 1.6))));
  const scale = Math.min(1, (maxWidth / cols - 12) / width);
  const cw = Math.round(width * scale), ch = Math.round(height * scale);
  return render(browser, `<!doctype html><body style="margin:0;background:${BG};font:600 13px system-ui;color:${FG}">
    <div id="sheet" style="display:grid;grid-template-columns:repeat(${cols},${cw}px);gap:12px;padding:12px;width:max-content">
    ${frames.map((f) => `<figure style="margin:0"><figcaption style="margin:0 0 4px">${esc(f.label)}</figcaption>
      <div style="width:${cw}px;height:${ch}px;outline:1px solid ${LINE};background:url(data:image/jpeg;base64,${f.data}) no-repeat;
        background-size:${Math.round(viewport.width * scale)}px ${Math.round(viewport.height * scale)}px;
        background-position:-${Math.round(x * scale)}px -${Math.round(y * scale)}px"></div></figure>`).join("")}
    </div></body>`, out);
}

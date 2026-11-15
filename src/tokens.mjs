// What an image costs an agent to look at, so it can choose a crop knowing the price.
// Claude's published rule: images whose long side exceeds 1568 px (or above ~1.15 megapixels) are scaled
// down first, then cost about width × height / 750 tokens. Other models differ; the order of magnitude
// (a full desktop screen ≈ 1.5k tokens, a button ≈ tens) holds.
import { readFileSync } from "node:fs";

export function pngSize(file) {
  const b = readFileSync(file);
  if (b.toString("ascii", 1, 4) !== "PNG") return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

export function imageTokens({ width, height }) {
  let s = Math.min(1, 1568 / Math.max(width, height));
  const mp = width * height * s * s;
  if (mp > 1_150_000) s *= Math.sqrt(1_150_000 / mp);
  return Math.max(1, Math.ceil((width * s * height * s) / 750));
}

export function describe(file) {
  const size = pngSize(file);
  if (!size) return file;
  const t = imageTokens(size);
  return `${file}  (${size.width}x${size.height}, ~${t >= 1000 ? `${(t / 1000).toFixed(1)}k` : t} tokens)`;
}

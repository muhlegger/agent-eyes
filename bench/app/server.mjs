// A small property-listing app used by bench/run.mjs. It reproduces what made agents retry in real work:
// a login form that only works once its script chunk arrives, data that loads late, client-side navigation,
// and detail pages behind ids that change on every start. Planted defects are listed in bench/answer-key.md
// (kept out of the folder the agents work in).
//   node bench/app/server.mjs [port]  -> prints the base URL
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const file = (n) => readFileSync(path.join(here, n), "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const names = [
  ["Rua das Palmeiras, 120", "Apartment", 2, 68, 412000],
  ["Av. Atlântica, 3410", "Apartment", 3, 104, 1180000],
  ["Rua Harmonia, 77", "House", 3, 150, 890000],
  ["Alameda Santos, 900", "Studio", 1, 34, 365000],
  ["Rua do Bosque, 15", "House", 4, 210, 1320000],
  ["Rua Jaraguá, 402", "Apartment", 2, 59, 298000],
];
const listings = names.map(([address, kind, rooms, area, price]) => ({
  id: randomBytes(3).toString("hex"), address, kind, rooms, area, price,
  costs: [
    ["Purchase price", price], ["Transfer tax (3%)", price * 0.03], ["Registry and notary", 4800 + price * 0.004],
    ["Renovation estimate", area * 950], ["Condo fees in arrears", 7200], ["Broker commission (5%)", price * 0.05],
  ],
}));

const session = (req) => /(?:^|;\s*)sid=ok/.test(req.headers.cookie ?? "");
const send = (res, code, type, body, headers = {}) => { res.writeHead(code, { "content-type": type, ...headers }); res.end(body); };

export function start(port = 0) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    if (p === "/login") return send(res, 200, "text/html", file("login.html"));
    if (p === "/assets/login-chunk.js") { await sleep(900); return send(res, 200, "text/javascript", file("login-chunk.js")); }
    if (p === "/assets/app.js") { await sleep(300); return send(res, 200, "text/javascript", file("app.js")); }
    if (p === "/assets/app.css") return send(res, 200, "text/css", file("app.css"));
    if (p === "/api/session" && req.method === "POST") return send(res, 200, "application/json", "{}", { "set-cookie": "sid=ok; Path=/; HttpOnly" });
    if (p.startsWith("/api/")) {
      if (!session(req)) return send(res, 401, "application/json", '{"error":"unauthorized"}');
      if (p === "/api/listings") { await sleep(500); return send(res, 200, "application/json", JSON.stringify(listings.map(({ costs, ...l }) => l))); }
      if (p === "/api/notice") { await sleep(1100); return send(res, 200, "application/json", JSON.stringify({ text: "Auction calendar updated: 3 new dates this week. Review the listings marked as new before Friday." })); }
      const m = p.match(/^\/api\/listings\/([0-9a-f]+)$/);
      const l = m && listings.find((x) => x.id === m[1]);
      if (l) { await sleep(400); return send(res, 200, "application/json", JSON.stringify(l)); }
      return send(res, 404, "application/json", '{"error":"not found"}');
    }
    if (p === "/" ) return send(res, 302, "text/plain", "", { location: session(req) ? "/app" : "/login" });
    if (p === "/app" || p.startsWith("/app/")) {
      if (!session(req)) return send(res, 302, "text/plain", "", { location: "/login" });
      return send(res, 200, "text/html", file("shell.html"));
    }
    send(res, 404, "text/plain", "not found");
  });
  return new Promise((resolve) => server.listen(port, () => resolve({ server, base: `http://localhost:${server.address().port}` })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { base } = await start(Number(process.argv[2] ?? 0));
  console.log(base);
}

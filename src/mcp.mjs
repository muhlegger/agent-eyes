// agent-eyes as an MCP server over stdio, for agents that take tools from MCP (Cursor, Windsurf, Claude
// Desktop, ...) instead of a shell. Tools-only, so the protocol is small enough to speak directly:
// newline-delimited JSON-RPC, no SDK. The same runner as the command line; images come back as file
// paths with their token cost, and the agent asks for the ones it needs (view_image).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { compareFiles } from "./combine.mjs";
import { friendly, report, runChecks } from "./run.mjs";
import { pngSize } from "./tokens.mjs";

const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS = `agent-eyes lets you see a web app's UI after changing it. Work cheaply:
1. Put the whole check in ONE check_ui call: every screen, width and interaction, as a list of checks.
2. Read the text first: overflow, content that jumps after load, page errors, failed actions and motion
   glitches come back as text.
3. Call view_image only for the images the text can't answer (does the layout look right), preferring crops.
   Each image is listed with its token cost.
Actions are real (clicking Save saves): point it at a dev or test environment.`;

const CHECK = {
  type: "object",
  required: ["route"],
  properties: {
    route: { type: "string", description: 'Path to open, e.g. "/orders" or "/orders/{id}" ({id} is filled from vars).' },
    name: { type: "string", description: "Short name for this check's files and report lines." },
    widths: { type: "array", items: { type: "string" }, description: 'Viewport widths for this check, e.g. ["1440","390"] or ["1536x730"]. Give each check only the widths it needs.' },
    actions: { type: "array", items: { type: "string" }, description: 'Run in order before the screenshot: "click:<sel>", "hover:<sel>", "scroll:<px|sel>", "wait:<ms>", "type:<sel>=<text>", "press:<Key>". <sel> is a Playwright selector ("text=Save", CSS).' },
    element: { type: "string", description: "Crop the screenshot to this selector (much cheaper to view than a full screen)." },
    frames: { type: ["boolean", "integer"], description: "Record the motion of the last action at real speed into one frame-strip image, and report shrink-and-return, snaps, flicker, disappearing and browser freezes as text. true = 10 frames." },
    measure: { type: "string", description: "With frames: the element that should move (the panel, the column), measured and cropped to. Defaults to element." },
    full: { type: "boolean", description: "The whole scrolling page instead of the first screen." },
    eachStep: { type: "boolean", description: "Also a screenshot after each action." },
  },
};

const TOOLS = [
  {
    name: "check_ui",
    description: "Look at a running web app after a UI change: screenshots (logged in via agent-eyes.config.json, at the widths you ask, after clicks/hovers), plus findings as text: horizontal scroll, content that jumped after load, page errors, server 5xx, actions that missed, and animation glitches (shrink, snap, flicker, freeze). Returns image file paths with their token cost; open only the ones you need with view_image. Put every screen and interaction in one call.",
    inputSchema: {
      type: "object",
      required: ["checks"],
      properties: {
        checks: { type: "array", items: CHECK, minItems: 1, description: "Everything to verify, in one call." },
        baseUrl: { type: "string", description: 'e.g. "http://localhost:3000". Optional when agent-eyes.config.json has "baseUrl".' },
        projectDir: { type: "string", description: "Absolute path of the project (where agent-eyes.config.json lives, and where relative paths resolve). Default: the server's working directory." },
        widths: { type: "array", items: { type: "string" }, description: "Default widths for checks that give none (default: the config's, else 1440 and 390)." },
        vars: { type: "object", additionalProperties: { type: "string" }, description: 'Values for {name} in routes, e.g. {"id":"42"}.' },
        out: { type: "string", description: "Folder for the images (default ./agent-eyes-out). Use a separate folder to keep a baseline before editing." },
        compare: { type: "string", description: 'Folder of a previous run: each screenshot is compared pixel by pixel with the one of the same name. "identical" means nothing to look at; otherwise one side-by-side image with the changed regions boxed in red, listed as text.' },
        config: { type: "string", description: "Config file, if not ./agent-eyes.config.json." },
        wait: { type: "integer", description: "Milliseconds to wait after each page loads (default 1200)." },
      },
    },
  },
  {
    name: "view_image",
    description: "Open one PNG that check_ui or compare_images listed. Costs the tokens printed next to it, and it stays in your context: open only what the text findings can't answer.",
    inputSchema: { type: "object", required: ["path"], properties: { path: { type: "string", description: "Path as printed by check_ui." } } },
  },
  {
    name: "compare_images",
    description: 'Compare two PNG files pixel by pixel: "identical", or a side-by-side image with each changed region boxed in red, plus the regions as text.',
    inputSchema: {
      type: "object",
      required: ["before", "after", "out"],
      properties: { before: { type: "string" }, after: { type: "string" }, out: { type: "string", description: "Where to write the side-by-side PNG." } },
    },
  },
];

const text = (t, isError = false) => ({ content: [{ type: "text", text: t }], ...(isError && { isError: true }) });

async function call(name, a = {}) {
  if (name === "check_ui") {
    const r = await runChecks({ base: a.baseUrl, checks: a.checks, widths: a.widths, vars: a.vars, out: a.out,
      compare: a.compare, configFile: a.config, wait: a.wait, cwd: a.projectDir });
    return text(report(r));
  }
  if (name === "view_image") {
    const file = path.resolve(String(a.path ?? ""));
    if (!existsSync(file) || !pngSize(file)) return text(`not a PNG file: ${file}`, true);
    return { content: [{ type: "image", data: readFileSync(file).toString("base64"), mimeType: "image/png" }] };
  }
  if (name === "compare_images") return text(await compareFiles(a.before, a.after, a.out));
  throw Object.assign(new Error(`unknown tool: ${name}`), { code: -32602 });
}

export function serve({ input = process.stdin, output = process.stdout } = {}) {
  const send = (m) => output.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`);
  let queue = Promise.resolve(); // one browser run at a time: runs share the saved login session

  async function handle(msg) {
    const { id, method, params } = msg;
    if (id === undefined || id === null) return; // notifications need no answer
    try {
      if (method === "initialize") {
        return send({ id, result: {
          protocolVersion: PROTOCOLS.includes(params?.protocolVersion) ? params.protocolVersion : PROTOCOLS[0],
          capabilities: { tools: {} },
          serverInfo: { name: "agent-eyes", version: VERSION },
          instructions: INSTRUCTIONS,
        } });
      }
      if (method === "ping") return send({ id, result: {} });
      if (method === "tools/list") return send({ id, result: { tools: TOOLS } });
      if (method === "tools/call") {
        const run = queue.then(() => call(params?.name, params?.arguments));
        queue = run.catch(() => {});
        try { return send({ id, result: await run }); }
        catch (e) {
          if (e.code) throw e;
          // A failed run is a tool result the agent can read and act on, not a protocol error.
          return send({ id, result: text(`agent-eyes: ${friendly(e)}`, true) });
        }
      }
      send({ id, error: { code: -32601, message: `method not found: ${method}` } });
    } catch (e) {
      send({ id, error: { code: e.code ?? -32603, message: e.message } });
    }
  }

  return new Promise((done) => {
    const pending = new Set();
    const rl = createInterface({ input });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      let msg;
      try { msg = JSON.parse(line); } catch { return send({ id: null, error: { code: -32700, message: "parse error" } }); }
      const p = handle(msg).finally(() => pending.delete(p));
      pending.add(p);
    });
    rl.on("close", () => Promise.allSettled([...pending]).then(done));
  });
}

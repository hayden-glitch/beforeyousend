#!/usr/bin/env node
// comps-shot.mjs — render the three final-candidate comps (local file:// pages)
// to honest PNG screenshots at desktop 1440 and mobile 390, per surface.
// Home captures the hero at three phases: panic (held), strike (X crossed),
// calm (resolved) via the comps' capture-only phase override.
// Usage: node comps-shot.mjs [outdir]
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, appendFileSync, existsSync } from "node:fs";
const CHROME = "/root/.agent-browser/browsers/chrome-151.0.7922.76/chrome";
const PORT = 34111;
const PROFILE = "/tmp/final-comps-profile";
const BASE = "file:///home/team/shared/site/docs/final-candidate-comps";
const OUT = process.argv[2] || "/home/team/shared/site/docs/final-candidate-comps/screenshots";
const LOG = OUT + "/capture-log.jsonl";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!existsSync(CHROME)) { console.error("FATAL: chrome not found:", CHROME); process.exit(1); }
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--hide-scrollbars",
  "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
  "--window-size=1440,900", "--force-device-scale-factor=1",
], { stdio: "ignore" });
let wsUrl = null;
for (let i = 0; i < 80; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = list.find((t) => t.type === "page");
    if (page && page.webSocketDebuggerUrl) { wsUrl = page.webSocketDebuggerUrl; break; }
  } catch { /* retry */ }
  await sleep(500);
}
if (!wsUrl) { console.error("FATAL: no CDP page target"); process.exit(1); }
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
};
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++msgId; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
await send("Page.enable"); await send("Runtime.enable");
const evalJs = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error("eval: " + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result?.value;
};
const setViewport = (w, h, mobile) => send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
const nav = async (url) => { url = url.split("#")[0] + "?t=" + Date.now() + "#" + (url.split("#")[1]||"");
  const base = url.split("#")[0].split("?")[0];
  const wantHash = url.split("#")[1] || "";
  await send("Page.navigate", { url });
  // Wait for the NEW document to commit: poll location.href until the target
  // base + hash are present (readyState "complete" can briefly report the old
  // document before a file:// navigation commits).
  for (let i = 0; i < 200; i++) {
    const cur = await evalJs("location.href").catch(() => "");
    if (cur && cur.split("#")[0].split("?")[0] === base && (cur.split("#")[1] || "") === wantHash) break;
    await sleep(150);
  }
  for (let i = 0; i < 120; i++) { if ((await evalJs("document.readyState")) === "complete") break; await sleep(200); }
  await evalJs("document.fonts && document.fonts.ready ? document.fonts.ready.then(()=>true) : true").catch(() => {});
  await sleep(400);
};
const shot = async (file) => {
  const active = await evalJs("document.querySelector(\".bys-page.active\")?.id||null").catch(()=>null);
  const fp = await evalJs("document.title.slice(0,20)+\"|H\"+document.documentElement.scrollHeight").catch(()=>"?");
  const r = await send("Page.captureScreenshot", { format: "png" });
  const bytes = Buffer.from(r.data, "base64");
  writeFileSync(`${OUT}/${file}`, bytes);
  appendFileSync(LOG, JSON.stringify({ file, bytes: bytes.length, active, fp }) + "\n");
  console.log(`  [shot] ${file} bytes=${bytes.length} active=${active} fp=${fp}`);
  if (bytes.length < 8000) console.log(`    !! suspiciously small: ${file}`);
};
const COMP = ["comp-a-workbench", "comp-b-midnight", "comp-c-decision"];
const SHORT = { "comp-a-workbench": "a", "comp-b-midnight": "b", "comp-c-decision": "c" };
const run = async () => {
  for (const c of COMP) { if (process.env.COMP_ONLY && c !== process.env.COMP_ONLY) continue;
    const tag = SHORT[c];
    console.log(`== ${c} ==`);
    // ---- desktop 1440 ----
    await setViewport(1440, 900, false);
    await nav(`${BASE}/${c}.html#home&phase=panic`);  await shot(`comp-${tag}-home-panic-1440.png`);
    await nav(`${BASE}/${c}.html#home&phase=strike`); await shot(`comp-${tag}-home-strike-1440.png`);
    await nav(`${BASE}/${c}.html#home&phase=calm`);   await shot(`comp-${tag}-home-calm-1440.png`);
    await nav(`${BASE}/${c}.html#pricing`);           await shot(`comp-${tag}-pricing-1440.png`);
    await nav(`${BASE}/${c}.html#results`);           await shot(`comp-${tag}-results-1440.png`);
    // ---- mobile 390 ----
    await setViewport(390, 844, true);
    await nav(`${BASE}/${c}.html#home&phase=panic`);  await shot(`comp-${tag}-home-panic-390.png`);
    await nav(`${BASE}/${c}.html#home&phase=strike`); await shot(`comp-${tag}-home-strike-390.png`);
    await nav(`${BASE}/${c}.html#home&phase=calm`);   await shot(`comp-${tag}-home-calm-390.png`);
    await nav(`${BASE}/${c}.html#pricing`);           await shot(`comp-${tag}-pricing-390.png`);
    await nav(`${BASE}/${c}.html#results`);           await shot(`comp-${tag}-results-390.png`);
  }
  console.log("DONE-COMPS");
  process.exit(0);
};
run().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });

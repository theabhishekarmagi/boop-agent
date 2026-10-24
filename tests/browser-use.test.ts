import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalResearchBrowser, type BrowserConfig, type BrowserWorker, type BrowserPage } from "../server/browser-use.js";
import { BROWSER_NAMESPACE, browserConfig, localBrowserEnabled, createLocalBrowserTools } from "../server/browser-tools.js";
import { OPERATOR_OWNER, runInWorkspace } from "../server/workspace-context.js";
import { runAgentQuery } from "../server/openai-runtime.js";
import { ScriptedModel, assistantMessage, functionCall } from "@openai/agents-core/testing";
const config: BrowserConfig = { origins: ["https://allowed.test"], headless: true, idleMs: 60_000, maxPages: 2 };
const validate = async (url: string) => new URL(url);
function fake() {
  let launches = 0, closes = 0, nextTab = 0, snapshot = 0;
  const pages = new Set<string>();
  const result = (tab: string, offset = 0): BrowserPage => ({ tab, snapshot: ++snapshot, url: "https://allowed.test/", title: "fixture", content: "Live page", offset, totalChars: 9, nextOffset: null, truncated: false });
  const factory = async (): Promise<BrowserWorker> => {
    launches++;
    return {
      open: async () => { if (pages.size >= config.maxPages) throw new Error("Tab limit"); const tab = `tab-${++nextTab}`; pages.add(tab); return result(tab); },
      read: async (tab, offset) => { if (!pages.has(tab)) throw new Error("Unknown tab"); return result(tab, offset); },
      follow: async (tab, token) => { if (token !== snapshot) throw new Error("Stale snapshot"); return result(tab); },
      closeTab: async tab => { if (!pages.delete(tab)) throw new Error("Unknown tab"); return { closed: tab }; },
      close: async () => { closes++; pages.clear(); },
    };
  };
  return { factory, get launches() { return launches; }, get closes() { return closes; } };
}
function env(values: Record<string, string>, run: () => void) {
  const saved = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]])); Object.assign(process.env, values);
  try { run(); } finally { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}
test("Browser Use is opt-in, local operator only, and unavailable in production/public mode", () => {
  env({ BOOP_BROWSER_ENABLED: "true", NODE_ENV: "development", BOOP_PUBLIC_MODE: "false" }, () => {
    assert.equal(localBrowserEnabled(), false);
    runInWorkspace("customer", () => assert.equal(localBrowserEnabled(), false));
    runInWorkspace(OPERATOR_OWNER, () => {
      assert.equal(localBrowserEnabled(), true); process.env.NODE_ENV = "production"; assert.equal(localBrowserEnabled(), false);
      process.env.NODE_ENV = "development"; process.env.BOOP_PUBLIC_MODE = "true"; assert.equal(localBrowserEnabled(), false);
    });
  });
});
test("origin configuration rejects credentials, paths and private HTTP fixtures", () => {
  for (const value of ["http://127.0.0.1", "https://user:pass@allowed.test", "https://allowed.test/path"]) env({ BOOP_BROWSER_ORIGINS: value }, () => assert.throws(browserConfig));
});
test("workers are lazy, reused inside a task, and closed exactly once", async () => runInWorkspace(OPERATOR_OWNER, async () => {
  const f = fake(); const session = new LocalResearchBrowser(config, undefined, f.factory, validate);
  try {
    assert.equal(createLocalBrowserTools(undefined, session).tools.length, 4); assert.equal(f.launches, 0);
    const first = await session.open("https://allowed.test/"); await session.read(first.tab);
    assert.equal(f.launches, 1);
    await assert.rejects(session.follow(first.tab, first.snapshot, "1"), /Stale/);
    await assert.rejects(runInWorkspace("other", () => session.read(first.tab)), /workspace/);
    await assert.rejects(session.open("https://blocked.test/"), /origin/);
  } finally { await Promise.all([session.close(), session.close()]); }
  assert.equal(f.closes, 1); await assert.rejects(session.read("tab-1"), /ended/);
}));
test("cancelled launches clean up and release the single worker slot", async () => runInWorkspace(OPERATOR_OWNER, async () => {
  const f = fake(); const abort = new AbortController(); let resume!: () => void;
  const gate = new Promise<void>(resolve => { resume = resolve; });
  const session = new LocalResearchBrowser(config, abort.signal, async () => { await gate; return f.factory(); }, validate);
  const opening = session.open("https://allowed.test/"); await new Promise<void>(resolve => setImmediate(resolve));
  abort.abort(); resume(); await assert.rejects(opening); await session.close(); assert.equal(f.closes, 1);
  const next = new LocalResearchBrowser(config, undefined, f.factory, validate);
  try { await next.open("https://allowed.test/"); } finally { await next.close(); }
}));
test("idle sessions close and concurrent tasks never share the worker", async () => runInWorkspace(OPERATOR_OWNER, async () => {
  const f = fake(); const a = new LocalResearchBrowser({ ...config, idleMs: 10 }, undefined, f.factory, validate);
  const b = new LocalResearchBrowser(config, undefined, f.factory, validate);
  try {
    await a.open("https://allowed.test/"); await assert.rejects(b.open("https://allowed.test/"), /busy/);
    await new Promise(resolve => setTimeout(resolve, 30)); await a.close(); assert.equal(f.closes, 1);
    await b.open("https://allowed.test/");
  } finally { await a.close(); await b.close(); }
}));
test("worker failures cannot leak the concurrency slot", async () => runInWorkspace(OPERATOR_OWNER, async () => {
  const session = new LocalResearchBrowser(config, undefined, async () => { throw new Error("Worker failed"); }, validate);
  await assert.rejects(session.open("https://allowed.test/"), /Worker failed/); await session.close();
  const f = fake(); const next = new LocalResearchBrowser(config, undefined, f.factory, validate);
  try { await next.open("https://allowed.test/"); } finally { await next.close(); }
}));
test("actual runtime registers the nonreserved namespace without starting browsers", async () => runInWorkspace(OPERATOR_OWNER, async () => {
  const keys = ["BOOP_BROWSER_ENABLED", "NODE_ENV", "BOOP_PUBLIC_MODE"];
  const saved = keys.map(key => process.env[key]);
  Object.assign(process.env, { BOOP_BROWSER_ENABLED: "true", NODE_ENV: "development", BOOP_PUBLIC_MODE: "false" });
  try {
    const model = new ScriptedModel([[functionCall("BrowserOpen", { url: "http://127.0.0.1" }, { callId: "denied", namespace: BROWSER_NAMESPACE })], [assistantMessage("Blocked")]]);
    for await (const _ of runAgentQuery({ prompt: "test", options: { systemPrompt: "test", research: true } }, model)) {}
    assert.match(JSON.stringify(model.calls[1].request.input), /not enabled/);
    const definitions = model.calls[0].request.tools.filter(t => t.type === "function" && t.name.startsWith("Browser"));
    assert.equal(definitions.length, 4); assert(definitions.every(t => t.type === "function" && t.namespace === BROWSER_NAMESPACE));
    const other = new ScriptedModel([[assistantMessage("No browser")]]);
    await runInWorkspace("customer", async () => { for await (const _ of runAgentQuery({ prompt: "test", options: { systemPrompt: "test", research: true } }, other)) {} });
    assert.doesNotMatch(JSON.stringify(other.calls[0].request.tools), /BrowserOpen/);
  } finally { keys.forEach((key, index) => { if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index]; }); }
}));

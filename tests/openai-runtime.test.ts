import { test } from "node:test";
import assert from "node:assert/strict";
import { Usage } from "@openai/agents";
import { ScriptedModel, assistantMessage, functionCall, modelError } from "@openai/agents-core/testing";
import { z } from "zod";
import { runAgentQuery, tool, createToolGroup, buildTools } from "../server/openai-runtime.js";
import { mainModel, resolveModelInput } from "../server/model-config.js";
import { validatePublicUrl, researchTools } from "../server/research-tools.js";

async function collect(model: ScriptedModel, extra = {}) {
  return gather(runAgentQuery({ prompt: "task", options: { systemPrompt: "Boop", ...extra } }, model));
}
test("real SDK executes scoped tools, continues locally, and counts all turns", async () => {
  let executions = 0;
  const group = createToolGroup({ name: "memory", tools: [tool("recall", "Recall", { query: z.string() }, async ({ query }) => {
    executions++; assert.equal(query, "preferences");
    return { content: [{ type: "text", text: "Likes tea" }] };
  })] });
  const model = new ScriptedModel([
    { output: [functionCall("mcp__memory__recall", { query: "preferences" }, { callId: "call_1", namespace: "memory" })], usage: new Usage({ inputTokens: 100, outputTokens: 10, inputTokensDetails: { cached_tokens: 20 } }) },
    { output: [assistantMessage("You like tea.")], usage: new Usage({ inputTokens: 130, outputTokens: 20, inputTokensDetails: { cached_tokens: 30 } }) },
  ]);
  const events = await collect(model, { toolGroups: { memory: group }, allowedTools: ["mcp__memory__recall"] });
  assert.equal(executions, 1);
  assert.equal(events.at(-1)?.type, "result");
  const usage = events.find((e) => e.type === "result")!;
  assert.equal(usage.usage.inputTokens, 230); assert.equal(usage.usage.outputTokens, 30); assert.equal(usage.usage.cacheReadTokens, 50);
  assert(events.some((e) => e.type === "user" && e.message.content[0].content === "Likes tea"));
  assert(events.some((e) => e.type === "assistant" && e.message.content.some((b) => b.type === "text" && b.text === "You like tea.")));
  assert.equal(model.calls[0].request.modelSettings.store, false);
  assert.deepEqual(model.calls[0].request.modelSettings.providerData?.include, ["reasoning.encrypted_content"]);
  const continuation = model.calls[1].request.input;
  assert(Array.isArray(continuation));
  assert(continuation.some((i) => i.type === "function_call_result"));
  model.assertComplete();
});
test("dispatcher allowlist excludes unselected tools and bounds long names", () => {
  const make = (name: string) => tool(name, name, {}, async () => ({ content: [] }));
  const { tools, names } = buildTools({ gmail: createToolGroup({ name: "gmail", tools: [make("read"), make("send"), make("x".repeat(90))] }) }, ["mcp__gmail__read", "mcp__gmail__x*"]);
  assert.equal(tools.length, 2); assert(![...names.values()].includes("mcp__gmail__send"));
  assert(tools.every((t) => t.type === "function" && t.name.length <= 64));
});
test("failed streams propagate an error instead of a completed response", async () => {
  await assert.rejects(collect(new ScriptedModel([modelError(new Error("quota exhausted"))])), /quota exhausted/);
});
test("pre-cancelled agents never call a model", async () => {
  const abortController = new AbortController(); abortController.abort();
  const model = new ScriptedModel([[assistantMessage("should not run")]]);
  await assert.rejects(collect(model, { abortController })); assert.equal(model.calls.length, 0);
});
test("public-page reader blocks local and credential-bearing URLs", async () => {
  for (const url of ["http://127.0.0.1", "http://10.0.0.1", "http://[::1]", "file:///etc/passwd", "https://user:pass@example.com"]) {
    await assert.rejects(validatePublicUrl(url));
  }
});
test("execution exposes the existing project skill playbooks", async () => {
  const tools = await researchTools(undefined, true);
  const skill = tools.find((t) => t.type === "function" && t.name === "Skill");
  assert(skill?.type === "function"); assert.match(skill.description, /youtube-script-writer/);
});
test("legacy Claude settings fall back to the OpenAI default", () => {
  const old = process.env.BOOP_MODEL; process.env.BOOP_MODEL = "claude-sonnet-4-6";
  try { assert.equal(mainModel(), "gpt-6.1-sol"); assert.equal(resolveModelInput("fast"), "gpt-6-luna"); }
  finally { if (old === undefined) delete process.env.BOOP_MODEL; else process.env.BOOP_MODEL = old; }
});
test("model aliases respect the installation's account-compatible configured models", () => {
  const old = process.env.BOOP_MODEL; const oldSmall = process.env.BOOP_SMALL_MODEL;
  process.env.BOOP_MODEL = "gpt-5.6-sol"; process.env.BOOP_SMALL_MODEL = "gpt-5.6-luna";
  try {
    assert.equal(resolveModelInput("balanced"), "gpt-5.6-sol");
    assert.equal(resolveModelInput("fast"), "gpt-5.6-luna");
  } finally {
    if (old === undefined) delete process.env.BOOP_MODEL; else process.env.BOOP_MODEL = old;
    if (oldSmall === undefined) delete process.env.BOOP_SMALL_MODEL; else process.env.BOOP_SMALL_MODEL = oldSmall;
  }
});

async function gather<T>(items: AsyncIterable<T>): Promise<T[]> { const result: T[] = []; for await (const item of items) result.push(item); return result; }

test("project file and shell capabilities execute through the SDK for skills", async () => {
  const { localTools } = await import("../server/local-tools.js");
  const { mkdtemp, readFile, rm } = await import("node:fs/promises");
  const { join, relative } = await import("node:path");
  const dir = await mkdtemp(join(process.cwd(), ".boop-test-")); const path = relative(process.cwd(), join(dir, "note.txt"));
  const calls = [
    functionCall("mcp__local__Write", { file_path: path, content: "tea" }, { callId: "write", namespace: "local" }),
    functionCall("mcp__local__Edit", { file_path: path, old_string: "tea", new_string: "coffee", replace_all: false }, { callId: "edit", namespace: "local" }),
    functionCall("mcp__local__Bash", { command: "printf 'skill script completed'", timeout: null }, { callId: "shell", namespace: "local" }),
  ];
  const model = new ScriptedModel([...calls.map((call) => [call]), [assistantMessage("Done")]]);
  try {
    const events = await collect(model, { toolGroups: { local: createToolGroup({ name: "local", tools: localTools() }) } });
    assert.equal(await readFile(join(dir, "note.txt"), "utf8"), "coffee");
    assert(events.some((e) => e.type === "user" && e.message.content[0].content === "skill script completed"));
    model.assertComplete();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("long tasks retain the original uncapped model-turn behavior", async () => {
  const tools = createToolGroup({ name: "work", tools: [tool("step", "Work step", {}, async () => ({ content: [{ type: "text", text: "ok" }] }))] });
  const model = new ScriptedModel([...Array.from({ length: 12 }, (_, n) => [functionCall("mcp__work__step", {}, { callId: `step_${n}`, namespace: "work" })]), [assistantMessage("Complete")]]);
  await collect(model, { toolGroups: { work: tools } });
  assert.equal(model.calls.length, 13); model.assertComplete();
});

test("oversized provider results are bounded and details can be read without repeating the action", async () => {
  let executions = 0;
  const payload = "a".repeat(90000) + "NEEDED-DETAIL";
  const group = createToolGroup({ name: "provider", tools: [tool("fetch", "Fetch", {}, async () => {
    executions++;
    return { content: [{ type: "text", text: payload }] };
  })] });
  const model = new ScriptedModel([
    [functionCall("mcp__provider__fetch", {}, { callId: "big_result", namespace: "provider" })],
    [functionCall("read_tool_result", { call_id: "big_result", offset: 0, query: "NEEDED-DETAIL" }, { callId: "read_page" })],
    [assistantMessage("Found the requested detail.")],
  ]);
  await collect(model, { toolGroups: { provider: group } });
  const next = model.calls[1].request.input;
  assert(Array.isArray(next));
  const shortened = next.find(item => item.type === "function_call_result" && item.callId === "big_result");
  assert(shortened?.type === "function_call_result");
  const preview = JSON.stringify(shortened.output);
  assert(preview.length < 17000);
  assert.match(preview, /SHORTENED/);
  const final = model.calls[2].request.input;
  assert(Array.isArray(final));
  const recovered = final.find(item => item.type === "function_call_result" && item.callId === "read_page");
  assert(recovered?.type === "function_call_result");
  assert.match(JSON.stringify(recovered.output), /NEEDED-DETAIL/);
  assert.equal(executions, 1);
  model.assertComplete();
});

test("long tool histories shrink old outputs while preserving calls, pairs, and run isolation", async () => {
  const group = createToolGroup({ name: "provider", tools: [tool("fetch", "Fetch", {}, async () => ({ content: [{ type: "text", text: "z".repeat(40000) }] }))] });
  const model = new ScriptedModel([
    ...Array.from({ length: 8 }, (_, n) => [functionCall("mcp__provider__fetch", {}, { callId: `result_${n}`, namespace: "provider" })]),
    [assistantMessage("Done")],
  ]);
  await collect(model, { toolGroups: { provider: group } });
  const final = model.calls[8].request.input;
  assert(Array.isArray(final));
  const outputs = final.filter(item => item.type === "function_call_result");
  assert.equal(outputs.length, 8);
  assert.equal(final.filter(item => item.type === "function_call").length, 8);
  assert(JSON.stringify(outputs[0]).length < 2000);
  assert(JSON.stringify(outputs).length < 65000);
  const stranger = new ScriptedModel([
    [functionCall("read_tool_result", { call_id: "result_0", offset: 0, query: null }, { callId: "other_run" })],
    [assistantMessage("Unavailable")],
  ]);
  await collect(stranger);
  assert.match(JSON.stringify(stranger.calls[1].request.input), /Unknown result/);
});

test("a mistaken semantic search returns a usable result page with literal-search guidance", async () => {
  const payload = "Relevant email content. ".repeat(2000);
  const group = createToolGroup({name:"provider", tools:[tool("fetch","Fetch",{},async()=>({content:[{type:"text",text:payload}]}))]});
  const model = new ScriptedModel([
    [functionCall("mcp__provider__fetch",{}, {callId:"large", namespace:"provider"})],
    [functionCall("read_tool_result",{call_id:"large",offset:0,query:"Please return all important email contents"},{callId:"read"})],
    [assistantMessage("Read the result without running remote Python.")],
  ]);
  await collect(model,{toolGroups:{provider:group}});
  const history = JSON.stringify(model.calls[2].request.input);
  assert.match(history,/Relevant email content/); assert.match(history,/No exact literal match/);
  assert.match(history,/not a semantic search/); model.assertComplete();
});

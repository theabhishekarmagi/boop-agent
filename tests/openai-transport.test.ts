import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { runAgentQuery, tool, createToolGroup } from "../server/openai-runtime.js";

test("actual SDK HTTP requests satisfy the ChatGPT stateless streaming contract across tools", async () => {
  const dir = await mkdtemp(join(tmpdir(), "boop-transport-"));
  const oldFetch = globalThis.fetch; const oldPath = process.env.BOOP_CHATGPT_AUTH_FILE; const oldMode = process.env.BOOP_OPENAI_AUTH;
  process.env.BOOP_OPENAI_AUTH = "chatgpt"; process.env.BOOP_CHATGPT_AUTH_FILE = join(dir, "auth.json");
  await writeFile(process.env.BOOP_CHATGPT_AUTH_FILE, JSON.stringify({ hostId: "urn:uuid:test", activeClientId: "oaiapp_test", profiles: [{ clientId: "oaiapp_test", subject: "subject", idToken: "test", accessToken: "plan-token", scopes: ["resource.invoke", "chatgpt.tokens.use.direct"], expiresAt: Date.now() + 3600_000 }] }), { mode: 0o600 });
  const bodies: Record<string, any>[] = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://api.openai.com/v1/responses");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer plan-token");
    const body = JSON.parse(String(init?.body)); bodies.push(body);
    assert.equal(body.store, false); assert.equal(body.stream, true); assert(Array.isArray(body.input));
    assert.equal(body.instructions, "You are Boop");
    for (const field of ["previous_response_id", "conversation", "max_output_tokens", "max_tool_calls", "metadata", "background", "temperature", "top_p", "truncation", "user", "prompt_cache_retention"]) assert(!Object.hasOwn(body, field), `${field} must be absent`);
    assert(!body.input.some((item: any) => item.role === "system"));
    assert(body.tools.some((t: any) => t.type === "namespace" && t.name === "memory"));
    const output = bodies.length === 1
      ? [{ type: "function_call", id: "fc_1", call_id: "call_1", name: "mcp__memory__recall", namespace: "memory", arguments: '{"query":"tea"}', status: "completed" }]
      : [{ type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Tea remembered.", annotations: [] }] }];
    const response = { id: `resp_${bodies.length}`, object: "response", created_at: 1, model: "gpt-6.1-sol", status: "completed", output, usage: { input_tokens: 30, output_tokens: 5, total_tokens: 35, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
    // Real plan streams deliver complete items separately and leave output empty
    // in the terminal envelope. Without retention the SDK loops indefinitely.
    const stream = [{ type: "response.created", response: { ...response, status: "in_progress", output: [] } },
      { type: "response.output_item.done", output_index: 0, item: output[0] },
      { type: "response.completed", response: { ...response, output: [] } }].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
    return new Response(new TextEncoder().encode(stream)); // Plan route can omit Content-Type.
  };
  try {
    const group = createToolGroup({ name: "memory", tools: [tool("recall", "Recall", { query: z.string() }, async () => ({ content: [{ type: "text", text: "Tea" }] }))] });
    const events = await gather(runAgentQuery({ prompt: "Recall", options: { systemPrompt: "You are Boop", toolGroups: { memory: group } } }));
    assert.equal(bodies.length, 2);
    assert(bodies[1].input.some((i: any) => i.type === "function_call_output" && i.call_id === "call_1"));
    assert(events.some((e) => e.type === "assistant" && e.message.content.some((b) => b.type === "text" && b.text === "Tea remembered.")));
  } finally {
    globalThis.fetch = oldFetch;
    if (oldPath === undefined) delete process.env.BOOP_CHATGPT_AUTH_FILE; else process.env.BOOP_CHATGPT_AUTH_FILE = oldPath;
    if (oldMode === undefined) delete process.env.BOOP_OPENAI_AUTH; else process.env.BOOP_OPENAI_AUTH = oldMode;
    await rm(dir, { recursive: true, force: true });
  }
});

async function gather<T>(items: AsyncIterable<T>): Promise<T[]> { const result: T[] = []; for await (const item of items) result.push(item); return result; }

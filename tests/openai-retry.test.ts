import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgentQuery, tool, createToolGroup } from "../server/openai-runtime.js";
import { modelFailureMessage } from "../server/model-retry.js";

let directory: string;
let originalFetch: typeof fetch;
let previousMode: string | undefined, previousPath: string | undefined;
beforeEach(async () => {
  originalFetch = globalThis.fetch;
  previousMode = process.env.BOOP_OPENAI_AUTH; previousPath = process.env.BOOP_CHATGPT_AUTH_FILE;
  directory = await mkdtemp(join(tmpdir(), "boop-retry-"));
  process.env.BOOP_OPENAI_AUTH = "chatgpt"; process.env.BOOP_CHATGPT_AUTH_FILE = join(directory, "auth.json");
  await writeFile(process.env.BOOP_CHATGPT_AUTH_FILE, JSON.stringify({ hostId: "urn:uuid:test", activeClientId: "oaiapp_test", profiles: [{
    clientId: "oaiapp_test", subject: "subject", idToken: "test", accessToken: "test-token",
    scopes: ["resource.invoke", "chatgpt.tokens.use.direct"], expiresAt: Date.now() + 3600_000,
  }] }), { mode: 0o600 });
});
afterEach(async () => {
  globalThis.fetch = originalFetch;
  if (previousMode === undefined) delete process.env.BOOP_OPENAI_AUTH; else process.env.BOOP_OPENAI_AUTH = previousMode;
  if (previousPath === undefined) delete process.env.BOOP_CHATGPT_AUTH_FILE; else process.env.BOOP_CHATGPT_AUTH_FILE = previousPath;
  await rm(directory, { recursive: true, force: true });
});

const socketError = () => new TypeError("fetch failed", { cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }) });
const frame = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;
let responseNumber = 0;
function completedResponse(output: unknown[]) {
  const response = { id: `resp_test_${++responseNumber}`, object: "response", created_at: 1, model: "gpt-5.6-sol", status: "completed", output,
    usage: { input_tokens: 30, output_tokens: 5, total_tokens: 35 } };
  return new Response(frame({ type: "response.created", response: { ...response, status: "in_progress", output: [] } }) +
    output.map((item, output_index) => frame({ type: "response.output_item.done", item, output_index })).join("") +
    frame({ type: "response.completed", response: { ...response, output: [] } }), { headers: { "content-type": "text/event-stream" } });
}
const answer = [{ type: "message", id: "msg_test", role: "assistant", status: "completed",
  content: [{ type: "output_text", text: "Task finished.", annotations: [] }] }];
async function run(extra = {}) {
  const events = [];
  for await (const event of runAgentQuery({ prompt: "Read the inbox", options: { systemPrompt: "Boop", ...extra } })) events.push(event);
  return events;
}

test("real SDK retries a failed model continuation without repeating the completed tool", async () => {
  let calls = 0, executions = 0;
  const continuations: unknown[] = [];
  globalThis.fetch = async (_url, init) => {
    calls++;
    if (calls > 5) throw new Error("Unexpected extra model call");
    const body = JSON.parse(String(init?.body));
    // Retry configuration must stay local rather than being sent to OpenAI.
    assert.equal(body.retry, undefined);
    if (calls === 1) return completedResponse([{ type: "function_call", id: "fc_test", call_id: "call_test",
      name: "mcp__inbox__read", namespace: "inbox", arguments: "{}", status: "completed" }]);
    continuations.push(body.input);
    if (calls === 2) throw socketError();
    if (calls === 3) return new Response('{"error":{"message":"temporarily unavailable"}}', { status: 503, headers: { "content-type": "application/json", "retry-after-ms": "1" } });
    if (calls === 4) return new Response('{"error":{"message":"slow down","code":"rate_limit_exceeded"}}', { status: 429, headers: { "content-type": "application/json", "retry-after-ms": "1" } });
    return completedResponse(answer);
  };
  const inbox = createToolGroup({ name: "inbox", tools: [tool("read", "Read inbox", {}, async () => {
    executions++; return { content: [{ type: "text", text: "Important email already fetched" }] };
  })] });
  const events = await run({ toolGroups: { inbox } });
  assert.equal(calls, 5); assert.equal(executions, 1);
  for (const input of continuations) assert.deepEqual(input, continuations[0]);
  assert.match(JSON.stringify(continuations[0]), /Important email already fetched/);
  assert.match(JSON.stringify(events), /Task finished/);
});

test("persistent connection failure stops after the bounded retry budget", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw socketError(); };
  await assert.rejects(run(), /Connection error/);
  assert.equal(calls, 4);
});

test("invalid requests, authentication errors, and exhausted quota are not retried", async () => {
  for (const [status, code] of [[400, "invalid_request_error"], [401, "invalid_api_key"], [403, "permission_denied"], [429, "insufficient_quota"]] as const) {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response(JSON.stringify({ error: { message: code, code } }), { status, headers: { "content-type": "application/json" } });
    };
    await assert.rejects(run());
    assert.equal(calls, 1, `${status}/${code} must not retry`);
  }
});

test("cancelling during backoff prevents further model requests", async () => {
  let calls = 0;
  const abortController = new AbortController();
  globalThis.fetch = async () => {
    calls++;
    setTimeout(() => abortController.abort(), 20);
    throw socketError();
  };
  await assert.rejects(run({ abortController }));
  assert.equal(calls, 1);
});

test("a broken stream after response starts is not replayed", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(frame({ type: "response.created", response: {
        id: "resp_started", object: "response", model: "gpt-5.6-sol", status: "in_progress", output: [],
      } })));
      setTimeout(() => controller.error(socketError()), 20);
    } }));
  };
  await assert.rejects(run());
  assert.equal(calls, 1);
});

test("connection failures get an actionable message without exposing provider details", () => {
  const error = new Error("Connection error", { cause: socketError() });
  assert.match(modelFailureMessage(error)!, /Some steps may already have completed/);
  assert.equal(modelFailureMessage(new Error("unrelated tool failure")), null);
});

test("provider retry veto and long Retry-After are respected", async () => {
  for (const extraHeaders of [{ "x-should-retry": "false" }, { "retry-after": "120" }] as Record<string, string>[]) {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response('{"error":{"message":"unavailable"}}', {
        status: 503, headers: { "content-type": "application/json", ...extraHeaders },
      });
    };
    await assert.rejects(run());
    assert.equal(calls, 1);
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { retainStreamedOutput } from "../server/openai-stream.js";

test("stream retention handles byte boundaries, orders items, and preserves existing output", async () => {
  const message = { id: "msg", type: "message", content: [{ type: "output_text", text: "Hello 👋" }] };
  const call = { id: "fc", type: "function_call", name: "add", arguments: "{}" };
  const events = [
    { type: "response.output_item.done", output_index: 1, item: message },
    { type: "response.output_item.done", output_index: 0, item: call },
    { type: "response.completed", response: { output: [] } },
    { type: "response.completed", response: { output: [message] } },
  ];
  const bytes = new TextEncoder().encode(events.map(e => `event: ${e.type}\r\ndata: ${JSON.stringify(e)}\r\n\r\n`).join(""));
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    // Deliberately split every UTF-8 codepoint and SSE delimiter.
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } });
  const output = await retainStreamedOutput(new Response(body)).text();
  const parsed = output.split("\n").filter(l => l.startsWith("data:")).map(l => JSON.parse(l.slice(5)));
  assert.deepEqual(parsed[2].response.output, [call, message]);
  assert.deepEqual(parsed[3].response.output, [message]);
});

test("stream retention leaves failure events and JSON HTTP errors unchanged", async () => {
  const frame = 'data: {"type":"response.failed","response":{"output":[],"error":{"code":"subscription_sharing_usage_limit_exceeded"}}}\n\n';
  assert.equal(await retainStreamedOutput(new Response(new TextEncoder().encode(frame))).text(), frame);
  const error = new Response('{"error":"unauthorized"}', { status: 401 });
  assert.equal(retainStreamedOutput(error), error);
});
test("an interrupted stream fails instead of repeating inference", async () => {
  const stream = retainStreamedOutput(new Response(new TextEncoder().encode('data: {"type":"response.created"}\n\n')));
  await assert.rejects(stream.text(), /ended before a terminal/);
});

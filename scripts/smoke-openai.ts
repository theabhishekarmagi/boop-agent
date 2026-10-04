import "../server/env-setup.js";
import { z } from "zod";
import { runAgentQuery, createToolGroup, tool } from "../server/openai-runtime.js";
import { mainModel, smallModel } from "../server/model-config.js";
import { listOpenAIModels, authMode } from "../server/openai-auth.js";

async function main() {
  const available = new Set((await listOpenAIModels()).map((m) => m.id));
  for (const model of new Set([mainModel(), smallModel()])) {
    if (!available.has(model)) throw new Error(`Configured model ${model} is unavailable. Choose a slug from npm run models.`);
    let called = false;
    const group = createToolGroup({ name: "smoke", tools: [tool("add", "Add two numbers for this connection test.", { a: z.number(), b: z.number() }, async ({ a, b }) => {
      called = true; return { content: [{ type: "text", text: String(a + b) }] };
    })] });
    let reply = "";
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(new Error("OpenAI smoke test timed out.")), 90_000);
    console.log(`Testing ${model} with ${authMode()} authentication…`);
    try {
      for await (const event of runAgentQuery({ prompt: "Call the add tool with a=2 and b=3. Then reply exactly: BOOP_OK 5", options: {
        systemPrompt: "This is a harmless connection test. Use the provided tool once, then answer.", model, toolGroups: { smoke: group }, abortController: abort,
      } })) {
        if (event.type === "assistant") for (const block of event.message.content) if (block.type === "text") reply = block.text;
      }
      if (!called || reply.trim() !== "BOOP_OK 5") throw new Error(`Smoke test did not complete correctly for ${model}.`);
      console.log(`PASS ${model}: authenticated response and local tool continuation.`);
    } finally { clearTimeout(timer); }
  }
}
main().catch((err) => { console.error(err instanceof Error ? err.message : "OpenAI smoke test failed."); process.exitCode = 1; });

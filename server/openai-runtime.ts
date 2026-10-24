import { createAgentContext, EFFICIENT_TOOLS } from "./agent-context.js";
import { isOperator } from "./workspace-context.js";
import { createHash } from "node:crypto";
import OpenAI from "openai";
import { Agent, Runner, OpenAIProvider, tool as agentTool, toolNamespace, type Tool, type FunctionTool, type Model } from "@openai/agents";
import { z } from "zod";
import { authMode, getOpenAICredential } from "./openai-auth.js";
import { mainModel } from "./model-config.js";
import { MODEL_RETRY_SETTINGS } from "./model-retry.js";
import { retainStreamedOutput } from "./openai-stream.js";
import { localTools } from "./local-tools.js";
import { BROWSER_NAMESPACE, BROWSER_INSTRUCTIONS, createLocalBrowserTools, localBrowserEnabled } from "./browser-tools.js";
import { researchTools } from "./research-tools.js";
import { costForUsage, type UsageTotals } from "./usage.js";

export interface ToolGroup { name: string; tools: Tool[] }
export interface ToolResult { content: Array<{ type: "text"; text: string }>; isError?: boolean }
/** Keep Boop's existing Zod argument contracts and handlers; the SDK executes them locally. */
export function tool<T extends z.ZodRawShape>(name: string, description: string, shape: T,
  handler: (args: z.infer<z.ZodObject<T>>) => Promise<ToolResult>): Tool {
  const schema = z.object(shape);
  return agentTool({ name, description, strict: false,
    parameters: { ...z.toJSONSchema(schema), additionalProperties: true } as FunctionTool["parameters"] & { additionalProperties: true },
    execute: async (args: unknown) => {
      const result = await handler(schema.parse(args));
      return result.content.map((item) => item.text).join("\n");
    },
  });
}
export function createToolGroup({ name, tools }: { name: string; version?: string; tools: Tool[] }): ToolGroup {
  return { name, tools };
}
export type AgentMessage =
  | { type: "assistant"; message: { content: Array<{ type: "text"; text: string } | { type: "tool_use"; name: string; input: unknown }> } }
  | { type: "user"; message: { content: Array<{ type: "tool_result"; content: string }> } }
  | { type: "result"; usage: UsageTotals };
export interface AgentOptions {
  systemPrompt: string;
  model?: string;
  toolGroups?: Record<string, ToolGroup>;
  allowedTools?: string[];
  research?: boolean;
  skills?: boolean;
  abortController?: AbortController;
}
function matches(name: string, patterns: string[]): boolean {
  return patterns.some((pattern) => pattern.endsWith("*") ? name.startsWith(pattern.slice(0, -1)) : pattern === name);
}
/** Preserve names in logs and tool scope while meeting the API's name-length limit. */
function exposedName(name: string): string {
  return name.length <= 64 ? name : `${name.slice(0, 49)}_${createHash("sha256").update(name).digest("hex").slice(0, 14)}`;
}
export function buildTools(groups: Record<string, ToolGroup>, allowed?: string[]): { tools: Tool[]; names: Map<string, string> } {
  const tools: Tool[] = [];
  const names = new Map<string, string>();
  for (const [key, group] of Object.entries(groups)) {
    const functions: FunctionTool[] = [];
    for (const definition of group.tools) {
      if (definition.type !== "function") throw new Error(`Unexpected non-function tool in ${key}.`);
      const originalName = `mcp__${key}__${definition.name}`;
      if (allowed && !matches(originalName, allowed)) continue;
      const name = exposedName(originalName);
      names.set(name, originalName);
      functions.push({ ...definition, name });
    }
    tools.push(...toolNamespace({ name: key.replace(/[^a-zA-Z0-9_]/g, "_"),
      description: `${group.name} tools scoped to this Boop agent.`, tools: functions }));
  }
  return { tools, names };
}

/** Creates the request-scoped client. Each HTTP request obtains a fresh/renewed credential. */
export function createOpenAIClient(): OpenAI {
  return new OpenAI({ apiKey: getOpenAICredential, baseURL: "https://api.openai.com/v1",
    // The runner owns the retry budget and stream safety; avoid nested retries.
    maxRetries: 0,
    fetch: async (input, init) => {
      const response = await globalThis.fetch(input, init);
      return authMode() === "chatgpt" ? retainStreamedOutput(response) : response;
    },
  });
}
/** Shared OpenAI agent runner for dispatch, execution, extraction, consolidation, and classification. */
export async function* runAgentQuery({ prompt, options }: { prompt: string; options: AgentOptions },
  injectedModel?: Model): AsyncGenerator<AgentMessage> {
  const browser = options.research && localBrowserEnabled() ? createLocalBrowserTools(options.abortController?.signal) : undefined;
  try { yield* runAgentQueryWithBrowser({ prompt, options }, injectedModel, browser); }
  finally { await browser?.close(); }
}
async function* runAgentQueryWithBrowser({ prompt, options }: { prompt: string; options: AgentOptions },
  injectedModel?: Model, browser?: ReturnType<typeof createLocalBrowserTools>): AsyncGenerator<AgentMessage> {
  const model = options.model ?? mainModel();
  const signal = options.abortController?.signal;
  signal?.throwIfAborted();
  const { tools, names } = buildTools(options.toolGroups ?? {}, options.allowedTools);
  if (options.research) {
    const research = await researchTools(signal, isOperator() && (options.skills ?? false));
    if (isOperator() && options.skills) research.push(...localTools(signal));
    // WebFetch and Skill also run locally; namespaced tools work with Plus sign-in.
    const functions = research.filter((t): t is FunctionTool => t.type === "function");
    tools.push(...research.filter((t) => t.type !== "function"),
      ...toolNamespace({ name: "research", description: "Webpage reading and project playbooks.", tools: functions }));
  }
  if (browser) {
    tools.push(...toolNamespace({ name: BROWSER_NAMESPACE, description: "Optional local browser research. Use only when APIs or WebFetch are insufficient.",
      tools: browser.tools.filter((t): t is FunctionTool => t.type === "function") }));
  }
  const context = createAgentContext();
  tools.push(context.read);
  const provider = injectedModel ? undefined : new OpenAIProvider({ openAIClient: createOpenAIClient(), useResponses: true });
  const agent = new Agent({ name: options.research ? "Boop task agent" : "Boop", instructions: options.systemPrompt + EFFICIENT_TOOLS + (browser ? "\n" + BROWSER_INSTRUCTIONS : ""),
    model: injectedModel ?? model, tools,
    modelSettings: { retry: MODEL_RETRY_SETTINGS, store: false, parallelToolCalls: false, reasoning: { effort: "low" },
      // Stateless HTTP continuation needs encrypted reasoning items in local history.
      providerData: { include: ["reasoning.encrypted_content"] } },
  });
  const runner = new Runner({ ...(provider ? { modelProvider: provider } : {}), tracingDisabled: true });
  const result = await runner.run(agent, [{ role: "user", content: prompt }], {
    stream: true, maxTurns: null, signal, callModelInputFilter: context.filter,
  });
  // Observe completion even if the stream consumer breaks early.
  void result.completed.catch(() => {});
  let finalSeen = "";
  let webSearchCalls = 0;
  try {
    for await (const event of result) {
      if (event.type !== "run_item_stream_event") continue;
      const item = event.item;
      if (item.type === "message_output_item") {
        const text = item.rawItem.content.filter((block) => block.type === "output_text")
          .map((block) => block.type === "output_text" ? block.text : "").join("");
        if (text) { finalSeen = text; yield { type: "assistant", message: { content: [{ type: "text", text }] } }; }
      } else if (item.type === "tool_call_item") {
        const raw = item.rawItem;
        if (raw.type === "function_call") {
          let input: unknown;
          try { input = JSON.parse(raw.arguments); } catch { input = raw.arguments; }
          yield { type: "assistant", message: { content: [{ type: "tool_use", name: names.get(raw.name) ?? raw.name, input }] } };
        } else if (raw.type === "hosted_tool_call") {
          if (raw.name === "web_search_call" || raw.name === "web_search") webSearchCalls++;
          yield { type: "assistant", message: { content: [{ type: "tool_use", name: raw.name, input: raw.providerData ?? {} }] } };
        }
      } else if (item.type === "tool_call_output_item") {
        yield { type: "user", message: { content: [{ type: "tool_result", content: typeof item.output === "string" ? item.output : JSON.stringify(item.output) }] } };
      }
    }
    await result.completed;
    if (result.cancelled) throw new Error("Agent cancelled.");
    if (result.interruptions.length) throw new Error("Agent stopped with an unresolved tool approval.");
    const final = result.finalOutput;
    if (typeof final === "string" && final !== finalSeen) {
      yield { type: "assistant", message: { content: [{ type: "text", text: final }] } };
    }
  } finally {
    const rawUsage = result.state._context.usage;
    const cacheReadTokens = rawUsage.inputTokensDetails.reduce((sum, entry) => sum + (entry.cached_tokens ?? 0), 0);
    const usage: UsageTotals = { model, inputTokens: rawUsage.inputTokens, outputTokens: rawUsage.outputTokens,
      cacheReadTokens, cacheCreationTokens: 0, costUsd: costForUsage(model, rawUsage.inputTokens, rawUsage.outputTokens, cacheReadTokens, webSearchCalls) };
    await provider?.close();
    yield { type: "result", usage };
  }
}

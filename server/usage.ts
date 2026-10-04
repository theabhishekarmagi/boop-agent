import type { AgentMessage } from "./openai-runtime.js";
import { authMode } from "./openai-auth.js";

export interface UsageTotals {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** API-mode estimate; ChatGPT-plan requests have no separate API charge. */
  costUsd: number;
}
export const EMPTY_USAGE: UsageTotals = {
  model: "unknown", inputTokens: 0, outputTokens: 0,
  cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0,
};
// Standard short-context API estimates, USD per million tokens. Unknown models
// return zero rather than inventing a price. The API billing dashboard is authoritative.
const RATES: Record<string, [number, number, number]> = {
  "gpt-6.1-sol": [2, 0.1, 10], "gpt-6-astra": [10, 1, 50],
  "gpt-6-luna": [0.1, 0.01, 0.5],
};
export function costForUsage(model: string, input: number, output: number, cached: number, _webCalls = 0): number {
  if (authMode() === "chatgpt") return 0;
  const rates = RATES[model];
  return rates ? (Math.max(0, input - cached) * rates[0] + cached * rates[1] + output * rates[2]) / 1e6 : 0;
}
export function aggregateUsageFromResult(msg: Extract<AgentMessage, { type: "result" }>, requestedModel?: string): UsageTotals {
  return { ...msg.usage, model: requestedModel ?? msg.usage.model };
}

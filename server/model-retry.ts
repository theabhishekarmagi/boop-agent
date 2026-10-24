import type { ModelRetrySettings, RetryPolicyContext } from "@openai/agents";

export const MODEL_RETRY_LIMIT = 3;

/** Retry one model call, never the agent run or a completed local tool. */
export function transientModelRetry(context: RetryPolicyContext) {
  const { normalized, providerAdvice, attempt } = context;
  const status = normalized.statusCode;
  if (normalized.isAbort || providerAdvice?.suggested === false ||
      context.responseStarted || context.replaySafety === "unsafe" || context.statefulRequest ||
      ["insufficient_quota", "billing_hard_limit_reached"].includes(normalized.errorCode ?? "")) return false;
  const temporary = status === undefined ? normalized.isNetworkError
    : status === 408 || status === 429 || (status >= 500 && status <= 599);
  if (!temporary) return false;
  const delayMs = providerAdvice?.retryAfterMs ?? normalized.retryAfterMs;
  // Respect provider backoff without parking a conversational task indefinitely.
  if (delayMs !== undefined && (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > 30_000)) return false;
  console.warn(`[model] temporary ${status ? `HTTP ${status}` : "connection"} failure; retry ${attempt}/${MODEL_RETRY_LIMIT}`);
  return { retry: true, ...(delayMs === undefined ? {} : { delayMs }) };
}

export const MODEL_RETRY_SETTINGS: ModelRetrySettings = {
  maxRetries: MODEL_RETRY_LIMIT,
  backoff: { initialDelayMs: 500, maxDelayMs: 4000, multiplier: 2, jitter: true },
  policy: transientModelRetry,
};

export function modelFailureMessage(error: unknown): string | null {
  const seen = new Set<unknown>();
  for (let current = error; current && typeof current === "object" && !seen.has(current);) {
    seen.add(current);
    const value = current as { name?: string; code?: string; message?: string; cause?: unknown; status?: number };
    if (value.name === "APIConnectionError" || value.name === "APIConnectionTimeoutError" ||
        /^(UND_ERR_|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN)/.test(value.code ?? "") ||
        /OpenAI stream ended before a terminal response event/.test(value.message ?? "") ||
        (typeof value.status === "number" && value.status >= 500)) {
      return "The AI connection was interrupted and Boop couldn't recover safely. Some steps may already have completed; review the task history before retrying.";
    }
    current = value.cause;
  }
  return null;
}

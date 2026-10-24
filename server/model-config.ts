// Defaults preserve the main-agent / inexpensive background-worker split.
// ChatGPT accounts can override these with slugs from `npm run models`.
export const DEFAULT_MODEL = "gpt-6.1-sol";
export const DEFAULT_SMALL_MODEL = "gpt-6-luna";
export const MODEL_ALIASES: Record<string, string> = {
  default: DEFAULT_MODEL, balanced: DEFAULT_MODEL, fast: DEFAULT_SMALL_MODEL,
  small: DEFAULT_SMALL_MODEL, powerful: "gpt-6-astra",
};
export const KNOWN_MODELS = new Set(["gpt-6.1-sol", "gpt-6-astra", "gpt-6-sol", "gpt-6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5"]);
function canonical(input: string): string | null {
  return /^(?:gpt-|o\d)[a-z0-9.-]+$/.test(input) ? input : null;
}
export function resolveModelInput(input: string): string | null {
  const value = input.trim().toLowerCase();
  if (value === "default" || value === "balanced") return canonical(process.env.BOOP_MODEL?.trim().toLowerCase() ?? "") ?? DEFAULT_MODEL;
  if (value === "small" || value === "fast") return canonical(process.env.BOOP_SMALL_MODEL?.trim().toLowerCase() ?? "") ?? DEFAULT_SMALL_MODEL;
  return MODEL_ALIASES[value] ?? canonical(value);
}
export function mainModel(): string {
  const configured = process.env.BOOP_MODEL;
  // Ignore old Claude IDs left in an existing installation's environment.
  return (configured && resolveModelInput(configured)) || DEFAULT_MODEL;
}
export function smallModel(): string {
  return resolveModelInput(process.env.BOOP_SMALL_MODEL ?? "") ?? DEFAULT_SMALL_MODEL;
}

/** The bounded read-only overview uses the installation's fast-model setting. */
export async function modelForExecution(workflow: "general" | "gmail_priority" | undefined,
  normalModel: () => Promise<string>): Promise<string> {
  return workflow === "gmail_priority" ? smallModel() : normalModel();
}

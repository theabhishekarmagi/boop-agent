import { currentOwner } from "../workspace-context.js";
import type { ToolGroup } from "../openai-runtime.js";

export interface IntegrationModule {
  name: string;
  description: string;
  requiredEnv?: string[];
  createServer: (ctx: IntegrationContext) => Promise<ToolGroup>;
}

export interface IntegrationContext {
  conversationId?: string;
  workflow?: "general" | "gmail_priority";
}

const registries = new Map<string, Map<string, IntegrationModule>>();
const loadedAt = new Map<string, number>();
const refreshing = new Map<string, Promise<void>>();
function registry(): Map<string, IntegrationModule> {
  const owner = currentOwner();
  let map = registries.get(owner);
  if (!map) { map = new Map(); registries.set(owner, map); }
  return map;
}

export function registerIntegration(mod: IntegrationModule): void {
  registry().set(mod.name, mod);
}

export function listIntegrations(): IntegrationModule[] {
  return [...registry().values()];
}

export function getIntegration(name: string): IntegrationModule | undefined {
  return registry().get(name);
}

export async function loadIntegrations(): Promise<void> {
  const { registerComposioToolkits } = await import("./composio-loader.js");
  await registerComposioToolkits();
  loadedAt.set(currentOwner(), Date.now());
  const loaded = [...registry().keys()];
  console.log(
    `[integrations] loaded: ${loaded.join(", ") || "(none — connect a toolkit from the Debug UI's Connections tab)"}`,
  );
}

export async function ensureIntegrations(): Promise<void> {
  const inFlight = refreshing.get(currentOwner());
  if (inFlight) return inFlight;
  if (Date.now() - (loadedAt.get(currentOwner()) ?? 0) > 60_000) {
    await refreshIntegrations();
  }
}

export async function refreshIntegrations(): Promise<void> {
  const owner = currentOwner();
  const existing = refreshing.get(owner);
  if (existing) return existing;
  const work = (async () => {
    const previous = new Map(registry());
    registry().clear();
    try { await loadIntegrations(); }
    catch (error) {
      registries.set(owner, previous);
      throw error;
    }
  })();
  refreshing.set(owner, work);
  try { await work; }
  finally { if (refreshing.get(owner) === work) refreshing.delete(owner); }
}

export function makeContext(conversationId?: string, workflow?: IntegrationContext["workflow"]): IntegrationContext {
  return { conversationId, workflow };
}

export async function buildMcpServersForIntegrations(
  names: string[],
  conversationId?: string,
  workflow?: IntegrationContext["workflow"],
): Promise<Record<string, ToolGroup>> {
  const ctx = makeContext(conversationId, workflow);
  const out: Record<string, ToolGroup> = {};
  // Independent integration sessions need not add their setup latency serially.
  const entries = await Promise.all([...new Set(names)].map(async name => {
    const mod = registry().get(name);
    if (!mod) {
      console.warn(`[integrations] unknown integration: ${name}`);
      return undefined;
    }
    try { return [name, await mod.createServer(ctx)] as const; }
    catch {
      // Upstream SDK errors may carry credential-bearing request details.
      console.warn(`[integrations] failed to build ${name}`);
      return undefined;
    }
  }));
  for (const entry of entries) if (entry) out[entry[0]] = entry[1];
  return out;
}

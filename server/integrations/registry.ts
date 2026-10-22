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
}

const registries = new Map<string, Map<string, IntegrationModule>>();
const loadedAt = new Map<string, number>();
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
  if (Date.now() - (loadedAt.get(currentOwner()) ?? 0) > 60_000) {
    await refreshIntegrations();
  }
}

export async function refreshIntegrations(): Promise<void> {
  registry().clear();
  await loadIntegrations();
}

export function makeContext(conversationId?: string): IntegrationContext {
  return { conversationId };
}

export async function buildMcpServersForIntegrations(
  names: string[],
  conversationId?: string,
): Promise<Record<string, ToolGroup>> {
  const ctx = makeContext(conversationId);
  const out: Record<string, ToolGroup> = {};
  for (const name of names) {
    const mod = registry().get(name);
    if (!mod) {
      console.warn(`[integrations] unknown integration: ${name}`);
      continue;
    }
    try {
      out[name] = await mod.createServer(ctx);
    } catch (err) {
      console.error(`[integrations] failed to build ${name}`, err);
    }
  }
  return out;
}

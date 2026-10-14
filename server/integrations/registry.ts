import { tenantKey } from "../tenant-context.js";
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
function registryForTenant() {
  const key = tenantKey();
  let map = registries.get(key);
  if (!map) { map = new Map(); registries.set(key, map); }
  return map;
}

export function registerIntegration(mod: IntegrationModule): void {
  registryForTenant().set(mod.name, mod);
}

export function listIntegrations(): IntegrationModule[] {
  return [...registryForTenant().values()];
}

export function getIntegration(name: string): IntegrationModule | undefined {
  return registryForTenant().get(name);
}

export async function loadIntegrations(): Promise<void> {
  const { registerComposioToolkits } = await import("./composio-loader.js");
  await registerComposioToolkits();
  const loaded = [...registryForTenant().keys()];
  console.log(
    `[integrations] loaded: ${loaded.join(", ") || "(none — connect a toolkit from the Debug UI's Connections tab)"}`,
  );
}

export async function refreshIntegrations(): Promise<void> {
  registryForTenant().clear();
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
    const mod = registryForTenant().get(name);
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

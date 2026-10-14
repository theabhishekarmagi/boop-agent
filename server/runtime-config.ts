import { tenantKey } from "./tenant-context.js";
import { mainModel, resolveModelInput } from "./model-config.js";
import { api } from "../convex/_generated/api.js";
import { convex } from "./convex-client.js";

const MODEL_KEY = "model";
const MODEL_TTL_MS = 30 * 1000;
const cache = new Map<string, { at: number; value: string }>();

export { KNOWN_MODELS, MODEL_ALIASES, resolveModelInput } from "./model-config.js";

export async function getRuntimeModel(): Promise<string> {
  const cached = cache.get(tenantKey());
  if (cached && Date.now() - cached.at < MODEL_TTL_MS) return cached.value;
  let stored: string | null = null;
  try {
    stored = await convex.query(api.settings.get, { key: MODEL_KEY });
  } catch (err) {
    console.warn("[runtime-config] settings:get failed", err);
  }
  // Re-validate even though set_model writes through resolveModelInput — the
  // settings table is also writable via the Convex dashboard and other
  // mutations, and a bad value here would surface as an opaque SDK 4xx on the
  // next turn instead of falling back gracefully.
  const final = (stored && resolveModelInput(stored)) || mainModel();
  cache.set(tenantKey(), { at: Date.now(), value: final });
  return final;
}

export async function setRuntimeModel(model: string): Promise<void> {
  await convex.mutation(api.settings.set, { key: MODEL_KEY, value: model });
  cache.set(tenantKey(), { at: Date.now(), value: model });
}

export async function clearRuntimeModel(): Promise<void> {
  await convex.mutation(api.settings.clear, { key: MODEL_KEY });
  cache.delete(tenantKey());
}

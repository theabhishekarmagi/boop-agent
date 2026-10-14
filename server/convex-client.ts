import { ConvexHttpClient } from "convex/browser";
import { SignJWT, importPKCS8 } from "jose";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { tenantActor, tenantKey } from "./tenant-context.js";

const url = process.env.CONVEX_URL;
if (!url) {
  throw new Error(
    "CONVEX_URL is not set. Run `npm run setup` or `npx convex dev` to configure Convex.",
  );
}

const legacy = new ConvexHttpClient(url);
let signingKey: ReturnType<typeof importPKCS8> | undefined;
const clients = new Map<string, { client: ConvexHttpClient; refreshedAt: number; phone?: string }>();
async function clientForTenant(): Promise<ConvexHttpClient> {
  const path = process.env.BOOP_WORKER_KEY_FILE || resolve("data/worker-private.pem");
  if (!existsSync(path)) {
    if (process.env.BOOP_PUBLIC_MODE === "true" || tenantActor()) throw new Error("Worker signing key is not configured");
    return legacy;
  }
  const ownerKey = tenantKey();
  let entry = clients.get(ownerKey);
  if (!entry) { entry = { client: new ConvexHttpClient(url!), refreshedAt: 0 }; clients.set(ownerKey, entry); }
  if (Date.now() - entry.refreshedAt > 5 * 60_000 || entry.phone !== tenantActor()?.phone) {
    signingKey ??= importPKCS8(readFileSync(path, "utf8"), "RS256");
    const actor = tenantActor();
    const token = await new SignJWT({ ownerKey, workerRole: "system", clerkUserId: actor?.clerkUserId, verifiedPhone: actor?.phone })
      .setProtectedHeader({ alg: "RS256", kid: "boop-worker", typ: "JWT" })
      .setIssuer("https://boop-worker.internal").setSubject("boop-worker").setAudience("boop-worker")
      .setIssuedAt().setExpirationTime("15m").sign(await signingKey);
    entry.client.setAuth(token); entry.refreshedAt = Date.now(); entry.phone = actor?.phone;
  }
  return entry.client;
}
// Resolve the authenticated client at call time, never by mutating a shared
// client's auth while two tenants are executing concurrently.
export const convex = new Proxy(legacy, {
  get(target, name) {
    if (["query", "mutation", "action"].includes(String(name))) return async (...args: unknown[]) => {
      const client = await clientForTenant();
      return (client[name as "query"] as (...args: unknown[]) => unknown).apply(client, args);
    };
    const value = Reflect.get(target, name);
    return typeof value === "function" ? value.bind(target) : value;
  },
});

import type { QueryCtx, MutationCtx, ActionCtx } from "./_generated/server";
import type { UserIdentity } from "convex/server";

export const WORKER_ISSUER = "https://boop-worker.internal";
export function memoryScope(ownerId: string | undefined, lifecycle: string) { return JSON.stringify([ownerId ?? null, lifecycle]); }
export function isWorker(identity: UserIdentity | null): boolean {
  return identity?.issuer === WORKER_ISSUER && identity.subject === "boop-worker" && identity.workerRole === "system";
}
export async function requireWorker(ctx: { auth: QueryCtx["auth"] }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!isWorker(identity)) throw new Error("Worker authentication required");
  return identity!;
}
export async function ownerFor(ctx: { auth: QueryCtx["auth"] }): Promise<string | undefined> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    if (process.env.BOOP_PUBLIC_MODE === "true") throw new Error("Not authenticated");
    return undefined;
  }
  if (isWorker(identity)) {
    if (identity.ownerKey === "legacy") return undefined;
    if (typeof identity.ownerKey !== "string" || !identity.ownerKey.includes("|")) throw new Error("Invalid worker scope");
    return identity.ownerKey;
  }
  return identity.tokenIdentifier;
}

// Preserve the existing function API while enforcing ownership for every DB
// operation. Indexes are prefixed with ownerId before any limit/pagination.
// No handler can accidentally read another user's rows through an old index.
export async function tenantContext<T extends QueryCtx | MutationCtx | ActionCtx>(ctx: T): Promise<T> {
  const ownerId = await ownerFor(ctx);
  const original = ctx as any;
  const scoped: any = { ...original };
  if (original.db) {
    const db = original.db;
    const owned = async (id: string) => {
      const document = await db.get(id);
      if (document && document.ownerId !== ownerId) throw new Error("Unauthorized document access");
      return document;
    };
    scoped.db = new Proxy(db, {
      get(target, method) {
        if (method === "query") return (table: string) => {
          const initial = target.query(table);
          const base = () => initial.withIndex("by_ownerId", (q: any) => q.eq("ownerId", ownerId));
          return new Proxy(initial, {
            get(_query, operation) {
              if (operation === "withIndex") return (name: string, range?: (q: any) => any) =>
                initial.withIndex(`owner_${name}`, (q: any) => {
                  const start = q.eq("ownerId", ownerId);
                  return range ? range(start) : start;
                });
              if (operation === "withSearchIndex" || operation === "filter") throw new Error("Use an owner-scoped index");
              // Existing list endpoints are bounded, even when old code calls collect.
              if (operation === "collect") return () => base().take(5000);
              const query = base();
              const value = query[operation];
              return typeof value === "function" ? value.bind(query) : value;
            },
          });
        };
        if (method === "get") return owned;
        if (method === "insert") return (table: string, document: Record<string, unknown>) => target.insert(table, {
          ...document, ownerId,
          ...(table === "memoryRecords" ? { ownerLifecycle: memoryScope(ownerId, String(document.lifecycle)) } : {}),
        });
        if (["patch", "replace", "delete"].includes(String(method))) return async (id: string, document?: Record<string, unknown>) => {
          const existing = await owned(id);
          if (document && "ownerId" in document && document.ownerId !== ownerId) throw new Error("Cannot change document ownership");
          if (document && existing?.memoryId && document.lifecycle) document = { ...document, ownerLifecycle: memoryScope(ownerId, String(document.lifecycle)) };
          return method === "delete" ? target.delete(id) : target[method](id, document);
        };
        const value = target[method];
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }
  return scoped as T;
}

import { AsyncLocalStorage } from "node:async_hooks";
export interface TenantActor { ownerId: string; clerkUserId: string; phone: string }
const storage = new AsyncLocalStorage<TenantActor>();
export function tenantActor() { return storage.getStore(); }
export function tenantKey() { return tenantActor()?.ownerId ?? "legacy"; }
export function asTenant<T>(actor: TenantActor, run: () => T): T { return storage.run(actor, run); }
export function publicMode() { return process.env.BOOP_PUBLIC_MODE === "true"; }

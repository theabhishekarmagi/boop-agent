import { asTenant, publicMode, type TenantActor } from "./tenant-context.js";
import { convex } from "./convex-client.js";
import { api } from "../convex/_generated/api.js";
import { loadIntegrations } from "./integrations/registry.js";
export async function forEachTenant(work: () => Promise<unknown>) {
  if (!publicMode()) { await work(); return; }
  let cursor: string | null = null;
  do {
    const page: { page: TenantActor[]; isDone: boolean; continueCursor: string } = await convex.query(api.publicAccounts.workerUsers, { paginationOpts: { cursor, numItems: 100 } });
    for (const actor of page.page as TenantActor[]) await asTenant(actor, async () => {
      try { await loadIntegrations(); await work(); }
      catch { console.warn("[tenant-jobs] A tenant job failed; continuing with other users."); }
    });
    cursor = page.isDone ? null : page.continueCursor;
  } while (cursor);
}

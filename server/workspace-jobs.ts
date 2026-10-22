import { convex } from "./convex-client.js";
import { api } from "../convex/_generated/api.js";
import { OPERATOR_OWNER, runInWorkspace } from "./workspace-context.js";

export async function forEachWorkspace(job: () => Promise<unknown>): Promise<void> {
  // Includes the private channels; never assigns their data to a Google account.
  await runInWorkspace(OPERATOR_OWNER, job);
  let cursor: string | null = null;
  do {
    const page = await runInWorkspace(OPERATOR_OWNER, () => convex.query(api.workspaces.forWorker, {
      paginationOpts: { cursor, numItems: 100 },
    }));
    for (const workspace of page.page) {
      if (workspace.ownerId === OPERATOR_OWNER) continue;
      try { await runInWorkspace(workspace.ownerId, job); }
      catch (err) { console.error("[workspaces] background job failed", err); }
    }
    cursor = page.isDone ? null : page.continueCursor;
  } while (cursor);
}

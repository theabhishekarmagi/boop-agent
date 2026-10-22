import { internalMutation, mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import schema from "./schema";
import { requireIdentity, requireWorkspaceOwner, RUNTIME_ISSUER, OPERATOR_OWNER } from "./model/auth";

export const ensure = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    const ownerId = await requireWorkspaceOwner(ctx);
    const existing = await ctx.db.query("workspaces").withIndex("by_owner", q => q.eq("ownerId", ownerId)).unique();
    if (!existing) await ctx.db.insert("workspaces", { ownerId, createdAt: Date.now() });
    return ownerId;
  },
});

// Scheduler enumeration is privileged; signed-in customers cannot list users.
export const forWorker = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({ page: v.array(schema.doc("workspaces")), isDone: v.boolean(), continueCursor: v.string(), splitCursor: v.optional(v.union(v.string(), v.null())), pageStatus: v.optional(v.union(v.literal("SplitRecommended"), v.literal("SplitRequired"), v.null())) }),
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    if (identity.issuer !== RUNTIME_ISSUER || await requireWorkspaceOwner(ctx) !== OPERATOR_OWNER) {
      throw new ConvexError({ code: 403, message: "Worker access required" });
    }
    return await ctx.db.query("workspaces").paginate(args.paginationOpts);
  },
});

// Administrative, bounded migration. Old single-user records stay in the
// reserved operator workspace and can never be claimed by a browser account.
export const preserveLegacy = internalMutation({
  args: { table: v.union(...[
    "messages", "conversations", "memoryRecords", "executionAgents", "usageRecords",
    "agentLogs", "memoryEvents", "automations", "sendblueDedup", "drafts",
    "consolidationRuns", "settings", "automationRuns",
  ].map(name => v.literal(name))) },
  returns: v.number(),
  handler: async (ctx, args) => {
    const tables = ["messages", "conversations", "memoryRecords", "executionAgents", "usageRecords", "agentLogs", "memoryEvents", "automations", "sendblueDedup", "drafts", "consolidationRuns", "settings", "automationRuns"] as const;
    const table = tables.find(name => name === args.table);
    if (!table) throw new Error("Unknown legacy table");
    const rows = await ctx.db.query(table).withIndex("by_owner", q => q.eq("ownerId", undefined)).take(100);
    for (const row of rows) await ctx.db.patch(row._id, { ownerId: OPERATOR_OWNER });
    return rows.length;
  },
});

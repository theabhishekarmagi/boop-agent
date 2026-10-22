import { requireWorkspaceOwner } from "./model/auth";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const statusV = v.union(
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
);

export const createRun = mutation({
  args: { runId: v.string(), trigger: v.string() },
  handler: async (ctx, args) => {
    const ownerId = await requireWorkspaceOwner(ctx);
    return await ctx.db.insert("consolidationRuns", { ownerId,
      ...args,
      status: "running",
      proposalsCount: 0,
      mergedCount: 0,
      prunedCount: 0,
      startedAt: Date.now(),
    });
  },
});

export const updateRun = mutation({
  args: {
    runId: v.string(),
    status: v.optional(statusV),
    proposalsCount: v.optional(v.number()),
    mergedCount: v.optional(v.number()),
    prunedCount: v.optional(v.number()),
    notes: v.optional(v.string()),
    details: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ownerId = await requireWorkspaceOwner(ctx);
    const { runId, ...patch } = args;
    const run = await ctx.db
      .query("consolidationRuns")
      .withIndex("by_owner_run_id", (q) => q.eq("ownerId", ownerId).eq("runId", runId))
      .unique();
    if (!run) return null;
    const done = patch.status && patch.status !== "running";
    await ctx.db.patch(run._id, { ...patch, ...(done ? { completedAt: Date.now() } : {}) });
    return run._id;
  },
});

export const listRuns = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const ownerId = await requireWorkspaceOwner(ctx);
    return await ctx.db.query("consolidationRuns").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).order("desc").take(args.limit ?? 25);
  },
});

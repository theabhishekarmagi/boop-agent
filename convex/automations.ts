import { requireWorkspaceOwner } from "./model/auth";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const create = mutation({
  args: {
    automationId: v.string(),
    name: v.string(),
    task: v.string(),
    integrations: v.array(v.string()),
    schedule: v.string(),
    timezone: v.optional(v.string()),
    conversationId: v.optional(v.string()),
    notifyConversationId: v.optional(v.string()),
    nextRunAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const ownerId = await requireWorkspaceOwner(ctx);
    const existing = await ctx.db
      .query("automations")
      .withIndex("by_owner_automation_id", (q) => q.eq("ownerId", ownerId).eq("automationId", args.automationId))
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("automations", { ownerId,
      ...args,
      enabled: true,
      createdAt: Date.now(),
    });
  },
});

export const list = query({
  args: { enabledOnly: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const ownerId = await requireWorkspaceOwner(ctx);
    let results;
    if (args.enabledOnly) {
      results = await ctx.db
        .query("automations")
        .withIndex("by_owner_enabled", (q) => q.eq("ownerId", ownerId).eq("enabled", true))
        .take(1000);
    } else {
      results = await ctx.db.query("automations").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).order("desc").take(1000);
    }
    return results;
  },
});

export const get = query({
  args: { automationId: v.string() },
  handler: async (ctx, args) => {
    const ownerId = await requireWorkspaceOwner(ctx);
    return await ctx.db
      .query("automations")
      .withIndex("by_owner_automation_id", (q) => q.eq("ownerId", ownerId).eq("automationId", args.automationId))
      .unique();
  },
});

export const setEnabled = mutation({
  args: { automationId: v.string(), enabled: v.boolean() },
  handler: async (ctx, args) => {
    const ownerId = await requireWorkspaceOwner(ctx);
    const auto = await ctx.db
      .query("automations")
      .withIndex("by_owner_automation_id", (q) => q.eq("ownerId", ownerId).eq("automationId", args.automationId))
      .unique();
    if (!auto) return null;
    await ctx.db.patch(auto._id, { enabled: args.enabled });
    return auto._id;
  },
});

export const remove = mutation({
  args: { automationId: v.string() },
  handler: async (ctx, args) => {
    const ownerId = await requireWorkspaceOwner(ctx);
    const auto = await ctx.db
      .query("automations")
      .withIndex("by_owner_automation_id", (q) => q.eq("ownerId", ownerId).eq("automationId", args.automationId))
      .unique();
    if (!auto) return null;
    await ctx.db.delete(auto._id);
    return auto._id;
  },
});

export const markRan = mutation({
  args: {
    automationId: v.string(),
    lastRunAt: v.number(),
    nextRunAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const ownerId = await requireWorkspaceOwner(ctx);
    const auto = await ctx.db
      .query("automations")
      .withIndex("by_owner_automation_id", (q) => q.eq("ownerId", ownerId).eq("automationId", args.automationId))
      .unique();
    if (!auto) return null;
    await ctx.db.patch(auto._id, {
      lastRunAt: args.lastRunAt,
      nextRunAt: args.nextRunAt,
    });
    return auto._id;
  },
});

export const createRun = mutation({
  args: {
    runId: v.string(),
    automationId: v.string(),
  },
  handler: async (ctx, args) => {
    const ownerId = await requireWorkspaceOwner(ctx);
    const parent = await ctx.db.query("automations").withIndex("by_owner_automation_id", q => q.eq("ownerId", ownerId).eq("automationId", args.automationId)).unique();
    if (!parent) throw new Error("Automation not found in your workspace");
    return await ctx.db.insert("automationRuns", { ownerId,
      ...args,
      status: "running",
      startedAt: Date.now(),
    });
  },
});

export const updateRun = mutation({
  args: {
    runId: v.string(),
    status: v.union(v.literal("running"), v.literal("completed"), v.literal("failed")),
    result: v.optional(v.string()),
    error: v.optional(v.string()),
    agentId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ownerId = await requireWorkspaceOwner(ctx);
    const run = await ctx.db
      .query("automationRuns")
      .withIndex("by_owner_run_id", (q) => q.eq("ownerId", ownerId).eq("runId", args.runId))
      .unique();
    if (!run) return null;
    const completed = args.status !== "running";
    const { runId: _runId, ...patch } = args;
    await ctx.db.patch(run._id, {
      ...patch,
      ...(completed ? { completedAt: Date.now() } : {}),
    });
    return run._id;
  },
});

export const recentRuns = query({
  args: { automationId: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const ownerId = await requireWorkspaceOwner(ctx);
    const limit = args.limit ?? 50;
    if (args.automationId) {
      return await ctx.db
        .query("automationRuns")
        .withIndex("by_owner_automation", (q) => q.eq("ownerId", ownerId).eq("automationId", args.automationId!))
        .order("desc")
        .take(limit);
    }
    return await ctx.db.query("automationRuns").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).order("desc").take(limit);
  },
});

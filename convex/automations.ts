import { tenantContext } from "./tenant";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const create = mutation({
  returns: v.any(),
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
    ctx = await tenantContext(ctx);
    const existing = await ctx.db
      .query("automations")
      .withIndex("by_automation_id", (q) => q.eq("automationId", args.automationId))
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("automations", {
      ...args,
      enabled: true,
      createdAt: Date.now(),
    });
  },
});

export const list = query({
  returns: v.any(),
  args: { enabledOnly: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    ctx = await tenantContext(ctx);
    let results;
    if (args.enabledOnly) {
      results = await ctx.db
        .query("automations")
        .withIndex("by_enabled", (q) => q.eq("enabled", true))
        .take(5000);
    } else {
      results = await ctx.db.query("automations").order("desc").take(5000);
    }
    return results;
  },
});

export const get = query({
  returns: v.any(),
  args: { automationId: v.string() },
  handler: async (ctx, args) => {
    ctx = await tenantContext(ctx);
    return await ctx.db
      .query("automations")
      .withIndex("by_automation_id", (q) => q.eq("automationId", args.automationId))
      .unique();
  },
});

export const setEnabled = mutation({
  returns: v.any(),
  args: { automationId: v.string(), enabled: v.boolean() },
  handler: async (ctx, args) => {
    ctx = await tenantContext(ctx);
    const auto = await ctx.db
      .query("automations")
      .withIndex("by_automation_id", (q) => q.eq("automationId", args.automationId))
      .unique();
    if (!auto) return null;
    await ctx.db.patch(auto._id, { enabled: args.enabled });
    return auto._id;
  },
});

export const remove = mutation({
  returns: v.any(),
  args: { automationId: v.string() },
  handler: async (ctx, args) => {
    ctx = await tenantContext(ctx);
    const auto = await ctx.db
      .query("automations")
      .withIndex("by_automation_id", (q) => q.eq("automationId", args.automationId))
      .unique();
    if (!auto) return null;
    await ctx.db.delete(auto._id);
    return auto._id;
  },
});

export const markRan = mutation({
  returns: v.any(),
  args: {
    automationId: v.string(),
    lastRunAt: v.number(),
    nextRunAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    ctx = await tenantContext(ctx);
    const auto = await ctx.db
      .query("automations")
      .withIndex("by_automation_id", (q) => q.eq("automationId", args.automationId))
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
  returns: v.any(),
  args: {
    runId: v.string(),
    automationId: v.string(),
  },
  handler: async (ctx, args) => {
    ctx = await tenantContext(ctx);
    return await ctx.db.insert("automationRuns", {
      ...args,
      status: "running",
      startedAt: Date.now(),
    });
  },
});

export const updateRun = mutation({
  returns: v.any(),
  args: {
    runId: v.string(),
    status: v.union(v.literal("running"), v.literal("completed"), v.literal("failed")),
    result: v.optional(v.string()),
    error: v.optional(v.string()),
    agentId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    ctx = await tenantContext(ctx);
    const run = await ctx.db
      .query("automationRuns")
      .withIndex("by_run_id", (q) => q.eq("runId", args.runId))
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
  returns: v.any(),
  args: { automationId: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    ctx = await tenantContext(ctx);
    const limit = args.limit ?? 50;
    if (args.automationId) {
      return await ctx.db
        .query("automationRuns")
        .withIndex("by_automation", (q) => q.eq("automationId", args.automationId!))
        .order("desc")
        .take(limit);
    }
    return await ctx.db.query("automationRuns").order("desc").take(limit);
  },
});

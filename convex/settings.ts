import { tenantContext } from "./tenant";
import { mutation, query } from "./_generated/server.js";
import { v } from "convex/values";

export const get = query({
  returns: v.any(),
  args: { key: v.string() },
  handler: async (ctx, args) => {
    ctx = await tenantContext(ctx);
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    return row?.value ?? null;
  },
});

export const set = mutation({
  returns: v.any(),
  args: { key: v.string(), value: v.string() },
  handler: async (ctx, args) => {
    ctx = await tenantContext(ctx);
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { value: args.value, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("settings", {
        key: args.key,
        value: args.value,
        updatedAt: Date.now(),
      });
    }
  },
});

export const clear = mutation({
  returns: v.any(),
  args: { key: v.string() },
  handler: async (ctx, args) => {
    ctx = await tenantContext(ctx);
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  },
});

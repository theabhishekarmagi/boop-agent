import { requireWorkspaceOwner } from "./model/auth";
import { mutation, query } from "./_generated/server.js";
import { v } from "convex/values";

export const get = query({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    const ownerId = await requireWorkspaceOwner(ctx);
    const row = await ctx.db
      .query("settings")
      .withIndex("by_owner_key", (q) => q.eq("ownerId", ownerId).eq("key", args.key))
      .unique();
    return row?.value ?? null;
  },
});

export const set = mutation({
  args: { key: v.string(), value: v.string() },
  handler: async (ctx, args) => {
    const ownerId = await requireWorkspaceOwner(ctx);
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_owner_key", (q) => q.eq("ownerId", ownerId).eq("key", args.key))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { value: args.value, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("settings", { ownerId,
        key: args.key,
        value: args.value,
        updatedAt: Date.now(),
      });
    }
  },
});

export const clear = mutation({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    const ownerId = await requireWorkspaceOwner(ctx);
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_owner_key", (q) => q.eq("ownerId", ownerId).eq("key", args.key))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  },
});

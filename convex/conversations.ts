import { requireWorkspaceOwner } from "./model/auth";
import { query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const ownerId = await requireWorkspaceOwner(ctx);
    return await ctx.db.query("conversations").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).order("desc").take(50);
  },
});

export const get = query({
  args: { conversationId: v.string() },
  handler: async (ctx, args) => {
    const ownerId = await requireWorkspaceOwner(ctx);
    return await ctx.db
      .query("conversations")
      .withIndex("by_owner_conversation", (q) => q.eq("ownerId", ownerId).eq("conversationId", args.conversationId))
      .unique();
  },
});

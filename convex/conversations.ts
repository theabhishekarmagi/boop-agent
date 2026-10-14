import { tenantContext } from "./tenant";
import { query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  returns: v.any(),
  args: {},
  handler: async (ctx) => {
    ctx = await tenantContext(ctx);
    return await ctx.db.query("conversations").order("desc").take(50);
  },
});

export const get = query({
  returns: v.any(),
  args: { conversationId: v.string() },
  handler: async (ctx, args) => {
    ctx = await tenantContext(ctx);
    return await ctx.db
      .query("conversations")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .unique();
  },
});

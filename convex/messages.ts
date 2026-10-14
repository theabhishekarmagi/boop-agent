import { tenantContext } from "./tenant";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const send = mutation({
  returns: v.any(),
  args: {
    conversationId: v.string(),
    role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system")),
    content: v.string(),
    agentId: v.optional(v.string()),
    turnId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    ctx = await tenantContext(ctx);
    const now = Date.now();
    const id = await ctx.db.insert("messages", { ...args, createdAt: now });

    const conv = await ctx.db
      .query("conversations")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .unique();
    if (conv) {
      await ctx.db.patch(conv._id, {
        messageCount: conv.messageCount + 1,
        lastActivityAt: now,
      });
    } else {
      await ctx.db.insert("conversations", {
        conversationId: args.conversationId,
        messageCount: 1,
        lastActivityAt: now,
      });
    }
    return id;
  },
});

export const list = query({
  returns: v.any(),
  args: { conversationId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    ctx = await tenantContext(ctx);
    return await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .order("desc")
      .take(args.limit ?? 50);
  },
});

export const recent = query({
  returns: v.any(),
  args: { conversationId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    ctx = await tenantContext(ctx);
    const msgs = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .order("desc")
      .take(args.limit ?? 20);
    return msgs.reverse();
  },
});

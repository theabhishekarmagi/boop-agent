import { requireWorkspaceOwner } from "./model/auth";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const send = mutation({
  args: {
    conversationId: v.string(),
    role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system")),
    content: v.string(),
    agentId: v.optional(v.string()),
    turnId: v.optional(v.string()),
    dedupe: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const ownerId = await requireWorkspaceOwner(ctx);
    const { dedupe, ...message } = args;
    if (dedupe && args.turnId) {
      const existing = await ctx.db.query("messages")
        .withIndex("by_owner_conversation_turn", q => q.eq("ownerId", ownerId)
          .eq("conversationId", args.conversationId).eq("turnId", args.turnId))
        .filter(q => q.eq(q.field("role"), args.role)).first();
      if (existing) return existing._id;
    }
    const now = Date.now();
    const id = await ctx.db.insert("messages", { ownerId, ...message, createdAt: now });

    const conv = await ctx.db
      .query("conversations")
      .withIndex("by_owner_conversation", (q) => q.eq("ownerId", ownerId).eq("conversationId", args.conversationId))
      .unique();
    if (conv) {
      await ctx.db.patch(conv._id, {
        messageCount: conv.messageCount + 1,
        lastActivityAt: now,
      });
    } else {
      await ctx.db.insert("conversations", { ownerId,
        conversationId: args.conversationId,
        messageCount: 1,
        lastActivityAt: now,
      });
    }
    return id;
  },
});

export const byTurn = query({
  args: { conversationId: v.string(), turnId: v.string() },
  handler: async (ctx, args) => {
    const ownerId = await requireWorkspaceOwner(ctx);
    return await ctx.db.query("messages")
      .withIndex("by_owner_conversation_turn", q => q.eq("ownerId", ownerId)
        .eq("conversationId", args.conversationId).eq("turnId", args.turnId))
      .take(10);
  },
});

export const list = query({
  args: { conversationId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const ownerId = await requireWorkspaceOwner(ctx);
    return await ctx.db
      .query("messages")
      .withIndex("by_owner_conversation", (q) => q.eq("ownerId", ownerId).eq("conversationId", args.conversationId))
      .order("desc")
      .take(args.limit ?? 50);
  },
});

export const recent = query({
  args: { conversationId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const ownerId = await requireWorkspaceOwner(ctx);
    const msgs = await ctx.db
      .query("messages")
      .withIndex("by_owner_conversation", (q) => q.eq("ownerId", ownerId).eq("conversationId", args.conversationId))
      .order("desc")
      .take(args.limit ?? 20);
    return msgs.reverse();
  },
});

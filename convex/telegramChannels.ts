import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import schema from "./schema";
import { requireIdentity, requireWorkspaceOwner, RUNTIME_ISSUER } from "./model/auth";
import type { QueryCtx } from "./_generated/server";

async function workerOwner(ctx: Pick<QueryCtx, "auth">) {
  if ((await requireIdentity(ctx)).issuer !== RUNTIME_ISSUER) {
    throw new ConvexError("Worker access required");
  }
  return requireWorkspaceOwner(ctx);
}

export const get = query({
  args: { connectionId: v.string() }, returns: v.union(schema.doc("telegramChannels"), v.null()),
  handler: async (ctx, args) => {
    const owner = await workerOwner(ctx);
    return ctx.db.query("telegramChannels").withIndex("by_ownerId_and_connectionId", q =>
      q.eq("ownerId", owner).eq("connectionId", args.connectionId)).unique();
  },
});

export const begin = mutation({
  args: { connectionId: v.string(), botId: v.string(), botUsername: v.string(), tokenHash: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerId = await workerOwner(ctx);
    const bot = await ctx.db.query("telegramChannels").withIndex("by_botId", q => q.eq("botId", args.botId)).unique();
    if (bot && (bot.ownerId !== ownerId || bot.connectionId !== args.connectionId)) {
      throw new ConvexError("This bot is already linked to another connection. Use a separate bot.");
    }
    const existing = await ctx.db.query("telegramChannels").withIndex("by_ownerId_and_connectionId", q =>
      q.eq("ownerId", ownerId).eq("connectionId", args.connectionId)).unique();
    const value = { ...args, ownerId, expiresAt: Date.now() + 10 * 60_000, updatedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, { ...value,
      ...(existing.botId !== args.botId ? { chatId: undefined, senderId: undefined, pendingChats: undefined, greetingPending: undefined } : {}),
    });
    else await ctx.db.insert("telegramChannels", value);
    return null;
  },
});

export const verify = mutation({
  args: { connectionId: v.string(), tokenHash: v.string(), chatId: v.string(), senderId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const ownerId = await workerOwner(ctx);
    const row = await ctx.db.query("telegramChannels").withIndex("by_ownerId_and_connectionId", q =>
      q.eq("ownerId", ownerId).eq("connectionId", args.connectionId)).unique();
    if (!row || row.tokenHash !== args.tokenHash || (row.expiresAt ?? 0) < Date.now() || args.chatId !== args.senderId) return false;
    await ctx.db.patch(row._id, { chatId: args.chatId, senderId: args.senderId,
      tokenHash: undefined, expiresAt: undefined, updatedAt: Date.now() });
    return true;
  },
});

export const remove = mutation({
  args: { connectionId: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    const ownerId = await workerOwner(ctx);
    const row = await ctx.db.query("telegramChannels").withIndex("by_ownerId_and_connectionId", q =>
      q.eq("ownerId", ownerId).eq("connectionId", args.connectionId)).unique();
    if (row) await ctx.db.delete(row._id);
    return null;
  },
});

// Only the trusted runtime can collect candidates or approve a dashboard action.
export const requestChat = mutation({
  args: { connectionId: v.string(), requestId: v.string(), chatId: v.string(), senderId: v.string(),
    username: v.optional(v.string()), firstName: v.optional(v.string()) },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const owner = await workerOwner(ctx);
    const row = await ctx.db.query("telegramChannels").withIndex("by_ownerId_and_connectionId", q =>
      q.eq("ownerId", owner).eq("connectionId", args.connectionId)).unique();
    if (!row || row.chatId || args.chatId !== args.senderId || !/^[1-9]\d*$/.test(args.senderId)) return false;
    const now = Date.now();
    const pending = (row.pendingChats ?? []).filter(p => p.expiresAt > now);
    // Repeated /start must not replace an approval ID the dashboard is showing.
    if (pending.some(p => p.senderId === args.senderId)) return true;
    if (pending.length >= 10) return false;
    const { connectionId: _, ...candidate } = args;
    await ctx.db.patch(row._id, { pendingChats: [...pending, { ...candidate, expiresAt: now + 600_000 }], updatedAt: now });
    return true;
  },
});

export const confirmChat = mutation({
  args: { connectionId: v.string(), requestId: v.string() }, returns: v.boolean(),
  handler: async (ctx, args) => {
    const owner = await workerOwner(ctx);
    const row = await ctx.db.query("telegramChannels").withIndex("by_ownerId_and_connectionId", q =>
      q.eq("ownerId", owner).eq("connectionId", args.connectionId)).unique();
    if (!row || row.chatId) return false;
    const candidate = row.pendingChats?.find(p => p.requestId === args.requestId && p.expiresAt > Date.now());
    if (!candidate) return false;
    await ctx.db.patch(row._id, { chatId: candidate.chatId, senderId: candidate.senderId,
      pendingChats: undefined, tokenHash: undefined, expiresAt: undefined,
      greetingPending: candidate.requestId, updatedAt: Date.now() });
    return true;
  },
});

export const acknowledgeGreeting = mutation({
  args: { connectionId: v.string(), requestId: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    const owner = await workerOwner(ctx);
    const row = await ctx.db.query("telegramChannels").withIndex("by_ownerId_and_connectionId", q =>
      q.eq("ownerId", owner).eq("connectionId", args.connectionId)).unique();
    if (row?.greetingPending === args.requestId) await ctx.db.patch(row._id, { greetingPending: undefined });
    return null;
  },
});

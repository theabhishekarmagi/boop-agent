import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { ownerFor, requireWorker } from "./tenant";

const actorV = v.object({ ownerId: v.string(), clerkUserId: v.string(), phone: v.string() });
const profileV = v.object({ phone: v.string(), connected: v.boolean(), codeExpiresAt: v.union(v.number(), v.null()) });

export const me = query({
  args: {}, returns: v.union(profileV, v.null()),
  handler: async (ctx) => {
    const ownerId = await ownerFor(ctx);
    if (!ownerId) throw new Error("Not authenticated");
    const p = await ctx.db.query("userProfiles").withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId)).unique();
    return p ? { phone: p.phone, connected: !!p.whatsappJid, codeExpiresAt: p.codeExpiresAt ?? null } : null;
  },
});

// Called by the trusted backend after verifying Clerk's primary phone status.
// No client-supplied identity/phone can create an account association.
export const syncVerifiedPhone = mutation({
  args: {}, returns: v.null(),
  handler: async (ctx) => {
    const identity = await requireWorker(ctx);
    const ownerId = await ownerFor(ctx);
    const phone = identity.verifiedPhone;
    const clerkUserId = identity.clerkUserId;
    if (!ownerId || typeof phone !== "string" || !/^\+[1-9]\d{6,14}$/.test(phone) || typeof clerkUserId !== "string") throw new Error("Verified phone required");
    const existing = await ctx.db.query("userProfiles").withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId)).unique();
    const other = await ctx.db.query("userProfiles").withIndex("by_phone", (q) => q.eq("phone", phone)).unique();
    if (other && other.ownerId !== ownerId) throw new Error("Phone already associated with another account");
    if (!existing) await ctx.db.insert("userProfiles", { ownerId, clerkUserId, phone, createdAt: Date.now() });
    else if (existing.phone !== phone) await ctx.db.patch(existing._id, { phone, whatsappJid: undefined, botAccount: undefined,
      codeHash: undefined, codeExpiresAt: undefined });
    return null;
  },
});

export const createChallenge = mutation({
  args: { codeHash: v.string() }, returns: v.number(),
  handler: async (ctx, args) => {
    await requireWorker(ctx);
    const ownerId = await ownerFor(ctx);
    const p = await ctx.db.query("userProfiles").withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId!)).unique();
    if (!p) throw new Error("Verified phone required");
    if (!/^[a-f0-9]{64}$/.test(args.codeHash)) throw new Error("Invalid code hash");
    const now = Date.now();
    if (p.lastCodeAt && now - p.lastCodeAt < 30_000) throw new Error("Wait 30 seconds before generating another code");
    const expiresAt = now + 5 * 60_000;
    await ctx.db.patch(p._id, { codeHash: args.codeHash, codeExpiresAt: expiresAt, lastCodeAt: now });
    return expiresAt;
  },
});

export const consumeChallenge = mutation({
  args: { codeHash: v.string(), phone: v.string(), jid: v.string(), botAccount: v.string() },
  returns: v.union(actorV, v.null()),
  handler: async (ctx, args) => {
    await requireWorker(ctx);
    const p = await ctx.db.query("userProfiles").withIndex("by_codeHash", (q) => q.eq("codeHash", args.codeHash)).unique();
    if (!p || (p.codeExpiresAt ?? 0) <= Date.now() || p.phone !== args.phone || args.jid !== `${args.phone.slice(1)}@s.whatsapp.net`) return null;
    const other = await ctx.db.query("userProfiles").withIndex("by_whatsappJid", (q) => q.eq("whatsappJid", args.jid)).unique();
    if (other && other.ownerId !== p.ownerId) return null;
    await ctx.db.patch(p._id, { whatsappJid: args.jid, botAccount: args.botAccount, codeHash: undefined, codeExpiresAt: undefined });
    return { ownerId: p.ownerId, clerkUserId: p.clerkUserId, phone: p.phone };
  },
});

export const resolveSender = query({
  args: { jid: v.string(), botAccount: v.string() }, returns: v.union(actorV, v.null()),
  handler: async (ctx, args) => {
    await requireWorker(ctx);
    const p = await ctx.db.query("userProfiles").withIndex("by_whatsappJid", (q) => q.eq("whatsappJid", args.jid)).unique();
    return p && p.botAccount === args.botAccount ? { ownerId: p.ownerId, clerkUserId: p.clerkUserId, phone: p.phone } : null;
  },
});

export const disconnect = mutation({
  args: {}, returns: v.null(),
  handler: async (ctx) => {
    const ownerId = await ownerFor(ctx);
    if (!ownerId) throw new Error("Not authenticated");
    const p = await ctx.db.query("userProfiles").withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId)).unique();
    if (p) await ctx.db.patch(p._id, { whatsappJid: undefined, botAccount: undefined, codeHash: undefined, codeExpiresAt: undefined });
    return null;
  },
});

export const workerUsers = query({
  args: { paginationOpts: paginationOptsValidator }, returns: paginationResultValidator(actorV),
  handler: async (ctx, args) => {
    await requireWorker(ctx);
    const page = await ctx.db.query("userProfiles").withIndex("by_ownerId").paginate(args.paginationOpts);
    return { ...page, page: page.page.map((p) => ({ ownerId: p.ownerId, clerkUserId: p.clerkUserId, phone: p.phone })) };
  },
});

export const securityStatus = query({
  args: {}, returns: v.object({ requiresAuth: v.boolean(), clerkConfigured: v.boolean() }),
  handler: async (ctx) => {
    await requireWorker(ctx);
    return { requiresAuth: process.env.BOOP_PUBLIC_MODE === "true", clerkConfigured: !!process.env.CLERK_JWT_ISSUER_DOMAIN };
  },
});

export const claimTurn = mutation({
  args: {}, returns: v.boolean(),
  handler: async (ctx) => {
    await requireWorker(ctx);
    const ownerId = await ownerFor(ctx);
    if (!ownerId) throw new Error("User scope required");
    const p = await ctx.db.query("userProfiles").withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId)).unique();
    if (!p) return false;
    const minuteBucket = Math.floor(Date.now() / 60_000);
    const dayBucket = Math.floor(Date.now() / 86_400_000);
    const minuteTurns = p.minuteBucket === minuteBucket ? p.minuteTurns ?? 0 : 0;
    const dayTurns = p.dayBucket === dayBucket ? p.dayTurns ?? 0 : 0;
    if (minuteTurns >= 5 || dayTurns >= 100) return false;
    await ctx.db.patch(p._id, { minuteBucket, dayBucket, minuteTurns: minuteTurns + 1, dayTurns: dayTurns + 1 });
    return true;
  },
});

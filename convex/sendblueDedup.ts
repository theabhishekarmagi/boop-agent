import { requireWorkspaceOwner } from "./model/auth";
import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const claim = mutation({
  args: { handle: v.string() },
  handler: async (ctx, args) => {
    const ownerId = await requireWorkspaceOwner(ctx);
    const existing = await ctx.db
      .query("sendblueDedup")
      .withIndex("by_owner_handle", (q) => q.eq("ownerId", ownerId).eq("handle", args.handle))
      .unique();
    if (existing) return { claimed: false };
    await ctx.db.insert("sendblueDedup", { ownerId,
      handle: args.handle,
      claimedAt: Date.now(),
    });
    return { claimed: true };
  },
});

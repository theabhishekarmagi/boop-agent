import { tenantContext } from "./tenant";
import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const claim = mutation({
  returns: v.any(),
  args: { handle: v.string() },
  handler: async (ctx, args) => {
    ctx = await tenantContext(ctx);
    const existing = await ctx.db
      .query("sendblueDedup")
      .withIndex("by_handle", (q) => q.eq("handle", args.handle))
      .unique();
    if (existing) return { claimed: false };
    await ctx.db.insert("sendblueDedup", {
      handle: args.handle,
      claimedAt: Date.now(),
    });
    return { claimed: true };
  },
});

import { requireWorkspaceOwner } from "./model/auth";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const statusV = v.union(
  v.literal("pending"),
  v.literal("sent"),
  v.literal("rejected"),
  v.literal("expired"),
  v.literal("submitting"), v.literal("failed"), v.literal("uncertain"),
);

export const create = mutation({
  args: {
    draftId: v.string(),
    conversationId: v.string(),
    kind: v.string(),
    summary: v.string(),
    payload: v.string(),
  },
  handler: async (ctx, args) => {
    const ownerId = await requireWorkspaceOwner(ctx);
    return await ctx.db.insert("drafts", { ownerId,
      ...args,
      status: "pending",
      createdAt: Date.now(),
    });
  },
});

export const get = query({
  args: { draftId: v.string() },
  handler: async (ctx, args) => {
    const ownerId = await requireWorkspaceOwner(ctx);
    return await ctx.db
      .query("drafts")
      .withIndex("by_owner_draft_id", (q) => q.eq("ownerId", ownerId).eq("draftId", args.draftId))
      .unique();
  },
});

export const pendingByConversation = query({
  args: { conversationId: v.string() },
  handler: async (ctx, args) => {
    const ownerId = await requireWorkspaceOwner(ctx);
    return await ctx.db
      .query("drafts")
      .withIndex("by_owner_conversation_status", (q) => q.eq("ownerId", ownerId).eq("conversationId", args.conversationId).eq("status", "pending"),
      )
      .order("desc")
      .take(25);
  },
});

export const recent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const ownerId = await requireWorkspaceOwner(ctx);
    return await ctx.db.query("drafts").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).order("desc").take(args.limit ?? 50);
  },
});

export const setStatus = mutation({
  args: { draftId: v.string(), status: statusV },
  handler: async (ctx, args) => {
    const ownerId = await requireWorkspaceOwner(ctx);
    const draft = await ctx.db
      .query("drafts")
      .withIndex("by_owner_draft_id", (q) => q.eq("ownerId", ownerId).eq("draftId", args.draftId))
      .unique();
    if (!draft) return null;
    if (draft.kind === "browser.googleform" && !(draft.status === "pending" && ["rejected", "expired"].includes(args.status))) {
      throw new Error("Form submission state cannot be reset or marked sent through setStatus.");
    }
    await ctx.db.patch(draft._id, { status: args.status, decidedAt: Date.now() });
    return draft;
  },
});

// A form draft is consumed atomically BEFORE any browser submission. A worker
// crash or lost reply leaves a non-pending draft, preventing duplicate submits.
export const claimFormSubmission = mutation({
  args: {draftId:v.string(), conversationId:v.string()},
  returns: v.object({payload:v.string()}),
  handler: async (ctx,args) => {
    const ownerId=await requireWorkspaceOwner(ctx);
    const draft=await ctx.db.query("drafts").withIndex("by_owner_draft_id",q=>q.eq("ownerId",ownerId).eq("draftId",args.draftId)).unique();
    if(!draft||draft.conversationId!==args.conversationId||draft.kind!=="browser.googleform") throw new Error("Form draft not found in this conversation.");
    if(draft.status!=="pending")throw new Error("This form submission is already decided or in progress. It will not be repeated.");
    if(Date.now()-draft.createdAt>60*60*1000)throw new Error("Form draft expired. Prepare a fresh draft.");
    await ctx.db.patch(draft._id,{status:"submitting",decidedAt:Date.now()});
    return {payload:draft.payload};
  },
});
export const finishFormSubmission = mutation({
  args:{draftId:v.string(),status:v.union(v.literal("sent"),v.literal("failed"),v.literal("uncertain")),note:v.string()},
  returns:v.null(),
  handler:async(ctx,args)=>{
    const ownerId=await requireWorkspaceOwner(ctx);
    const draft=await ctx.db.query("drafts").withIndex("by_owner_draft_id",q=>q.eq("ownerId",ownerId).eq("draftId",args.draftId)).unique();
    if(!draft||draft.kind!=="browser.googleform"||draft.status!=="submitting")throw new Error("Form draft is not awaiting a result.");
    if(args.note.length>1500)throw new Error("Submission note too long.");
    await ctx.db.patch(draft._id,{status:args.status,submissionNote:args.note,decidedAt:Date.now()});
    return null;
  },
});

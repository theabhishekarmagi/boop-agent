import { ConvexError } from "convex/values";
import type { QueryCtx } from "../_generated/server";

export const RUNTIME_ISSUER = "https://boop.internal/runtime";
export const OPERATOR_OWNER = "boop:operator";
type AuthCtx = Pick<QueryCtx, "auth">;

export async function requireIdentity(ctx: AuthCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: 401, message: "Sign in required" });
  return identity;
}

export async function requireWorkspaceOwner(ctx: AuthCtx): Promise<string> {
  const identity = await requireIdentity(ctx);
  // Only the separately verified server JWT provider can delegate a workspace.
  // Browser identities are keyed by issuer + subject, never email or an argument.
  if (identity.issuer === RUNTIME_ISSUER) {
    if (typeof identity.workspace !== "string" || !identity.workspace) {
      throw new ConvexError({ code: 403, message: "Invalid runtime identity" });
    }
    return identity.workspace;
  }
  return identity.tokenIdentifier;
}

export async function requireOwner<T extends { ownerId?: string }>(ctx: AuthCtx, doc: T | null): Promise<T> {
  if (!doc) throw new ConvexError({ code: 404, message: "Not found" });
  if (doc.ownerId !== await requireWorkspaceOwner(ctx)) {
    throw new ConvexError({ code: 403, message: "Access denied" });
  }
  return doc;
}

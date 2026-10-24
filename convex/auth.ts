import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth/minimal";
import { v } from "convex/values";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import authConfig from "./auth.config";
import { requireWorkspaceOwner } from "./model/auth";

export const authComponent = createClient<DataModel>(components.betterAuth);

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  const siteUrl = process.env.SITE_URL!;
  return betterAuth({
    appName: "Boop",
    baseURL: process.env.CONVEX_SITE_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    // A cloud development backend may serve both the hosted preview and a
    // local frontend. Keep the primary callback site and allow only explicitly
    // configured additional origins for CORS and redirect validation.
    trustedOrigins: [siteUrl, ...(process.env.ADDITIONAL_AUTH_TRUSTED_ORIGINS ?? "")
      .split(",").map((origin) => origin.trim()).filter(Boolean)],
    database: authComponent.adapter(ctx),
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        prompt: "select_account",
      },
    },
    plugins: [crossDomain({ siteUrl }), convex({ authConfig })],
  });
};

// Only return the current session's profile, never credentials or other users.
export const currentUser = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      id: v.string(),
      ownerId: v.string(),
      name: v.string(),
      email: v.string(),
      image: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    return user
      ? { id: String(user._id), ownerId: await requireWorkspaceOwner(ctx), name: user.name, email: user.email, image: user.image ?? null }
      : null;
  },
});

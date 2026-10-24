import { ConvexHttpClient } from "convex/browser";
import type { RequestHandler } from "express";
import { api } from "../convex/_generated/api.js";
import { runInWorkspace } from "./workspace-context.js";
import { convex } from "./convex-client.js";

export async function verifyBrowserToken(token: string): Promise<string> {
  if (!token || token.length > 16384) throw new Error("Invalid session");
  const client = new ConvexHttpClient(process.env.CONVEX_URL!);
  client.setAuth(token);
  // Verifies the JWT AND the live Better Auth session. Service JWTs cannot
  // impersonate browser sessions, and no request body/header supplies ownerId.
  const profile = await client.query(api.auth.currentUser, {});
  if (!profile) throw new Error("Sign in required");
  const allowedEmails = (process.env.BOOP_ALLOWED_EMAILS ?? "")
    .split(",").map(email => email.trim().toLowerCase()).filter(Boolean);
  if (process.env.BOOP_HOSTED_PREVIEW === "true" &&
      process.env.BOOP_ALLOW_PUBLIC_SIGNUPS !== "true" &&
      !allowedEmails.includes(profile.email.toLowerCase())) {
    throw new Error("This hosted preview is invitation-only");
  }
  return profile.ownerId;
}

export const requireBrowserSession: RequestHandler = async (req, res, next) => {
  let owner: string;
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw new Error("Sign in required");
    owner = await verifyBrowserToken(header.slice(7));
  } catch {
    res.status(401).json({ error: "Sign in required" });
    return;
  }
  await runInWorkspace(owner, async () => {
    try {
      await convex.mutation(api.workspaces.ensure, {});
      next();
    } catch (err) { next(err); }
  });
};

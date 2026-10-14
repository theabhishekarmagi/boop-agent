import { createClerkClient, verifyToken } from "@clerk/backend";
import type { RequestHandler } from "express";
import { asTenant, publicMode, type TenantActor } from "./tenant-context.js";

export function allowedOrigins() {
  return (process.env.BOOP_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}
export async function assertCurrentPhone(actor: TenantActor): Promise<void> {
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  const user = await clerk.users.getUser(actor.clerkUserId);
  const phone = user.phoneNumbers.find((p) => p.id === user.primaryPhoneNumberId && p.verification?.status === "verified");
  if (phone?.phoneNumber !== actor.phone) throw new Error("Verified account phone changed");
}
export async function authenticatePublicToken(token: string): Promise<TenantActor> {
  if (!process.env.CLERK_SECRET_KEY || !allowedOrigins().length) throw new Error("Public authentication is not configured");
  const claims = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY, authorizedParties: allowedOrigins() });
  const issuer = process.env.CLERK_JWT_ISSUER_DOMAIN?.replace(/\/$/, "");
  if (!issuer || claims.iss.replace(/\/$/, "") !== issuer || !claims.sub) throw new Error("Unexpected account issuer");
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  const user = await clerk.users.getUser(claims.sub);
  const phone = user.phoneNumbers.find((p) => p.id === user.primaryPhoneNumberId && p.verification?.status === "verified");
  if (!phone) throw new Error("Verify your primary phone number before using Boop");
  return { ownerId: `${claims.iss}|${claims.sub}`, clerkUserId: claims.sub, phone: phone.phoneNumber };
}
export const publicAuthentication: RequestHandler = async (req, res, next) => {
  if (!publicMode()) { next(); return; }
  try {
    const match = /^Bearer (.+)$/.exec(req.header("authorization") ?? "");
    if (!match) { res.status(401).json({ error: "Sign in to Boop first" }); return; }
    const actor = await authenticatePublicToken(match[1]);
    asTenant(actor, () => next());
  } catch { res.status(401).json({ error: "Sign in with a verified phone number" }); }
};

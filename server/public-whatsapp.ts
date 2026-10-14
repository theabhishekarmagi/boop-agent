import express from "express";
import { randomBytes, createHash } from "node:crypto";
import QRCode from "qrcode";
import { convex } from "./convex-client.js";
import { api } from "../convex/_generated/api.js";
import { asTenant, tenantActor, type TenantActor } from "./tenant-context.js";
import { assertCurrentPhone } from "./public-auth.js";
import { whatsAppStatus } from "./whatsapp.js";

export function hashConnectionCode(code: string) { return createHash("sha256").update(code).digest("hex"); }
export function whatsAppLink(botNumber: string, code: string) {
  if (!/^\+[1-9]\d{6,14}$/.test(botNumber) || !/^[a-f0-9]{48}$/.test(code)) throw new Error("Invalid connection link");
  return `https://wa.me/${botNumber.slice(1)}?text=${encodeURIComponent(`BOOP CONNECT ${code}`)}`;
}
export function createPublicWhatsAppRouter() {
  const router = express.Router();
  router.get("/status", async (_req, res) => {
    if (!tenantActor()) { res.status(401).json({ error: "Sign in first" }); return; }
    await convex.mutation(api.publicAccounts.syncVerifiedPhone, {});
    const profile = await convex.query(api.publicAccounts.me, {});
    res.json({ ...profile, botStatus: whatsAppStatus().status });
  });
  router.post("/connect", async (_req, res) => {
    if (!tenantActor()) { res.status(401).json({ error: "Sign in first" }); return; }
    const botNumber = whatsAppStatus().phone;
    if (!botNumber || whatsAppStatus().status !== "connected") { res.status(503).json({ error: "Boop's WhatsApp number is currently offline" }); return; }
    await convex.mutation(api.publicAccounts.syncVerifiedPhone, {});
    const code = randomBytes(24).toString("hex");
    try {
      const expiresAt = await convex.mutation(api.publicAccounts.createChallenge, { codeHash: hashConnectionCode(code) });
      const url = whatsAppLink(botNumber, code);
      res.setHeader("Cache-Control", "no-store");
      res.json({ url, expiresAt, qr: await QRCode.toDataURL(url, { width: 280, margin: 2 }) });
    } catch { res.status(429).json({ error: "Wait 30 seconds before requesting a new connection code" }); }
  });
  router.post("/disconnect", async (_req, res) => {
    if (!tenantActor()) { res.status(401).json({ error: "Sign in first" }); return; }
    await convex.mutation(api.publicAccounts.disconnect, {});
    res.json({ ok: true });
  });
  return router;
}

export async function connectPublicWhatsApp(text: string, phoneJid: string, botAccount: string): Promise<boolean> {
  const match = /^BOOP CONNECT ([a-f0-9]{48})$/.exec(text.trim());
  if (!match) return false;
  const actor = await convex.mutation(api.publicAccounts.consumeChallenge, {
    codeHash: hashConnectionCode(match[1]), phone: `+${phoneJid.split("@")[0]}`, jid: phoneJid, botAccount,
  });
  if (!actor) return false;
  try { await assertCurrentPhone(actor); }
  catch { await asTenant(actor, () => convex.mutation(api.publicAccounts.disconnect, {})); return false; }
  return true;
}
export async function actorForWhatsApp(jid: string, botAccount: string): Promise<TenantActor | null> {
  const actor = await convex.query(api.publicAccounts.resolveSender, { jid, botAccount });
  if (actor) {
    try { await assertCurrentPhone(actor); }
    catch { await asTenant(actor, () => convex.mutation(api.publicAccounts.disconnect, {})); return null; }
  }
  return actor;
}

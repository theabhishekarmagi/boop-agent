/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { test, expect, beforeEach } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
const modules = import.meta.glob("./**/*.ts");
const issuer = "https://test.clerk.accounts.dev";
const alice = { subject: "user_alice", issuer, tokenIdentifier: `${issuer}|user_alice` };
const bob = { subject: "user_bob", issuer, tokenIdentifier: `${issuer}|user_bob` };
const worker = (owner = alice.tokenIdentifier, phone = "+15551234567") => ({ subject: "boop-worker", issuer: "https://boop-worker.internal",
  workerRole: "system", ownerKey: owner, verifiedPhone: phone, clerkUserId: owner.split("|")[1] });
beforeEach(() => { process.env.BOOP_PUBLIC_MODE = "true"; });

test("Public data requires auth and remains isolated across users and legacy data", async () => {
  const t = convexTest(schema, modules);
  const a = t.withIdentity(alice); const b = t.withIdentity(bob);
  await expect(t.query(api.messages.list, { conversationId: "shared" })).rejects.toThrow("Not authenticated");
  await a.mutation(api.messages.send, { conversationId: "shared", content: "Alice secret", role: "user" });
  await b.mutation(api.messages.send, { conversationId: "shared", content: "Bob secret", role: "user" });
  expect((await a.query(api.messages.list, { conversationId: "shared" })).map((r: any) => r.content)).toEqual(["Alice secret"]);
  expect((await b.query(api.messages.list, { conversationId: "shared" })).map((r: any) => r.content)).toEqual(["Bob secret"]);
  const legacy = t.withIdentity(worker("legacy"));
  await legacy.mutation(api.messages.send, { conversationId: "shared", content: "Operator secret", role: "user" });
  expect((await a.query(api.messages.list, { conversationId: "shared" })).length).toBe(1);
});

test("Memory ID collisions cannot expose or alter another tenant's memory", async () => {
  const t = convexTest(schema, modules); const a = t.withIdentity(alice); const b = t.withIdentity(bob);
  const args = { memoryId: "same-id", tier: "permanent" as const, segment: "identity" as const, importance: 1, decayRate: 0 };
  const id = await a.mutation(api.memoryRecords.upsert, { ...args, content: "Alice memory" });
  await b.mutation(api.memoryRecords.upsert, { ...args, content: "Bob memory" });
  expect((await a.query(api.memoryRecords.list, {}))[0].content).toBe("Alice memory");
  await expect(b.query(api.memoryRecords.getByIds, { ids: [id] })).rejects.toThrow("Unauthorized");
  await b.mutation(api.memoryRecords.setLifecycle, { memoryId: "same-id", lifecycle: "pruned" });
  expect((await a.query(api.memoryRecords.list, {}))[0].lifecycle).toBe("active");
});

test("Vector recall filters ownership and active lifecycle before limiting results", async () => {
  const t = convexTest(schema, modules); const a = t.withIdentity(alice); const b = t.withIdentity(bob);
  const embedding = Array.from({ length: 1024 }, (_, i) => i === 0 ? 1 : 0);
  const args = { tier: "permanent" as const, segment: "identity" as const, importance: 1, decayRate: 0, embedding };
  await a.mutation(api.memoryRecords.upsert, { ...args, memoryId: "active", content: "Alice active" });
  await a.mutation(api.memoryRecords.upsert, { ...args, memoryId: "archived", content: "Alice archived" });
  await a.mutation(api.memoryRecords.setLifecycle, { memoryId: "archived", lifecycle: "archived" });
  await b.mutation(api.memoryRecords.upsert, { ...args, memoryId: "other", content: "Bob active" });
  const hits = await a.action(api.memoryRecords.vectorSearch, { embedding, limit: 1 });
  expect(hits.map((h: any) => h.record.content)).toEqual(["Alice active"]);
});

test("Connection codes require worker auth, expire, match the verified phone and cannot replay", async () => {
  const t = convexTest(schema, modules); const w = t.withIdentity(worker()); const a = t.withIdentity(alice);
  await expect(a.mutation(api.publicAccounts.syncVerifiedPhone, {})).rejects.toThrow("Worker");
  await w.mutation(api.publicAccounts.syncVerifiedPhone, {});
  await w.mutation(api.publicAccounts.createChallenge, { codeHash: "a".repeat(64) });
  await expect(w.mutation(api.publicAccounts.createChallenge, { codeHash: "b".repeat(64) })).rejects.toThrow("30 seconds");
  const args = { codeHash: "a".repeat(64), phone: "+15551234567", jid: "15551234567@s.whatsapp.net", botAccount: "19999999999@s.whatsapp.net" };
  expect(await w.mutation(api.publicAccounts.consumeChallenge, { ...args, phone: "+15557654321" })).toBeNull();
  await expect(a.mutation(api.publicAccounts.consumeChallenge, args)).rejects.toThrow("Worker");
  const linked = await w.mutation(api.publicAccounts.consumeChallenge, args);
  expect(linked?.ownerId).toBe(alice.tokenIdentifier);
  expect(await w.mutation(api.publicAccounts.consumeChallenge, args)).toBeNull();
  expect((await a.query(api.publicAccounts.me, {}))?.connected).toBe(true);
  await a.mutation(api.publicAccounts.disconnect, {});
  expect(await w.query(api.publicAccounts.resolveSender, { jid: args.jid, botAccount: args.botAccount })).toBeNull();
  await t.run(async (ctx) => {
    const row = await ctx.db.query("userProfiles").withIndex("by_ownerId", (q) => q.eq("ownerId", alice.tokenIdentifier)).unique();
    await ctx.db.patch(row!._id, { codeHash: "c".repeat(64), codeExpiresAt: Date.now() - 1 });
  });
  expect(await w.mutation(api.publicAccounts.consumeChallenge, { ...args, codeHash: "c".repeat(64) })).toBeNull();
});

test("Phone changes unlink old WhatsApp identities and quotas are enforced per user", async () => {
  const t = convexTest(schema, modules); const w = t.withIdentity(worker());
  await w.mutation(api.publicAccounts.syncVerifiedPhone, {});
  for (let i = 0; i < 5; i++) expect(await w.mutation(api.publicAccounts.claimTurn, {})).toBe(true);
  expect(await w.mutation(api.publicAccounts.claimTurn, {})).toBe(false);
  const wb = t.withIdentity(worker(bob.tokenIdentifier, "+15557654321"));
  await wb.mutation(api.publicAccounts.syncVerifiedPhone, {});
  expect(await wb.mutation(api.publicAccounts.claimTurn, {})).toBe(true);
  await t.run(async (ctx) => {
    const p = await ctx.db.query("userProfiles").withIndex("by_ownerId", (q) => q.eq("ownerId", alice.tokenIdentifier)).unique();
    await ctx.db.patch(p!._id, { whatsappJid: "15551234567@s.whatsapp.net", botAccount: "bot" });
  });
  const updated = t.withIdentity(worker(alice.tokenIdentifier, "+15550001111"));
  await updated.mutation(api.publicAccounts.syncVerifiedPhone, {});
  expect(await w.query(api.publicAccounts.resolveSender, { jid: "15551234567@s.whatsapp.net", botAccount: "bot" })).toBeNull();
});

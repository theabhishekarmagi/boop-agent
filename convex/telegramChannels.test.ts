/// <reference types="vite/client" />
import { expect, test } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import { RUNTIME_ISSUER } from "./model/auth";
const modules = import.meta.glob("./**/*.ts");
const worker = (owner: string) => ({ issuer: RUNTIME_ISSUER, subject: "agent-worker", workspace: owner });
const begin = { connectionId: "connection-a", botId: "123", botUsername: "test_bot", tokenHash: "token-hash-a" };

test("Telegram verification is worker-only, account scoped, expiring and single use", async () => {
  const t = convexTest(schema, modules);
  const a = t.withIdentity(worker("alice")), b = t.withIdentity(worker("bob"));
  const browser = t.withIdentity({ issuer: "https://auth.example", subject: "alice" });
  await expect(browser.mutation(api.telegramChannels.begin, begin)).rejects.toThrow("Worker access required");
  await expect(t.query(api.telegramChannels.get, { connectionId: begin.connectionId })).rejects.toThrow();
  await a.mutation(api.telegramChannels.begin, begin);
  expect(await b.query(api.telegramChannels.get, { connectionId: begin.connectionId })).toBeNull();
  await expect(b.mutation(api.telegramChannels.begin, { ...begin, connectionId: "connection-b" })).rejects.toThrow("already linked");
  const verify = { connectionId: begin.connectionId, tokenHash: begin.tokenHash, chatId: "991", senderId: "991" };
  expect(await b.mutation(api.telegramChannels.verify, verify)).toBe(false);
  expect(await a.mutation(api.telegramChannels.verify, { ...verify, tokenHash: "wrong" })).toBe(false);
  expect(await a.mutation(api.telegramChannels.verify, { ...verify, senderId: "992" })).toBe(false);
  expect(await a.mutation(api.telegramChannels.verify, verify)).toBe(true);
  expect(await a.mutation(api.telegramChannels.verify, verify)).toBe(false);
  expect((await a.query(api.telegramChannels.get, { connectionId: begin.connectionId }))?.chatId).toBe("991");
  await b.mutation(api.telegramChannels.remove, { connectionId: begin.connectionId });
  expect(await a.query(api.telegramChannels.get, { connectionId: begin.connectionId })).not.toBeNull();
  await a.mutation(api.telegramChannels.begin, begin);
  await t.run(async ctx => {
    const row = await ctx.db.query("telegramChannels").withIndex("by_botId", q => q.eq("botId", begin.botId)).unique();
    await ctx.db.patch(row!._id, { expiresAt: Date.now() - 1 });
  });
  expect(await a.mutation(api.telegramChannels.verify, verify)).toBe(false);
  await a.mutation(api.telegramChannels.begin, { ...begin, botId: "replacement-bot" });
  expect((await a.query(api.telegramChannels.get, { connectionId: begin.connectionId }))?.chatId).toBeUndefined();
  await a.mutation(api.telegramChannels.remove, { connectionId: begin.connectionId });
  expect(await a.query(api.telegramChannels.get, { connectionId: begin.connectionId })).toBeNull();
});

test("plain-start candidates require owner approval, expire, and cannot replace a linked account", async () => {
  const t = convexTest(schema, modules);
  const a = t.withIdentity(worker("alice")), b = t.withIdentity(worker("bob"));
  const browser = t.withIdentity({ issuer: "https://auth.example", subject: "alice" });
  await a.mutation(api.telegramChannels.begin, { connectionId: "a", botId: "123", botUsername: "test_bot" });
  const candidate = { connectionId: "a", requestId: "request-1", chatId: "991", senderId: "991", username: "alice" };
  await expect(browser.mutation(api.telegramChannels.requestChat, candidate)).rejects.toThrow("Worker access required");
  await expect(browser.mutation(api.telegramChannels.confirmChat, { connectionId: "a", requestId: "request-1" })).rejects.toThrow("Worker access required");
  expect(await b.mutation(api.telegramChannels.requestChat, candidate)).toBe(false);
  expect(await a.mutation(api.telegramChannels.requestChat, { ...candidate, senderId: "992" })).toBe(false);
  expect(await a.mutation(api.telegramChannels.requestChat, candidate)).toBe(true);
  expect(await a.mutation(api.telegramChannels.requestChat, { ...candidate, requestId: "repeat-start" })).toBe(true);
  let row = await a.query(api.telegramChannels.get, { connectionId: "a" });
  expect(row?.chatId).toBeUndefined();
  expect(row?.pendingChats?.map(p => p.requestId)).toEqual(["request-1"]);
  expect(await b.mutation(api.telegramChannels.confirmChat, { connectionId: "a", requestId: "request-1" })).toBe(false);
  expect(await a.mutation(api.telegramChannels.confirmChat, { connectionId: "a", requestId: "unknown" })).toBe(false);
  await t.run(async ctx => {
    await ctx.db.patch(row!._id, { pendingChats: row!.pendingChats!.map(p => ({ ...p, expiresAt: Date.now() - 1 })) });
  });
  expect(await a.mutation(api.telegramChannels.confirmChat, { connectionId: "a", requestId: "request-1" })).toBe(false);
  await a.mutation(api.telegramChannels.requestChat, { ...candidate, requestId: "fresh" });
  await a.mutation(api.telegramChannels.requestChat, { ...candidate, requestId: "stranger", chatId: "992", senderId: "992" });
  expect(await a.mutation(api.telegramChannels.confirmChat, { connectionId: "a", requestId: "fresh" })).toBe(true);
  expect(await a.mutation(api.telegramChannels.confirmChat, { connectionId: "a", requestId: "stranger" })).toBe(false);
  expect(await a.mutation(api.telegramChannels.requestChat, { ...candidate, chatId: "993", senderId: "993" })).toBe(false);
  row = await a.query(api.telegramChannels.get, { connectionId: "a" });
  expect(row?.chatId).toBe("991");
  expect(row?.pendingChats).toBeUndefined();
  expect(row?.greetingPending).toBe("fresh");
  await b.mutation(api.telegramChannels.acknowledgeGreeting, { connectionId: "a", requestId: "fresh" });
  await a.mutation(api.telegramChannels.acknowledgeGreeting, { connectionId: "a", requestId: "wrong" });
  expect((await a.query(api.telegramChannels.get, { connectionId: "a" }))?.greetingPending).toBe("fresh");
  await a.mutation(api.telegramChannels.acknowledgeGreeting, { connectionId: "a", requestId: "fresh" });
  expect((await a.query(api.telegramChannels.get, { connectionId: "a" }))?.greetingPending).toBeUndefined();
});

test("pending Telegram requests are bounded and concurrent approvals have one winner", async () => {
  const t = convexTest(schema, modules);
  const a = t.withIdentity(worker("alice"));
  await a.mutation(api.telegramChannels.begin, { connectionId: "a", botId: "123", botUsername: "test_bot" });
  for (let i = 1; i <= 11; i++) {
    expect(await a.mutation(api.telegramChannels.requestChat, {
      connectionId: "a", requestId: `request-${i}`, senderId: String(i), chatId: String(i),
    })).toBe(i <= 10);
  }
  expect((await a.query(api.telegramChannels.get, { connectionId: "a" }))?.pendingChats).toHaveLength(10);
  const approvals = await Promise.all([1, 2].map(i => a.mutation(api.telegramChannels.confirmChat, {
    connectionId: "a", requestId: `request-${i}`,
  })));
  expect(approvals.filter(Boolean)).toHaveLength(1);
});

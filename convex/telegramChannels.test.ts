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

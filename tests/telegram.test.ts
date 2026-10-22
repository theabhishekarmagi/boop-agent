import { test } from "node:test";
import assert from "node:assert/strict";
import type { TelegramUpdate } from "../server/telegram.js";
process.env.CONVEX_URL ??= "https://unit-test.convex.cloud";
const { allowedTelegramSender, processTelegramBatch, splitTelegramText } = await import("../server/telegram.js");

const update = (id: number, sender = 991): TelegramUpdate => ({
  update_id: id, message: { message_id: id, text: "Hello", chat: { id: sender, type: "private" }, from: { id: sender } },
});

test("Telegram blocks unapproved senders, groups, and bots", () => {
  const before = process.env.BOOP_TELEGRAM_ALLOWED_USER_IDS;
  const names = process.env.BOOP_TELEGRAM_ALLOWED_USERNAMES;
  process.env.BOOP_TELEGRAM_ALLOWED_USER_IDS = "991";
  delete process.env.BOOP_TELEGRAM_ALLOWED_USERNAMES;
  try {
    assert(allowedTelegramSender(update(1)));
    assert(!allowedTelegramSender(update(1, 992)));
    const group = update(1); group.message!.chat.type = "group";
    assert(!allowedTelegramSender(group));
    const bot = update(1); bot.message!.from!.is_bot = true;
    assert(!allowedTelegramSender(bot));
  } finally {
    if (before === undefined) delete process.env.BOOP_TELEGRAM_ALLOWED_USER_IDS;
    else process.env.BOOP_TELEGRAM_ALLOWED_USER_IDS = before;
    if (names !== undefined) process.env.BOOP_TELEGRAM_ALLOWED_USERNAMES = names;
  }
});

test("Telegram processes updates in order and checkpoints delivered replies", async () => {
  const before = process.env.BOOP_TELEGRAM_ALLOWED_USER_IDS;
  process.env.BOOP_TELEGRAM_ALLOWED_USER_IDS = "991";
  try {
    const state = {};
    const seen: string[] = [];
    const deps = {
      generate: async (conversationId: string) => { seen.push(conversationId); return "Reply"; },
      send: async () => {}, record: async () => {}, save: async () => {},
    };
    await processTelegramBatch("ca_bot", [update(4), update(2), update(3, 992)], state, deps);
    assert.deepEqual(state, { offset: 5 });
    assert.deepEqual(seen, ["telegram:ca_bot:991", "telegram:ca_bot:991"]);
    await processTelegramBatch("ca_bot", [update(4)], state, deps);
    assert.equal(seen.length, 2);
  } finally {
    if (before === undefined) delete process.env.BOOP_TELEGRAM_ALLOWED_USER_IDS;
    else process.env.BOOP_TELEGRAM_ALLOWED_USER_IDS = before;
  }
});

test("Telegram retries a failed send without rerunning the agent or resending completed chunks", async () => {
  const before = process.env.BOOP_TELEGRAM_ALLOWED_USER_IDS;
  process.env.BOOP_TELEGRAM_ALLOWED_USER_IDS = "991";
  try {
    const state = {};
    let generations = 0;
    const sent: string[] = [];
    let failed = false;
    const deps = {
      generate: async () => { generations++; return "x".repeat(4500); },
      send: async (_id: number, text: string) => {
        if (sent.length === 1 && !failed) { failed = true; throw new Error("network"); }
        sent.push(text);
      },
      record: async () => {}, save: async () => {},
    };
    await assert.rejects(processTelegramBatch("ca_bot", [update(2)], state, deps), /network/);
    await processTelegramBatch("ca_bot", [update(2)], state, deps);
    assert.equal(generations, 1);
    assert.deepEqual(sent.map((s) => s.length), [4000, 500]);
    assert.deepEqual(state, { offset: 3 });
  } finally {
    if (before === undefined) delete process.env.BOOP_TELEGRAM_ALLOWED_USER_IDS;
    else process.env.BOOP_TELEGRAM_ALLOWED_USER_IDS = before;
  }
});

test("Telegram long replies preserve emoji and content within message limits", () => {
  const text = "a".repeat(3999) + "😀" + "b".repeat(5000);
  const chunks = splitTelegramText(text);
  assert.equal(chunks.join(""), text);
  assert(chunks.every((s) => s.length <= 4000));
  assert(chunks.every((s) => !/[\uD800-\uDBFF]$/.test(s)));
});


test("workspace Telegram pairing greets once and ignores unauthorized senders", async () => {
  const state = {};
  const sent: string[] = [];
  let generated = 0;
  await processTelegramBatch("ca_user_bot", [update(1), update(2, 992), update(3)], state, {
    authorize: async item => item.update_id === 1 ? "linked" : item.message?.from?.id === 991 ? "message" : "ignore",
    generate: async () => { generated++; return "Your own agent reply"; },
    send: async (_id, text) => { sent.push(text); }, record: async () => {}, save: async () => {},
  });
  assert.equal(generated, 1);
  assert.match(sent[0], /^Hi! Your Telegram is connected/);
  assert.equal(sent[1], "Your own agent reply");
  assert.equal(sent.length, 2);
});


test("Composio Telegram string and numeric IDs normalize to the same private sender", async () => {
  const { privateTelegramSender } = await import("../server/telegram.js");
  const item = update(1);
  item.message!.chat.id = "991";
  assert.deepEqual(privateTelegramSender(item), {chatId: "991", senderId: "991"});
  item.message!.from!.id = "992";
  assert.equal(privateTelegramSender(item), null);
});

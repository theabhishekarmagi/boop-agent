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

test("durable intake continues while a task runs, with order per chat and no duplicate updates", async () => {
  const { createTelegramInbox } = await import("../server/telegram.js");
  const state: Parameters<typeof createTelegramInbox>[1] = {};
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const started: string[] = [], sent: number[] = [];
  const snapshots: typeof state[] = [];
  const inbox = createTelegramInbox("bot", state, {
    authorize: async () => "message",
    generate: async (chat) => { started.push(chat); if (started.length === 1) await blocked; return "ok"; },
    send: async chat => { sent.push(chat); }, record: async () => {},
    save: async next => { snapshots.push(structuredClone(next)); },
  });
  await inbox.enqueue([update(1)]);
  await new Promise(resolve => setImmediate(resolve));
  await inbox.enqueue([update(1), update(2), update(3, 992)]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.offset, 4);
  assert(sent.includes(992), "another chat must complete before the first task finishes");
  assert.equal(started.filter(chat => chat.endsWith(":991")).length, 1, "same chat stays ordered");
  assert(snapshots.some(s => s.offset === 4 && s.inbox?.some(j => j.update.update_id === 2)));
  release();
  await inbox.idle();
  assert.equal(started.length, 3);
  assert.equal(state.inbox?.length, 0);
});

test("persisted inbox survives restart and resumes failed delivery without regenerating", async () => {
  const { createTelegramInbox } = await import("../server/telegram.js");
  const state: Parameters<typeof createTelegramInbox>[1] = { offset: 3, inbox: [{ update: update(2), checkpoint: { pending: { updateId: 2, reply: "cached reply", sentChunks: 0 } } }] };
  let generated = 0;
  let fail = true;
  const sent: string[] = [];
  const inbox = createTelegramInbox("bot", state, {
    authorize: async () => "message",
    generate: async () => { generated++; return "wrong"; },
    send: async (_chat, reply) => { if (fail) throw new Error("network"); sent.push(reply); },
    record: async () => {}, save: async () => {},
  });
  inbox.wake();
  await assert.rejects(inbox.idle(), /network/);
  assert.equal(state.inbox?.length, 1);
  fail = false;
  inbox.wake(); await inbox.idle();
  assert.equal(generated, 0);
  assert.deepEqual(sent, ["cached reply"]);
  assert.equal(state.inbox?.length, 0);
});

test("failed durable intake does not advance the provider offset", async () => {
  const { createTelegramInbox } = await import("../server/telegram.js");
  const state: Parameters<typeof createTelegramInbox>[1] = {};
  let calls = 0;
  const inbox = createTelegramInbox("bot", state, {
    authorize: async () => "message", generate: async () => { calls++; return "ok"; },
    send: async () => {}, record: async () => {}, save: async () => { throw new Error("disk unavailable"); },
  });
  await assert.rejects(inbox.enqueue([update(1)]), /disk unavailable/);
  assert.equal(state.offset, undefined);
  assert.equal(state.inbox, undefined);
  assert.equal(calls, 0);
});

test("plain /start queues approval without running the agent; approved senders get a greeting", async () => {
  const { authorizeUpdate } = await import("../server/telegram.js");
  let approved = false;
  const requested: Array<{ chatId: string; senderId: string; requestId: string }> = [];
  const deps = {
    verified: async (_connection: string, chat: string) => approved && chat === "991",
    verify: async () => false,
    request: async (candidate: { chatId: string; senderId: string; requestId: string }) => { requested.push(candidate); return true; },
    legacyAllowed: () => false,
  };
  const start = update(1); start.message!.text = "/start";
  assert.equal(await authorizeUpdate("ca_bot", start, deps), "ignore");
  assert.equal(requested.length, 1);
  assert.equal(requested[0].chatId, "991");
  assert.match(requested[0].requestId, /^[a-zA-Z0-9_-]{32}$/);
  assert.equal(await authorizeUpdate("ca_bot", update(2), deps), "ignore");
  approved = true;
  assert.equal(await authorizeUpdate("ca_bot", start, deps), "linked");
  assert.equal(await authorizeUpdate("ca_bot", update(3), deps), "message");
  assert.equal(await authorizeUpdate("ca_bot", update(4, 992), deps), "ignore");
  const group = update(5); group.message!.text = "/start"; group.message!.chat.type = "group";
  assert.equal(await authorizeUpdate("ca_bot", group, deps), "ignore");
  const bot = update(6); bot.message!.text = "/start"; bot.message!.from!.is_bot = true;
  assert.equal(await authorizeUpdate("ca_bot", bot, deps), "ignore");
  assert.equal(requested.length, 1);
  let generations = 0;
  const sent: string[] = [];
  await processTelegramBatch("ca_bot", [start], {}, {
    authorize: candidate => authorizeUpdate("ca_bot", candidate, deps),
    generate: async () => { generations++; return "should not run"; },
    send: async (_chat, text) => { sent.push(text); }, record: async () => {}, save: async () => {},
  });
  assert.equal(generations, 0);
  assert.match(sent[0], /^Hi! Your Telegram is connected/);
});

test("dashboard approval greeting is acknowledged only after delivery and retried on failure", async () => {
  const { deliverTelegramGreeting } = await import("../server/telegram.js");
  const channel = { chatId: "991", greetingPending: "approval-id" as string | undefined };
  let failed = false, acknowledgements = 0, attempts = 0;
  const deps = {
    send: async (chatId: string, text: string) => {
      attempts++;
      assert.equal(chatId, "991"); assert.match(text, /^Hi!/);
      if (!failed) { failed = true; throw new Error("provider unavailable"); }
    },
    acknowledge: async (id: string) => { assert.equal(id, "approval-id"); acknowledgements++; channel.greetingPending = undefined; return null; },
  };
  await assert.rejects(deliverTelegramGreeting("ca_bot", channel, deps), /provider unavailable/);
  assert.equal(acknowledgements, 0);
  await deliverTelegramGreeting("ca_bot", channel, deps);
  await deliverTelegramGreeting("ca_bot", channel, deps);
  assert.equal(attempts, 2);
  assert.equal(acknowledgements, 1);
});

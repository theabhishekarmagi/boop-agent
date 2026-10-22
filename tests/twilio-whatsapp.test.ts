import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import twilio from "twilio";
import { TwilioWhatsAppQueue, emptyQueue, conversationFor, WINDOW_MS, splitWhatsAppText, type WhatsAppQueueState } from "../server/twilio-whatsapp-queue.js";
import { createTwilioWhatsAppRouter, twilioWhatsAppConfig } from "../server/twilio-whatsapp.js";

const config = {
  accountSid: `AC${"1".repeat(32)}`, authToken: "test-auth-token", from: "whatsapp:+14155550100",
  webhookUrl: "https://boop.example/twilio/whatsapp/webhook", allowed: new Set(["whatsapp:+919876543210"]),
};
const job = (id = "1") => ({ id: `SM${id.padStart(32, "0")}`, from: [...config.allowed][0], to: config.from, text: "Hello", receivedAt: 1_000_000 });
const conversation = conversationFor(config.from, [...config.allowed][0]);

function fixture(initial = emptyQueue()) {
  let saved = structuredClone(initial);
  let now = 1_000_000;
  let generations = 0;
  const sent: string[] = [];
  const recorded: string[] = [];
  const deps = {
    save: async (state: WhatsAppQueueState) => { saved = structuredClone(state); },
    generate: async () => { generations++; return "Hi from Boop"; },
    send: async (_to: string, text: string) => { sent.push(text); },
    record: async (_id: string, text: string) => { recorded.push(text); },
    allowed: (from: string) => config.allowed.has(from), now: () => now,
  };
  return { deps, state: () => saved, now: (value: number) => { now = value; }, generations: () => generations, sent, recorded };
}

test("Twilio configuration requires private access and an exact HTTPS webhook URL", () => {
  assert(twilioWhatsAppConfig({}).missing.includes("BOOP_WHATSAPP_ALLOWED_NUMBERS"));
  const env = { TWILIO_ACCOUNT_SID: config.accountSid, TWILIO_AUTH_TOKEN: config.authToken,
    TWILIO_WHATSAPP_FROM: config.from, TWILIO_WHATSAPP_WEBHOOK_URL: config.webhookUrl,
    BOOP_WHATSAPP_ALLOWED_NUMBERS: "+919876543210" };
  assert.equal(twilioWhatsAppConfig(env).config?.from, config.from);
  assert.throws(() => twilioWhatsAppConfig({ ...env, TWILIO_WHATSAPP_WEBHOOK_URL: "http://localhost/webhook" }));
  assert.throws(() => twilioWhatsAppConfig({ ...env, BOOP_WHATSAPP_ALLOWED_NUMBERS: config.from.slice(9) }));
});

test("signed webhook admits text once; rejects tampering and ignores unauthorized/media traffic", async () => {
  const f = fixture();
  const queue = new TwilioWhatsAppQueue(emptyQueue(), f.deps);
  const app = express();
  app.use("/twilio/whatsapp", createTwilioWhatsAppRouter(config, queue));
  const server = createServer(app);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address() as { port: number };
  const fields = { AccountSid: config.accountSid, MessageSid: job().id,
    From: job().from, To: config.from, Body: "Hello", NumMedia: "0", NewTwilioField: "included-in-signature" };
  const post = (body = fields, signature = twilio.getExpectedTwilioSignature(config.authToken, config.webhookUrl, body), path = "") =>
    fetch(`http://127.0.0.1:${address.port}/twilio/whatsapp/webhook${path}`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": signature },
      body: new URLSearchParams(body),
    });
  try {
    assert.equal((await post(fields, "invalid")).status, 403);
    assert.equal((await post({ ...fields, Body: "tampered" }, twilio.getExpectedTwilioSignature(config.authToken, config.webhookUrl, fields))).status, 403);
    assert.equal((await post(fields, undefined, "?unexpected=1")).status, 403);
    assert.equal((await post({ ...fields, AccountSid: `AC${"2".repeat(32)}` })).status, 403);
    assert.equal((await post({ ...fields, From: "whatsapp:+919999999999" })).status, 200);
    assert.equal((await post({ ...fields, NumMedia: "1" })).status, 200);
    assert.equal(f.generations(), 0);
    // HTTP receipt uses current time, so make the fixture clock agree for processing.
    f.now(Date.now());
    assert.equal((await post()).status, 200);
    await queue.drain();
    assert.equal((await post()).status, 200);
    await queue.drain();
    assert.equal(f.generations(), 1);
    assert.deepEqual(f.sent, ["Hi from Boop"]);
  } finally { await queue.stop(); await new Promise<void>((done) => server.close(() => done())); }
});

test("reply retry resumes saved chunks after restart without repeating agent actions", async () => {
  const f = fixture();
  f.deps.generate = async () => { return "a".repeat(1600); };
  let calls = 0;
  f.deps.send = async (_to, text) => { if (++calls === 2) throw new Error("offline"); f.sent.push(text); };
  const queue = new TwilioWhatsAppQueue(emptyQueue(), f.deps);
  await queue.enqueue(job()); await queue.drain(); await queue.stop();
  assert.equal(f.state().jobs[0].sentChunks, 1);
  const resumed = fixture(f.state());
  const second = new TwilioWhatsAppQueue(f.state(), resumed.deps);
  await second.recover(); await second.drain(); await second.stop();
  assert.equal(resumed.generations(), 0);
  assert.deepEqual(resumed.sent.map((s) => s.length), [100]);
  assert.equal(resumed.state().jobs.length, 0);
});

test("interrupted generation is not rerun and closed windows cannot deliver saved replies", async () => {
  const f = fixture({ ...emptyQueue(), jobs: [{ ...job(), phase: "generating", sentChunks: 0 }] });
  const queue = new TwilioWhatsAppQueue(f.state(), f.deps);
  await queue.recover(); await queue.drain();
  assert.equal(f.generations(), 0);
  assert.equal(f.state().jobs.length, 0);
  await queue.enqueue(job("2"));
  assert(queue.canReply(conversation));
  f.now(1_000_000 + WINDOW_MS);
  assert(!queue.canReply(conversation));
  await queue.drain(); await queue.stop();
  assert.equal(f.sent.length, 0);
});

test("duplicate webhooks don't extend the reply window; new messages do", async () => {
  const f = fixture(); const queue = new TwilioWhatsAppQueue(emptyQueue(), f.deps);
  await queue.enqueue(job()); await queue.drain();
  f.now(1_000_000 + WINDOW_MS);
  await queue.enqueue({ ...job(), receivedAt: 1_000_000 + WINDOW_MS });
  assert(!queue.canReply(conversation));
  await queue.enqueue({ ...job("2"), receivedAt: 1_000_000 + WINDOW_MS });
  assert(queue.canReply(conversation));
  await queue.stop();
});

test("WhatsApp chunking preserves emoji and text", () => {
  const text = "a".repeat(1499) + "😀" + "b".repeat(2000);
  const chunks = splitWhatsAppText(text);
  assert.equal(chunks.join(""), text);
  assert(chunks.every((s) => s.length <= 1500 && !/[\uD800-\uDBFF]$/.test(s)));
});

test("failed persistence cannot acknowledge or execute an incoming request", async () => {
  const f = fixture();
  f.deps.save = async () => { throw new Error("disk full"); };
  const queue = new TwilioWhatsAppQueue(emptyQueue(), f.deps);
  await assert.rejects(queue.enqueue(job()), /disk full/);
  await queue.drain(); await queue.stop();
  assert.equal(f.generations(), 0);
  assert.equal(f.sent.length, 0);
});

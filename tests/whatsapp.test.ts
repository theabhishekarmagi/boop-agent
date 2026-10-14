import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { proto, type WAMessage } from "@whiskeysockets/baileys";
import { approvedWhatsAppPhone, incomingWhatsAppText, phoneJid, processWhatsAppJob, splitWhatsAppText, type WhatsAppCheckpoint } from "../server/whatsapp-messages.js";
import { loadWhatsAppAuth, lockWhatsAppDirectory } from "../server/whatsapp-state.js";

const phone = "15551234567@s.whatsapp.net";
const message = (jid = phone): WAMessage => proto.WebMessageInfo.fromObject({
  key: { id: "message-1", remoteJid: jid, fromMe: false }, message: { conversation: "Hello" },
}) as WAMessage;

test("WhatsApp ignores outgoing messages, groups, statuses and non-text events", () => {
  assert.equal(incomingWhatsAppText(message()), "Hello");
  for (const jid of ["123@g.us", "status@broadcast", "123@newsletter"]) assert.equal(incomingWhatsAppText(message(jid)), undefined);
  const outgoing = message(); outgoing.key.fromMe = true;
  assert.equal(incomingWhatsAppText(outgoing), undefined);
  const reaction = message(); reaction.message = { reactionMessage: { text: "👍" } };
  assert.equal(incomingWhatsAppText(reaction), undefined);
  const wrapped = message(); wrapped.message = { ephemeralMessage: { message: { extendedTextMessage: { text: "wrapped" } } } };
  assert.equal(incomingWhatsAppText(wrapped), "wrapped");
});

test("WhatsApp authorizes phone identities across LIDs without interpreting a LID as a phone number", async () => {
  const allowed = new Set([phone]);
  assert.equal(phoneJid("+15551234567"), phone);
  assert.equal(phoneJid("anything"), undefined);
  assert.equal(await approvedWhatsAppPhone(message(), allowed, async () => undefined), phone);
  const lid = message("123:4@lid"); lid.key.remoteJidAlt = phone;
  assert.equal(await approvedWhatsAppPhone(lid, allowed, async () => undefined), phone);
  delete lid.key.remoteJidAlt;
  assert.equal(await approvedWhatsAppPhone(lid, allowed, async () => phone), phone);
  assert.equal(await approvedWhatsAppPhone(lid, allowed, async () => undefined), undefined);
  assert.equal(await approvedWhatsAppPhone(message(), new Set(), async () => phone), undefined);
});

test("WhatsApp checkpoints resume delivery after restart without rerunning tools or completed chunks", async () => {
  let state: WhatsAppCheckpoint = { completed: [] };
  const job = { id: "one", jid: phone, conversationId: `whatsapp:bot:${phone}`, text: "Hello" };
  let generated = 0; let recorded = 0; let persisted = "";
  const sent: string[] = [];
  const deps = {
    generate: async () => { generated++; return "a".repeat(3999) + "😀" + "b".repeat(500); },
    send: async (_jid: string, text: string) => { if (sent.length === 1) throw new Error("disconnected"); sent.push(text); },
    record: async () => { recorded++; },
    save: async (value: WhatsAppCheckpoint) => { persisted = JSON.stringify(value); },
  };
  await assert.rejects(processWhatsAppJob(job, state, deps), /disconnected/);
  state = JSON.parse(persisted);
  await processWhatsAppJob(job, state, { ...deps, send: async (_jid, text) => { sent.push(text); } });
  await processWhatsAppJob(job, state, deps);
  assert.equal(generated, 1); assert.equal(recorded, 1);
  assert.equal(sent.join(""), "a".repeat(3999) + "😀" + "b".repeat(500));
  assert.deepEqual(state, { completed: ["one"] });
});

test("WhatsApp splits long replies without breaking emoji", () => {
  const text = "😀".repeat(4200);
  const parts = splitWhatsAppText(text);
  assert.equal(parts.join(""), text);
  assert(parts.every((part) => part.length <= 4000 && !/[\uD800-\uDBFF]$/.test(part)));
});

test("WhatsApp auth restores binary keys, LID mappings and app-state keys with private permissions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "boop-whatsapp-"));
  const release = await lockWhatsAppDirectory(directory);
  try {
    await assert.rejects(lockWhatsAppDirectory(directory), /already owns/);
    const auth = await loadWhatsAppAuth(directory);
    await Promise.all([
      auth.state.keys.set({ session: { user: Buffer.from([1, 2, 3]) }, "lid-mapping": { user: phone } }),
      auth.state.keys.set({ "app-state-sync-key": { key: { keyData: Buffer.from([4, 5]) } } }),
      auth.saveCreds(),
    ]);
    const restored = await loadWhatsAppAuth(directory);
    assert.deepEqual((await restored.state.keys.get("session", ["user"])).user, Buffer.from([1, 2, 3]));
    assert.equal((await restored.state.keys.get("lid-mapping", ["user"])).user, phone);
    assert.deepEqual((await restored.state.keys.get("app-state-sync-key", ["key"])).key.keyData, Buffer.from([4, 5]));
    assert.deepEqual(restored.state.creds.noiseKey, auth.state.creds.noiseKey);
    assert.equal((await stat(join(directory, "auth.json"))).mode & 0o777, 0o600);
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    await restored.state.keys.set({ session: { user: null } });
    assert.deepEqual(await restored.state.keys.get("session", ["user"]), {});
    await writeFile(join(directory, "auth.json"), "broken");
    await assert.rejects(loadWhatsAppAuth(directory), /Cannot read/);
  } finally { await release(); await rm(directory, { recursive: true, force: true }); }
});

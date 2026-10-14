import { test } from "node:test";
import assert from "node:assert/strict";
import { operatorWelcome } from "../server/whatsapp-welcome.js";

test("operator greeting is sent once across concurrent opens and restarts", async () => {
  const sent: string[] = [];
  let persisted: string[] = [];
  const send = async (jid: string) => { sent.push(jid); };
  const save = async (accounts: string[]) => { persisted = accounts; };
  const welcome = operatorWelcome([], send, save);
  await Promise.all([welcome("bot@s.whatsapp.net"), welcome("bot@s.whatsapp.net")]);
  await operatorWelcome(persisted, send, save)("bot@s.whatsapp.net");
  assert.deepEqual(sent, ["bot@s.whatsapp.net"]);
});

test("a failed greeting can retry without being recorded as delivered", async () => {
  let attempts = 0;
  let persisted: string[] = [];
  const welcome = operatorWelcome([], async () => {
    if (++attempts === 1) throw new Error("offline");
  }, async (accounts) => { persisted = accounts; });
  await assert.rejects(welcome("bot@s.whatsapp.net"));
  assert.deepEqual(persisted, []);
  await welcome("bot@s.whatsapp.net");
  assert.equal(attempts, 2);
  assert.deepEqual(persisted, ["bot@s.whatsapp.net"]);
});

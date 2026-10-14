import { resolve, join } from "node:path";
import makeWASocket, { DisconnectReason, jidNormalizedUser, makeCacheableSignalKeyStore, type WASocket, type WAMessage, type proto } from "@whiskeysockets/baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";
import QRCode from "qrcode";
import { writeFile } from "node:fs/promises";
import { lockWhatsAppDirectory, loadWhatsAppAuth, readJson, writeJson } from "./whatsapp-state.js";
import { approvedWhatsAppPhone, incomingWhatsAppText, phoneJid, processWhatsAppJob, splitWhatsAppText, type WhatsAppCheckpoint, type WhatsAppJob } from "./whatsapp-messages.js";
import { handleUserMessage } from "./interaction-agent.js";
import { convex } from "./convex-client.js";
import { api } from "../convex/_generated/api.js";
import { broadcast } from "./broadcast.js";
import { asTenant, publicMode, tenantActor } from "./tenant-context.js";
import { actorForWhatsApp, connectPublicWhatsApp } from "./public-whatsapp.js";
import { operatorWelcome } from "./whatsapp-welcome.js";

let socket: WASocket | undefined;
let account: string | undefined;
let status = "disabled";
let started = false;
let sendText: ((jid: string, text: string) => Promise<void>) | undefined;
export function whatsAppStatus() { return { status, phone: account?.endsWith("@s.whatsapp.net") ? `+${account.split("@")[0]}` : null }; }

export function allowedWhatsAppPhones(): Set<string> {
  return new Set((process.env.BOOP_WHATSAPP_ALLOWED_NUMBERS ?? "").split(",")
    .map((number) => phoneJid(number.replace(/[\s()-]/g, ""))).filter((jid): jid is string => !!jid));
}

export async function sendWhatsAppReply(conversationId: string, text: string): Promise<void> {
  const match = /^whatsapp:([^:]+):([^:]+)$/.exec(conversationId);
  const authorized = match && (publicMode()
    ? (await actorForWhatsApp(match[2], match[1]))?.ownerId === tenantActor()?.ownerId && !!tenantActor()
    : allowedWhatsAppPhones().has(match[2]));
  if (!match || match[1] !== account || !authorized) {
    throw new Error("WhatsApp conversation is not authorized for this account.");
  }
  if (!socket || status !== "connected") throw new Error("WhatsApp is disconnected.");
  for (const part of splitWhatsAppText(text)) await sendText!(match[2], part);
}

export async function startWhatsApp(): Promise<(() => Promise<void>) | undefined> {
  if (process.env.BOOP_WHATSAPP_ENABLED !== "true" || started) return;
  started = true;
  const directory = resolve(process.env.BOOP_WHATSAPP_STATE_DIR || "data/whatsapp");
  let release: (() => Promise<void>) | undefined;
  try {
    release = await lockWhatsAppDirectory(directory);
    const auth = await loadWhatsAppAuth(directory);
    const checkpointPath = join(directory, "messages.json");
    const checkpoint = await readJson<WhatsAppCheckpoint>(checkpointPath) ?? { completed: [] };
    const cachePath = join(directory, "sent.json");
    const sentMessages = new Map<string, proto.IMessage>(await readJson<[string, proto.IMessage][]>(cachePath) ?? []);
    let cacheWrites: Promise<void> = Promise.resolve();
    const logger = pino({ level: "silent" });
    let stopped = false;
    let attempts = 0;
    let reconnect: NodeJS.Timeout | undefined;
    let retry: NodeJS.Timeout | undefined;
    let draining: Promise<void> | undefined;
    const queue: WhatsAppJob[] = [];
    const queued = new Set<string>();
    // Restore an interrupted delivery before processing new requests.
    if (checkpoint.pending) { queue.push(checkpoint.pending.job); queued.add(checkpoint.pending.job.id); }
    const save = (value: WhatsAppCheckpoint) => writeJson(checkpointPath, value);
    sendText = async (jid, text) => {
      if (!socket || status !== "connected") throw new Error("WhatsApp is disconnected.");
      const sent = await socket.sendMessage(jid, { text });
      if (!sent?.key.id || !sent.message) throw new Error("WhatsApp did not accept the reply.");
      sentMessages.set(sent.key.id, sent.message);
      while (sentMessages.size > 200) sentMessages.delete(sentMessages.keys().next().value!);
      // getMessage enables Baileys' protocol-level resend/decryption retries.
      const snapshot = [...sentMessages];
      cacheWrites = cacheWrites.then(() => writeJson(cachePath, snapshot));
      await cacheWrites;
    };
    const welcomePath = join(directory, "welcomed-accounts.json");
    const welcome = operatorWelcome(await readJson<string[]>(welcomePath) ?? [], sendText,
      (accounts) => writeJson(welcomePath, accounts));
    const drain = () => {
      if (draining || stopped || status !== "connected" || retry) return;
      draining = (async () => {
        while (!stopped && status === "connected" && queue.length) {
          const job = queue[0];
          const actor = publicMode() ? await actorForWhatsApp(job.conversationId.split(":")[2], account!) : null;
          if (!job.conversationId.startsWith(`whatsapp:${account}:`) || (publicMode() ? !actor : !allowedWhatsAppPhones().has(job.conversationId.split(":")[2]))) {
            if (checkpoint.pending?.job.id === job.id) { delete checkpoint.pending; await save(checkpoint); }
            queue.shift(); queued.delete(job.id); continue;
          }
          try {
            const process = () => processWhatsAppJob(job, checkpoint, {
              generate: async (conversationId, content) => {
                broadcast("message_in", { conversationId, content, channel: "whatsapp" });
                return handleUserMessage({ conversationId, content,
                  onThinking: (t) => broadcast("thinking", { conversationId, t }) });
              },
              send: sendText!,
              record: async (conversationId, content) => {
                await convex.mutation(api.messages.send, { conversationId, role: "assistant", content });
                broadcast("whatsapp_reply", { conversationId });
              }, save,
            });
            await (actor ? asTenant(actor, process) : process());
            queue.shift(); queued.delete(job.id);
            console.log("[whatsapp] Request processed and reply submitted.");
          } catch {
            // Never print upstream errors or session material. Stop automatic
            // regeneration if generation failed: external tool actions may have
            // already happened. A saved reply can be retried safely.
            if (!checkpoint.pending) {
              queue.shift(); queued.delete(job.id);
              checkpoint.completed.push(job.id);
              checkpoint.completed = checkpoint.completed.slice(-2000);
              await save(checkpoint);
              console.warn("[whatsapp] Agent request failed. Review the dashboard before sending a new request.");
              continue;
            }
            console.warn("[whatsapp] Reply delivery/checkpoint failed; retaining pending reply for retry.");
            retry = setTimeout(() => { retry = undefined; drain(); }, 10_000);
            break;
          }
        }
      })().catch(() => {
        status = "storage_error";
        console.error("[whatsapp] State persistence failed. Stop Boop and check its state directory.");
        void socket?.end(new Error("State persistence failed"));
      }).finally(() => {
        draining = undefined;
        if (queue.length && !retry && !stopped && status === "connected") drain();
      });
    };

    const accept = async (messages: WAMessage[], current: WASocket) => {
      for (const message of messages) {
        const text = incomingWhatsAppText(message);
        if (!text || text.length > 16000 || !account) continue;
        const jid = jidNormalizedUser(message.key.remoteJid!);
        const phone = await approvedWhatsAppPhone(message, publicMode() ? undefined : allowedWhatsAppPhones(),
          async (lid) => (await current.signalRepository.lidMapping.getPNForLID(lid)) ?? undefined);
        if (!phone) continue;
        if (publicMode()) {
          if (text.startsWith("BOOP CONNECT")) {
            if (await connectPublicWhatsApp(text, phone, account)) await sendText!(jid, "Hi 👋 WhatsApp is connected to your Boop account. How can I help you?");
            continue;
          }
          if (!await actorForWhatsApp(phone, account)) continue;
        }
        const id = `${jidNormalizedUser(phone)}:${message.key.id}`;
        if (checkpoint.completed.includes(id) || queued.has(id)) continue;
        if (queue.length >= 100) { console.warn("[whatsapp] Queue full; incoming request skipped."); continue; }
        const job = { id, jid, conversationId: `whatsapp:${account}:${jidNormalizedUser(phone)}`, text };
        queued.add(id); queue.push(job);
      }
      drain();
    };

    const connect = () => {
      if (stopped || status === "storage_error") return;
      status = "connecting";
      const current = makeWASocket({
        auth: { creds: auth.state.creds, keys: makeCacheableSignalKeyStore(auth.state.keys, logger) },
        logger, markOnlineOnConnect: false, syncFullHistory: false,
        shouldSyncHistoryMessage: () => false,
        getMessage: async (key) => key.id ? sentMessages.get(key.id) : undefined,
      });
      socket = current;
      current.ev.on("creds.update", () => {
        void auth.saveCreds().catch(() => {
          status = "storage_error";
          console.error("[whatsapp] Cannot save credentials; connection stopped.");
          void current.end(new Error("Credential persistence failed"));
        });
      });
      current.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
        if (stopped || socket !== current || status === "storage_error") return;
        if (qr) {
          status = "awaiting_qr";
          console.log("[whatsapp] Scan with the Boop WhatsApp account: Linked devices → Link a device. Keep this QR private.");
          qrcode.generate(qr, { small: true });
          void QRCode.toBuffer(qr, { width: 360, margin: 2 }).then((image) =>
            writeFile(join(directory, "operator-qr.png"), image, { mode: 0o600 }))
            .catch(() => console.warn("[whatsapp] Could not save the operator QR image; use the terminal QR."));
        }
        if (connection === "open") {
          account = jidNormalizedUser(current.user!.id);
          attempts = 0; status = "connected";
          console.log(`[whatsapp] Connected. ${allowedWhatsAppPhones().size} approved sender(s).`);
          void welcome(account).catch(() => console.warn("[whatsapp] Welcome greeting failed; it will retry on the next connection."));
          drain();
        }
        if (connection === "close") {
          const code = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
          const terminal = [DisconnectReason.loggedOut, DisconnectReason.connectionReplaced,
            DisconnectReason.badSession, DisconnectReason.multideviceMismatch, DisconnectReason.forbidden];
          if (code && terminal.includes(code)) {
            status = code === DisconnectReason.loggedOut ? "logged_out" : "needs_attention";
            console.warn(`[whatsapp] Session stopped (code ${code}). See WHATSAPP.md for recovery.`);
            return;
          }
          status = "reconnecting";
          const delay = code === DisconnectReason.restartRequired ? 1000 : Math.min(30_000, 2000 * 2 ** attempts++);
          reconnect = setTimeout(connect, delay);
        }
      });
      // History/backfill batches are intentionally excluded.
      current.ev.on("messages.upsert", ({ type, messages }) => {
        if (type !== "notify" || stopped || socket !== current) return;
        void accept(messages, current).catch(() => console.warn("[whatsapp] Incoming message could not be resolved."));
      });
    };
    if (!publicMode() && !allowedWhatsAppPhones().size) console.log("[whatsapp] Pairing enabled; messages blocked until BOOP_WHATSAPP_ALLOWED_NUMBERS is configured.");
    connect();
    return async () => {
      stopped = true; status = "stopped";
      clearTimeout(reconnect); clearTimeout(retry);
      await socket?.end(undefined);
      await draining;
      await auth.flush();
      await cacheWrites;
      await release!();
    };
  } catch (error) {
    started = false; status = "error";
    await release?.();
    // Startup errors are our own safe descriptions, not HTTP/WhatsApp payloads.
    throw error;
  }
}

import express from "express";
import twilio from "twilio";
import { mkdir, chmod, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { emptyQueue, queueSchema, TwilioWhatsAppQueue, splitWhatsAppText, type WhatsAppQueueState } from "./twilio-whatsapp-queue.js";

const ADDRESS = /^whatsapp:\+[1-9]\d{6,14}$/;
export interface TwilioWhatsAppConfig { accountSid: string; authToken: string; from: string; webhookUrl: string; allowed: Set<string> }
export function twilioWhatsAppConfig(env = process.env): { config?: TwilioWhatsAppConfig; missing: string[] } {
  const names = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_WHATSAPP_FROM", "TWILIO_WHATSAPP_WEBHOOK_URL", "BOOP_WHATSAPP_ALLOWED_NUMBERS"];
  const missing = names.filter((name) => !env[name]?.trim());
  if (missing.length) return { missing };
  const from = env.TWILIO_WHATSAPP_FROM!.trim();
  const accountSid = env.TWILIO_ACCOUNT_SID!.trim();
  const webhookUrl = env.TWILIO_WHATSAPP_WEBHOOK_URL!.trim();
  const url = new URL(webhookUrl);
  const allowed = new Set(env.BOOP_WHATSAPP_ALLOWED_NUMBERS!.split(",").map((n) => `whatsapp:${n.trim()}`));
  if (!/^AC[a-fA-F0-9]{32}$/.test(accountSid) || !ADDRESS.test(from) ||
    [...allowed].some((n) => !ADDRESS.test(n) || n === from) ||
    url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/twilio/whatsapp/webhook") {
    throw new Error("Invalid Twilio WhatsApp configuration. Check Account SID, E.164 numbers, and the exact HTTPS webhook URL.");
  }
  return { missing: [], config: { accountSid, authToken: env.TWILIO_AUTH_TOKEN!.trim(), from, webhookUrl, allowed } };
}

export interface WhatsAppRuntimeDependencies {
  generate: (conversationId: string, text: string) => Promise<string>;
  record: (conversationId: string, text: string) => Promise<void>;
}

// Fixed configured URL, never a request-controlled Host/X-Forwarded-Host value.
export function createTwilioWhatsAppRouter(config: TwilioWhatsAppConfig, queue: TwilioWhatsAppQueue) {
  const router = express.Router();
  router.post("/webhook", express.urlencoded({ extended: false, limit: "64kb", parameterLimit: 100 }), async (req, res) => {
    const params: unknown = req.body;
    if (!req.is("application/x-www-form-urlencoded") || !params || typeof params !== "object" ||
      Object.values(params).some((v) => typeof v !== "string")) { res.sendStatus(400); return; }
    const fields = params as Record<string, string>;
    if (req.originalUrl !== "/twilio/whatsapp/webhook" ||
      !twilio.validateRequest(config.authToken, req.get("X-Twilio-Signature") ?? "", config.webhookUrl, fields)) {
      res.sendStatus(403); return;
    }
    const { AccountSid, MessageSid, From, To, Body, NumMedia } = fields;
    if (AccountSid !== config.accountSid || To !== config.from || !ADDRESS.test(From ?? "")) { res.sendStatus(403); return; }
    const ack = () => res.type("text/xml").send("<Response></Response>");
    if (!config.allowed.has(From) || !Body?.trim() || Number(NumMedia ?? "0") > 0) { ack(); return; }
    if (!/^SM[a-fA-F0-9]{32}$/.test(MessageSid ?? "") || Body.length > 16000) { res.sendStatus(400); return; }
    try {
      // Persist before returning 200 so accepted messages survive restarts.
      await queue.enqueue({ id: MessageSid, from: From, to: To, text: Body, receivedAt: Date.now() });
      ack();
      void queue.drain();
    } catch { res.sendStatus(503); }
  });
  return router;
}

let runtime: { config: TwilioWhatsAppConfig; queue: TwilioWhatsAppQueue; send: (to: string, text: string) => Promise<void> } | undefined;
let configuredMissing: string[] = [];
export function twilioWhatsAppStatus() {
  return { status: runtime ? "configured" : "disabled", missing: configuredMissing };
}
export async function sendTwilioWhatsAppReply(conversationId: string, text: string) {
  if (!runtime) throw new Error("Twilio WhatsApp is not configured");
  const match = /^whatsapp:twilio:(\+[1-9]\d{6,14}):(\+[1-9]\d{6,14})$/.exec(conversationId);
  if (!match || `whatsapp:${match[1]}` !== runtime.config.from ||
    !runtime.config.allowed.has(`whatsapp:${match[2]}`)) throw new Error("WhatsApp recipient is not authorized");
  for (const part of splitWhatsAppText(text)) {
    if (!runtime.queue.canReply(conversationId)) throw new Error("WhatsApp's 24-hour reply window is closed; send Boop a new message first.");
    await runtime.send(`whatsapp:${match[2]}`, part);
  }
}

async function lock(directory: string) {
  const path = join(directory, "owner.lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    try { await writeFile(path, String(process.pid), { flag: "wx", mode: 0o600 }); return () => unlink(path); }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const pid = Number(await readFile(path, "utf8"));
      if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Invalid WhatsApp queue lock");
      try { process.kill(pid, 0); }
      catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ESRCH") { await unlink(path); continue; }
        throw err;
      }
      throw new Error("Another server owns the Twilio WhatsApp queue; stop it first");
    }
  }
  throw new Error("Cannot lock WhatsApp queue");
}

export async function startTwilioWhatsApp(deps: WhatsAppRuntimeDependencies) {
  if (runtime) throw new Error("Twilio WhatsApp already started");
  const { config, missing } = twilioWhatsAppConfig();
  configuredMissing = missing;
  if (!config) { console.log(`[whatsapp] Disabled. Set: ${missing.join(", ")}`); return; }
  const directory = resolve("data/twilio-whatsapp", config.accountSid, config.from.slice(10));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const release = await lock(directory);
  try {
    const path = join(directory, "queue.json");
    let state: WhatsAppQueueState;
    try { state = queueSchema.parse(JSON.parse(await readFile(path, "utf8"))); }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Cannot read WhatsApp queue; restore it before restarting");
      state = emptyQueue();
    }
    const client = twilio(config.accountSid, config.authToken, { timeout: 20_000, autoRetry: false });
    const send = async (to: string, text: string) => {
      const result = await client.messages.create({ from: config.from, to, body: text });
      if (!result.sid || result.errorCode || ["failed", "undelivered", "canceled"].includes(result.status)) throw new Error("WhatsApp provider rejected message");
    };
    const queue = new TwilioWhatsAppQueue(state, {
      ...deps, allowed: (from) => config.allowed.has(from), send,
      save: async (next) => {
        await writeFile(`${path}.tmp`, JSON.stringify(next), { mode: 0o600 });
        await rename(`${path}.tmp`, path);
        await chmod(path, 0o600);
      },
    });
    await queue.recover();
    runtime = { config, queue, send };
    void queue.drain();
    console.log(`[whatsapp] Twilio configured. Set incoming webhook (POST): ${config.webhookUrl}`);
    return { router: createTwilioWhatsAppRouter(config, queue), stop: async () => { await queue.stop(); runtime = undefined; await release(); } };
  } catch (err) { await release(); throw err; }
}

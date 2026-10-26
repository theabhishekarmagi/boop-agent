import { createHash, randomBytes } from "node:crypto";
import { currentOwner, isOperator, workspaceKey } from "./workspace-context.js";
import { forEachWorkspace } from "./workspace-jobs.js";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { getComposio, boopUserId } from "./composio.js";
import { handleUserMessage } from "./interaction-agent.js";
import { convex } from "./convex-client.js";
import { api } from "../convex/_generated/api.js";
import { broadcast } from "./broadcast.js";

type Session = Awaited<ReturnType<NonNullable<ReturnType<typeof getComposio>>["create"]>>;
export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    chat: { id: number | string; type: string };
    from?: { id: number | string; username?: string; first_name?: string; is_bot?: boolean };
  };
}
interface State {
  inbox?: Array<{ update: TelegramUpdate; checkpoint: State }>;
  offset?: number;
  pending?: { updateId: number; reply: string; sentChunks: number };
}
const sessions = new Map<string, Promise<Session>>();
const workers = new Map<string, { stopped: boolean; owner: string; connectionId: string }>();
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

function telegramId(value: unknown): string | null {
  if ((typeof value !== "number" && typeof value !== "string") || !/^-?[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) return null;
  return String(Number(value));
}

export function privateTelegramSender(update: TelegramUpdate) {
  const message = update.message;
  if (!message?.from || message.from.is_bot || message.chat.type !== "private") return null;
  const chatId = telegramId(message.chat.id), senderId = telegramId(message.from.id);
  return chatId && senderId && chatId === senderId ? { chatId, senderId } : null;
}

export function allowedTelegramSender(update: TelegramUpdate): boolean {
  const message = update.message;
  if (!message?.from || !privateTelegramSender(update)) return false;
  const ids = (process.env.BOOP_TELEGRAM_ALLOWED_USER_IDS ?? "").split(",").map((s) => s.trim());
  const names = (process.env.BOOP_TELEGRAM_ALLOWED_USERNAMES ?? "")
    .split(",").map((s) => s.trim().replace(/^@/, "").toLowerCase()).filter(Boolean);
  return ids.includes(String(message.from.id)) ||
    Boolean(message.from.username && names.includes(message.from.username.toLowerCase()));
}

export function splitTelegramText(text: string): string[] {
  // Count UTF-16 units conservatively and keep surrogate pairs intact.
  const chunks: string[] = [];
  let current = "";
  for (const char of text) {
    if (current.length + char.length > 4000) { chunks.push(current); current = ""; }
    current += char;
  }
  if (current) chunks.push(current);
  return chunks;
}

async function sessionFor(connectionId: string): Promise<Session> {
  const key = workspaceKey(connectionId);
  let session = sessions.get(key);
  if (!session) {
    const composio = getComposio();
    if (!composio) throw new Error("Composio is disabled");
    session = composio.create(boopUserId(), {
      toolkits: ["telegram"], manageConnections: false,
      connectedAccounts: { telegram: connectionId },
    });
    sessions.set(key, session);
    session.catch(() => sessions.delete(key));
  }
  return session;
}

async function execute(connectionId: string, slug: string, args: Record<string, unknown>) {
  const session = await sessionFor(connectionId);
  // The session is already pinned to this connection. Some projects reject
  // the per-call account parameter unless multi-account selection is enabled.
  const result = await session.execute(slug, args);
  if (result.error || result.data.ok === false) {
    // Provider errors can embed credentials. Log only the execution ID.
    throw new Error(`Telegram tool failed (${slug}, log ${result.logId}).`);
  }
  return result;
}

async function ownedConnection(connectionId: string) {
  const accounts = await getComposio()!.connectedAccounts.list({ userIds: [boopUserId()], statuses: ["ACTIVE"] });
  if (!accounts.items.some(account => account.id === connectionId && account.toolkit.slug === "telegram")) {
    throw new Error("Active Telegram connection not found in your workspace");
  }
}

async function ensureTelegramChannel(connectionId: string) {
  const existing = await convex.query(api.telegramChannels.get, { connectionId });
  if (existing) return existing;
  const result = await execute(connectionId, "TELEGRAM_GET_ME", {});
  const bot = result.data.result as { username?: unknown; id?: unknown } | undefined;
  if (!bot || typeof bot.username !== "string" || !/^[a-zA-Z0-9_]+$/.test(bot.username) || !telegramId(bot.id)) {
    throw new Error(`Invalid Telegram bot info (log ${result.logId})`);
  }
  await convex.mutation(api.telegramChannels.begin, {
    connectionId, botId: String(bot.id), botUsername: bot.username,
  });
  return (await convex.query(api.telegramChannels.get, { connectionId }))!;
}

export async function telegramChatStatus(connectionId: string) {
  await ownedConnection(connectionId);
  const enabled = process.env.BOOP_TELEGRAM_ENABLED !== "false";
  const row = enabled ? await ensureTelegramChannel(connectionId) : await convex.query(api.telegramChannels.get, { connectionId });
  return { enabled, verified: Boolean(row?.chatId), botUsername: row?.botUsername ?? null,
    url: row ? `https://t.me/${row.botUsername}` : null,
    pending: (row?.pendingChats ?? []).filter(p => p.expiresAt > Date.now()),
    greetingPending: Boolean(row?.greetingPending) };
}

export async function beginTelegramChat(connectionId: string) {
  if (process.env.BOOP_TELEGRAM_ENABLED === "false") throw new Error("Telegram chat is disabled on this server");
  return telegramChatStatus(connectionId);
}

export async function confirmTelegramChat(connectionId: string, requestId: string) {
  if (process.env.BOOP_TELEGRAM_ENABLED === "false") throw new Error("Telegram chat is disabled on this server");
  await ownedConnection(connectionId);
  if (!await convex.mutation(api.telegramChannels.confirmChat, { connectionId, requestId })) {
    throw new Error("This request expired or was already handled. Refresh and send /start again if needed.");
  }
  return { verified: true };
}

export async function verifiedTelegramConversation(connectionId: string, chatId: string): Promise<boolean> {
  const row = await convex.query(api.telegramChannels.get, { connectionId });
  return Boolean(row?.chatId === chatId && row.senderId === chatId);
}

export async function authorizeUpdate(connectionId: string, update: TelegramUpdate, deps = {
  verified: verifiedTelegramConversation,
  verify: (args: { connectionId: string; tokenHash: string; chatId: string; senderId: string }) => convex.mutation(api.telegramChannels.verify, args),
  request: (args: { connectionId: string; requestId: string; chatId: string; senderId: string; username?: string; firstName?: string }) => convex.mutation(api.telegramChannels.requestChat, args),
  legacyAllowed: (candidate: TelegramUpdate) => isOperator() && allowedTelegramSender(candidate),
}): Promise<"message" | "linked" | "ignore"> {
  const message = update.message;
  const sender = privateTelegramSender(update);
  if (!message || !sender) return "ignore";
  const pairing = /^\/start(?:@[a-zA-Z0-9_]+)? boop_([a-zA-Z0-9_-]{32})$/.exec(message.text ?? "");
  if (pairing) {
    const verified = await deps.verify({
      connectionId, tokenHash: hash(pairing[1]), ...sender,
    });
    // Verification commits before the greeting is checkpointed. If the process
    // restarts in that gap, the same verified sender may retry the greeting.
    return verified || await deps.verified(connectionId, String(message.chat.id)) ? "linked" : "ignore";
  }
  if ((message.text ?? "").startsWith("/start ")) return "ignore";
  if (await deps.verified(connectionId, String(message.chat.id))) {
    return /^\/start(?:@[a-zA-Z0-9_]+)?\s*$/.test(message.text ?? "") ? "linked" : "message";
  }
  if (/^\/start(?:@[a-zA-Z0-9_]+)?\s*$/.test(message.text ?? "")) {
    await deps.request({
      connectionId, requestId: randomBytes(24).toString("base64url"), ...sender,
      ...(message.from?.username ? { username: message.from.username.slice(0, 64) } : {}),
      ...(message.from?.first_name ? { firstName: message.from.first_name.slice(0, 128) } : {}),
    });
    return "ignore";
  }
  return deps.legacyAllowed(update) ? "message" : "ignore";
}

export async function sendTelegramReply(conversationId: string, text: string): Promise<void> {
  const match = /^telegram:([^:]+):(-?\d+)$/.exec(conversationId);
  if (!match) throw new Error("Invalid Telegram conversation");
  if (!isOperator()) {
    if (!await verifiedTelegramConversation(match[1], match[2])) throw new Error("This workspace has no verified messaging channel yet.");
    await ownedConnection(match[1]);
  }
  for (const chunk of splitTelegramText(text)) {
    await execute(match[1], "TELEGRAM_SEND_MESSAGE", { chat_id: match[2], text: chunk });
  }
}

export interface TelegramBatchDependencies {
  authorize?: (update: TelegramUpdate) => Promise<"message" | "linked" | "ignore">;
  generate: (conversationId: string, text: string, updateId?: number) => Promise<string>;
  send: (chatId: number, text: string) => Promise<void>;
  record: (conversationId: string, reply: string) => Promise<void>;
  save: (state: State) => Promise<void>;
}

// Checkpoint only completed/ignored updates. A send failure retains the generated
// reply and delivered chunk count, so retries don't run the agent again.
export async function processTelegramBatch(
  connectionId: string, updates: TelegramUpdate[], state: State, deps: TelegramBatchDependencies,
) {
  for (const update of [...updates].sort((a, b) => a.update_id - b.update_id)) {
    if (!Number.isSafeInteger(update.update_id) || update.update_id < (state.offset ?? 0)) continue;
    const message = update.message;
    const authorization = deps.authorize ? await deps.authorize(update) : allowedTelegramSender(update) ? "message" : "ignore";
    if (authorization !== "ignore" && message?.text) {
      const conversationId = `telegram:${connectionId}:${message.chat.id}`;
      if (state.pending?.updateId !== update.update_id) {
        const reply = authorization === "linked" ? "Hi! Your Telegram is connected to your Boop agent. What can I help you with?" : await deps.generate(conversationId, message.text, update.update_id);
        state.pending = { updateId: update.update_id, reply, sentChunks: 0 };
        await deps.save(state);
      }
      const pending = state.pending!;
      const chunks = splitTelegramText(pending.reply);
      while (pending.sentChunks < chunks.length) {
        await deps.send(Number(message.chat.id), chunks[pending.sentChunks]);
        pending.sentChunks++;
        await deps.save(state);
      }
      if (pending.reply) await deps.record(conversationId, pending.reply);
    }
    delete state.pending;
    state.offset = update.update_id + 1;
    await deps.save(state);
  }
}

/** Durable intake is separate from execution. Each chat remains ordered, while
 * another chat and the next poll do not wait for a long-running agent. */
export function createTelegramInbox(connectionId: string, state: State, deps: TelegramBatchDependencies) {
  const active = new Map<string, Promise<void>>();
  let committing = Promise.resolve();
  const commit = (action: () => Promise<void>) => {
    const next = committing.catch(() => {}).then(action);
    committing = next;
    return next;
  };
  const wake = () => {
    for (const job of state.inbox ?? []) {
      const chat = String(job.update.message?.chat.id ?? "ignored");
      if (active.has(chat)) continue;
      const work = (async () => {
        // Defer until active is registered, including for synchronously failing deps.
        await Promise.resolve();
        while (true) {
          const next = state.inbox?.find(j => String(j.update.message?.chat.id ?? "ignored") === chat);
          if (!next) break;
          await processTelegramBatch(connectionId, [next.update], next.checkpoint, {
            ...deps, save: () => commit(() => deps.save(state)),
          });
          await commit(async () => {
            const before = state.inbox!;
            state.inbox = before.filter(j => j !== next);
            try { await deps.save(state); }
            catch (error) { state.inbox = before; throw error; }
          });
        }
      })().finally(() => active.delete(chat));
      active.set(chat, work);
      // Polling retries persisted work on the next iteration. Never leak an
      // unhandled rejection, or lose an update after a failed delivery.
      void work.catch(() => console.warn("[telegram] queued message failed; will retry."));
    }
  };
  return {
    wake,
    async enqueue(updates: TelegramUpdate[]) {
      await commit(async () => {
        // Build a snapshot before committing; do not advance intake on save failure.
        const inbox = [...(state.inbox ?? [])];
        let offset = state.offset;
        let pending = state.pending;
        for (const update of [...updates].sort((a, b) => a.update_id - b.update_id)) {
          if (!Number.isSafeInteger(update.update_id) || update.update_id < (offset ?? 0)) continue;
          inbox.push({ update, checkpoint: pending?.updateId === update.update_id ? { pending } : {} });
          if (pending?.updateId === update.update_id) pending = undefined;
          offset = update.update_id + 1;
        }
        const snapshot: State = { ...state, inbox, offset, ...(pending ? { pending } : {}) };
        if (!pending) delete snapshot.pending;
        await deps.save(snapshot);
        state.inbox = inbox; state.offset = offset;
        if (!pending) delete state.pending;
      });
      wake();
    },
    async idle() { await Promise.all([...active.values()]); },
  };
}

export async function deliverTelegramGreeting(
  connectionId: string, channel: { chatId?: string; greetingPending?: string } | null,
  deps: {
    send: (chatId: string, text: string) => Promise<unknown>;
    acknowledge: (requestId: string) => Promise<unknown>;
  } = {
    send: (chatId: string, text: string) => execute(connectionId, "TELEGRAM_SEND_MESSAGE", { chat_id: chatId, text }),
    acknowledge: (requestId: string) => convex.mutation(api.telegramChannels.acknowledgeGreeting, { connectionId, requestId }),
  },
) {
  if (!channel?.chatId || !channel.greetingPending) return;
  await deps.send(channel.chatId, "Hi! Your Telegram is connected to your Boop agent. What can I help you with?");
  // Keep the durable delivery request on failure so a restart retries it.
  await deps.acknowledge(channel.greetingPending);
}

async function runWorker(connectionId: string, worker: { stopped: boolean }) {
  const directory = resolve("data/telegram");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = resolve(directory, `${connectionId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
  let state: State = {};
  try { state = JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Cannot read Telegram checkpoint"); }
  let writing = Promise.resolve();
  const save = (next: State) => {
    const snapshot = JSON.stringify(next);
    const write = writing.catch(() => {}).then(async () => {
      await writeFile(`${path}.tmp`, snapshot, { mode: 0o600 });
      await rename(`${path}.tmp`, path);
    });
    writing = write;
    return write;
  };
  const inbox = createTelegramInbox(connectionId, state, {
    authorize: async (update) => {
      const decision = await authorizeUpdate(connectionId, update);
      console.log(`[telegram] message ${decision === "ignore" ? "ignored: chat verification required" : decision === "linked" ? "verified" : "accepted"}`);
      return decision;
    },
    generate: (conversationId, content, updateId) => handleUserMessage({ conversationId, content,
      ...(updateId !== undefined ? { sourceEventId: `telegram:${connectionId}:${updateId}` } : {}) }),
    send: async (chatId, text) => {
      const sent = await execute(connectionId, "TELEGRAM_SEND_MESSAGE", { chat_id: chatId, text });
      console.log(`[telegram] reply delivered (log ${sent.logId})`);
    },
    record: async (conversationId, content) => {
      await convex.mutation(api.messages.send, { conversationId, role: "assistant", content });
      broadcast("telegram_reply", { conversationId });
    },
    save,
  });
  console.log(`[telegram] listening on connection ${connectionId}`);
  while (!worker.stopped) {
    try {
      const channel = await convex.query(api.telegramChannels.get, { connectionId });
      await deliverTelegramGreeting(connectionId, channel);
      inbox.wake();
      // Bound queued intake without discarding provider updates.
      if ((state.inbox?.length ?? 0) >= 100) {
        await new Promise(done => setTimeout(done, 1000));
        continue;
      }
      const result = await execute(connectionId, "TELEGRAM_GET_UPDATES", {
        ...(state.offset !== undefined ? { offset: state.offset } : {}),
        timeout: 20, limit: 20, allowed_updates: ["message"],
      });
      const updates = result.data.result;
      if (!Array.isArray(updates)) throw new Error(`Invalid Telegram updates (log ${result.logId})`);
      if (updates.length) console.log(`[telegram] received ${updates.length} update(s) (log ${result.logId})`);
      if (worker.stopped) break;
      await inbox.enqueue(updates);
    } catch (error) {
      // Do not dump upstream HTTP errors, which can contain bot credentials.
      console.warn(`[telegram] ${error instanceof Error && error.message.startsWith("Telegram tool failed")
        ? error.message : "Polling or message processing failed; retrying."}`);
      await new Promise((done) => setTimeout(done, 5000));
    }
  }
}

export function startTelegramLoop(): void {
  if (process.env.BOOP_TELEGRAM_ENABLED === "false" || !getComposio()) return;
  let checking = false;
  const discover = async () => {
    if (checking) return;
    checking = true;
    const seen = new Set<string>();
    try {
      await forEachWorkspace(async () => {
        const result = await getComposio()!.connectedAccounts.list({ userIds: [boopUserId()], statuses: ["ACTIVE"] });
        for (const account of result.items.filter(c => c.toolkit.slug === "telegram")) {
          const connectionId = account.id;
          try { await ensureTelegramChannel(connectionId); }
          catch {
            console.warn("[telegram] Cannot initialize a connection; retrying on next discovery.");
            continue;
          }
          const key = workspaceKey(connectionId);
          seen.add(key);
          if (workers.has(key)) continue;
          const worker = { stopped: false, owner: currentOwner(), connectionId };
          workers.set(key, worker);
          void runWorker(connectionId, worker).catch(() => {
            if (workers.get(key) === worker) workers.delete(key);
            console.warn("[telegram] Worker stopped; will retry discovery.");
          });
        }
      });
      for (const [key, worker] of workers) {
        if (!seen.has(key)) { worker.stopped = true; workers.delete(key); sessions.delete(key); }
      }
    } catch { console.warn("[telegram] Connection discovery failed; will retry."); }
    finally { checking = false; }
  };
  void discover();
  setInterval(() => void discover(), 10_000).unref();
}

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
    chat: { id: number; type: string };
    from?: { id: number; username?: string; is_bot?: boolean };
  };
}
interface State {
  offset?: number;
  pending?: { updateId: number; reply: string; sentChunks: number };
}
const sessions = new Map<string, Promise<Session>>();
const workers = new Map<string, { stopped: boolean }>();

export function allowedTelegramSender(update: TelegramUpdate): boolean {
  const message = update.message;
  if (!message?.from || message.from.is_bot || message.chat.type !== "private") return false;
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
  let session = sessions.get(connectionId);
  if (!session) {
    const composio = getComposio();
    if (!composio) throw new Error("Composio is disabled");
    session = composio.create(boopUserId(), {
      toolkits: ["telegram"], manageConnections: false,
      connectedAccounts: { telegram: connectionId },
    });
    sessions.set(connectionId, session);
    session.catch(() => sessions.delete(connectionId));
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

export async function sendTelegramReply(conversationId: string, text: string): Promise<void> {
  const match = /^telegram:([^:]+):(-?\d+)$/.exec(conversationId);
  if (!match) throw new Error("Invalid Telegram conversation");
  for (const chunk of splitTelegramText(text)) {
    await execute(match[1], "TELEGRAM_SEND_MESSAGE", { chat_id: match[2], text: chunk });
  }
}

export interface TelegramBatchDependencies {
  generate: (conversationId: string, text: string) => Promise<string>;
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
    if (allowedTelegramSender(update) && message?.text) {
      const conversationId = `telegram:${connectionId}:${message.chat.id}`;
      if (state.pending?.updateId !== update.update_id) {
        const reply = await deps.generate(conversationId, message.text);
        state.pending = { updateId: update.update_id, reply, sentChunks: 0 };
        await deps.save(state);
      }
      const pending = state.pending!;
      const chunks = splitTelegramText(pending.reply);
      while (pending.sentChunks < chunks.length) {
        await deps.send(message.chat.id, chunks[pending.sentChunks]);
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

async function runWorker(connectionId: string, worker: { stopped: boolean }) {
  const directory = resolve("data/telegram");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = resolve(directory, `${connectionId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
  let state: State = {};
  try { state = JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Cannot read Telegram checkpoint"); }
  const save = async (next: State) => {
    await writeFile(`${path}.tmp`, JSON.stringify(next), { mode: 0o600 });
    await rename(`${path}.tmp`, path);
  };
  console.log(`[telegram] listening on connection ${connectionId}`);
  while (!worker.stopped) {
    try {
      const result = await execute(connectionId, "TELEGRAM_GET_UPDATES", {
        ...(state.offset !== undefined ? { offset: state.offset } : {}),
        timeout: 20, limit: 20, allowed_updates: ["message"],
      });
      const updates = result.data.result;
      if (!Array.isArray(updates)) throw new Error(`Invalid Telegram updates (log ${result.logId})`);
      if (worker.stopped) break;
      await processTelegramBatch(connectionId, updates, state, {
        generate: (conversationId, content) => handleUserMessage({ conversationId, content }),
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
  if (!process.env.BOOP_TELEGRAM_ALLOWED_USER_IDS && !process.env.BOOP_TELEGRAM_ALLOWED_USERNAMES) {
    console.log("[telegram] Configure BOOP_TELEGRAM_ALLOWED_USER_IDS or BOOP_TELEGRAM_ALLOWED_USERNAMES to enable personal chat.");
  }
  let checking = false;
  const discover = async () => {
    if (checking) return;
    checking = true;
    try {
      // Don't consume any messages until the owner has been configured.
      if (!process.env.BOOP_TELEGRAM_ALLOWED_USER_IDS && !process.env.BOOP_TELEGRAM_ALLOWED_USERNAMES) return;
      const result = await getComposio()!.connectedAccounts.list({ userIds: [boopUserId()], statuses: ["ACTIVE"] });
      const ids = new Set(result.items.filter((c) => c.toolkit.slug === "telegram").map((c) => c.id));
      for (const [id, worker] of workers) {
        if (!ids.has(id)) { worker.stopped = true; workers.delete(id); sessions.delete(id); }
      }
      for (const id of ids) {
        if (workers.has(id)) continue;
        const worker = { stopped: false };
        workers.set(id, worker);
        void runWorker(id, worker).catch(() => {
          workers.delete(id);
          console.warn("[telegram] Worker stopped; will retry discovery.");
        });
      }
    } catch { console.warn("[telegram] Connection discovery failed; will retry."); }
    finally { checking = false; }
  };
  void discover();
  setInterval(() => void discover(), 30_000).unref();
}

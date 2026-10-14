import { jidNormalizedUser, normalizeMessageContent, type WAMessage } from "@whiskeysockets/baileys";

export function phoneJid(value: string): string | undefined {
  const number = value.trim().replace(/^\+/, "");
  return /^[1-9]\d{6,14}$/.test(number) ? `${number}@s.whatsapp.net` : undefined;
}

export function isDirectJid(jid: string): boolean {
  return /^\d+@(s\.whatsapp\.net|lid)$/.test(jidNormalizedUser(jid));
}

export function incomingWhatsAppText(message: WAMessage): string | undefined {
  if (message.key.fromMe || !message.key.id || !message.key.remoteJid || !isDirectJid(message.key.remoteJid)) return;
  const content = normalizeMessageContent(message.message);
  // Do not treat captions, edits, protocol events, reactions, or old history as
  // new requests. Wrapped ephemeral text is handled by normalizeMessageContent.
  const text = content?.conversation ?? content?.extendedTextMessage?.text;
  return text?.trim() || undefined;
}

export async function approvedWhatsAppPhone(message: WAMessage, allowed: Set<string> | undefined, resolveLid: (jid: string) => Promise<string | undefined>): Promise<string | undefined> {
  if (!message.key.remoteJid || !isDirectJid(message.key.remoteJid)) return;
  const jid = jidNormalizedUser(message.key.remoteJid);
  const alternate = message.key.remoteJidAlt ? jidNormalizedUser(message.key.remoteJidAlt) : undefined;
  const phone = jid.endsWith("@s.whatsapp.net") ? jid
    : alternate?.endsWith("@s.whatsapp.net") ? alternate : await resolveLid(jid);
  if (!phone) return;
  const normalized = jidNormalizedUser(phone);
  return !allowed || allowed.has(normalized) ? normalized : undefined;
}

export function splitWhatsAppText(text: string): string[] {
  const parts: string[] = [];
  let part = "";
  for (const character of text) {
    if (part.length + character.length > 4000) { parts.push(part); part = ""; }
    part += character;
  }
  if (part) parts.push(part);
  return parts;
}

export interface WhatsAppJob { id: string; jid: string; conversationId: string; text: string }
export interface WhatsAppCheckpoint {
  completed: string[];
  pending?: { job: WhatsAppJob; reply: string; sentChunks: number };
}
export interface WhatsAppDependencies {
  generate: (conversationId: string, text: string) => Promise<string>;
  send: (jid: string, text: string) => Promise<void>;
  record: (conversationId: string, text: string) => Promise<void>;
  save: (checkpoint: WhatsAppCheckpoint) => Promise<void>;
}

// Called by a single queue. Persist generated replies before sending so delivery
// retries/restarts don't repeat the agent's actions or completed message chunks.
export async function processWhatsAppJob(job: WhatsAppJob, checkpoint: WhatsAppCheckpoint, deps: WhatsAppDependencies) {
  if (checkpoint.completed.includes(job.id)) return;
  if (checkpoint.pending && checkpoint.pending.job.id !== job.id) throw new Error("Finish the pending WhatsApp reply first.");
  if (!checkpoint.pending) {
    const reply = await deps.generate(job.conversationId, job.text);
    checkpoint.pending = { job, reply, sentChunks: 0 };
    await deps.save(checkpoint);
  }
  const pending = checkpoint.pending;
  const parts = splitWhatsAppText(pending.reply);
  while (pending.sentChunks < parts.length) {
    await deps.send(job.jid, parts[pending.sentChunks]);
    pending.sentChunks++;
    await deps.save(checkpoint);
  }
  if (pending.reply) await deps.record(job.conversationId, pending.reply);
  checkpoint.completed.push(job.id);
  checkpoint.completed = checkpoint.completed.slice(-2000);
  delete checkpoint.pending;
  await deps.save(checkpoint);
}

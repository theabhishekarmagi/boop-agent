import { z } from "zod";

export const WINDOW_MS = 24 * 60 * 60 * 1000;
const jobSchema = z.object({
  id: z.string(), from: z.string(), to: z.string(), text: z.string(), receivedAt: z.number(),
  phase: z.enum(["queued", "generating", "reply"]), reply: z.string().optional(), sentChunks: z.number().int().nonnegative(),
});
export const queueSchema = z.object({
  jobs: z.array(jobSchema).max(100), completed: z.array(z.string()).max(10000),
  windows: z.record(z.string(), z.number()),
});
export type WhatsAppQueueState = z.infer<typeof queueSchema>;
export type WhatsAppJob = z.infer<typeof jobSchema>;
export const emptyQueue = (): WhatsAppQueueState => ({ jobs: [], completed: [], windows: {} });
export const conversationFor = (to: string, from: string) => `whatsapp:twilio:${to.slice(9)}:${from.slice(9)}`;

export function splitWhatsAppText(text: string) {
  const chunks: string[] = [];
  let part = "";
  for (const char of text) {
    if (part.length + char.length > 1500) { chunks.push(part); part = ""; }
    part += char;
  }
  if (part) chunks.push(part);
  return chunks;
}

interface Dependencies {
  save: (state: WhatsAppQueueState) => Promise<void>;
  generate: (conversationId: string, text: string) => Promise<string>;
  send: (from: string, text: string) => Promise<void>;
  record: (conversationId: string, text: string) => Promise<void>;
  allowed: (from: string) => boolean;
  now?: () => number;
}

/** One persistent host. Writes and admission are serialized; inference doesn't block webhook receipts. */
export class TwilioWhatsAppQueue {
  private changes: Promise<unknown> = Promise.resolve();
  private draining?: Promise<void>;
  private timer?: NodeJS.Timeout;
  private stopped = false;
  constructor(private state: WhatsAppQueueState, private deps: Dependencies) {}
  private now() { return this.deps.now?.() ?? Date.now(); }
  private change<T>(fn: (next: WhatsAppQueueState) => T) {
    const result = this.changes.then(async () => {
      const next = structuredClone(this.state);
      const value = fn(next);
      await this.deps.save(next);
      this.state = next;
      return value;
    });
    this.changes = result.catch(() => {});
    return result;
  }
  async enqueue(job: Omit<WhatsAppJob, "phase" | "sentChunks">) {
    return this.change((next) => {
      if (this.stopped) throw new Error("WhatsApp queue stopped");
      if (next.completed.includes(job.id) || next.jobs.some((j) => j.id === job.id)) return "duplicate" as const;
      if (next.jobs.length >= 100) throw new Error("WhatsApp queue full");
      next.jobs.push({ ...job, phase: "queued", sentChunks: 0 });
      for (const [key, at] of Object.entries(next.windows)) {
        if (this.now() - at >= WINDOW_MS) delete next.windows[key];
      }
      next.windows[conversationFor(job.to, job.from)] = job.receivedAt;
      return "queued" as const;
    });
  }
  canReply(conversationId: string) {
    const at = this.state.windows[conversationId];
    // Small safety margin for transport latency at the end of the service window.
    return at !== undefined && this.now() < at + WINDOW_MS - 60_000;
  }
  private async finish(id: string) {
    await this.change((next) => {
      next.jobs = next.jobs.filter((j) => j.id !== id);
      next.completed = [...next.completed, id].slice(-10000);
    });
  }
  async recover() {
    // Inference may have performed external actions before a crash. Never repeat it automatically.
    for (const job of this.state.jobs.filter((j) => j.phase === "generating")) {
      await this.finish(job.id);
      console.warn("[whatsapp] Interrupted agent request skipped; review the dashboard before retrying.");
    }
  }
  drain(): Promise<void> {
    if (this.draining) return this.draining;
    if (this.stopped || this.timer) return Promise.resolve();
    this.draining = this.run().catch(() => {
      console.warn("[whatsapp] Reply delivery or storage failed; saved work will retry.");
      if (!this.stopped) {
        this.timer = setTimeout(() => { this.timer = undefined; void this.drain(); }, 15_000);
        this.timer.unref();
      }
    }).finally(() => {
      this.draining = undefined;
      if (!this.stopped && !this.timer && this.state.jobs.length) void this.drain();
    });
    return this.draining;
  }
  private async run() {
    while (!this.stopped) {
      await this.changes;
      const job = this.state.jobs[0];
      if (!job) return;
      const conversationId = conversationFor(job.to, job.from);
      if (!this.deps.allowed(job.from) || !this.canReply(conversationId)) { await this.finish(job.id); continue; }
      if (job.phase === "queued") {
        await this.change((next) => { next.jobs[0].phase = "generating"; });
        let reply: string;
        try { reply = await this.deps.generate(conversationId, job.text); }
        catch {
          await this.finish(job.id);
          console.warn("[whatsapp] Agent request failed; it will not be regenerated automatically.");
          continue;
        }
        await this.change((next) => { next.jobs[0].reply = reply; next.jobs[0].phase = "reply"; });
      }
      const pending = this.state.jobs[0];
      if (pending.phase !== "reply") throw new Error("Uncertain agent execution; restart to recover");
      const chunks = splitWhatsAppText(pending.reply ?? "");
      while (!this.stopped && this.state.jobs[0].sentChunks < chunks.length) {
        if (!this.canReply(conversationId)) break;
        await this.deps.send(job.from, chunks[this.state.jobs[0].sentChunks]);
        await this.change((next) => { next.jobs[0].sentChunks++; });
      }
      if (this.stopped) return;
      if (this.state.jobs[0].sentChunks === chunks.length && pending.reply) await this.deps.record(conversationId, pending.reply);
      await this.finish(job.id);
    }
  }
  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.draining;
    await this.changes;
  }
}

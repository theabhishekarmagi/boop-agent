export type TaskOutcome = { status: "completed" | "failed" | "cancelled"; result: string };
type TaskStatus = "queued" | "running" | TaskOutcome["status"];
interface ScheduledTask {
  id: string; owner: string; conversationId: string; name: string; task: string;
  dependencies: string[]; status: TaskStatus; outcome?: TaskOutcome;
  abort: AbortController;
  run: (dependencies: Array<{ id: string; name: string; result: string }>, signal: AbortSignal) => Promise<TaskOutcome>;
  finish: (outcome: TaskOutcome) => Promise<void>;
  done: Promise<void>; resolve: () => void;
}

/** Single-process task admission. Completed local tools are never replayed. */
export class TaskScheduler {
  private tasks = new Map<string, ScheduledTask>();
  private key(owner: string, id: string) { return JSON.stringify([owner, id]); }
  constructor(private concurrency = 3) {}
  list(owner: string, conversationId: string) {
    return [...this.tasks.values()].filter(t => t.owner === owner && t.conversationId === conversationId &&
      (t.status === "queued" || t.status === "running")).map(t => ({
        agentId: t.id, name: t.name, task: t.task, status: t.status, dependsOn: t.dependencies,
      }));
  }
  admit(options: {
    id: string; owner: string; conversationId: string; name: string; task: string; dependencies?: string[];
    run: ScheduledTask["run"]; finish: ScheduledTask["finish"];
  }) {
    const key = this.key(options.owner, options.id);
    if (this.tasks.has(key)) throw new Error("Task already admitted");
    const dependencies = [...new Set(options.dependencies ?? [])];
    for (const id of dependencies) {
      const parent = this.tasks.get(this.key(options.owner, id));
      if (!parent || parent.conversationId !== options.conversationId) throw new Error("Dependency not found in this conversation");
    }
    const outstanding = [...this.tasks.values()].filter(t => t.owner === options.owner && (t.status === "queued" || t.status === "running"));
    if (outstanding.length >= 20) throw new Error("You already have 20 active or queued tasks. Wait for a task to finish.");
    let resolve!: () => void;
    const done = new Promise<void>(r => { resolve = r; });
    const entry: ScheduledTask = { ...options, dependencies, status: "queued", abort: new AbortController(), done, resolve };
    this.tasks.set(key, entry);
    this.pump(options.owner);
    return { agentId: entry.id, status: entry.status as "queued" | "running", dependsOn: dependencies };
  }
  cancel(owner: string, id: string) {
    const entry = this.tasks.get(this.key(owner, id));
    if (!entry || (entry.status !== "queued" && entry.status !== "running")) return false;
    entry.abort.abort();
    if (entry.status === "queued") {
      entry.status = "cancelled";
      void this.complete(entry, { status: "cancelled", result: "Task cancelled before starting." });
    }
    return true;
  }
  activeIds(owner: string) {
    return [...this.tasks.values()].filter(t => t.owner === owner && (t.status === "queued" || t.status === "running")).map(t => t.id);
  }
  async idle(owner: string) {
    await Promise.all([...this.tasks.values()].filter(t => t.owner === owner).map(t => t.done));
  }
  private pump(owner: string) {
    let running = [...this.tasks.values()].filter(t => t.owner === owner && t.status === "running").length;
    for (const entry of this.tasks.values()) {
      if (entry.owner !== owner || entry.status !== "queued") continue;
      const parents = entry.dependencies.map(id => this.tasks.get(this.key(owner, id))!);
      if (parents.some(p => !p.outcome)) continue;
      if (parents.some(p => p.outcome!.status !== "completed")) {
        entry.status = "failed";
        void this.complete(entry, { status: "failed", result: "A prerequisite task failed or was cancelled. This dependent task did not run." });
        continue;
      }
      if (running >= this.concurrency) continue;
      entry.status = "running"; running++;
      void Promise.resolve().then(() => {
        entry.abort.signal.throwIfAborted();
        return entry.run(parents.map(p => ({ id: p.id, name: p.name, result: p.outcome!.result })), entry.abort.signal);
      }).then(result => this.complete(entry, entry.abort.signal.aborted
        ? { status: "cancelled", result: "Task cancelled." } : result), () => this.complete(entry, {
          status: entry.abort.signal.aborted ? "cancelled" : "failed",
          result: entry.abort.signal.aborted ? "Task cancelled." : "Task could not finish. Review its dashboard details before retrying.",
        }));
    }
  }
  private async complete(entry: ScheduledTask, outcome: TaskOutcome) {
    entry.status = outcome.status;
    entry.outcome = { ...outcome, result: outcome.result.length > 24000 ? outcome.result.slice(0, 24000) + "\n[Prerequisite result truncated; ask for the missing details rather than guessing.]" : outcome.result };
    try { await entry.finish(outcome); }
    catch { console.warn("[tasks] Completion notification failed; inspect the task in the dashboard."); }
    finally {
      entry.resolve();
      this.pump(entry.owner);
      // Retain a bounded recent history for explicit follow-ups, never evict prerequisites in use.
      const own = [...this.tasks.values()].filter(t => t.owner === entry.owner);
      let excess = own.length - 100;
      for (const old of own) {
        if (excess <= 0) break;
        if (!old.outcome || own.some(t => !t.outcome && t.dependencies.includes(old.id))) continue;
        this.tasks.delete(this.key(old.owner, old.id)); excess--;
      }
    }
  }
}

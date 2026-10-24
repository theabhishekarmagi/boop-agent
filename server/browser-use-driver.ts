import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { createWriteStream } from "node:fs";
import { currentOwner } from "./workspace-context.js";
import { validatePublicUrl } from "./research-tools.js";
import type { BrowserConfig, BrowserStats, BrowserPage as PageResult } from "./browser-config.js";
import { mkdir, access } from "node:fs/promises";
/** Local Browser Use stdio driver. Model credentials are never passed to Python. */
export class BrowserUseWorker {
  readonly stats: BrowserStats = { launches: 0, operations: 0, durationMs: 0, snapshotChars: 0 };
  private owner = currentOwner();
  private child?: ChildProcessWithoutNullStreams;
  private seq = 0;
  private requests = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private abort = () => { this.child?.stdin.end(); this.child?.kill("SIGTERM"); };
  constructor(private config: BrowserConfig, private signal: AbortSignal, private logPath: string) {
    signal.addEventListener("abort", this.abort, { once: true });
  }
  private check() { if (currentOwner() !== this.owner) throw new Error("Wrong workspace"); this.signal.throwIfAborted(); }
  private async validate(url: string) {
    if (!this.config.origins.includes(new URL(url).origin)) throw new Error("Browser origin is not enabled in BOOP_BROWSER_ORIGINS.");
    return validatePublicUrl(url);
  }
  private async start() {
    this.check(); if (this.child) return;
    try { await access(resolve(this.config.pythonPath ?? "data/browser-use/venv/bin/python")); }
    catch { throw new Error("Browser Use Python environment is missing. Run npm run setup:browser first."); }
    await mkdir(resolve("data/browser-use/logs"), { recursive: true, mode: 0o700 });
    const env = Object.fromEntries(["PATH", "HOME", "TMPDIR", "LANG"].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []));
    this.child = spawn(resolve(this.config.pythonPath ?? "data/browser-use/venv/bin/python"), ["-u", resolve("server/browser-use-worker.py")], {
      env: { ...env, ANONYMIZED_TELEMETRY: "false", DO_NOT_TRACK: "1", BROWSER_USE_LOGGING_LEVEL: "error", PYTHONNOUSERSITE: "1" }, stdio: "pipe" });
    const child = this.child; const log = createWriteStream(this.logPath, { mode: 0o600 }); log.on("error", this.abort); child.stderr.pipe(log);
    createInterface({ input: child.stdout }).on("line", line => {
      if (!line.startsWith("BOOP_RPC ")) return;
      let message: { id: number; error?: string; result?: unknown };
      try { message = JSON.parse(line.slice(9)); }
      catch { this.abort(); return; }
      const pending = this.requests.get(message.id);
      if (!pending) return; this.requests.delete(message.id); clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error)); else pending.resolve(message.result);
    });
    const rejectAll = () => { for (const entry of this.requests.values()) { clearTimeout(entry.timer); entry.reject(new Error("Browser Use worker stopped")); } this.requests.clear(); };
    child.once("error", rejectAll); child.once("exit", rejectAll); child.stdin.on("error", rejectAll);
    await this.rpc("init", { origins: this.config.origins, executablePath: this.config.executablePath, headless: this.config.headless, maxPages: this.config.maxPages, viewport: this.config.viewport ?? { width: 1280, height: 720 } }); this.stats.launches++;
  }
  private rpc<T = unknown>(op: string, args: unknown = {}): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      if (!this.child || this.child.exitCode !== null || this.child.signalCode !== null || !this.child.stdin.writable) {
        reject(new Error("Browser Use worker is not available.")); return;
      }
      const timer = setTimeout(() => {
        this.requests.delete(id); this.abort(); reject(new Error("Browser Use operation timed out."));
      }, 45_000);
      this.requests.set(id, { resolve: value => resolve(value as T), reject, timer });
      this.child.stdin.write(JSON.stringify({ id, op, args }) + "\n");
    });
  }
  private async operation<T>(fn: () => Promise<T>): Promise<T> {
    this.check(); const start = performance.now(); this.stats.operations++;
    try { const result = await fn(); if (result && typeof result === "object" && "content" in result) this.stats.snapshotChars += String(result.content).length; return result; }
    finally { this.stats.durationMs += performance.now() - start; }
  }
  open(url: string): Promise<PageResult> { return this.operation(async () => { await this.validate(url); await this.start(); return this.rpc<PageResult>("open", { url }); }); }
  read(tab: string, offset = 0): Promise<PageResult> { return this.operation(() => this.rpc<PageResult>("read", { tab, offset })); }
  follow(tab: string, snapshot: number, element: string): Promise<PageResult> { return this.operation(async () => {
    const { url } = await this.rpc<{ url: string }>("resolve", { tab, snapshot, element });
    await this.validate(url); return this.rpc<PageResult>("follow", { tab, url });
  }); }
  closeTab(tab: string): Promise<{ closed: string }> { return this.operation(() => this.rpc("closeTab", { tab })); }
  async close() {
    this.signal.removeEventListener("abort", this.abort);
    if (!this.child) return;
    const child = this.child;
    const exited = new Promise<void>(resolve => { if (child.exitCode !== null || child.signalCode !== null) resolve(); else child.once("exit", () => resolve()); });
    try {
      if (child.exitCode === null && child.signalCode === null) {
        const timer = setTimeout(() => child.kill("SIGTERM"), 10_000);
        const hardStop = setTimeout(() => child.kill("SIGKILL"), 20_000);
        try { await this.rpc("close").catch(() => {}); await exited; } finally { clearTimeout(timer); clearTimeout(hardStop); }
      }
    } finally { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); this.child = undefined; }
  }
}

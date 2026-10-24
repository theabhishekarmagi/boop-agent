import { access } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { currentOwner } from "./workspace-context.js";
import { validatePublicUrl } from "./research-tools.js";
import { BrowserUseWorker } from "./browser-use-driver.js";
import type { BrowserConfig, BrowserWorker, BrowserStats, BrowserPage } from "./browser-config.js";
export type { BrowserConfig, BrowserStats, BrowserPage, BrowserWorker } from "./browser-config.js";

async function executablePath(configured?: string) {
  if (configured || process.platform !== "darwin") return configured;
  for (const path of ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"]) {
    try { await access(path); return path; } catch { /* Try the next installed Chromium browser. */ }
  }
  return undefined;
}
type WorkerFactory = (config: BrowserConfig, signal: AbortSignal) => Promise<BrowserWorker>;
const createWorker: WorkerFactory = async (config, signal) => new BrowserUseWorker(
  { ...config, executablePath: await executablePath(config.executablePath) }, signal,
  resolve("data/browser-use/logs", `${randomUUID()}.log`));
let busy = false;
/** One isolated Browser Use worker per local operator task, allocated only on first navigation. */
export class LocalResearchBrowser implements BrowserWorker {
  readonly stats: BrowserStats = { launches: 0, operations: 0, durationMs: 0, snapshotChars: 0 };
  private owner = currentOwner();
  private worker?: BrowserWorker;
  private closed = false;
  private slot = false;
  private pending: Promise<unknown> = Promise.resolve();
  private closing?: Promise<void>;
  private releasing?: Promise<void>;
  private idle?: NodeJS.Timeout;
  private signal: AbortSignal;
  private abort = () => { void this.close().catch(() => console.warn("[browser] Browser Use cleanup failed.")); };
  constructor(readonly config: BrowserConfig, signal?: AbortSignal, private factory: WorkerFactory = createWorker,
    private validate: (url: string) => Promise<URL> = validatePublicUrl) {
    this.signal = signal ?? new AbortController().signal;
    this.signal.addEventListener("abort", this.abort, { once: true });
  }
  private check() {
    if (currentOwner() !== this.owner) throw new Error("Browser belongs to a different workspace.");
    this.signal.throwIfAborted();
    if (this.closed) throw new Error("Browser session ended. Start a new task to browse again.");
  }
  private async url(value: string) {
    if (!this.config.origins.includes(new URL(value).origin)) throw new Error("Browser origin is not enabled in BOOP_BROWSER_ORIGINS.");
    return this.validate(value);
  }
  private async getWorker() {
    this.check();
    if (!this.worker) {
      if (busy) throw new Error("The local browser worker is busy. Retry after the current browser task finishes.");
      busy = true; this.slot = true;
      try { this.worker = await this.factory(this.config, this.signal); this.check(); }
      catch (error) { await this.release(); throw error; }
    }
    return this.worker;
  }
  private operation<T>(fn: () => Promise<T>): Promise<T> {
    const work = this.pending.then(async () => {
      this.check(); clearTimeout(this.idle);
      const start = performance.now(); this.stats.operations++;
      try {
        const result = await fn();
        if (result && typeof result === "object" && "content" in result) this.stats.snapshotChars += String(result.content).length;
        return result;
      } finally {
        this.stats.durationMs += performance.now() - start;
        if (!this.closed) { this.idle = setTimeout(this.abort, this.config.idleMs); this.idle.unref(); }
      }
    });
    this.pending = work.catch(() => {}); return work;
  }
  private requireWorker() {
    if (!this.worker) throw new Error("Unknown tab in this task. Open a browser tab first.");
    return this.worker;
  }
  private async validatePage(page: BrowserPage) { await this.url(page.url); return page; }
  open(value: string) {
    return this.operation(async () => {
      const url = await this.url(value); const existed = !!this.worker;
      const worker = await this.getWorker();
      try {
        const page = await this.validatePage(await worker.open(url.href));
        if (!existed) this.stats.launches++;
        return page;
      } catch (error) { await this.release(); throw error; }
    });
  }
  read(tab: string, offset = 0) { return this.operation(async () => this.validatePage(await this.requireWorker().read(tab, offset))); }
  follow(tab: string, snapshot: number, element: string) { return this.operation(async () => this.validatePage(await this.requireWorker().follow(tab, snapshot, element))); }
  closeTab(tab: string) { return this.operation(() => this.requireWorker().closeTab(tab)); }
  private release(): Promise<void> {
    if (this.releasing) return this.releasing;
    const worker = this.worker; this.worker = undefined;
    this.releasing = (async () => { try { await worker?.close(); } finally { if (this.slot) { busy = false; this.slot = false; } } })();
    return this.releasing.finally(() => { this.releasing = undefined; });
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true; clearTimeout(this.idle); this.signal.removeEventListener("abort", this.abort);
    this.closing = (async () => { await this.pending; await this.release(); })(); return this.closing;
  }
}

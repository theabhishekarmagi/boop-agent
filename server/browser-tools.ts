import { tool, type Tool } from "@openai/agents";
import { z } from "zod";
import { browserConfig, type BrowserWorker, type BrowserStats } from "./browser-config.js";
import { LocalResearchBrowser } from "./browser-use.js";
export { BROWSER_NAMESPACE, BROWSER_INSTRUCTIONS, localBrowserEnabled, browserConfig } from "./browser-config.js";

export function createLocalBrowserTools(signal?: AbortSignal, session: BrowserWorker & { stats: BrowserStats } = new LocalResearchBrowser(browserConfig(), signal)) {
  const tools: Tool[] = [
    tool({ name: "BrowserOpen", description: "Open an allowlisted public website in a fresh local browser tab. Use only when WebFetch cannot read JavaScript-rendered content. Returns a compact snapshot with element IDs. No existing personal browser profile is used.",
      parameters: z.object({ url: z.string() }), execute: ({ url }) => session.open(url) }),
    tool({ name: "BrowserRead", description: "Read a fresh compact snapshot of an existing browser tab. Use nextOffset from a truncated result to read further. Use after page content updates; old snapshot IDs become stale.",
      parameters: z.object({ tab: z.string(), offset: z.number().int().min(0).max(200_000).nullable().default(null) }), execute: ({ tab, offset }) => session.read(tab, offset ?? 0) }),
    tool({ name: "BrowserFollowLink", description: "Navigate a real link from the latest snapshot. Supply its bracketed element ID without brackets, tab, and snapshot number. Buttons, form submissions and arbitrary clicks are disabled in the local qualification build.",
      parameters: z.object({ tab: z.string(), snapshot: z.number().int(), element: z.string() }), execute: ({ tab, snapshot, element }) => session.follow(tab, snapshot, element) }),
    tool({ name: "BrowserCloseTab", description: "Close a browser tab when finished to release resources.",
      parameters: z.object({ tab: z.string() }), execute: ({ tab }) => session.closeTab(tab) }),
  ];
  return { tools, close: () => session.close(), stats: session.stats };
}

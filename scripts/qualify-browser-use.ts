import "../server/env-setup.js";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { LocalResearchBrowser } from "../server/browser-use.js";
import { OPERATOR_OWNER, runInWorkspace } from "../server/workspace-context.js";
async function main() {
  await runInWorkspace(OPERATOR_OWNER, async () => {
    const abort = new AbortController(); const timer = setTimeout(() => abort.abort(), 60_000);
    const browser = new LocalResearchBrowser({ origins: ["https://quotes.toscrape.com"], headless: true, idleMs: 60_000, maxPages: 4,
      executablePath: process.env.BOOP_BROWSER_EXECUTABLE_PATH }, abort.signal);
    try {
      let first = await browser.open("https://quotes.toscrape.com/js/");
      if (!first.content.includes("Albert Einstein")) first = await browser.read(first.tab);
      assert(first.content.includes("Albert Einstein"));
      const link = first.content.match(/\[(\d+)\]<a[^>]*\/>\s*Next/)?.[1];
      assert(link, "Missing pagination link in native Browser Use snapshot");
      const next = await browser.follow(first.tab, first.snapshot, link);
      assert.match(next.url, /\/page\/2/);
      await assert.rejects(browser.follow(first.tab, first.snapshot, link), /Stale snapshot/);
      const second = await browser.open("https://quotes.toscrape.com/js/");
      assert.notEqual(second.tab, first.tab); await browser.closeTab(second.tab);
      await assert.rejects(browser.read(second.tab), /Unknown tab/);
      await assert.rejects(runInWorkspace("different-user", () => browser.read(first.tab)), /workspace/);
      await assert.rejects(browser.open("https://example.org/"), /origin/);
      const report = { generatedAt: new Date().toISOString(), provider: "browser-use", passed: true,
        javascriptReading: true, realLinkNavigation: true, multipleTabs: true, staleSnapshotsRejected: true,
        unknownTabsRejected: true, workspaceIsolation: true, stats: browser.stats, modelCalls: 0 };
      await mkdir("data/browser-use", { recursive: true });
      await writeFile("data/browser-use/qualification.json", JSON.stringify(report, null, 2) + "\n");
      console.log(JSON.stringify(report, null, 2));
    } finally { await browser.close(); clearTimeout(timer); }
  });
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Browser qualification failed"); process.exitCode = 1; });

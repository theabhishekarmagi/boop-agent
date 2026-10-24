import { readFile, writeFile } from "node:fs/promises";
import { researchEvidenceGrounded } from "./browser-evidence.js";
interface Run {
  provider: string; task: string; error?: string; answerCorrect: boolean; sourceCoverage: boolean;
  evidence: string; elapsedMs: number; elapsedWithCleanupMs: number; calls: unknown[];
  usage: { inputTokens: number; cacheReadTokens: number; outputTokens: number };
  browser: { durationMs: number };
}
type ReviewedRun = Run & { reviewedPassed: boolean; reviewedGrounded: boolean };
const path = "data/browser-use/comparison/results.json";
const report = JSON.parse(await readFile(path, "utf8")) as { results: Run[]; [key: string]: unknown };
const reviewed = report.results.map((run: Run) => ({ ...run,
  reviewedGrounded: researchEvidenceGrounded(run.task, run.evidence),
  reviewedPassed: !run.error && run.answerCorrect && run.sourceCoverage && researchEvidenceGrounded(run.task, run.evidence) }));
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const summary = ["stagehand", "browser-use"].map(provider => {
  const runs = reviewed.filter((r: ReviewedRun) => r.provider === provider);
  return { provider, passed: runs.filter((r: ReviewedRun) => r.reviewedPassed).length, total: runs.length,
    meanSeconds: mean(runs.map((r: ReviewedRun) => r.elapsedMs)) / 1000,
    meanWithCleanupSeconds: mean(runs.map((r: ReviewedRun) => r.elapsedWithCleanupMs)) / 1000,
    inputTokens: runs.reduce((sum: number, r: ReviewedRun) => sum + r.usage.inputTokens, 0),
    cachedTokens: runs.reduce((sum: number, r: ReviewedRun) => sum + r.usage.cacheReadTokens, 0),
    outputTokens: runs.reduce((sum: number, r: ReviewedRun) => sum + r.usage.outputTokens, 0),
    calls: runs.reduce((sum: number, r: ReviewedRun) => sum + r.calls.length, 0),
    meanBrowserSeconds: mean(runs.map((r: ReviewedRun) => r.browser.durationMs)) / 1000,
    byTask: ["migration-research", "provider-cost-research", "javascript-research"].map(task => ({ task,
      seconds: mean(runs.filter((r: ReviewedRun) => r.task === task).map((r: ReviewedRun) => r.elapsedMs)) / 1000 })) };
});
await writeFile("data/browser-use/comparison/reviewed-results.json", JSON.stringify({ ...report, results: reviewed, summary,
  reviewNote: "Original results preserved. A format-only validator bug rejected Browser Use pricing because native indexed spans separate 100 and browser hours. Identical wrapper/node/whitespace normalization was applied to every saved result, without new model calls or answer changes. Metadata is excluded when extracting content for grounding." }, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));

export interface ResearchCase { id: string; prompt: string; urls: string[]; check: (answer: Record<string, unknown>) => boolean }
export const parseAnswer = (value: string): Record<string, unknown> => JSON.parse(value.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "").trim());
export const cases: ResearchCase[] = [
  { id: "migration-research", urls: ["https://docs.stagehand.dev/v4/migrations/playwright"],
    prompt: `Research whether an existing Playwright integration can be dropped into Stagehand v4 unchanged. Read https://docs.stagehand.dev/v4/migrations/playwright. Return JSON only with usesPlaywrightDependency (boolean), requiresPorting (boolean), unsupported (array of missing Playwright features), and sources (actual URLs read). Base the answer on the live page, not prior knowledge.`,
    check: a => a.usesPlaywrightDependency === false && a.requiresPorting === true && /auto.wait|getBy|route interception/i.test(JSON.stringify(a.unsupported)) },
  { id: "provider-cost-research", urls: ["https://www.browserbase.com/pricing", "https://browser-use.com/pricing"],
    prompt: `For Boop's occasional browser research, compare 50 browser hours/month on Browserbase Developer versus Browser Use Cloud browser infrastructure, excluding model inference, proxy traffic and taxes. Read both https://www.browserbase.com/pricing and https://browser-use.com/pricing. Return JSON only with browserbaseMonthlyUsd (number), browserUseMonthlyUsd (number), excludesModelAndTraffic (boolean), and sources (actual URLs read). Do not compare fully hosted agents.`,
    check: a => a.browserbaseMonthlyUsd === 20 && a.browserUseMonthlyUsd === 1 && a.excludesModelAndTraffic === true },
  { id: "javascript-research", urls: ["https://quotes.toscrape.com/js/"],
    prompt: `Read https://quotes.toscrape.com/js/ and identify the authors of the first three displayed quotes, in page order, preserving duplicates. Do not reproduce any quotation text. Return JSON only with authors (array of names) and sources (actual URLs read). If the displayed authors are unavailable with your tools, use authors: [] and explain in an unavailable string; do not guess from memory or embedded scripts.`,
    check: a => JSON.stringify(a.authors) === JSON.stringify(["Albert Einstein", "J.K. Rowling", "Albert Einstein"]) },
];

/** Decode SDK tool-output JSON wrappers, then normalize presentation without adding facts. */
export function normalizeBrowserEvidence(evidence: string): string {
  const parts = evidence.split("\n").map(line => {
    let value: unknown = line;
    for (let depth = 0; depth < 3 && typeof value === "string"; depth++) {
      try { value = JSON.parse(value); } catch { break; }
    }
    if (value && typeof value === "object" && "content" in value && typeof value.content === "string") {
      return value.content;
    }
    return typeof value === "string" ? value : JSON.stringify(value);
  });
  return parts.join("\n")
    .replace(/\[\d+\]<[^>]*>/g, " ") // Browser Use indexed element markup.
    .replace(/\[\d+-\d+\]\s*(?:StaticText:)?/g, " ") // Stagehand element IDs/text labels.
    .replace(/\s+/g, " ").trim();
}
export function researchEvidenceGrounded(task: string, evidence: string): boolean {
  const text = normalizeBrowserEvidence(evidence);
  if (task === "javascript-research") return evidence.split("\n").some(output => {
    const names = normalizeBrowserEvidence(output).match(/Albert Einstein|J\.K\. Rowling/g) ?? [];
    return JSON.stringify(names.slice(0, 3)) === JSON.stringify(["Albert Einstein", "J.K. Rowling", "Albert Einstein"]);
  });
  if (task === "migration-research") return /no Playwright dependency/i.test(text) && /porting/i.test(text);
  if (task === "provider-cost-research") return /Developer Plan/.test(text) && /\$20/.test(text) && /100 browser hours/.test(text) && /0\.02/.test(text);
  return false;
}

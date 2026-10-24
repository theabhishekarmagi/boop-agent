import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeBrowserEvidence, researchEvidenceGrounded } from "../scripts/browser-evidence.js";
const wrap = (content: string) => JSON.stringify(JSON.stringify({ url: "https://public.test", content }));
test("grounding treats Browser Use split-node numbers and Stagehand text equally", () => {
  const native = "Developer Plan\n$20/mo\n[575]<span />\n25\nconcurrent browsers\n[579]<span />\n100\nbrowser hours\n$0.02\nhour";
  const stagehand = "[0-1] StaticText: Developer Plan\n[0-2] StaticText: $20/mo\n[0-3] StaticText: 100 browser hours\n[0-4] StaticText: $0.02/hour";
  assert(researchEvidenceGrounded("provider-cost-research", wrap(native)));
  assert(researchEvidenceGrounded("provider-cost-research", wrap(stagehand)));
  assert(normalizeBrowserEvidence(wrap(native)).includes("100 browser hours"));
});
test("normalization cannot supply missing facts from metadata or a correct-looking answer", () => {
  const evidence = JSON.stringify(JSON.stringify({ title: "$20, 100 browser hours, 0.02", content: "Empty page" }));
  assert.equal(researchEvidenceGrounded("provider-cost-research", evidence), false);
  assert.equal(researchEvidenceGrounded("javascript-research", wrap("No rendered authors available")), false);
  assert.equal(researchEvidenceGrounded("unknown", wrap("anything")), false);
});

test("JavaScript grounding preserves author order and duplicates in a single page snapshot", () => {
  assert(researchEvidenceGrounded("javascript-research", wrap("Albert Einstein J.K. Rowling Albert Einstein")));
  assert.equal(researchEvidenceGrounded("javascript-research", wrap("Albert Einstein J.K. Rowling")), false);
  assert.equal(researchEvidenceGrounded("javascript-research", wrap("Albert Einstein J.K. Rowling") + "\n" + wrap("Albert Einstein J.K. Rowling")), false);
});

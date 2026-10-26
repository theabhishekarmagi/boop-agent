import { test } from "node:test";
import assert from "node:assert/strict";
process.env.CONVEX_URL ??= "https://unit-test.convex.cloud";
const { createApprovedGoogleDoc, parseGoogleDocPayload } = await import("../server/google-doc-drafts.js");

test("approved Workspace Doc uses full content, makes one create call, and returns a verified link", async () => {
  const calls: string[] = [];
  let state = "pending";
  const result = await createApprovedGoogleDoc("draft_1", "telegram:connection:123", JSON.stringify({
    title: "Research report", markdown_text: "# Findings\n\nEvidence and source links.",
  }), {
    accounts: async () => [{ slug: "googlesuper", connectionId: "account_1", status: "ACTIVE" }],
    claim: async () => { assert.equal(state, "pending"); state = "submitting"; },
    execute: async (account, title, markdown) => {
      assert.equal(state, "submitting");
      calls.push(account);
      assert.equal(title, "Research report");
      assert.equal(markdown, "# Findings\n\nEvidence and source links.");
      return { error: null, data: { documentId: "abcdefghijklmnopqrstuvwxyz123456" } };
    },
    finish: async (_id, status, note) => { assert.equal(status, "sent"); assert.match(note, /^https:\/\/docs\.google\.com/); state = status; },
  });
  assert.equal(result.status, "sent");
  assert.equal(result.url, "https://docs.google.com/document/d/abcdefghijklmnopqrstuvwxyz123456/edit");
  assert.deepEqual(calls, ["account_1"]);
});

test("missing full content or ambiguous account never claims or creates a Doc", async () => {
  assert.throws(() => parseGoogleDocPayload(JSON.stringify({ title: "Only a preview" })), /full text/);
  let calls = 0;
  await assert.rejects(createApprovedGoogleDoc("draft_1", "web:1", JSON.stringify({ title: "T", content: "Full body" }), {
    accounts: async () => ["a", "b"].map(connectionId => ({ slug: "googlesuper", connectionId, status: "ACTIVE" })),
    claim: async () => { calls++; }, execute: async () => { calls++; return { error: null, data: {} }; }, finish: async () => { calls++; },
  }), /Choose which/);
  assert.equal(calls, 0);
});

test("unknown provider result remains single-use and never claims a Doc was created", async () => {
  let calls = 0, state = "pending";
  const deps = {
    accounts: async () => [{ slug: "googlesuper", connectionId: "a", status: "ACTIVE" }],
    claim: async () => { if (state !== "pending") throw new Error("already decided"); state = "submitting"; },
    execute: async () => { calls++; throw new Error("timeout after request"); },
    finish: async (_id: string, status: "sent" | "uncertain") => { state = status; },
  };
  const payload = JSON.stringify({ title: "T", markdown_text: "The complete content" });
  const result = await createApprovedGoogleDoc("draft_1", "web:1", payload, deps);
  assert.equal(result.status, "uncertain");
  assert.match(result.note, /Check your Drive/);
  await assert.rejects(createApprovedGoogleDoc("draft_1", "web:1", payload, deps), /already decided/);
  assert.equal(calls, 1);
});

test("provider error cannot be mistaken for creation even when its payload contains an ID", async () => {
  let finalStatus = "";
  const result = await createApprovedGoogleDoc("draft_2", "web:1", JSON.stringify({
    title: "Report", markdown_text: "Complete report text",
  }), {
    accounts: async () => [{ slug: "googlesuper", connectionId: "a", status: "ACTIVE" }],
    claim: async () => {},
    execute: async () => ({ error: "Google rejected the request", logId: "log_test",
      data: { documentId: "abcdefghijklmnopqrstuvwxyz123456" } }),
    finish: async (_id, status) => { finalStatus = status; },
  });
  assert.equal(result.status, "uncertain");
  assert.equal(finalStatus, "uncertain");
  assert.equal(result.url, undefined);
  assert.match(result.note, /log_test/);
});

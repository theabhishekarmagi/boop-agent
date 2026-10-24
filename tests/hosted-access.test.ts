import test from "node:test";
import assert from "node:assert/strict";
import { ConvexHttpClient } from "convex/browser";
process.env.CONVEX_URL ??= "https://test.convex.cloud";
const { verifyBrowserToken } = await import("../server/browser-auth.js");

test("public preview admits other verified accounts only after explicit opt-in and still rejects missing sessions", async t => {
  const keys = ["BOOP_HOSTED_PREVIEW", "BOOP_ALLOW_PUBLIC_SIGNUPS", "BOOP_ALLOWED_EMAILS"] as const;
  const before = keys.map(key => process.env[key]);
  let profile: { id: string; ownerId: string; name: string; email: string; image: null } | null = {
    id: "user-b", ownerId: "https://auth.example|user-b", name: "Tester", email: "tester@example.com", image: null,
  };
  t.mock.method(ConvexHttpClient.prototype, "query", async () => profile);
  process.env.BOOP_HOSTED_PREVIEW = "true";
  process.env.BOOP_ALLOWED_EMAILS = "owner@example.com";
  delete process.env.BOOP_ALLOW_PUBLIC_SIGNUPS;
  try {
    await assert.rejects(() => verifyBrowserToken("test-session"), /invitation-only/);
    process.env.BOOP_ALLOW_PUBLIC_SIGNUPS = "true";
    assert.equal(await verifyBrowserToken("test-session"), "https://auth.example|user-b");
    profile = null;
    await assert.rejects(() => verifyBrowserToken("test-session"), /Sign in required/);
    await assert.rejects(() => verifyBrowserToken(""), /Invalid session/);
  } finally {
    keys.forEach((key, i) => { if (before[i] === undefined) delete process.env[key]; else process.env[key] = before[i]; });
  }
});

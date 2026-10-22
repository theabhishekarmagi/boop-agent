import test from "node:test";
import assert from "node:assert/strict";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const enabled = process.env.BOOP_TEST_LOCAL_AUTH === "1";
const base = "http://127.0.0.1:3211/api/auth";
const origin = "http://localhost:5173";
const localTest = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !enabled }, fn);

localTest(
  "Google auth: anonymous users cannot read an account profile",
  async () => {
    const convex = new ConvexHttpClient("http://127.0.0.1:3210");
    assert.equal(await convex.query(api.auth.currentUser, {}), null);
    const session = await fetch(`${base}/get-session`);
    assert.equal(session.status, 200);
    assert.equal(await session.json(), null);
  },
);

localTest("Google auth: fabricated session cannot authenticate", async () => {
  const session = await fetch(`${base}/get-session`, {
    headers: {
      origin,
      "better-auth-cookie": "better-auth.session_token=forged.invalid",
    },
  });
  assert.equal(session.status, 200);
  assert.equal(await session.json(), null);
});

localTest(
  "Google auth: authorization uses identity-only scopes and PKCE",
  async () => {
    const response = await fetch(`${base}/sign-in/social`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({
        provider: "google",
        callbackURL: `${origin}/account`,
      }),
    });
    assert.equal(response.status, 200);
    const data = (await response.json()) as { url: string };
    const url = new URL(data.url);
    assert.equal(url.origin, "https://accounts.google.com");
    assert.equal(
      url.searchParams.get("redirect_uri"),
      `${base}/callback/google`,
    );
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.ok(url.searchParams.get("code_challenge"));
    assert.ok(url.searchParams.get("state"));
    assert.deepEqual(url.searchParams.get("scope")?.split(" ").sort(), [
      "email",
      "openid",
      "profile",
    ]);
  },
);

localTest(
  "Google auth: external success and error redirects are rejected",
  async () => {
    for (const field of [
      "callbackURL",
      "errorCallbackURL",
      "newUserCallbackURL",
    ]) {
      const response = await fetch(`${base}/sign-in/social`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({
          provider: "google",
          callbackURL: `${origin}/account`,
          [field]: "https://untrusted.example/steal",
        }),
      });
      assert.equal(response.status, 403, field);
    }
  },
);

localTest(
  "Google auth: CORS permits the app and denies an unrelated origin",
  async () => {
    for (const candidate of [origin, "https://untrusted.example"]) {
      const response = await fetch(`${base}/sign-in/social`, {
        method: "OPTIONS",
        headers: {
          origin: candidate,
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type,better-auth-cookie",
        },
      });
      assert.equal(
        response.headers.get("access-control-allow-origin"),
        candidate === origin ? origin : null,
      );
    }
  },
);

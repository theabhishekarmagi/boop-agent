import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getOpenAICredential, getChatGPTAccessToken, assertPlanPermission, listOpenAIModels } from "../server/openai-auth.js";

test("ChatGPT plan scope is mandatory", () => {
  assert.throws(() => assertPlanPermission(["resource.invoke"]), /plan usage/);
  assert.doesNotThrow(() => assertPlanPermission(["resource.invoke", "chatgpt.tokens.use.direct"]));
});
test("parallel requests serialize refresh, rotate credentials, and preserve account identity", async () => {
  const dir = await mkdtemp(join(tmpdir(), "boop-auth-"));
  const oldPath = process.env.BOOP_CHATGPT_AUTH_FILE; const oldFetch = globalThis.fetch;
  process.env.BOOP_CHATGPT_AUTH_FILE = join(dir, "auth.json");
  const profile = { clientId: "oaiapp_test", subject: "user1", accessToken: "expired", refreshToken: "old-refresh", idToken: "identity", scopes: ["resource.invoke", "chatgpt.tokens.use.direct"], expiresAt: 0 };
  await writeFile(process.env.BOOP_CHATGPT_AUTH_FILE, JSON.stringify({ hostId: "urn:uuid:test", activeClientId: profile.clientId, profiles: [profile] }), { mode: 0o600 });
  let requests = 0;
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /auth.openai.com\/api\/accounts\/oauth\/token/); requests++;
    const body = new URLSearchParams(String(options?.body));
    assert.equal(body.get("client_id"), "oaiapp_test"); assert.equal(body.get("resource"), "https://api.openai.com/v1"); assert.equal(body.has("scope"), false);
    return Response.json({ access_token: "renewed", refresh_token: "new-refresh", expires_in: 3600, token_type: "Bearer" });
  };
  try {
    assert.deepEqual(await Promise.all(Array.from({ length: 8 }, () => getChatGPTAccessToken())), Array(8).fill("renewed"));
    assert.equal(requests, 1);
    const stored = JSON.parse(await readFile(process.env.BOOP_CHATGPT_AUTH_FILE, "utf8"));
    assert.equal(stored.profiles[0].refreshToken, "new-refresh"); assert.equal(stored.hostId, "urn:uuid:test"); assert.equal(stored.profiles[0].subject, "user1");
    assert.equal((await stat(process.env.BOOP_CHATGPT_AUTH_FILE)).mode & 0o777, 0o600);
    globalThis.fetch = async () => Response.json({ models: [{ slug: "gpt-6.1-sol", display_name: "Balanced", visibility: "list" }, { slug: "hidden", visibility: "hidden" }] });
    assert.deepEqual(await listOpenAIModels(), [{ id: "gpt-6.1-sol", name: "Balanced" }]);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldPath === undefined) delete process.env.BOOP_CHATGPT_AUTH_FILE; else process.env.BOOP_CHATGPT_AUTH_FILE = oldPath;
    await rm(dir, { recursive: true, force: true });
  }
});
test("API auth is explicit and never a fallback for missing ChatGPT sign-in", async () => {
  const oldMode = process.env.BOOP_OPENAI_AUTH; const oldKey = process.env.OPENAI_API_KEY; const oldPath = process.env.BOOP_CHATGPT_AUTH_FILE;
  process.env.BOOP_OPENAI_AUTH = "chatgpt"; process.env.OPENAI_API_KEY = "test-api-key";
  process.env.BOOP_CHATGPT_AUTH_FILE = join(tmpdir(), `absent-boop-${Date.now()}.json`);
  try {
    await assert.rejects(getOpenAICredential(), /not connected/);
    process.env.BOOP_OPENAI_AUTH = "api"; assert.equal(await getOpenAICredential(), "test-api-key");
  } finally {
    for (const [key, old] of Object.entries({ BOOP_OPENAI_AUTH: oldMode, OPENAI_API_KEY: oldKey, BOOP_CHATGPT_AUTH_FILE: oldPath })) {
      if (old === undefined) delete process.env[key]; else process.env[key] = old;
    }
  }
});

test("browser sign-in verifies state, PKCE, issued client registration and signed identity", async () => {
  const { generateKeyPair, exportJWK, SignJWT } = await import("jose");
  const { loginChatGPT, chatGPTAccounts, logoutChatGPT } = await import("../server/openai-auth.js");
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...await exportJWK(publicKey), kid: "test-key", alg: "RS256", use: "sig" };
  const dir = await mkdtemp(join(tmpdir(), "boop-login-"));
  const oldPath = process.env.BOOP_CHATGPT_AUTH_FILE; const originalFetch = globalThis.fetch; const oldLog = console.log;
  process.env.BOOP_CHATGPT_AUTH_FILE = join(dir, "auth.json");
  let authorization!: URL; let callbackDone: Promise<void> | undefined; let revoked = false;
  console.log = (message: unknown) => {
    const address = String(message).match(/http:\/\/127\.0\.0\.1:\d+\//);
    if (!address) return;
    const local = new URL(address[0]);
    callbackDone = (async () => {
      const page = await originalFetch(local);
      assert.equal(page.status, 200);
      assert.equal(page.headers.get("cache-control"), "no-store");
      assert.match(page.headers.get("content-security-policy") ?? "", /form-action 'self' https:\/\/auth\.openai\.com;/);
      const html = await page.text();
      assert.match(html, /Continue with ChatGPT/);
      const formToken = html.match(/name="form_token" value="([a-f0-9]+)"/)?.[1];
      assert(formToken);
      const form = new URLSearchParams({ form_token: formToken });
      const attempt = async (origin?: string) => {
        const response = await originalFetch(new URL("/login", local), { method: "POST", redirect: "manual", body: form, headers: origin ? { Origin: origin } : {} });
        assert.equal(response.status, 303);
        return new URL(response.headers.get("location")!);
      };
      // Same-origin HTML submissions can have a normal, absent, or opaque
      // Origin. The page token remains mandatory in all three cases.
      await attempt(local.origin);
      const first = await attempt();
      // Browser-side failures leave the callback pending. Retry rotates all
      // attempt secrets, retaining the same host registration and callback.
      authorization = await attempt("null");
      for (const key of ["state", "nonce", "code_challenge"]) assert.notEqual(first.searchParams.get(key), authorization.searchParams.get(key));
      for (const key of ["ext_agent_host_id", "redirect_uri", "client_id"]) assert.equal(first.searchParams.get(key), authorization.searchParams.get(key));
      const stale = new URL(first.searchParams.get("redirect_uri")!);
      stale.search = new URLSearchParams({ state: first.searchParams.get("state")!, code: "stale" }).toString();
      assert.equal((await originalFetch(stale)).status, 400);
      assert.equal((await originalFetch(new URL("/login", local), { method: "POST", body: form, headers: { Origin: "https://untrusted.example" } })).status, 403);
      for (const origin of [undefined, "null", local.origin]) {
        assert.equal((await originalFetch(new URL("/login", local), { method: "POST", body: new URLSearchParams({ form_token: "wrong" }), headers: origin ? { Origin: origin } : {} })).status, 403);
      }
      assert.equal(authorization.searchParams.get("client_id"), "dynamic_agent_client");
      assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
      const callback = new URL(authorization.searchParams.get("redirect_uri")!);
      assert.equal(callback.hostname, "127.0.0.1");
      callback.search = new URLSearchParams({ state: "wrong", code: "unused" }).toString();
      assert.equal((await originalFetch(callback)).status, 400);
      callback.search = new URLSearchParams({ state: authorization.searchParams.get("state")!, code: "auth-code", client_id: "oaiapp_test" }).toString();
      assert.equal((await originalFetch(callback)).status, 200);
    })();
    void callbackDone.catch(() => {});
  };
  globalThis.fetch = async (url, options) => {
    const target = String(url);
    if (target.endsWith("/.well-known/jwks.json")) return Response.json({ keys: [jwk] });
    if (target.endsWith("/.well-known/openid-configuration")) return Response.json({ revocation_endpoint: "https://auth.openai.com/oauth/revoke" });
    const body = new URLSearchParams(String(options?.body));
    if (target.endsWith("/oauth/revoke")) { assert.equal(body.get("token"), "refresh"); revoked = true; return new Response(null, { status: 200 }); }
    assert.equal(body.get("client_id"), "oaiapp_test"); assert.equal(body.get("code"), "auth-code");
    const { createHash } = await import("node:crypto");
    assert.equal(createHash("sha256").update(body.get("code_verifier")!).digest("base64url"), authorization.searchParams.get("code_challenge"));
    const idToken = await new SignJWT({ nonce: authorization.searchParams.get("nonce"), email: "test@example.com" }).setProtectedHeader({ alg: "RS256", kid: "test-key" }).setIssuer("https://auth.openai.com").setAudience("oaiapp_test").setSubject("user-test").setExpirationTime("1h").sign(privateKey);
    return Response.json({ access_token: "test-access", refresh_token: "refresh", id_token: idToken, expires_in: 3600, token_type: "Bearer", scope: "resource.invoke chatgpt.tokens.use.direct openid profile email offline_access" });
  };
  try {
    await loginChatGPT(); await callbackDone;
    assert.equal((await chatGPTAccounts())[0].email, "test@example.com");
    await logoutChatGPT(); assert(revoked);
    const store = JSON.parse(await readFile(process.env.BOOP_CHATGPT_AUTH_FILE, "utf8"));
    assert.match(store.hostId, /^urn:uuid:/); assert.equal(store.profiles[0].clientId, "oaiapp_test");
    assert.equal(store.profiles[0].accessToken, ""); assert.equal(store.profiles[0].refreshToken, undefined);
  } finally {
    console.log = oldLog; globalThis.fetch = originalFetch;
    if (oldPath === undefined) delete process.env.BOOP_CHATGPT_AUTH_FILE; else process.env.BOOP_CHATGPT_AUTH_FILE = oldPath;
    await rm(dir, { recursive: true, force: true });
  }
});

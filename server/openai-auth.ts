import { randomBytes, randomUUID, createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile, rename, unlink, open } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createRemoteJWKSet, jwtVerify } from "jose";

const ISSUER = "https://auth.openai.com";
const TOKEN_URL = `${ISSUER}/api/accounts/oauth/token`;
const RESOURCE = "https://api.openai.com/v1";
const REQUIRED_SCOPES = ["resource.invoke", "chatgpt.tokens.use.direct"];
const jwks = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));

export interface ChatGPTProfile {
  clientId: string;
  subject: string;
  email?: string;
  accessToken: string;
  refreshToken?: string;
  idToken: string;
  scopes: string[];
  expiresAt: number;
}
interface AuthStore { hostId: string; activeClientId?: string; profiles: ChatGPTProfile[] }
export function authFile(): string {
  return resolve(process.env.BOOP_CHATGPT_AUTH_FILE ?? "data/chatgpt-auth.json");
}
async function readStore(): Promise<AuthStore> {
  try {
    return JSON.parse(await readFile(authFile(), "utf8")) as AuthStore;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return { hostId: `urn:uuid:${randomUUID()}`, profiles: [] };
  }
}
async function saveStore(store: AuthStore): Promise<void> {
  const path = authFile();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(store, null, 2), { mode: 0o600, flag: "wx" });
    await rename(temp, path);
  } finally {
    await unlink(temp).catch(() => {});
  }
}
export function assertPlanPermission(scopes: string[]): void {
  if (!REQUIRED_SCOPES.every((scope) => scopes.includes(scope))) {
    throw new Error("ChatGPT plan usage was not authorized. Run npm run login:chatgpt and allow plan usage.");
  }
}
async function exchange(params: Record<string, string>): Promise<{
  access_token: string; refresh_token?: string; id_token?: string;
  expires_in: number; scope?: string; token_type: string;
}> {
  const response = await fetch(TOKEN_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, resource: RESOURCE }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    // Token responses may contain credentials: never include the response body.
    throw new Error(`ChatGPT authorization failed (HTTP ${response.status}). Run npm run login:chatgpt again.`);
  }
  const token = await response.json() as Awaited<ReturnType<typeof exchange>>;
  if (!token.access_token || token.token_type?.toLowerCase() !== "bearer" || !(token.expires_in > 0)) {
    throw new Error("ChatGPT returned an invalid token response.");
  }
  return token;
}

/** The CLI prints a fresh authorization URL; the user signs in in their browser. */
export async function loginChatGPT(clientId?: string | null): Promise<void> {
  const store = await withStoreLock(async () => { const stored = await readStore(); await saveStore(stored); return stored; });
  const registration = clientId === null ? undefined : clientId ?? store.activeClientId;
  const previous = registration ? store.profiles.find((p) => p.clientId === registration) : undefined;
  if (registration && !previous) throw new Error("Unknown saved ChatGPT account.");
  let state = "";
  let nonce = "";
  let verifier = "";
  let redirectUri = "";
  let localOrigin = "";
  let accepted = false;
  const formToken = randomBytes(32).toString("hex");
  let settle!: (url: URL) => void;
  let reject!: (err: Error) => void;
  const callback = new Promise<URL>((ok, fail) => { settle = ok; reject = fail; });
  const beginAuthorization = (): URL => {
    state = randomBytes(32).toString("base64url");
    nonce = randomBytes(32).toString("base64url");
    verifier = randomBytes(48).toString("base64url");
    const url = new URL(`${ISSUER}/api/accounts/authorize`);
    url.search = new URLSearchParams({
      client_id: previous?.clientId ?? "dynamic_agent_client",
      ...(previous ? {} : { agent_name_hint: "Boop" }),
      ...(previous?.email ? { login_hint: previous.email } : {}),
      ext_agent_host_id: store.hostId, response_type: "code", redirect_uri: redirectUri,
      scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
      resource: RESOURCE, state, nonce, code_challenge_method: "S256",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    }).toString();
    return url;
  };
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://auth.openai.com; frame-ancestors 'none'; base-uri 'none'");
    if (!localOrigin || req.headers.host !== new URL(localOrigin).host) { res.writeHead(400).end("Invalid callback host."); return; }
    const url = new URL(req.url ?? "/", localOrigin);
    if (url.pathname === "/" && req.method === "GET") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Connect Boop</title>
<style>body{font:18px system-ui;max-width:620px;margin:12vh auto;padding:24px;line-height:1.6}button{font:inherit;background:#111;color:white;border:0;border-radius:8px;padding:12px 20px;cursor:pointer}</style>
<h1>Connect Boop</h1><p>Continue with ChatGPT to authorize use of your plan. Boop shares your subscription limits.</p>
<form method="post" action="/login"><input type="hidden" name="form_token" value="${formToken}"><button type="submit">Continue with ChatGPT</button></form>
<p>If ChatGPT shows “Operation timed out” after account selection, return here and try again. Each click creates a fresh sign-in attempt.</p>
<p>You can open this local page in Safari or Chrome on this computer to try a different browser session. Keep the Boop sign-in terminal running.</p>
<p>No account is connected until the terminal confirms success.</p></html>`);
      return;
    }
    if (url.pathname === "/login" && req.method === "POST") {
      // Privacy settings and no-referrer navigation can omit Origin or send
      // "null". Prove the request came from this page with a form token instead
      // of rejecting legitimate submissions on that header alone.
      const origin = req.headers.origin;
      if (origin && origin !== "null" && origin !== localOrigin) { res.writeHead(403).end("Start sign-in from Boop's local page."); return; }
      if (!req.headers["content-type"]?.startsWith("application/x-www-form-urlencoded")) { res.writeHead(400).end("Submit the button on Boop's local page."); return; }
      if (Number(req.headers["content-length"] ?? 0) > 4096) { res.writeHead(413).end("Sign-in form is too large."); return; }
      let body = "";
      try {
        for await (const chunk of req) {
          body += chunk.toString();
          if (Buffer.byteLength(body) > 4096) { res.writeHead(413).end("Sign-in form is too large."); return; }
        }
      } catch { res.writeHead(400).end("Unable to read sign-in form."); return; }
      const submitted = new URLSearchParams(body).get("form_token") ?? "";
      const actual = Buffer.from(submitted);
      const expected = Buffer.from(formToken);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) { res.writeHead(403).end("This sign-in page is expired. Open the local link printed in the terminal again."); return; }
      if (accepted) { res.writeHead(409).end("Sign-in callback already received; check the terminal."); return; }
      res.writeHead(303, { Location: beginAuthorization().toString() }).end();
      return;
    }
    if (url.pathname !== "/auth/callback" || req.method !== "GET") { res.writeHead(404).end(); return; }
    if (!state || url.searchParams.get("state") !== state) { res.writeHead(400).end("Invalid or expired sign-in attempt. Return to Boop's local sign-in page and try again."); return; }
    if (accepted) { res.writeHead(409).end("Sign-in callback already received."); return; }
    accepted = true;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Sign-in received. Return to the Boop terminal to check the result.");
    settle(url);
  });
  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", ok);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not start sign-in callback.");
  localOrigin = `http://127.0.0.1:${address.port}`;
  redirectUri = `${localOrigin}/auth/callback`;
  console.log(`Continue with ChatGPT\nOpen this local page on this computer:\n${localOrigin}/\n\nKeep this terminal running. If ChatGPT times out after account selection, return to this page for a fresh attempt or open it in Safari/Chrome.\nAllow Boop to use your ChatGPT plan. This shares your plan limits; manage access in ChatGPT Settings.`);
  const timer = setTimeout(() => reject(new Error("No ChatGPT callback received within 15 minutes. Run npm run login:chatgpt again and open the new local link. A timeout on ChatGPT's page occurs before Boop receives the callback.")), 15 * 60_000);
  try {
    const returned = await callback;
    if (returned.searchParams.has("error")) throw new Error("ChatGPT sign-in was declined or failed.");
    const issued = returned.searchParams.get("client_id") ?? previous?.clientId;
    if (!issued || issued === "dynamic_agent_client" || (previous && issued !== previous.clientId)) {
      throw new Error("ChatGPT returned an unexpected client registration.");
    }
    const code = returned.searchParams.get("code");
    if (!code) throw new Error("ChatGPT did not return an authorization code.");
    const tokens = await exchange({ grant_type: "authorization_code", client_id: issued,
      code, code_verifier: verifier, redirect_uri: redirectUri });
    if (!tokens.id_token) throw new Error("ChatGPT did not return an identity token.");
    const { payload } = await jwtVerify(tokens.id_token, jwks, { issuer: ISSUER, audience: issued });
    if (payload.nonce !== nonce || !payload.sub || !payload.exp || (previous && payload.sub !== previous.subject)) {
      throw new Error("ChatGPT identity verification failed.");
    }
    const scopes = (tokens.scope ?? "").split(/\s+/).filter(Boolean);
    assertPlanPermission(scopes);
    const profile: ChatGPTProfile = {
      clientId: issued, subject: payload.sub,
      email: typeof payload.email === "string" ? payload.email : undefined,
      accessToken: tokens.access_token, refreshToken: tokens.refresh_token,
      idToken: tokens.id_token, scopes, expiresAt: Date.now() + tokens.expires_in * 1000,
    };
    await withStoreLock(async () => {
      const latest = await readStore();
      latest.profiles = [...latest.profiles.filter((p) => p.clientId !== issued), profile];
      latest.activeClientId = issued;
      await saveStore(latest);
    });
    console.log(`ChatGPT connected${profile.email ? ` (${profile.email})` : ""}. Boop will use your ChatGPT plan.`);
  } finally {
    clearTimeout(timer);
    server.close();
    server.closeAllConnections();
  }
}

let refreshing: Promise<string> | undefined;
async function withStoreLock<T>(action: () => Promise<T>): Promise<T> {
  const path = `${authFile()}.lock`;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  // Serialize rotating refresh tokens across CLI/server processes as well as agents.
  let lock: Awaited<ReturnType<typeof open>> | undefined;
  for (let attempt = 0; attempt < 400; attempt++) {
    try { lock = await open(path, "wx", 0o600); break; }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      await new Promise((ok) => setTimeout(ok, 100));
    }
  }
  if (!lock) throw new Error("ChatGPT credentials are locked by another Boop process. Retry; if the process crashed, remove the stale data/chatgpt-auth.json.lock file.");
  try {
    return await action();
  } finally {
    await lock.close();
    await unlink(path);
  }
}
async function refreshAccessToken(): Promise<string> {
  return withStoreLock(async () => {
    const store = await readStore();
    const profile = store.profiles.find((p) => p.clientId === store.activeClientId);
    if (!profile) throw new Error("ChatGPT is not connected. Run npm run login:chatgpt.");
    assertPlanPermission(profile.scopes);
    if (profile.expiresAt > Date.now() + 60_000) return profile.accessToken;
    if (!profile.refreshToken) throw new Error("ChatGPT sign-in expired. Run npm run login:chatgpt.");
    const tokens = await exchange({ grant_type: "refresh_token", client_id: profile.clientId, refresh_token: profile.refreshToken });
    const scopes = tokens.scope ? tokens.scope.split(/\s+/) : profile.scopes;
    assertPlanPermission(scopes);
    if (tokens.id_token) {
      const { payload } = await jwtVerify(tokens.id_token, jwks, { issuer: ISSUER, audience: profile.clientId });
      if (!payload.exp || payload.sub !== profile.subject) throw new Error("Refreshed ChatGPT identity does not match the saved account.");
      profile.idToken = tokens.id_token;
    }
    profile.accessToken = tokens.access_token;
    profile.refreshToken = tokens.refresh_token ?? profile.refreshToken;
    profile.expiresAt = Date.now() + tokens.expires_in * 1000;
    profile.scopes = scopes;
    await saveStore(store);
    return profile.accessToken;
  });
}
export async function getChatGPTAccessToken(): Promise<string> {
  const store = await readStore();
  const profile = store.profiles.find((p) => p.clientId === store.activeClientId);
  if (!profile) throw new Error("ChatGPT is not connected. Run npm run login:chatgpt.");
  assertPlanPermission(profile.scopes);
  if (profile.expiresAt > Date.now() + 60_000) return profile.accessToken;
  if (!refreshing) refreshing = refreshAccessToken().finally(() => { refreshing = undefined; });
  return refreshing;
}
export function authMode(): "chatgpt" | "api" {
  const mode = process.env.BOOP_OPENAI_AUTH ?? "chatgpt";
  if (mode !== "chatgpt" && mode !== "api") throw new Error("BOOP_OPENAI_AUTH must be chatgpt or api.");
  return mode;
}
export async function getOpenAICredential(): Promise<string> {
  if (authMode() === "chatgpt") return getChatGPTAccessToken();
  if (!process.env.OPENAI_API_KEY) throw new Error("API mode requires OPENAI_API_KEY in .env.local (separate API billing).");
  return process.env.OPENAI_API_KEY;
}
export async function listOpenAIModels(): Promise<Array<{ id: string; name: string }>> {
  const credential = await getOpenAICredential();
  const response = await fetch(`${RESOURCE}/models`, { headers: { Authorization: `Bearer ${credential}` }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Could not list OpenAI models (HTTP ${response.status}).`);
  const body = await response.json() as { models?: Array<{ slug: string; display_name?: string; visibility?: string }>; data?: Array<{ id: string }> };
  if (body.models) return body.models.filter((m) => m.visibility === "list").map((m) => ({ id: m.slug, name: m.display_name ?? m.slug }));
  return (body.data ?? []).filter((m) => /^(gpt-|o\d)/.test(m.id)).map((m) => ({ id: m.id, name: m.id }));
}

/** Safe account summaries; tokens and identity JWTs never leave the credential module. */
export async function chatGPTAccounts() {
  const store = await readStore();
  return store.profiles.map((p) => ({ clientId: p.clientId, email: p.email, active: p.clientId === store.activeClientId, connected: Boolean(p.accessToken) }));
}
export async function selectChatGPTAccount(clientId: string): Promise<void> {
  await withStoreLock(async () => {
    const store = await readStore();
    const profile = store.profiles.find((p) => p.clientId === clientId);
    if (!profile?.accessToken) throw new Error("Account is not connected. Sign in with --client=<id> first.");
    assertPlanPermission(profile.scopes);
    store.activeClientId = clientId;
    await saveStore(store);
  });
}
export async function logoutChatGPT(): Promise<void> {
  await withStoreLock(async () => {
    const store = await readStore();
    const profile = store.profiles.find((p) => p.clientId === store.activeClientId);
    if (!profile) return;
    const credential = profile.refreshToken ?? profile.accessToken;
    if (credential) {
      const discovery = await fetch(`${ISSUER}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(30_000) });
      if (!discovery.ok) throw new Error("Unable to discover ChatGPT revocation endpoint. Retry logout.");
      const config = await discovery.json() as { revocation_endpoint?: string };
      const endpoint = new URL(config.revocation_endpoint ?? "");
      if (endpoint.origin !== ISSUER) throw new Error("Unexpected ChatGPT revocation endpoint.");
      const revoked = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: profile.clientId, token: credential, token_type_hint: profile.refreshToken ? "refresh_token" : "access_token" }), signal: AbortSignal.timeout(30_000) });
      if (!revoked.ok) throw new Error(`ChatGPT revocation failed (HTTP ${revoked.status}). Retry logout.`);
    }
    // Retain the app/identity mapping for reauthorization; delete all credentials.
    profile.accessToken = ""; profile.refreshToken = undefined; profile.idToken = ""; profile.expiresAt = 0;
    store.activeClientId = undefined;
    await saveStore(store);
  });
}

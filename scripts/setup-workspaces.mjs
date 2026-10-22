import { readFileSync, appendFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { generateKeyPair, exportJWK, importJWK } from "jose";
import { parse } from "dotenv";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env.local");
const env = parse(readFileSync(envPath));
if (!env.CONVEX_DEPLOYMENT?.startsWith("local:") || env.CONVEX_DEPLOY_KEY || process.env.CONVEX_DEPLOY_KEY ||
    (process.env.CONVEX_DEPLOYMENT && process.env.CONVEX_DEPLOYMENT !== env.CONVEX_DEPLOYMENT)) {
  throw new Error("This setup is restricted to the configured local Convex deployment.");
}
let privateJwk;
if (env.BOOP_RUNTIME_PRIVATE_JWK) {
  privateJwk = JSON.parse(env.BOOP_RUNTIME_PRIVATE_JWK);
  await importJWK(privateJwk, "RS256");
} else {
  const keys = await generateKeyPair("RS256", { extractable: true });
  privateJwk = { ...await exportJWK(keys.privateKey), kid: "boop-runtime-v1", use: "sig", alg: "RS256" };
  appendFileSync(envPath, `\n# Private server signing key. Never expose to the frontend.\nBOOP_RUNTIME_PRIVATE_JWK='${JSON.stringify(privateJwk)}'\n`);
}
const publicJwk = { kty: privateJwk.kty, n: privateJwk.n, e: privateJwk.e, kid: privateJwk.kid, use: "sig", alg: "RS256" };
const jwks = `data:application/json;base64,${Buffer.from(JSON.stringify({ keys: [publicJwk] })).toString("base64")}`;
console.log(`target: local (${env.CONVEX_DEPLOYMENT})`);
const dir = mkdtempSync(join(tmpdir(), "boop-workspaces-"));
try {
  const file = join(dir, "public-key.env");
  writeFileSync(file, `BOOP_RUNTIME_JWKS=${jwks}\n`, { mode: 0o600 });
  const result = spawnSync("npx", ["convex", "env", "set", "--deployment", "local", "--from-file", file, "--force"], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error("Could not register runtime public key with local Convex. No private key was printed.");
  console.log("Workspace signing configured. Restart the agent server to load its private key.");
} finally { rmSync(dir, { recursive: true, force: true }); }

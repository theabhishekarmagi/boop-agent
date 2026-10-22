import {
  readFileSync,
  appendFileSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { parse } from "dotenv";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env.local");
const env = parse(readFileSync(envPath));
if (
  !env.CONVEX_DEPLOYMENT?.startsWith("local:") ||
  env.CONVEX_DEPLOY_KEY ||
  process.env.CONVEX_DEPLOY_KEY
) {
  throw new Error(
    "This setup command only supports a local Convex deployment without a deploy key.",
  );
}
if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
  throw new Error(
    "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local first.",
  );
}
const site = new URL(env.SITE_URL || "http://localhost:5173");
const backend = new URL(env.VITE_CONVEX_SITE_URL);
if (
  ![site, backend].every((url) =>
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
  )
) {
  throw new Error(
    "Local auth setup requires loopback frontend and Convex site URLs.",
  );
}
const secret = env.BETTER_AUTH_SECRET || randomBytes(32).toString("base64url");
if (secret.length < 32)
  throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters.");
if (!env.BETTER_AUTH_SECRET)
  appendFileSync(envPath, `\nBETTER_AUTH_SECRET=${secret}\n`);

console.log(`target: local (${env.CONVEX_DEPLOYMENT})`);
const dir = mkdtempSync(join(tmpdir(), "boop-auth-"));
try {
  const file = join(dir, "auth.env");
  writeFileSync(
    file,
    Object.entries({
      SITE_URL: site.origin,
      BETTER_AUTH_SECRET: secret,
      GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
    })
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join("\n"),
    { mode: 0o600 },
  );
  // A private temporary file avoids putting secrets in process arguments/logs.
  // Without --force, Convex refuses changes to already configured values.
  const result = spawnSync(
    "npx",
    ["convex", "env", "set", "--deployment", "local", "--from-file", file],
    { cwd: root, encoding: "utf8" },
  );
  if (result.status !== 0)
    throw new Error(
      "Could not configure local auth. Check the running backend and existing environment values. No credentials were printed.",
    );
  console.log(
    `Google authorized redirect URI: ${backend.origin}/api/auth/callback/google`,
  );
  console.log(`Sign in: ${site.origin}/login`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

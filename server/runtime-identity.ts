import { importJWK, SignJWT } from "jose";

const issuer = "https://boop.internal/runtime";
let signingKey: ReturnType<typeof importJWK> | undefined;

export async function runtimeToken(owner: string): Promise<string> {
  const raw = process.env.BOOP_RUNTIME_PRIVATE_JWK;
  if (!raw) throw new Error("Run npm run setup:workspaces to configure the agent's database identity.");
  const jwk = JSON.parse(raw);
  signingKey ??= importJWK(jwk, "RS256");
  return new SignJWT({ workspace: owner })
    .setProtectedHeader({ alg: "RS256", kid: jwk.kid, typ: "JWT" })
    .setIssuer(issuer).setAudience("boop-runtime").setSubject("agent-worker")
    .setIssuedAt().setExpirationTime("10m").sign(await signingKey);
}

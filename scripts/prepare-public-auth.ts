import { generateKeyPairSync, createPublicKey } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
const directory = resolve("data");
mkdirSync(directory, { recursive: true });
const keyFile = resolve(directory, "worker-private.pem");
if (!existsSync(keyFile)) {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
}
chmodSync(keyFile, 0o600);
const publicKey = createPublicKey(readFileSync(keyFile)).export({ format: "jwk" });
const jwks = { keys: [{ ...publicKey, kid: "boop-worker", alg: "RS256", use: "sig" }] };
writeFileSync(resolve(directory, "worker-jwks.txt"), Buffer.from(JSON.stringify(jwks)).toString("base64"), { mode: 0o600 });
console.log("Worker signing key prepared. Only the public JWKS is uploaded to Convex; private key stays under ignored data/.");

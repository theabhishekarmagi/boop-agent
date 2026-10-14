import type { AuthConfig } from "convex/server";
export default {
  providers: [
    ...(process.env.CLERK_JWT_ISSUER_DOMAIN ? [{ domain: process.env.CLERK_JWT_ISSUER_DOMAIN, applicationID: "convex" }] : []),
    ...(process.env.BOOP_WORKER_JWKS ? [{
      type: "customJwt" as const, issuer: "https://boop-worker.internal", applicationID: "boop-worker",
      algorithm: "RS256" as const, jwks: `data:text/plain;charset=utf-8;base64,${process.env.BOOP_WORKER_JWKS}`,
    }] : []),
  ],
} satisfies AuthConfig;

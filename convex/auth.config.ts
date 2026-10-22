import { getAuthConfigProvider } from "@convex-dev/better-auth/auth-config";
import type { AuthConfig } from "convex/server";
import { RUNTIME_ISSUER } from "./model/auth";

export default {
  providers: [getAuthConfigProvider(), ...(process.env.BOOP_RUNTIME_JWKS ? [{
    type: "customJwt" as const,
    issuer: RUNTIME_ISSUER,
    applicationID: "boop-runtime",
    algorithm: "RS256" as const,
    jwks: process.env.BOOP_RUNTIME_JWKS,
  }] : [])],
} satisfies AuthConfig;

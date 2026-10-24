# Google sign-in

Boop uses Better Auth's Convex component for Google OAuth, persisted users,
sessions, and the authentication tokens used by Convex. No Firebase or Clerk
account is needed.

## Local development

1. Start the existing local Convex deployment with `npm run dev:convex`.
2. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the root `.env.local`.
   Do not prefix secrets with `VITE_` or commit them.
3. Run `npm run setup:google-auth`. This command only configures a local
   deployment, creates a signing secret if needed, and prints the callback URI.
4. In Google Auth Platform → Clients → your **Web application** OAuth client,
   add the printed URI to **Authorized redirect URIs**. With the existing local
   backend this is exactly:

   ```text
   http://127.0.0.1:3211/api/auth/callback/google
   ```

   The callback belongs to the Convex HTTP endpoint, not the Vite frontend.
   If Google asks for an authorized JavaScript origin, use
   `http://localhost:5173`. Add your Google account as a test user while the
   OAuth app is in Testing mode.
5. Run `npm run dev:debug` and open `http://localhost:5173/login`.
   `/signup` opens the create-account view; both use the same Google OAuth flow.
   Successful local sign-in opens `/dashboard`. Existing signed-in sessions on
   `/login`, `/signup`, and `/account` also continue to the dashboard.
   `/dashboard` waits for a verified session before mounting the dashboard.
6. Complete Google authorization, check the dashboard, reload to check session
   persistence, sign out, and confirm `/dashboard` shows the sign-in page again.

The frontend requires `VITE_CONVEX_URL` and `VITE_CONVEX_SITE_URL`.
The Convex deployment requires `SITE_URL`, `BETTER_AUTH_SECRET`,
`GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET`. `CONVEX_SITE_URL` is supplied
by Convex. Google login only requests basic identity scopes; integration access
is handled separately by Composio.

### Local frontend with a cloud development backend

All Convex URLs must point to the same deployment: `CONVEX_URL` and
`VITE_CONVEX_URL` use its `.convex.cloud` URL, while `VITE_CONVEX_SITE_URL`
uses its `.convex.site` URL. The worker signing key must also match that backend.
Keep the deployment's `SITE_URL` set to the hosted preview and configure
`ADDITIONAL_AUTH_TRUSTED_ORIGINS` on that same development deployment as
`http://localhost:5173,http://127.0.0.1:5173` when testing locally. Only add
origins you control; do not use a wildcard. This allows browser CORS requests
and OAuth return URLs without breaking hosted sign-in. The Google callback
remains the cloud backend's `/api/auth/callback/google` endpoint.

If `/api/auth/get-session` returns 200 but the browser says it cannot reach
sign-in, check that the response allows the frontend's exact Origin. An
untrusted origin can produce this symptom even when the database is reachable.

## Scope and deployment

Google accounts now have separate workspaces. Convex queries and mutations,
agent execution, WebSocket events, settings, and Composio connections are scoped
to the verified account. `/debug` also requires authentication. Existing personal
data is retained in a separate operator workspace and is not assigned to a new
Google account. See [ACCOUNT_ISOLATION.md](ACCOUNT_ISOLATION.md).

This remains a local development release. `BOOP_PUBLIC_MODE` is blocked, and
production builds exclude the dashboard until production hosting, authentication,
and verified messaging-channel ownership are configured.

Before production, configure separate production credentials and a strong
signing secret on the chosen Convex deployment, set `SITE_URL` to the exact
frontend origin, and register `<CONVEX_SITE_URL>/api/auth/callback/google` in
Google. Select the deployment explicitly; never copy local configuration onto a
cloud deployment blindly. The public frontend must serve `index.html` for
`/login`, `/signup`, and `/account`.

## Verification

```sh
npm run typecheck
npx tsc --noEmit -p convex/tsconfig.json
npm run build:debug
BOOP_TEST_LOCAL_AUTH=1 node --import tsx --test tests/google-auth.integration.test.ts
```

The opt-in integration tests contact only the local Convex ports. They validate
anonymous/forged-session rejection, OAuth scopes and PKCE, callback restrictions,
and CORS. They never sign in to a real Google account. Completing the real
Google consent screen is a separate manual check.

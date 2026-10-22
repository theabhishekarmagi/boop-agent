# AWS private test deployment

This configuration runs Boop on Lightsail with a separate Convex development
backend. It is an invitation-only test, not a public production launch.

- Instance: `boop-agent`, Ubuntu 24.04, Sydney `ap-southeast-2a`.
- Bundle: `medium_3_2`, 2 CPUs, 4 GB RAM, 80 GB disk; $24/month before credits.
- Convex: `theabhishekar:peshi:dev/aws-staging`, `compassionate-gnat-191`.
- Google callback: `https://compassionate-gnat-191.convex.site/api/auth/callback/google`.
- Web container listens on the server's `127.0.0.1:8080` only.
- Connect with an SSH local forward and open `http://localhost:8080`.
- Convex `SITE_URL` for this test is `http://localhost:8080`.

`agent.env` and `runtime-data/` are private, ignored files. Never commit them or
include them in a Docker build context. ChatGPT authentication is mounted at
runtime and is only intended for the owner's private test. Invited account emails
are listed in `BOOP_ALLOWED_EMAILS`; the agent HTTP and WebSocket APIs reject
others. Database access remains isolated by account. Google sign-up itself is
not limited by this server allowlist.

The build includes Convex generated files, so generate those before packaging.
Build from the repository root:

```sh
docker compose -f deploy/aws/compose.yaml build
docker compose -f deploy/aws/compose.yaml up -d
```

The backend has no published Docker port. The web proxy blocks personal operator
webhook routes. Twilio and Sendblue credentials are omitted. Telegram polling is enabled only
for a user-owned connected bot after starting chat verification (or a verified
chat). The legacy operator listener still requires its explicit sender allowlist. Production dashboard inclusion is explicit via
`VITE_ENABLE_DASHBOARD=true` during the frontend image build; authentication is
still required. `BOOP_PUBLIC_MODE` remains blocked until public-launch work is
complete.

A real public launch still needs a public HTTPS endpoint, its exact Google/Auth
origin settings, production database choice, per-user messaging bindings, an AI
usage budget, and operational limits. A private test does not validate those.

Stopping a Lightsail instance does not remove its storage-related plan charges.
Delete unused infrastructure only after preserving needed data and confirming
that the environment is no longer required. SSH access credentials downloaded
for setup are temporary and should not be committed or shared.

## Verified private deployment

The server is running at `3.27.235.8`. Use the active SSH tunnel and open
`http://localhost:8080/dashboard`. This localhost address forwards to AWS; it is
not a publicly accessible website and works only on the machine with the tunnel.
`connect-private.sh` reopens it while the downloaded AWS SSH certificate is valid.
If the certificate expires, renew Lightsail temporary SSH access first.

Verified: both containers running, Google sign-in to the cloud-backed dashboard,
authenticated WebSocket connection, anonymous API rejection, and actual tool-call
smoke tests for both configured AI models from the AWS container. No personal
messaging credentials were deployed. The database is a fresh development database.

Connections catalog loading and full-catalog search were verified in the hosted
Google session. Compose env files must contain the runtime JWK as literal JSON
inside single quotes, without backslash-escaped JSON property quotes. A malformed
key prevents authenticated server requests even when browser sign-in succeeds.

## Telegram chat

Connect a Telegram bot in Connections, then select **Chat with Boop** under that
connection. Open the generated Telegram link and press Start within ten minutes.
For Telegram Web, use **Copy verification command** and send the full command
to the displayed bot; the t.me desktop-app launcher may not pass the code to an
already-open web chat. The server verifies the one-time code, sends a greeting, and routes subsequent
private messages to the Google workspace that generated the link. No local
phone number or username configuration is needed. Groups and other senders are
ignored. Each bot may belong to only one Boop connection/workspace.

Bindings and hashed expiring codes live in Convex. Delivery validates the current
workspace binding; disconnect removes it. Polling checkpoints are on the existing
persistent runtime volume. Run one Telegram worker instance per deployment;
multiple replicas require a distributed polling lease before scaling horizontally.

Verified live on 2026-10-22: the connected customer bot `@boop300_bot` accepted
the full verification command, delivered the automatic greeting, then received
a normal Telegram test message and delivered an actual AI reply. Dashboard status
changed to “Telegram chat verified.” Composio verification-receive log:
`log_OEOlrtOmJo6F`; greeting delivery log: `log_QbnU3_limEi4`.

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

## Temporary public testing

Public testing is an explicit Compose overlay; ordinary private startup keeps
its existing email allowlist. Run both files to allow any authenticated Google
account and publish the web proxy through a Cloudflare Quick Tunnel:

```sh
docker compose -f deploy/aws/compose.yaml -f deploy/aws/compose.public-test.yaml up -d
```

The tunnel runs on AWS, so the public link does not depend on the laptop's SSH
forward. No inbound web ports are opened. Google authentication, per-workspace
data isolation, and the proxy's operator-webhook block remain enforced.
`BOOP_ALLOW_PUBLIC_SIGNUPS=true` removes the tester email restriction; it does not
allow anonymous API access. This test still shares the owner's ChatGPT plan.

Read the current HTTPS address from `docker logs aws-tunnel-1`. Set `SITE_URL` on
the **aws-staging development Convex deployment** to that exact origin before
using Google login. The Google callback remains the existing Convex site URL.
The current test origin is `https://deposit-primary-pottery-picnic.trycloudflare.com`.
Use this public origin for sign-in during public testing rather than localhost.
Quick Tunnel hostnames change when the tunnel is recreated; update `SITE_URL`
again if that happens. A stable launch hostname needs a named tunnel/domain.

To return to private testing, stop the `tunnel` service using both Compose files,
recreate `agent` with only compose.yaml, and restore the development deployment's
`SITE_URL` to `http://localhost:8080`.

## Shared agent latency controls

All agent runs use the same tool-context policy: recent textual results are
limited to 16,000 characters each, and older results get smaller previews.
Full results remain private to that run and can be searched/paged with
`read_tool_result`; retrieving a result never repeats a provider action.
Call/result pairs, model reasoning, and uncapped task turns are retained.
The shared instructions favor filtered metadata, targeted detail retrieval,
bounded batches, and checking execution status before retrying a timeout.
These are latency controls, not a response-time guarantee for external services
or exhaustive tasks.

Independent integration sessions initialize concurrently; simultaneous registry
refreshes share one request per workspace. Telegram intake checkpoints updates
to a persistent inbox before advancing the provider offset. Execution is ordered
within each chat and independent across chats, with saved partial delivery state.
Intake pauses at 100 queued updates (a batch may add up to 20 more), preserving
upstream updates rather than dropping them. The existing single-worker deployment
requirement still applies.

## Development test release — 2026-10-24

Updated the existing Lightsail agent/web containers and the `compassionate-gnat-191`
development Convex deployment. The existing Quick Tunnel was preserved. The release
includes bounded Gmail priority overviews, task cancellation/concurrency, retry
recovery, Telegram connection improvements, and connected-app grouping.

Verified public health HTTP 200, protected API HTTP 401 without authentication,
the signed-in dashboard's live connection, and zero backend container restarts.
A real `gpt-6-luna` run in the corrected AWS image passed the synthetic empty-inbox
case with exactly one Gmail tool call in 7.8 seconds. This is a tool smoke test,
not an end-to-end mailbox latency benchmark. Browser automation stays disabled.

The first image failed because restrictive archive permissions prevented the
non-root runtime from reading source files. The Dockerfile now explicitly grants
read/traverse permission to packaged source files before switching to `USER node`.
The previous backend was restored while rebuilding; the corrected image was
tested before activation. Rollback images and a private source/runtime backup
remain on the server under `/home/ubuntu/boop-backups/20261024`.

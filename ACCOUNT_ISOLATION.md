# Account isolation

Each Google account owns a workspace keyed by its verified Convex identity.
Business queries and mutations derive ownership on the server, and indexes filter
by owner before pagination or limits. Clients cannot select another owner.

Agent workers use short-lived signed JWTs to act within a workspace. Async-local
context keeps concurrent runs separate; browser tokens cannot delegate ownership.
Browser HTTP and WebSocket requests require a verified live account session.
WebSocket events, running agents, settings, integration caches, and Composio user
identities are scoped to that workspace.

## Local setup

Run `npm run setup:workspaces` with the local Convex deployment running. It creates
a private signing JWK in ignored `.env.local` and installs its public JWKS on the
local Convex deployment. Restart the Node server after configuring it. The script
refuses cloud deployments. Treat the private JWK as a privileged server secret.

Existing unowned records are preserved as `boop:operator`, never claimed by the
first Google login. A private export was taken before the local migration. The
internal `workspaces:preserveLegacy` mutation migrates bounded batches; it is not
available to browser clients. Existing messaging channels remain operator-owned.
Google users must connect their own integrations. Telegram chat is now supported
for a user-owned connected bot after a one-time, expiring verification command.
The `telegramChannels` table is writable only by authenticated server workers;
its owner is derived from the signed workspace identity. A bot cannot be claimed
by two workspaces. The listener runs within the connection owner's workspace,
accepts only the verified private sender, and shared delivery checks that binding.
Disconnecting removes the binding. iMessage and Twilio remain operator-only.

## Verification

- `npm run test:workspaces`: database authorization and cross-account isolation.
- `npm test`: runtime context, broadcasts, integration ownership, and channel guards.
- `npm run typecheck` and `npm run build:debug`.

Live local checks also reject anonymous HTTP/Convex requests, forged WebSocket
authentication, and worker tokens used as browser credentials. Concurrent signed
worker requests were checked against the live local database.

## Remaining public launch work

Production dashboard delivery and public server mode remain disabled. Configure
cloud Convex, production Google OAuth callbacks, HTTPS hosting, server secrets,
and verified per-user messaging bindings before enabling public access. Customer
workspaces currently cannot send through operator-owned external messaging
channels. This avoids sending another user's agent output to the operator.

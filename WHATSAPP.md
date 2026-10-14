# WhatsApp access through Baileys

Boop can receive private text messages through a linked WhatsApp account and reply using its existing OpenAI agent, memory, tools, acknowledgments, and scheduled notifications. iMessage and Telegram remain available.

## Public user connection flow

With `BOOP_PUBLIC_MODE=true`, customers sign up/sign in using Clerk phone verification. In Connections → WhatsApp, each signed-in user gets a private QR/link that opens a conversation with Boop's separate WhatsApp number. They send its prefilled message from the **same verified phone number**. The five-minute code is stored only as a hash, consumed atomically once, and never processed as an agent request. A customer never scans Boop's linked-device QR or grants access to their other WhatsApp conversations.

The operator links Boop's WhatsApp account once with the terminal QR (`npm run whatsapp`). A private copy of the rotating operator QR is saved under `data/whatsapp/operator-qr.png`; it is never served through the public API. Customers get the chat-opening QR only after the operator account is connected. No customer phone numbers belong in `.env.local`.

After pairing, Boop sends a one-time “Hi” to the operator account's **Message yourself** chat. Successful greetings are saved privately and are not repeated on ordinary reconnects/restarts. A failed send retries on the next connection; a crash after send but before saving its receipt can duplicate this greeting. Customers receive their own “Hi” after sending the QR link's prefilled verification message successfully; merely opening the chat QR does not verify ownership or send the greeting.

Public mode requires the Clerk publishable/secret keys and issuer, exact frontend origins (`BOOP_ALLOWED_ORIGINS`), and an authenticated backend worker. Generate its local private key with `npx tsx scripts/prepare-public-auth.ts`; configure **only** the base64 public JWKS from `data/worker-jwks.txt` as `BOOP_WORKER_JWKS` on Convex. Configure `CLERK_JWT_ISSUER_DOMAIN` and `BOOP_PUBLIC_MODE=true` on Convex too. Clerk's Convex integration or a `convex` JWT template with audience `convex` must be active. Production needs its own Clerk production instance/issuer/keys and hosting origins; development credentials are not a public launch configuration.

Ownership derives from authenticated Clerk identity or a signed backend-worker claim, never a client-supplied user ID. Messages, memory/vector search, drafts, settings, agent logs, usage, automations, dashboard events, and Composio connections are isolated by user. Existing personal data remains in a separate legacy scope and is not automatically assigned to newly created accounts. Phone changes invalidate the previous WhatsApp link while retaining the account's stable internal identity. SMS OTP login and an incoming WhatsApp connection message verify separate steps.

Public requests have an initial limit of five user turns per minute and 100 per UTC day. These are development defaults, not a billing system or global cost budget. Private file, shell, and project-skill tools are excluded from customer execution on a shared host; restoring those capabilities requires isolated execution environments. Public mode currently uses WhatsApp and authenticated web APIs; legacy operator Sendblue/Telegram and proactive email webhooks are disabled in that mode until they have user-account linking. Personal mode keeps the original channels and local capabilities.

Validation: `npm run typecheck`, `npm test`, and `npm run test:backend`. Clerk development signup and phone verification were driven in the browser with a documented test number/OTP. Signed browser requests and signed worker access were verified against the development Convex deployment. Operator pairing and a real WhatsApp reply still require a live linked account; production hosting, Clerk production setup, and load testing remain separate rollout work.

## Start and pair

1. Use a WhatsApp account you control as Boop's account. A separate account/number is recommended: incoming messages from approved contacts become agent requests. The shared Sendblue number cannot be used as a WhatsApp account without Sendblue's permission and verification support.
2. In `.env.local`, set:

   ```env
   BOOP_WHATSAPP_ENABLED=true
   BOOP_WHATSAPP_ALLOWED_NUMBERS=+15551234567
   ```

   The allowed number is the person messaging Boop, not the linked account's number. Separate approved numbers with commas. An empty list blocks all incoming requests.
3. Stop any running Boop server, then run `npm run whatsapp` (backend only), or `npm run dev:parallel` for the backend and dashboard. `npm run dev` also works if you need the existing public tunnel for other channels. WhatsApp itself needs no tunnel, webhook, Twilio account, or API key.
4. On the phone signed into Boop's WhatsApp account, open **Linked devices → Link a device** and scan the terminal QR. Treat this QR as a secret. The terminal should print `[whatsapp] Connected`.
5. From the approved sender's WhatsApp account, send "Hello Boop" to the linked account's number. Do not test by sending from the linked account itself: outgoing messages are ignored to prevent reply loops.

The QR expires and refreshes automatically. Credentials are restored on restart. `GET /health` includes the WhatsApp connection status but does not expose the QR or credentials.

## Storage and recovery

Session credentials, Signal keys, pending replies, duplicate IDs, and recent outgoing messages are stored under ignored `data/whatsapp/`. Files have owner-only permissions. Keep this directory on persistent storage; do not commit it, share it, or run multiple replicas against it. `BOOP_WHATSAPP_STATE_DIR` can select another persistent directory. A process lock prevents two instances from sharing one session.

Temporary disconnects reconnect with backoff. Logged-out, replaced, forbidden, or broken sessions stop reconnecting and require attention. For a revoked session, stop Boop, unlink the old device in WhatsApp, move `data/whatsapp` to a private backup location, then restart and scan a fresh QR. A storage error requires fixing permissions/disk/state rather than silently starting a new identity.

Replies are saved before delivery. Reconnection/restart retries a saved reply without rerunning the agent and skips already submitted chunks. There is still a small duplicate-send window if the process crashes after WhatsApp accepts a chunk but before its checkpoint is saved. Assistant recording can also repeat in that narrow checkpoint window. Agent requests that fail before generating a saved reply are not automatically repeated, since they may already have performed external actions. Inspect the dashboard before issuing a new request. Queued requests awaiting generation are held in memory and can be lost if the process crashes.

## Personal mode scope

- Private text conversations only; no groups, statuses, channels, historical imports, outgoing-message loops, or media processing.
- WhatsApp v7 LIDs are resolved to approved phone numbers via their alternate identity or Baileys' mapping store. Unknown identities are rejected.
- Each personal-mode conversation includes the linked account identity and sender phone identity. Personal mode shares the operator's integrations and memory, so keep its approved-sender restriction. For customer accounts, use the public flow above.
- Baileys is unofficial and is not affiliated with Meta/WhatsApp. Account restrictions, protocol changes, and session revocation are possible. This integration does not establish official Business Platform approval or guarantee global availability.

## Validation

Run `npm run typecheck` and `npm test`. Tests cover private-message filtering, phone/LID authorization, duplicate suppression, reply recovery, Unicode chunking, binary-key persistence, private file permissions, corrupt-state handling, and concurrent-process locking. The initial runtime smoke check reached `awaiting_qr` against WhatsApp. Live end-to-end delivery requires the owner to scan the QR and send a message from the approved account.

Documentation: https://baileys.wiki/llms.txt

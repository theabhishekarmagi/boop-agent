# WhatsApp access through Baileys

Boop can receive private text messages through a linked WhatsApp account and reply using its existing OpenAI agent, memory, tools, acknowledgments, and scheduled notifications. iMessage and Telegram remain available.

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

## Current scope

- Private text conversations only; no groups, statuses, channels, historical imports, outgoing-message loops, or media processing.
- WhatsApp v7 LIDs are resolved to approved phone numbers via their alternate identity or Baileys' mapping store. Unknown identities are rejected.
- Each conversation includes the linked account identity and sender phone identity. Access is restricted to approved senders, but this remains Boop's existing **personal instance**: its connected accounts, memory services, and credentials are not isolated per customer. Do not open this instance to unrelated customers. A global public service needs tenant isolation and deployment work beyond this adapter.
- Baileys is unofficial and is not affiliated with Meta/WhatsApp. Account restrictions, protocol changes, and session revocation are possible. This integration does not establish official Business Platform approval or guarantee global availability.

## Validation

Run `npm run typecheck` and `npm test`. Tests cover private-message filtering, phone/LID authorization, duplicate suppression, reply recovery, Unicode chunking, binary-key persistence, private file permissions, corrupt-state handling, and concurrent-process locking. The initial runtime smoke check reached `awaiting_qr` against WhatsApp. Live end-to-end delivery requires the owner to scan the QR and send a message from the approved account.

Documentation: https://baileys.wiki/llms.txt

# Twilio WhatsApp for a personal Boop agent

This main-based branch uses one personal agent, memory store and integration account. Only explicitly approved WhatsApp sender numbers can use it. It does not include the Clerk/public multi-user onboarding from `stagging`. Do not use an allowlist of unrelated customers as a substitute for user isolation.

## Requirements

1. An active Twilio account and a registered WhatsApp sender showing Online/Connected. Creating a sender or receiving a WhatsApp Business ID alone does not prove it is ready.
2. The Account SID and Auth Token for the account that owns the sender. Save secrets only in `.env.local`. Meta Business ID and WhatsApp Business Account ID are not sending credentials.
3. Boop's dedicated WhatsApp sender number, different from the personal number you will message from.
4. Your approved personal sender number(s), in full E.164 format.
5. A public HTTPS URL reaching the webhook-only listener (default port 3457), not the Vite dashboard or full personal backend. Run a persistent deployment or a tunnel such as `ngrok http 3457`. Override the listener port with `TWILIO_WHATSAPP_WEBHOOK_PORT` if necessary.
6. Working OpenAI/ChatGPT authentication and a Convex development deployment compatible with this branch. The `stagging` deployment's Clerk/worker-auth configuration is not compatible with the unauthenticated personal Convex client on `main`; use a separate personal development deployment. Do not deploy this branch over a public multi-user deployment.

```dotenv
BOOP_PUBLIC_MODE=false
TWILIO_ACCOUNT_SID=AC_your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_WHATSAPP_FROM=whatsapp:+14155552671
TWILIO_WHATSAPP_WEBHOOK_URL=https://your-public-host/twilio/whatsapp/webhook
BOOP_WHATSAPP_ALLOWED_NUMBERS=+919876543210
```

Use your actual sender and recipient numbers, not these examples. The configured webhook URL must match Twilio's URL exactly, with no query string or trailing slash. This fixed URL is used to verify Twilio's signature; proxy Host headers are not trusted. If a free tunnel's hostname changes, update this variable and Twilio, then restart Boop. A2P 10DLC is US SMS registration, not WhatsApp sender registration.

## Configure and test

1. Run `npm start` after completing the configuration. If settings are missing, WhatsApp stays disabled and `/health` lists only missing variable names. `configured` means local settings loaded, not that Twilio approved the sender or delivered a message.
2. In Twilio, open **Numbers & Senders → WhatsApp sender → Configuration** (legacy: Messaging → Senders → WhatsApp Senders). Set the incoming message webhook to the exact `TWILIO_WHATSAPP_WEBHOOK_URL`, method **POST**, and save it. No Baileys QR scan is needed.
3. From your approved personal WhatsApp account, send **Hi** to Boop's registered number. This opens WhatsApp's 24-hour customer service window, allowing a free-form agent response. Our endpoint returns empty TwiML quickly and sends the generated answer through the REST API.
4. If no reply arrives, check Twilio's request/message logs for the webhook HTTP result and outbound message status. HTTP 403 means signature/account/recipient validation failed; HTTP 503 means the local queue could not accept work. Confirm the public URL still reaches the backend. Logs intentionally do not include Auth Tokens, full webhook bodies or provider errors.

Media-only messages and messages with attachments are currently ignored. Text messages, agent acknowledgments and scheduled notifications route through the existing personal agent. Free-form notifications are refused outside the local 24-hour window; send Boop another message to reopen it. Approved outbound templates are not implemented here. API acceptance is not handset delivery: inspect the Twilio message status for delivery confirmation. Ordinary Twilio/Meta messaging fees apply.

## Delivery and operating limits

Accepted text is saved before returning HTTP 200. The single-host worker processes requests in order, deduplicates the last 10,000 completed Message SIDs, and checkpoints generated replies and submitted chunks. Restart recovery resumes saved replies without regenerating the agent. Interrupted or failed inference is not automatically repeated because it may already have performed external tool actions. Review the dashboard before issuing the request again.

Local state lives in ignored `data/twilio-whatsapp/<account>/<sender>/`, with private file permissions and a process lock. Only one server may use that directory. Keep its persistent disk and backups; do not share this queue across replicas. At most 100 jobs can wait. There remains a duplicate-send window if Twilio accepts a request but its HTTP response/checkpoint is lost. Assistant recording may also repeat if the database write succeeds before its completion checkpoint. These are not exactly-once delivery guarantees.

This is a personal development branch, not a public multi-tenant service. Its other existing dashboard/API endpoints retain the original `main` access model. The separate webhook-only listener excludes those routes; tunnel port 3457, and keep the full backend/dashboard private. Registering a sender does not independently establish eligibility for distributing a general-purpose AI assistant. Confirm your intended use case and markets with Twilio before a commercial rollout.

## Validation

Run `npm run typecheck` and `npm test`. Tests exercise real HTTP form parsing and Twilio SDK signatures, tampering/account/allowlist checks, duplicate receipts, restart recovery, interrupted generation, reply-window enforcement and Unicode chunking. Live end-to-end testing additionally requires configured credentials, a reachable webhook, an active sender and an actual incoming WhatsApp message.

Official references: [Twilio WhatsApp setup](https://www.twilio.com/docs/whatsapp/self-sign-up), [webhook signature verification](https://www.twilio.com/docs/usage/security), [WhatsApp quickstart and service windows](https://www.twilio.com/docs/whatsapp/quickstart).

# Running Boop with OpenAI

Boop now uses `@openai/agents` and `@composio/openai-agents`. All five LLM workflows run through the same OpenAI adapter: interaction dispatch, execution agents, memory extraction, consolidation, and proactive-email classification.

The existing iMessage bridge, debug dashboard, Convex records, memory recall, acknowledgment messages, spawned tasks, draft approval flow, automations, connection management, multiple integration accounts, logs, and heartbeat cancellation remain wired to their existing handlers. Execution agents have hosted web search and local webpage, skill, file, and shell tools. Dispatcher agents receive only their selected internal tools.

## Accounts and credentials

- **ChatGPT account:** run `npm run login:chatgpt` locally. Eligible subscriptions, including Plus, can authorize plan usage through [Sign in with ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source/sign-in). This shares ChatGPT limits; it does not provide API credits. Availability, models, tools, and limits are determined by the account and the [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).
- **Alternatively, OpenAI API:** set `BOOP_OPENAI_AUTH=api` and `OPENAI_API_KEY` in `.env.local`. API billing is separate from Plus. Boop never falls back to this mode automatically.
- **Convex:** the existing deployment configuration is required for persistence and the dashboard. `npm run setup` or `npx convex dev` configures it.
- **Sendblue:** API key, API secret, provisioned number, and an inbound webhook are needed for real iMessage delivery.
- **Composio:** API key and connected accounts are needed for Gmail, Slack, Calendar, and other integrations. Connections still happen through Boop's dashboard.
- **Public tunnel:** ngrok or an existing public server URL is needed for Sendblue and Composio webhooks.

Keep secrets in local configuration. Do not paste passwords, keys, or OAuth tokens into chat.

## Startup

Use Node 20 or newer (verified here with Node 24).

```sh
npm install
npm run setup
npm run login:chatgpt
npm run models
npm run dev
```

The sign-in command prints a local sign-in page. Open it on the **same computer**, then select **Continue with ChatGPT**. The browser returns to a temporary `127.0.0.1` callback. Approve ChatGPT plan access and wait for the terminal's success message. Once connected, subsequent starts use the saved account and renew its credentials when needed.

If ChatGPT displays **Operation timed out** after account selection, return to the local page and click again. Each click generates a new state, nonce, and PKCE challenge while retaining the host identity. Earlier attempt callbacks are rejected. Keep the terminal running; the session allows 15 minutes. To test a different browser session, copy the local page URL into Safari or Chrome. A timeout displayed by ChatGPT before the callback is a browser/provider-side failure, and a longer local timeout alone does not resolve it. Boop never switches billing to work around it.

In `.env.local`, the defaults are:

```dotenv
BOOP_OPENAI_AUTH=chatgpt
BOOP_MODEL=gpt-6.1-sol
BOOP_SMALL_MODEL=gpt-6-luna
```

Check `npm run models` and choose available slugs if either default is unavailable. `BOOP_ADVERSARY_MODEL` optionally overrides the consolidation adversary. Existing saved Claude model IDs are ignored, falling back to the OpenAI default. Runtime model switching remains available by message using a canonical model ID or aliases `balanced`, `powerful`, and `fast`; the selected model is checked against the account catalog before saving.

The current local installation uses `gpt-5.6-sol` for main agents and `gpt-5.6-luna` for background work because those models are available to the connected account. `balanced` and `fast` follow these configured models.

### Database and dashboard

The active installation uses the Convex cloud development deployment `dazzling-cow-103`. Both `CONVEX_URL` and `VITE_CONVEX_URL` in ignored `.env.local` point to `https://dazzling-cow-103.convex.cloud`; `VITE_CONVEX_SITE_URL` points to `https://dazzling-cow-103.convex.site`. The original anonymous local deployment remains separate; its records are not copied automatically.

Restart the local services together, without requiring a public webhook tunnel:

```sh
npm run dev:parallel
```

Open the [Boop dashboard](http://localhost:5173/). The server runs at `http://localhost:3456`, and your Convex project dashboard shows cloud database records. Stop any already-running service instances before restarting them.

The existing debug dashboard monitors agents, memory, events, automations, connections, and settings. To test a local conversation directly:

```sh
curl -sS http://localhost:3456/chat \
  -H 'Content-Type: application/json' \
  -d '{"conversationId":"local","content":"Hello Boop!"}'
```

For API mode, configure these locally instead:

```dotenv
BOOP_OPENAI_AUTH=api
OPENAI_API_KEY=your-key
```

## Account management

```sh
npm run login:chatgpt -- --accounts
npm run login:chatgpt -- --add
npm run login:chatgpt -- --use=oaiapp_saved_client_id
npm run login:chatgpt -- --client=oaiapp_saved_client_id
npm run login:chatgpt -- --logout
```

`--add` adds another account; `--use` selects a connected account; `--client` reauthorizes that registration. Default login reuses the active registration. Logout revokes the saved credential and clears local tokens while retaining host/client/identity mappings for reauthorization.

Credentials are atomically saved with owner-only permissions in ignored `data/chatgpt-auth.json`; refreshes are serialized across agents and processes. `BOOP_CHATGPT_AUTH_FILE` can change the location—keep that file private and outside version control. If a process crashes while refreshing, stop Boop and remove its stale `.lock` file before retrying.

## Inference and costs

ChatGPT calls use the public Responses endpoint with OAuth credentials, streaming, `store:false`, locally carried history, namespaced function tools, and disabled SDK tracing. The transport retains completed streamed output items when the plan endpoint leaves the terminal output envelope empty; this prevents the SDK from repeatedly issuing the same request. Failed or incomplete responses propagate errors. Hosted tool availability still depends on the account; [models and inference requirements](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference) apply.

Token totals include every request in a tool loop. ChatGPT runs record $0 in the existing USD field because they consume the subscription allowance. API-mode costs are estimates for recognized models at standard short-context token rates; hosted-tool fees, long-context premiums, and unknown-model prices are excluded. Consult OpenAI billing for actual charges. Historical usage rows are retained.

Embeddings remain separate: Voyage, paid OpenAI embeddings, or the existing local Transformers fallback. ChatGPT OAuth tokens are never used for embeddings. With no embedding API key, the local model downloads on first use. Although providers share the 1024-dimensional index, changing providers requires re-embedding existing memories.

The current full-precision local model is approximately **1.3 GB** (the original ~440 MB setup estimate is inaccurate for `dtype: fp32`). Its initial download can take time on a slow connection. Keep the server running until it logs `[embeddings] local model ready`; subsequent starts use the cached model. The first memory write or recall waits for this download.

## Verification and remaining live checks

```sh
npm run typecheck
npm test
npm run build:debug
npm run smoke:openai
```

Automated tests use the actual OpenAI SDK with scripted models or mocked HTTP responses. They cover scoped tool execution, continuation history, request-body compatibility, streamed item retention, usage aggregation, errors, cancellation before execution, long tool loops, skill discovery, file/shell tools, OAuth state and PKCE, signed identity verification, credential rotation, logout, and explicit auth-mode selection. They consume no API credits. The sign-in test requires a temporary localhost listener. `smoke:openai` is a separate **live** inference and tool-continuation check that consumes the selected account's allowance or API credits.

Convex functions and indexes were deployed and types generated through the normal CLI against the local deployment. No backend schema migration was introduced.

Live checks passed with the connected ChatGPT account: both configured models completed a namespaced tool call and continuation; the local chat endpoint returned a reply and persisted the inbound message and usage records; a background worker fetched a public webpage and returned its title with a source; and the dashboard rendered connected to local Convex.

Sendblue and Composio credentials are not configured. Real iMessage delivery, connected-account reads, and externally committed drafts remain unverified. Model behavior can differ from Claude even with the same prompts and tools; check these integrations before relying on them.

The local embedding model is still downloading; semantic memory write/recall has not yet completed a live check. Automation execution and draft approval also need separate end-to-end checks.

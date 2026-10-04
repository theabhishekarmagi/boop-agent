# Telegram chat

Connect a Telegram bot from Connections through Composio. Then set one of these
in the ignored `.env.local` file and restart Boop:

```dotenv
BOOP_TELEGRAM_ALLOWED_USER_IDS=your_numeric_telegram_user_id
# Or, if your account has a username:
# BOOP_TELEGRAM_ALLOWED_USERNAMES=your_username_without_at
```

Send a text message to your bot. Boop uses the same OpenAI agent, memory,
integration tools, and automations as its existing messaging channel. Replies,
acknowledgments, and scheduled notifications return to the Telegram conversation.

The listener polls connected Telegram accounts through Composio sessions, with
credentials remaining inside Composio. No additional bot token or public URL is
required. New bot connections are discovered every 30 seconds. Only approved
private-chat senders are handled; group chats, bot senders, and non-text updates
are skipped. With no approved sender configured, polling stays disabled and
messages are not consumed.

Conversation IDs include the connection and chat ID. Update offsets, generated
replies awaiting delivery, and delivered chunk counts are stored in ignored
`data/telegram/` files with owner-only permissions. Retries resume stored replies
instead of generating them again. A crash between a successful Telegram send and
its local checkpoint can still duplicate that chunk; Telegram doesn't provide
an idempotency key for message sends.

Run one Boop server per bot. Telegram polling cannot run alongside an existing
Telegram webhook or another poller. Boop does not remove existing webhooks.
Set `BOOP_TELEGRAM_ENABLED=false` to stop polling while keeping the integration's
tools connected.

Validation: automated tests cover sender restrictions, update ordering, duplicate
updates, delivery retries, and long Unicode replies. Live session polling was
verified against the connected bot; a live agent reply requires the approved
sender to send a new message.

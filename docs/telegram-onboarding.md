# Telegram chat connection

1. Sign into Boop and connect your Telegram bot token through Composio.
2. In Connections, open Telegram and send `/start` in a private chat with the bot.
3. Return to the Telegram card in Boop. It refreshes every five seconds and shows pending accounts with name, username, and Telegram user ID.
4. Click **This is me** only for your own account. The bot automatically sends a greeting, normally within the next polling cycle (up to about 20 seconds plus provider latency).
5. Send tasks directly to the bot. Approval is saved across restarts; there is no copied verification command.

An active connection is discovered automatically within about ten seconds. Pending approvals expire after ten minutes; send `/start` again to create a fresh request. Repeated `/start` while a request is live preserves the original approval ID.

Only an authenticated dashboard session belonging to the connected bot's workspace can approve a request. Incoming `/start` never grants access by itself. Usernames and display names are untrusted labels, so approve only the request from the account you just used. Groups and bots cannot link. Pending requests are capped at ten per connection. Once approved, other senders cannot take over the channel. Disconnecting and reconnecting the integration removes the saved channel binding.

Greeting delivery is persisted and retried after send failures or process restarts. A crash after Telegram accepts the greeting but before Boop acknowledges it can produce a duplicate greeting; the Bot API send operation is not exactly-once. Existing verified channels and previously issued unexpired deep links remain compatible.

This change must run on the same server and Convex deployment used by the dashboard. Local development updates do not update an existing AWS deployment.

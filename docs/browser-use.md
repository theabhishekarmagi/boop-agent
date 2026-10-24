# Browser Use in Boop

Browser Use **0.13.11** is Boop's only active browser provider. Stagehand has been
removed from runtime dependencies. Previous comparisons and archived source remain
under `experiments/` as historical evidence, not active integrations.

## Local setup

Requirements: Node 22.18+, `uv`, Python 3.12, and an installed Chromium browser.
On macOS Boop detects Chrome first, then Brave. The current machine uses Brave.

```sh
npm run setup:browser
```

This installs the pinned Python package in ignored `data/browser-use/venv`, not your
global Python environment. No Browser Use Cloud account or separate model key is
required. Boop's existing model makes the decisions; Browser Use provides the browser
and compact DOM representation through a private stdio worker.

Nonsecret `.env.local` settings (already configured on this machine):

```dotenv
BOOP_BROWSER_ENABLED=true
BOOP_BROWSER_ORIGINS=https://docs.browser-use.com,https://browser-use.com,https://quotes.toscrape.com
BOOP_BROWSER_HEADLESS=true
# Optional explicit paths:
# BOOP_BROWSER_EXECUTABLE_PATH=/Applications/Brave Browser.app/Contents/MacOS/Brave Browser
# BOOP_BROWSER_PYTHON=/absolute/path/to/venv/bin/python
```

Origins are an explicit comma-separated HTTPS allowlist, with no URL paths. Add
trusted research sites as needed. Stagehand-specific env names are no longer read.
Restart the local server after changing env settings.

## Test

```sh
npm run smoke:browser
npm run test:browser
npm run research:browser
# Nonpersistent candidate-model check; does not change the configured default:
npm run smoke:browser -- --model=gpt-6-luna
```

The smoke test uses the actual operator runtime to open a JavaScript-only public
sandbox, read the first three author names, and verify both answer and browser
evidence. It does not reproduce quotations or submit anything. Local reports go to
`data/browser-use/model-smoke-<model>.json`. These tasks consume the existing model
account's allocation; a zero dollar estimate is not an inference-cost measurement.

## Current boundary

This remains local/operator-only. Customer workspaces, production mode and public
mode cannot enable it. It is available to research-enabled agent runs, not every
classifier or conversation. No browser process is created until `BrowserOpen`.

Tools: `BrowserOpen`, `BrowserRead`, `BrowserFollowLink`, `BrowserCloseTab`, in the
nonreserved `boop_browser` namespace. They use compact native DOM snapshots and
bounded text windows, follow ordinary links, and return actual source URLs. Existing
API integrations and WebFetch remain the first choices for simpler tasks.

Each run owns a fresh browser profile, at most four tabs and one worker slot. Calls
are serialized. Sessions close on completion, cancellation or 60-second inactivity;
individual worker operations time out after 45 seconds. Unknown tabs, stale link
snapshots, disallowed origins and cross-workspace access are rejected. No saved
personal browser profiles, forms, uploads or arbitrary JavaScript tools are exposed.

This is not the full autonomous Browser Use Agent or Cloud service. DOM scrolling,
saved logins, interactive applications, backend-enforced submission approvals and
network isolation require a separate implementation before public browser access.
The SDK domain policy and URL checks are not a complete network security boundary.
Nothing in this change configures or deploys an AWS browser worker.

## Model choice and token efficiency

Browser Use's compact DOM used about 44% fewer cumulative input tokens than the
Stagehand adapter in our small controlled comparison. It was not consistently faster,
and the result is not a universal saving. Keep reducing unnecessary page reads,
repeated navigation and tool turns; do not truncate away facts the task needs.

The configured main model remains `gpt-5.6-sol`; the configured small model remains
`gpt-5.6-luna`. The account also has `gpt-6-luna` available, a candidate for routine
work. A smaller model generally changes cost/latency, not the token size of the same
input. Benchmark total tokens per successful task and correctness before changing
routing or making it the default. One smoke test is not enough to establish complex
research or external-action reliability.

Current official model reference:
https://developers.openai.com/api/docs/models/gpt-6-luna

## Migration checks — 24 October 2026

- Stagehand is absent from runtime imports and root dependencies; archived source
  is not compiled or loaded.
- Full Node suite: 55 passed, 5 existing auth integration tests skipped; typecheck passed.
- Real operator smoke with `gpt-5.6-sol`: passed, 15.66 seconds, one BrowserOpen call,
  11,638 input tokens (8,704 cached) and 63 output tokens.
- Same one-task smoke with candidate `gpt-6-luna`: passed, 12.06 seconds, one
  BrowserOpen call, 11,638 input tokens (8,192 cached) and 63 output tokens.
- These single runs are not a broad model benchmark. Equal inputs show why a smaller
  model alone is not a context-token reduction. No automatic model routing/default
  change was made, and no billing amount was measured.
- The browser qualification command tests native link navigation, tabs, stale IDs,
  origin restrictions and workspace isolation without model calls.
- Nothing was pushed or deployed; the public AWS instance was not changed.

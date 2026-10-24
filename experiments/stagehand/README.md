> **Historical experiment.** Boop now uses Browser Use only. Stagehand is no longer
> installed or active. Previous runners are retained as `.archived` source under
> `experiments/stagehand/archive/`; old npm commands below are historical. See
> [current setup](../../docs/browser-use.md) for supported commands.

# Stagehand local qualification

Boop's optional browser research adapter uses **Stagehand 4.3.0** and local Chromium.
Requires Node **22.18+**. It keeps Boop's existing model/tool loop. It does not call
Stagehand's AI `act`, `observe`, or `extract` methods, use a paid model gateway, or
start a second agent. Those are separate capabilities requiring further evaluation.

## Configure and use

The local `.env.local` has been configured with the nonsecret settings in `.env.example`.
Restart the local Boop server to pick up env changes. The feature is available only
when `BOOP_STAGEHAND_ENABLED=true`, the workspace is `boop:operator`, and neither
production mode nor public mode is enabled. Signed-in customer dashboards do not
receive browser tools in this qualification build.

Start with a request such as: “Use the browser to read Stagehand's documentation
and list the available browser configuration options, with sources.”

Tool namespace: `boop_browser` (the API reserves `browser` for built-in tools).

Supported tools: `BrowserOpen`, `BrowserRead`, `BrowserFollowLink`, `BrowserCloseTab`.
Only exact HTTPS origins listed in `BOOP_STAGEHAND_ORIGINS` may be navigated.
The initial allowlist contains the Stagehand website and docs. Add trusted sites
explicitly for further testing; this is not unrestricted browsing.

Chrome/Brave is launched in a fresh temporary profile, never your existing logged-in
profile. One browser job can run at a time, with up to four tabs. Other browser jobs
receive a busy response rather than sharing a session. Browser creation is lazy;
ordinary API/search/fetch tasks create no browser. Sessions are closed at run exit,
cancellation, or 60 seconds of browser inactivity. After idle expiry, start a new task.

## Run tests

```sh
npm run typecheck
node --import tsx --test tests/stagehand-browser.test.ts
npm run test:stagehand
npm run smoke:stagehand
npm run research:stagehand
```

`test:stagehand` starts a temporary loopback-only synthetic website, then tests:

- JavaScript-only inventory that plain HTML fetching cannot see;
- real snapshot IDs and link navigation;
- multiple tabs and stale-snapshot rejection;
- disallowed origins and redirects;
- workspace ownership and fresh-profile cookie isolation;
- native Stagehand form filling without submitting anything.

The fixture's private HTTP origin is injected only by the test harness. Runtime
configuration does not allow that exception. Test data contains no personal accounts.
Native form filling is tested at the SDK layer; it is **not exposed to agents** yet.

`smoke:stagehand` makes one real Boop model task using the existing credentials.
The model opens the real local browser and reads a random verification value that
is absent from the HTML and prompt. It verifies the answer and records tool calls,
latency and model usage. It sends no messages and submits no forms. ChatGPT token
usage shares the connected account's limits; reported dollar usage is Boop's API
price estimate, not a ChatGPT invoice. Reconnect with `npm run login:chatgpt` if expired.

Reports are written under ignored `data/stagehand/`. No secrets are copied into Git.

## Results and promotion gate

See `RESULTS.md`. Do not enable or deploy broadly based on synthetic latency alone.
Use repeated representative research workflows and compare completion rate, total
latency, tokens, browser lifetime, and resource use. Test success and speed separately.

Plain HTML fetch stays the faster path for static pages. Browser startup is additional
work; Stagehand is useful when JavaScript or interactive navigation is necessary.
This is not a benchmark against Playwright or Browser Use.

## Scope before public deployment

This is a local research build. Agent-facing button clicks, form filling/submission,
file uploads, arbitrary JavaScript, saved website logins, and automated retries of
external writes are intentionally absent. Add backend-enforced approved actions and
login takeover before enabling those workflows. A navigation link can itself have
side effects on some sites, so only trusted research origins belong on this allowlist.

The SDK domain policy adds a browser-side domain boundary, but is not a replacement
for network egress isolation against DNS rebinding or malicious subresources. Do not
expose the local worker publicly. Hosted deployment needs a separate browser worker,
network policy, per-user encrypted persisted sessions if desired, and measured capacity.

Managed server-side action caching is a Browserbase feature; this self-hosted adapter
does not claim to have it. No AWS resource or paid browser service was configured.

References:
- https://docs.stagehand.dev/v4/integrations/agent-frameworks/overview
- https://docs.stagehand.dev/v4/reference/page
- https://docs.stagehand.dev/v4/configuration/browser
- https://docs.stagehand.dev/v4/best-practices/speed-optimization

## Live public research comparison

`npm run research:stagehand` runs the same three tasks with Boop's actual WebFetch
and Stagehand tools, using the same configured model, six sequential model tasks:

1. Read official Stagehand migration documentation and identify compatibility gaps.
2. Compare two providers' current browser infrastructure pricing for a stated workload.
3. Read author names from the public JavaScript-only Quotes to Scrape sandbox.

It supplies source URLs to both methods, so it compares source reading and synthesis,
not search discovery. Each task/method gets one run, a fresh agent run and (where
applicable) a fresh browser. The order is fetch then browser; network/model caches
and timing variation may influence the result. Completion checks use expected facts
and cited URLs, with a tool-evidence check to reject memorized JavaScript-page answers.
The two real documentation/pricing tasks are distinct from the JS sandbox demonstration.
No logins or paid browser accounts are used, and no messages/forms are submitted.
Model usage consumes the existing connected account's allocation. The harness's
site allowlists are scoped to these runs, without broadening the app's env allowlist.
Reports: ignored `data/stagehand/research-results.json` and `RESEARCH.md` here.

> **Historical experiment.** Boop now uses Browser Use only. Stagehand is no longer
> installed or active. Previous runners are retained as `.archived` source under
> `experiments/stagehand/archive/`; old npm commands below are historical. See
> [current setup](../../docs/browser-use.md) for supported commands.

# Local results — 2026-10-24

Stagehand 4.3.0, Node 24.14.0, macOS, installed Brave Chromium, headless, fresh
profiles. Three trials against a loopback-only synthetic website. No hosted-browser
charges or separate Stagehand inference calls. Raw measurements are in ignored
`data/stagehand/qualification.json`.

| Trial | Plain fetch + text parsing | Cold browser open + first snapshot | Warm read until live value visible |
| --- | ---: | ---: | ---: |
| 1 | 21.6 ms | 1,381.6 ms | 30.7 ms |
| 2 | 2.1 ms | 1,391.9 ms | 30.4 ms |
| 3 | 1.6 ms | 1,394.8 ms | 23.2 ms |

Medians: fetch **2.1 ms**; cold open **1,391.9 ms**; warm read **30.4 ms**.
Warm read includes any readiness retries. These local fixture timings exclude model
inference, public-network latency, production load and login flows. The fetch baseline
uses the same HTML-to-text approach as WebFetch, with fixture access for the harness;
it does not bypass production WebFetch's private-address protection.

- Static content: plain fetch and browser both succeeded in all three trials.
- JavaScript-only value: browser succeeded 3/3; plain fetch could not see it 0/3.
- Link navigation: 3/3; stale IDs and cross-workspace access refused.
- Multiple tabs, origin and redirect boundaries: passed.
- Native form filling: passed; **zero submissions**.
- Cookie isolation across fresh profiles: passed.
- `npm test`: **53 passed, 5 existing tests skipped, zero failures**.
- TypeScript: passed.
- Real public-page check: Stagehand browser configuration docs loaded successfully;
  cold navigation + bounded snapshot **5,471 ms**. This includes public-network loading
  and must not be confused with the loopback timings above.
- Real Boop model smoke: **passed** after reconnection and correcting the reserved
  `browser` namespace to `boop_browser` in both runtime and smoke harness.
  `gpt-5.6-sol` called `BrowserOpen` and `BrowserRead`, then correctly returned a random
  JavaScript-only value and the product price. Total **12,098.8 ms**; browser operations
  **1,601.3 ms**; 3,355 input tokens and 104 output tokens. One fresh browser, zero form
  submissions. Raw report: ignored `data/stagehand/model-smoke.json`. The runtime's
  zero dollar estimate does not establish free inference or measured billing.

Conclusion: useful additional capability for JavaScript-rendered pages. **No evidence
of a general task-speed improvement**; do not replace API tools or WebFetch. Retain
as an opt-in local experiment: the real-model smoke passed, but representative
production tasks and an end-to-end performance comparison are still required.
Nothing has been pushed or deployed.

## Reserved namespace regression

The API reserves `browser` for built-in tools. Custom tools now use the shared
`BROWSER_NAMESPACE = "boop_browser"` constant in production wiring and the test
harness. The runtime test asserts all four browser function tools carry that
namespace. Typecheck and the 20 focused runtime/browser tests passed after this fix.

## Public research follow-up

See [RESEARCH.md](RESEARCH.md) for six live public-source comparisons and one stricter
pricing follow-up. Stagehand completed the tested browser tasks, but fetching was
faster for static-source research. The browser remains local and unpushed.
